"use strict";

const { Pool } = require("pg");

const LOCAL_CATALOG_DATABASE_URL = "postgresql://datamap_catalog_app@127.0.0.1:5432/datamap_catalog";
const MAX_BODY_BYTES = 32 * 1024;
const SORT_COLUMNS = {
  sourceRow: "a.source_row",
  name: "a.name_cn",
  updatedAt: "a.updated_at",
};

class HttpError extends Error {
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

function safeError(error) {
  return cleanText(error?.message || "元数据服务暂不可用", 300)
    .replace(/postgresql:\/\/[^\s]+/gi, "postgresql://***")
    .replace(/password=[^\s]+/gi, "password=***");
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "请求内容过大", "PAYLOAD_TOO_LARGE"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (_) {
        reject(new HttpError(400, "请求格式无效", "INVALID_JSON"));
      }
    });
    request.on("error", reject);
  });
}

function integerParam(value, fallback, minimum, maximum, label) {
  if (value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new HttpError(400, `${label}必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  return number;
}

function catalogPoolConfig() {
  const connectionString = cleanText(process.env.CATALOG_DATABASE_URL, 2048)
    || (process.env.NODE_ENV === "production" ? "" : LOCAL_CATALOG_DATABASE_URL);
  if (!connectionString) {
    throw new Error("生产环境缺少 CATALOG_DATABASE_URL");
  }
  const config = {
    connectionString,
    application_name: "dongpeng_datamap_api",
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  };
  const sslMode = cleanText(process.env.CATALOG_DATABASE_SSL_MODE, 20).toLowerCase();
  if (sslMode === "disable") config.ssl = false;
  if (sslMode === "require") config.ssl = { rejectUnauthorized: false };
  if (sslMode === "verify") config.ssl = { rejectUnauthorized: true };
  return config;
}

function normalizeAssetInput(body) {
  const asset = {
    nameCn: cleanText(body.nameCn, 255),
    l1Domain: cleanText(body.l1Domain, 255),
    l2Topic: cleanText(body.l2Topic, 255),
    l3Object: cleanText(body.l3Object, 255),
    owner: cleanText(body.owner, 120) || null,
    description: cleanText(body.description, 4000) || null,
    onlineStatus: cleanText(body.onlineStatus, 30) || null,
    lakeStatus: cleanText(body.lakeStatus, 30) || null,
    sensitivityLevel: cleanText(body.sensitivityLevel, 30) || null,
  };
  const missing = [
    ["中文表名", asset.nameCn],
    ["L1 主题域", asset.l1Domain],
    ["L2 主题域", asset.l2Topic],
    ["L3 业务对象", asset.l3Object],
  ].filter(([, value]) => !value).map(([label]) => label);
  if (missing.length) throw new HttpError(400, `${missing.join("、")}不能为空`);
  const allowedStatuses = new Set([null, "是", "否", "待确认"]);
  if (!allowedStatuses.has(asset.onlineStatus) || !allowedStatuses.has(asset.lakeStatus)) {
    throw new HttpError(400, "线上化和入湖状态只能为：是、否、待确认");
  }
  return asset;
}

function createCatalogApi() {
  const pool = new Pool(catalogPoolConfig());
  pool.on("error", (error) => console.error(`元数据仓库连接异常：${safeError(error)}`));

  async function getSummary(response) {
    const result = await pool.query(`
      SELECT
        COUNT(*)::INTEGER AS "assets",
        COUNT(DISTINCT l1_domain)::INTEGER AS "domains",
        COUNT(*) FILTER (WHERE online_status = '是')::INTEGER AS "online",
        COUNT(*) FILTER (WHERE lake_status = '是')::INTEGER AS "inLake",
        (SELECT COUNT(*)::INTEGER FROM catalog_physical_tables) AS "physicalTables",
        (SELECT COUNT(*)::INTEGER FROM catalog_columns WHERE is_active = TRUE) AS "columns",
        MAX(updated_at) AS "updatedAt"
      FROM catalog_assets
    `);
    sendJson(response, 200, { ok: true, summary: result.rows[0] });
  }

  async function listAssets(response, url) {
    const page = integerParam(url.searchParams.get("page"), 1, 1, 100000, "页码");
    const pageSize = integerParam(url.searchParams.get("pageSize"), 20, 10, 100, "每页数量");
    const query = cleanText(url.searchParams.get("query"), 100);
    const online = cleanText(url.searchParams.get("online"), 30);
    const lake = cleanText(url.searchParams.get("lake"), 30);
    const sort = cleanText(url.searchParams.get("sort"), 30) || "sourceRow";
    const direction = cleanText(url.searchParams.get("direction"), 10).toLowerCase() || "asc";
    if (online && !["是", "否", "待确认"].includes(online)) throw new HttpError(400, "线上化筛选值无效");
    if (lake && !["是", "否", "待确认"].includes(lake)) throw new HttpError(400, "入湖筛选值无效");
    if (!SORT_COLUMNS[sort]) throw new HttpError(400, "排序字段无效");
    if (!new Set(["asc", "desc"]).has(direction)) throw new HttpError(400, "排序方向无效");

    const params = [query, online, lake];
    const whereSql = `
      WHERE ($1 = '' OR
        a.name_cn ILIKE '%' || $1 || '%' OR
        a.asset_code ILIKE '%' || $1 || '%' OR
        COALESCE(a.owner, '') ILIKE '%' || $1 || '%' OR
        a.l1_domain ILIKE '%' || $1 || '%' OR
        a.l2_topic ILIKE '%' || $1 || '%' OR
        a.l3_object ILIKE '%' || $1 || '%' OR
        EXISTS (
          SELECT 1 FROM catalog_physical_tables search_table
          WHERE search_table.asset_id = a.id
            AND (search_table.schema_name || '.' || search_table.table_name) ILIKE '%' || $1 || '%'
        )
      )
      AND ($2 = '' OR a.online_status = $2)
      AND ($3 = '' OR a.lake_status = $3)
    `;
    const [countResult, itemsResult] = await Promise.all([
      pool.query(`SELECT COUNT(*)::INTEGER AS total FROM catalog_assets a ${whereSql}`, params),
      pool.query(`
        SELECT
          a.id::TEXT AS "id",
          a.asset_code AS "assetCode",
          a.name_cn AS "nameCn",
          a.l1_domain AS "l1Domain",
          a.l2_topic AS "l2Topic",
          a.l3_object AS "l3Object",
          a.owner,
          a.description,
          a.online_status AS "onlineStatus",
          a.lake_status AS "lakeStatus",
          a.sensitivity_level AS "sensitivityLevel",
          a.source_row AS "sourceRow",
          a.updated_at AS "updatedAt",
          COALESCE(physical."tables", '[]'::JSONB) AS "physicalTables"
        FROM catalog_assets a
        LEFT JOIN LATERAL (
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'id', p.id::TEXT,
            'schemaName', p.schema_name,
            'tableName', p.table_name,
            'tableType', p.table_type,
            'isActive', p.is_active,
            'estimatedRows', p.estimated_rows,
            'totalBytes', p.total_bytes
          ) ORDER BY p.id) AS "tables"
          FROM catalog_physical_tables p WHERE p.asset_id = a.id
        ) physical ON TRUE
        ${whereSql}
        ORDER BY ${SORT_COLUMNS[sort]} ${direction.toUpperCase()} NULLS LAST, a.id ASC
        LIMIT $4 OFFSET $5
      `, [...params, pageSize, (page - 1) * pageSize]),
    ]);
    const total = countResult.rows[0].total;
    sendJson(response, 200, {
      ok: true,
      page,
      pageSize,
      total,
      pages: Math.max(Math.ceil(total / pageSize), 1),
      items: itemsResult.rows,
    });
  }

  async function updateAsset(request, response, assetId) {
    if (!/^\d+$/.test(assetId) || assetId === "0") throw new HttpError(400, "资产 ID 无效");
    const asset = normalizeAssetInput(await readJsonBody(request));
    const result = await pool.query(`
      UPDATE catalog_assets SET
        name_cn = $1,
        l1_domain = $2,
        l2_topic = $3,
        l3_object = $4,
        owner = $5,
        description = $6,
        online_status = $7,
        lake_status = $8,
        sensitivity_level = $9
      WHERE id = $10
      RETURNING id::TEXT AS "id", asset_code AS "assetCode", updated_at AS "updatedAt"
    `, [
      asset.nameCn, asset.l1Domain, asset.l2Topic, asset.l3Object, asset.owner,
      asset.description, asset.onlineStatus, asset.lakeStatus, asset.sensitivityLevel, assetId,
    ]);
    if (!result.rows[0]) throw new HttpError(404, "未找到该元数据资产", "NOT_FOUND");
    sendJson(response, 200, { ok: true, asset: result.rows[0], message: "元数据已保存" });
  }

  async function findPreviewTarget(assetCode, physicalIndex) {
    const result = await pool.query(`
      SELECT JSONB_BUILD_OBJECT(
        'id', p.id::TEXT,
        'schemaName', p.schema_name,
        'tableName', p.table_name,
        'tableType', p.table_type,
        'isActive', p.is_active,
        'lastSeenAt', p.last_seen_at
      ) AS target
      FROM catalog_assets a
      JOIN catalog_physical_tables p ON p.asset_id = a.id
      WHERE a.asset_code = $1
      ORDER BY p.id
      LIMIT 1 OFFSET $2
    `, [assetCode, physicalIndex]);
    return result.rows[0]?.target || null;
  }

  async function getAssetFields(response, assetCode, physicalIndex) {
    const target = await findPreviewTarget(assetCode, physicalIndex);
    if (!target) throw new HttpError(404, "当前资产没有可读取字段的物理表", "PHYSICAL_TABLE_NOT_FOUND");
    const result = await pool.query(`
      SELECT
        id::TEXT AS "id",
        column_name AS "columnName",
        ordinal_position AS "ordinalPosition",
        data_type AS "dataType",
        is_nullable AS "isNullable",
        default_value AS "defaultValue",
        is_primary_key AS "isPrimaryKey",
        column_comment AS "columnComment",
        sensitivity_level AS "sensitivityLevel",
        masking_rule AS "maskingRule",
        last_seen_at AS "lastSeenAt"
      FROM catalog_columns
      WHERE physical_table_id = $1 AND is_active = TRUE
      ORDER BY ordinal_position, id
    `, [target.id]);
    sendJson(response, 200, {
      ok: true,
      assetCode,
      physicalIndex,
      physicalTable: target,
      columns: result.rows,
    });
  }

  async function handle(request, response, url) {
    try {
      if (request.method === "GET" && url.pathname === "/api/catalog/summary") {
        await getSummary(response);
        return true;
      }
      if (request.method === "GET" && url.pathname === "/api/catalog/assets") {
        await listAssets(response, url);
        return true;
      }
      const fieldsMatch = url.pathname.match(/^\/api\/catalog\/assets\/by-code\/([^/]+)\/fields$/);
      if (request.method === "GET" && fieldsMatch) {
        const assetCode = cleanText(decodeURIComponent(fieldsMatch[1]), 255);
        const physicalIndex = integerParam(url.searchParams.get("physicalIndex"), 0, 0, 100, "物理表序号");
        if (!assetCode) throw new HttpError(400, "资产编码不能为空");
        await getAssetFields(response, assetCode, physicalIndex);
        return true;
      }
      const assetMatch = url.pathname.match(/^\/api\/catalog\/assets\/(\d+)$/);
      if (request.method === "PATCH" && assetMatch) {
        await updateAsset(request, response, assetMatch[1]);
        return true;
      }
      return false;
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error(`元数据 API 异常：${safeError(error)}`);
      sendJson(response, status, {
        ok: false,
        code: error instanceof HttpError ? error.code : "CATALOG_UNAVAILABLE",
        message: status >= 500 ? "元数据服务暂不可用，请稍后重试" : error.message,
      });
      return true;
    }
  }

  return {
    handle,
    findPreviewTarget,
    close: () => pool.end(),
  };
}

module.exports = { createCatalogApi };
