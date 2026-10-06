"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { loadSourceConnection } = require("../credential-store");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const REPORT_FILE = path.join(PROJECT_ROOT, ".data", "catalog-sync-report.json");
const COLUMN_BATCH_SIZE = 500;

function cleanText(value, maxLength = 2048) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function safeError(error) {
  return cleanText(error?.message || "字段结构同步失败", 500)
    .replace(/postgresql:\/\/[^\s]+/gi, "postgresql://***")
    .replace(/password=[^\s]+/gi, "password=***");
}

function sourceConnectionConfig(config) {
  const sslMode = cleanText(config.sslMode, 20).toLowerCase();
  return {
    host: cleanText(config.host, 255),
    port: Number(config.port),
    database: cleanText(config.database, 120),
    user: cleanText(config.username, 120),
    password: String(config.password || ""),
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: sslMode === "verify" },
    application_name: "dongpeng_datamap_catalog_sync",
    connectionTimeoutMillis: 15_000,
    query_timeout: 60_000,
  };
}

function catalogConnectionConfig() {
  const connectionString = cleanText(process.env.CATALOG_DATABASE_URL);
  if (!connectionString) throw new Error("缺少 CATALOG_DATABASE_URL，未连接元数据仓库");
  const config = { connectionString, application_name: "dongpeng_datamap_catalog_sync" };
  const sslMode = cleanText(process.env.CATALOG_DATABASE_SSL_MODE, 20).toLowerCase();
  if (sslMode === "disable") config.ssl = false;
  if (sslMode === "require") config.ssl = { rejectUnauthorized: false };
  if (sslMode === "verify") config.ssl = { rejectUnauthorized: true };
  return config;
}

function targetValues(targets) {
  const params = [];
  const values = targets.map((target, index) => {
    params.push(target.schemaName, target.tableName);
    const start = index * 2 + 1;
    return `($${start}::TEXT, $${start + 1}::TEXT)`;
  });
  return { sql: values.join(", "), params };
}

function targetKey(schemaName, tableName) {
  return `${String(schemaName).toLowerCase()}\u0000${String(tableName).toLowerCase()}`;
}

async function readSourceMetadata(client, targets) {
  const values = targetValues(targets);
  const tableResult = await client.query(`
    WITH targets(requested_schema, requested_table) AS (VALUES ${values.sql})
    SELECT
      targets.requested_schema AS "requestedSchema",
      targets.requested_table AS "requestedTable",
      namespace.nspname AS "schemaName",
      relation.relname AS "tableName",
      CASE relation.relkind
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized_view'
        WHEN 'f' THEN 'foreign_table'
        ELSE 'table'
      END AS "tableType",
      pg_catalog.obj_description(relation.oid, 'pg_class') AS "tableComment",
      GREATEST(relation.reltuples, 0)::BIGINT AS "estimatedRows",
      CASE WHEN relation.relkind IN ('r', 'm')
        THEN pg_catalog.pg_total_relation_size(relation.oid)::BIGINT
        ELSE NULL
      END AS "totalBytes"
    FROM targets
    JOIN pg_catalog.pg_namespace namespace
      ON LOWER(namespace.nspname) = LOWER(targets.requested_schema)
    JOIN pg_catalog.pg_class relation
      ON relation.relnamespace = namespace.oid
      AND LOWER(relation.relname) = LOWER(targets.requested_table)
    WHERE relation.relkind IN ('r', 'v', 'm', 'f')
  `, values.params);

  const columnResult = await client.query(`
    WITH targets(requested_schema, requested_table) AS (VALUES ${values.sql})
    SELECT
      targets.requested_schema AS "requestedSchema",
      targets.requested_table AS "requestedTable",
      columns.column_name AS "columnName",
      columns.ordinal_position AS "ordinalPosition",
      COALESCE(pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), columns.data_type) AS "dataType",
      columns.is_nullable AS "isNullable",
      columns.column_default AS "defaultValue",
      description.description AS "columnComment"
    FROM targets
    JOIN information_schema.columns columns
      ON LOWER(columns.table_schema) = LOWER(targets.requested_schema)
      AND LOWER(columns.table_name) = LOWER(targets.requested_table)
    LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.nspname = columns.table_schema
    LEFT JOIN pg_catalog.pg_class relation
      ON relation.relnamespace = namespace.oid AND relation.relname = columns.table_name
    LEFT JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = relation.oid
      AND attribute.attname = columns.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    LEFT JOIN pg_catalog.pg_description description
      ON description.objoid = relation.oid AND description.objsubid = attribute.attnum
    ORDER BY targets.requested_schema, targets.requested_table, columns.ordinal_position
  `, values.params);

  const primaryKeyResult = await client.query(`
    WITH targets(requested_schema, requested_table) AS (VALUES ${values.sql})
    SELECT
      targets.requested_schema AS "requestedSchema",
      targets.requested_table AS "requestedTable",
      keys.column_name AS "columnName"
    FROM targets
    JOIN information_schema.table_constraints constraints
      ON LOWER(constraints.table_schema) = LOWER(targets.requested_schema)
      AND LOWER(constraints.table_name) = LOWER(targets.requested_table)
      AND constraints.constraint_type = 'PRIMARY KEY'
    JOIN information_schema.key_column_usage keys
      ON keys.constraint_schema = constraints.constraint_schema
      AND keys.constraint_name = constraints.constraint_name
      AND keys.table_schema = constraints.table_schema
      AND keys.table_name = constraints.table_name
  `, values.params);

  const primaryKeys = new Set(primaryKeyResult.rows.map((row) => (
    `${targetKey(row.requestedSchema, row.requestedTable)}\u0000${row.columnName}`
  )));
  const tables = new Map(tableResult.rows.map((row) => [
    targetKey(row.requestedSchema, row.requestedTable), row,
  ]));
  const columns = new Map();
  for (const row of columnResult.rows) {
    const key = targetKey(row.requestedSchema, row.requestedTable);
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key).push({
      columnName: row.columnName,
      ordinalPosition: Number(row.ordinalPosition),
      dataType: row.dataType,
      isNullable: row.isNullable === "YES",
      defaultValue: row.defaultValue,
      isPrimaryKey: primaryKeys.has(`${key}\u0000${row.columnName}`),
      columnComment: row.columnComment,
    });
  }
  return { tables, columns };
}

function structureHash(columns) {
  const normalized = columns.map((column) => [
    column.columnName, column.ordinalPosition, column.dataType,
    column.isNullable, column.defaultValue, column.isPrimaryKey,
  ]);
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function upsertColumnBatch(client, columns) {
  if (!columns.length) return;
  const params = [];
  const values = columns.map((column, index) => {
    const start = index * 8 + 1;
    params.push(
      column.physicalTableId, column.columnName, column.ordinalPosition, column.dataType,
      column.isNullable, column.defaultValue, column.isPrimaryKey, column.columnComment,
    );
    return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, TRUE, CURRENT_TIMESTAMP)`;
  });
  await client.query(`
    INSERT INTO catalog_columns (
      physical_table_id, column_name, ordinal_position, data_type, is_nullable,
      default_value, is_primary_key, column_comment, is_active, last_seen_at
    ) VALUES ${values.join(", ")}
    ON CONFLICT (physical_table_id, column_name) DO UPDATE SET
      ordinal_position = EXCLUDED.ordinal_position,
      data_type = EXCLUDED.data_type,
      is_nullable = EXCLUDED.is_nullable,
      default_value = EXCLUDED.default_value,
      is_primary_key = EXCLUDED.is_primary_key,
      column_comment = EXCLUDED.column_comment,
      is_active = TRUE,
      last_seen_at = EXCLUDED.last_seen_at
  `, params);
}

async function loadTargets(catalog, sourceConfig) {
  const result = await catalog.query(`
    SELECT
      source.id::TEXT AS "sourceId",
      physical.id::TEXT AS "physicalTableId",
      physical.schema_name AS "schemaName",
      physical.table_name AS "tableName"
    FROM catalog_physical_tables physical
    JOIN data_sources source ON source.id = physical.source_id
    WHERE source.enabled = TRUE
      AND (
        source.name = $1 OR (
          source.host = $2 AND source.port = $3
          AND source.database_name = $4 AND source.username = $5
        )
      )
    ORDER BY physical.id
  `, [
    cleanText(sourceConfig.connectionName, 120) || "数据地图 PostgreSQL",
    cleanText(sourceConfig.host, 255), Number(sourceConfig.port),
    cleanText(sourceConfig.database, 120), cleanText(sourceConfig.username, 120),
  ]);
  if (!result.rows.length) throw new Error("元数据仓库中没有与当前数据源匹配的物理表");
  return result.rows;
}

async function synchronize(catalog, source, sourceId, targets, metadata, dryRun) {
  const foundTargets = targets.filter((target) => metadata.tables.has(targetKey(target.schemaName, target.tableName)));
  const missingTargets = targets.filter((target) => !metadata.tables.has(targetKey(target.schemaName, target.tableName)));
  const synchronizedColumns = foundTargets.flatMap((target) => {
    const key = targetKey(target.schemaName, target.tableName);
    return (metadata.columns.get(key) || []).map((column) => ({ ...column, physicalTableId: target.physicalTableId }));
  });

  const report = {
    generatedAt: new Date().toISOString(),
    status: missingTargets.length ? "partial_success" : "success",
    dryRun,
    sourceId,
    tablesPlanned: targets.length,
    tablesFound: foundTargets.length,
    tablesMissing: missingTargets.length,
    columnsFound: synchronizedColumns.length,
    missingTables: missingTargets.map((target) => `${target.schemaName}.${target.tableName}`),
  };
  if (dryRun) return report;

  const runResult = await catalog.query(`
    INSERT INTO catalog_sync_runs (source_id, trigger_type, status)
    VALUES ($1, 'manual', 'running') RETURNING id
  `, [sourceId]);
  const runId = runResult.rows[0].id;

  await catalog.query("BEGIN");
  try {
    const targetIds = targets.map((target) => target.physicalTableId);
    await catalog.query(`
      UPDATE catalog_physical_tables SET is_active = FALSE
      WHERE id = ANY($1::BIGINT[])
    `, [targetIds]);
    await catalog.query(`
      UPDATE catalog_columns SET is_active = FALSE
      WHERE physical_table_id = ANY($1::BIGINT[])
    `, [targetIds]);

    for (const target of foundTargets) {
      const key = targetKey(target.schemaName, target.tableName);
      const table = metadata.tables.get(key);
      const columns = metadata.columns.get(key) || [];
      await catalog.query(`
        UPDATE catalog_physical_tables SET
          table_type = $1,
          table_comment = $2,
          estimated_rows = $3,
          total_bytes = $4,
          structure_hash = $5,
          is_active = TRUE,
          last_seen_at = CURRENT_TIMESTAMP
        WHERE id = $6
      `, [
        table.tableType, table.tableComment, table.estimatedRows,
        table.totalBytes, structureHash(columns), target.physicalTableId,
      ]);
    }
    for (let index = 0; index < synchronizedColumns.length; index += COLUMN_BATCH_SIZE) {
      await upsertColumnBatch(catalog, synchronizedColumns.slice(index, index + COLUMN_BATCH_SIZE));
    }

    await catalog.query(`
      UPDATE catalog_sync_runs SET
        status = $1,
        finished_at = CURRENT_TIMESTAMP,
        tables_found = $2,
        tables_updated = $2,
        tables_offline = $3
      WHERE id = $4
    `, [report.status, foundTargets.length, missingTargets.length, runId]);
    await catalog.query(`
      UPDATE data_sources SET last_success_at = CURRENT_TIMESTAMP, last_error = NULL
      WHERE id = $1
    `, [sourceId]);
    await catalog.query("COMMIT");
  } catch (error) {
    await catalog.query("ROLLBACK");
    await catalog.query(`
      UPDATE catalog_sync_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error_message = $1
      WHERE id = $2
    `, [safeError(error), runId]).catch(() => {});
    await catalog.query("UPDATE data_sources SET last_error = $1 WHERE id = $2", [safeError(error), sourceId]).catch(() => {});
    throw error;
  }
  return report;
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const catalog = new Client(catalogConnectionConfig());
  let source;
  let report;
  try {
    await catalog.connect();
    const sourceConfig = await loadSourceConnection(catalog);
    if (!sourceConfig) throw new Error("元数据仓库中没有已启用的业务数据源配置");
    const targets = await loadTargets(catalog, sourceConfig);
    const sourceIds = [...new Set(targets.map((target) => target.sourceId))];
    if (sourceIds.length !== 1) throw new Error("当前同步范围包含多个数据源，无法安全执行");
    source = new Client(sourceConnectionConfig(sourceConfig));
    await source.connect();
    const metadata = await readSourceMetadata(source, targets);
    report = await synchronize(catalog, source, sourceIds[0], targets, metadata, dryRun);
    writeReport(report);
    console.log(`字段同步完成：发现 ${report.tablesFound}/${report.tablesPlanned} 张表，${report.columnsFound} 个字段，缺失 ${report.tablesMissing} 张表`);
    console.log(`报告：${REPORT_FILE}`);
  } catch (error) {
    report = { generatedAt: new Date().toISOString(), status: "failed", error: safeError(error) };
    writeReport(report);
    throw error;
  } finally {
    if (source) await source.end().catch(() => {});
    await catalog.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`字段结构同步失败：${safeError(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { readSourceMetadata, structureHash, targetKey };
