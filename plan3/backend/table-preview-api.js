"use strict";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_METRICS_TIMEOUT_MS = 30_000;
const MAX_CELL_LENGTH = 2_000;

class PreviewError extends Error {
  constructor(status, message, code = "INVALID_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function integerParam(value, fallback, minimum, maximum, label) {
  if (value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new PreviewError(400, `${label}必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  return number;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function safeCellValue(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return `[二进制数据 ${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();
  let text;
  if (typeof value === "object") {
    try { text = JSON.stringify(value); }
    catch (_) { text = String(value); }
  } else {
    text = String(value);
  }
  return text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH)}…` : text;
}

function safeError(error) {
  return cleanText(error?.message || "表数据查询失败", 300)
    .replace(/postgresql:\/\/[^\s]+/gi, "postgresql://***")
    .replace(/password=[^\s]+/gi, "password=***");
}

function queryTimeoutMs() {
  const configured = Number(process.env.QUERY_TIMEOUT_MS);
  if (!Number.isInteger(configured)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(configured, 1_000), 30_000);
}

function metricsTimeoutMs() {
  const configured = Number(process.env.METRICS_QUERY_TIMEOUT_MS);
  if (!Number.isInteger(configured)) return DEFAULT_METRICS_TIMEOUT_MS;
  return Math.min(Math.max(configured, 1_000), 120_000);
}

async function resolveSourceTable(client, target) {
  const result = await client.query(`
    SELECT table_schema AS "schemaName", table_name AS "tableName", table_type AS "tableType"
    FROM information_schema.tables
    WHERE LOWER(table_schema) = LOWER($1)
      AND LOWER(table_name) = LOWER($2)
    ORDER BY (table_schema = $1 AND table_name = $2) DESC
    LIMIT 1
  `, [target.schemaName, target.tableName]);
  return result.rows[0] || null;
}

async function runReadOnlyPreview(pool, sourceTable, page, pageSize) {
  const client = await pool.connect();
  const startedAt = Date.now();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${queryTimeoutMs()}`);
    const offset = (page - 1) * pageSize;
    const sql = `SELECT * FROM ${quoteIdentifier(sourceTable.schemaName)}.${quoteIdentifier(sourceTable.tableName)} LIMIT $1 OFFSET $2`;
    const result = await client.query(sql, [pageSize + 1, offset]);
    await client.query("COMMIT");
    const hasMore = result.rows.length > pageSize;
    const rows = result.rows.slice(0, pageSize);
    return {
      columns: result.fields.map((field) => ({ name: field.name, typeOid: field.dataTypeID })),
      rows: rows.map((row) => result.fields.map((field) => safeCellValue(row[field.name]))),
      hasMore,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function runReadOnlyMetrics(pool, sourceTable) {
  const client = await pool.connect();
  const startedAt = Date.now();
  const qualifiedName = `${quoteIdentifier(sourceTable.schemaName)}.${quoteIdentifier(sourceTable.tableName)}`;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${metricsTimeoutMs()}`);
    const result = await client.query({
      text: `
        SELECT
          pg_total_relation_size($1::regclass)::BIGINT AS "totalBytes",
          pg_size_pretty(pg_total_relation_size($1::regclass)) AS "totalSize",
          COUNT(*)::BIGINT AS "exactRowCount"
        FROM ${qualifiedName}
      `,
      values: [qualifiedName],
      query_timeout: metricsTimeoutMs(),
    });
    await client.query("COMMIT");
    return { ...result.rows[0], durationMs: Date.now() - startedAt };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function createTablePreviewApi({ catalogApi, getSourcePool }) {
  async function handle(request, response, url) {
    const previewMatch = url.pathname.match(/^\/api\/source\/assets\/([^/]+)\/preview$/);
    const metricsMatch = url.pathname.match(/^\/api\/source\/assets\/([^/]+)\/metrics$/);
    const match = previewMatch || metricsMatch;
    if (!match) return false;
    if (request.method !== "GET") {
      sendJson(response, 405, { ok: false, code: "METHOD_NOT_ALLOWED", message: "Method Not Allowed" });
      return true;
    }

    try {
      const assetCode = cleanText(decodeURIComponent(match[1]), 255);
      const physicalIndex = integerParam(url.searchParams.get("physicalIndex"), 0, 0, 100, "物理表序号");
      const page = integerParam(url.searchParams.get("page"), 1, 1, 100_000, "页码");
      const pageSize = integerParam(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, "每页数量");
      if (!assetCode) throw new PreviewError(400, "资产编码不能为空");

      const target = await catalogApi.findPreviewTarget(assetCode, physicalIndex);
      if (!target) throw new PreviewError(404, "当前资产没有可查询的物理表", "PHYSICAL_TABLE_NOT_FOUND");

      const pool = await getSourcePool();
      if (!pool) throw new PreviewError(503, "PostgreSQL 数据源当前未连接", "SOURCE_UNAVAILABLE");
      const client = await pool.connect();
      let sourceTable;
      try { sourceTable = await resolveSourceTable(client, target); }
      finally { client.release(); }
      if (!sourceTable) {
        throw new PreviewError(404, `数据源中未找到物理表 ${target.schemaName}.${target.tableName}`, "SOURCE_TABLE_NOT_FOUND");
      }

      if (metricsMatch) {
        const technicalMetrics = await runReadOnlyMetrics(pool, sourceTable);
        await catalogApi.updatePhysicalTableTechnicalMetrics(target.id, technicalMetrics);
        sendJson(response, 200, {
          ok: true,
          assetCode,
          physicalIndex,
          physicalTable: {
            ...target,
            ...technicalMetrics,
          },
        });
        return true;
      }

      const preview = await runReadOnlyPreview(pool, sourceTable, page, pageSize);
      sendJson(response, 200, {
        ok: true,
        assetCode,
        physicalIndex,
        table: sourceTable,
        page,
        pageSize,
        ...preview,
      });
    } catch (error) {
      const expected = error instanceof PreviewError;
      const timedOut = error?.code === "57014" || error?.code === "QUERY_READ_TIMEOUT";
      const status = expected ? error.status : (timedOut ? 408 : 500);
      if (status >= 500) console.error(`表数据查询异常：${safeError(error)}`);
      sendJson(response, status, {
        ok: false,
        code: expected ? error.code : (timedOut ? "QUERY_TIMEOUT" : "PREVIEW_FAILED"),
        message: expected ? error.message : (timedOut ? "指标或数据查询超时，请稍后重试" : "表数据或指标查询失败，请稍后重试"),
      });
    }
    return true;
  }

  return { handle };
}

module.exports = { createTablePreviewApi };
