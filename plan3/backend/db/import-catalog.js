"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const EXTRACTOR = path.join(PROJECT_ROOT, "scripts", "extract_excel.py");
const DEFAULT_SOURCE_CONFIG = path.join(PROJECT_ROOT, ".data", "postgres-connection.json");
const DEFAULT_REPORT = path.join(PROJECT_ROOT, ".data", "catalog-import-report.json");

function parseArgs(argv) {
  const options = {
    workbook: null,
    report: DEFAULT_REPORT,
    sourceConfig: DEFAULT_SOURCE_CONFIG,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") options.dryRun = true;
    else if (value === "--report") options.report = path.resolve(argv[++index] || "");
    else if (value === "--source-config") options.sourceConfig = path.resolve(argv[++index] || "");
    else if (value.startsWith("--")) throw new Error(`不支持的参数：${value}`);
    else if (!options.workbook) options.workbook = path.resolve(value);
    else throw new Error(`多余的参数：${value}`);
  }
  if (!options.workbook) throw new Error("请提供 Excel 工作簿路径");
  return options;
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label}不存在：${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    throw new Error(`${label}不是有效 JSON：${filePath}`);
  }
}

function sourceConfig(filePath) {
  const input = readJson(filePath, "数据源配置");
  const required = ["host", "port", "database", "username"];
  const missing = required.filter((key) => !String(input[key] ?? "").trim());
  if (missing.length) throw new Error(`数据源配置缺少：${missing.join("、")}`);
  return {
    name: String(input.connectionName || "数据地图 PostgreSQL").trim(),
    host: String(input.host).trim(),
    port: Number(input.port),
    database: String(input.database).trim(),
    username: String(input.username).trim(),
    schema: String(input.schema || "public").trim(),
    sslMode: String(input.sslMode || "disable").trim(),
    credentialProvider: process.platform === "darwin" ? "keychain" : "env",
    credentialRef: String(input.credentialAccount || "").trim() || null,
  };
}

function pythonExecutable() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const venvPython = path.join(PROJECT_ROOT, ".venv", "bin", "python3");
  return fs.existsSync(venvPython) ? venvPython : "python3";
}

function extractWorkbook(workbookPath, defaultSchema) {
  try {
    const stdout = execFileSync(pythonExecutable(), [
      EXTRACTOR,
      workbookPath,
      "--format", "catalog-json",
      "--default-schema", defaultSchema,
    ], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout);
  } catch (error) {
    const detail = String(error.stderr || error.message || "Excel 解析失败").trim();
    if (detail.includes("openpyxl")) {
      throw new Error("缺少 Python 依赖 openpyxl，请先执行：python3 -m pip install -r requirements.txt");
    }
    throw new Error(`Excel 解析失败：${detail.slice(0, 500)}`);
  }
}

function catalogConnectionConfig() {
  const connectionString = String(process.env.CATALOG_DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("缺少 CATALOG_DATABASE_URL，未连接元数据仓库");
  const config = { connectionString, application_name: "dongpeng_datamap_catalog_import" };
  const sslMode = String(process.env.CATALOG_DATABASE_SSL_MODE || "").trim().toLowerCase();
  if (sslMode === "disable") config.ssl = false;
  if (sslMode === "require") config.ssl = { rejectUnauthorized: false };
  if (sslMode === "verify") config.ssl = { rejectUnauthorized: true };
  return config;
}

function buildImportPlan(extraction) {
  const physicalTables = new Map();
  for (const asset of extraction.assets) {
    for (const table of asset.physicalTables) {
      const key = `${table.schemaName}.${table.tableName}`;
      if (!physicalTables.has(key)) {
        physicalTables.set(key, { ...table, assetCode: asset.assetCode, sourceRow: asset.sourceRow });
      }
    }
  }
  return { assets: extraction.assets, physicalTables: [...physicalTables.values()] };
}

function baseReport(options, source, extraction, plan) {
  return {
    generatedAt: new Date().toISOString(),
    status: options.dryRun ? "validated" : "running",
    dryRun: options.dryRun,
    source: {
      workbook: options.workbook,
      sheet: extraction.source.sheet,
      dataSourceName: source.name,
      database: source.database,
      defaultSchema: source.schema,
    },
    validation: extraction.validation,
    import: {
      assetsPlanned: plan.assets.length,
      physicalTablesPlanned: plan.physicalTables.length,
      assetsCreated: 0,
      assetsExisting: 0,
      physicalTablesCreated: 0,
      physicalTablesExisting: 0,
      physicalTablesSchemaUpdated: 0,
      databaseAssociationConflicts: [],
    },
  };
}

function writeReport(filePath, report) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function upsertDataSource(client, source) {
  const result = await client.query(
    `INSERT INTO data_sources (
       name, type, host, port, database_name, username, default_schema, ssl_mode,
       credential_provider, credential_ref, enabled, sync_interval_minutes
     ) VALUES ($1, 'postgresql', $2, $3, $4, $5, $6, $7, $8, $9, TRUE, 60)
     ON CONFLICT (name) DO UPDATE SET
       host = EXCLUDED.host,
       port = EXCLUDED.port,
       database_name = EXCLUDED.database_name,
       username = EXCLUDED.username,
       default_schema = EXCLUDED.default_schema,
       ssl_mode = EXCLUDED.ssl_mode,
       credential_provider = EXCLUDED.credential_provider,
       credential_ref = EXCLUDED.credential_ref,
       enabled = TRUE
     RETURNING id`,
    [
      source.name, source.host, source.port, source.database, source.username,
      source.schema, source.sslMode, source.credentialProvider, source.credentialRef,
    ]
  );
  return result.rows[0].id;
}

async function importCatalog(client, source, plan, report) {
  await client.query("BEGIN");
  try {
    const sourceId = await upsertDataSource(client, source);
    const existingAssetsResult = await client.query(
      "SELECT asset_code FROM catalog_assets WHERE asset_code = ANY($1::text[])",
      [plan.assets.map((asset) => asset.assetCode)]
    );
    const existingAssets = new Set(existingAssetsResult.rows.map((row) => row.asset_code));
    const assetIds = new Map();

    for (const asset of plan.assets) {
      const result = await client.query(
        `INSERT INTO catalog_assets (
           asset_code, name_cn, l1_domain, l2_topic, l3_object, owner, description,
           online_status, lake_status, source_row
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (asset_code) DO UPDATE SET source_row = EXCLUDED.source_row
         RETURNING id`,
        [
          asset.assetCode, asset.nameCn, asset.l1Domain, asset.l2Topic, asset.l3Object,
          asset.owner || null, asset.description || null, asset.onlineStatus || null,
          asset.lakeStatus || null, asset.sourceRow,
        ]
      );
      assetIds.set(asset.assetCode, result.rows[0].id);
    }
    report.import.assetsExisting = existingAssets.size;
    report.import.assetsCreated = plan.assets.length - existingAssets.size;

    const existingPhysicalResult = await client.query(
      `SELECT id, schema_name, table_name, asset_id
       FROM catalog_physical_tables WHERE source_id = $1`,
      [sourceId]
    );
    const existingRows = existingPhysicalResult.rows;
    const existingPhysical = new Map(existingRows.map((row) => [
      `${row.schema_name}.${row.table_name}`,
      row,
    ]));
    const plannedTargetCounts = new Map();
    for (const table of plan.physicalTables) {
      const assetId = String(assetIds.get(table.assetCode));
      const matchKey = `${assetId}|${table.tableName.toUpperCase()}`;
      plannedTargetCounts.set(matchKey, (plannedTargetCounts.get(matchKey) || 0) + 1);
    }

    for (const table of plan.physicalTables) {
      const key = `${table.schemaName}.${table.tableName}`;
      if (existingPhysical.has(key)) continue;
      const assetId = String(assetIds.get(table.assetCode));
      const matchKey = `${assetId}|${table.tableName.toUpperCase()}`;
      if (plannedTargetCounts.get(matchKey) !== 1) continue;
      const previous = existingRows.find((row) => (
        String(row.asset_id) === assetId
        && String(row.table_name).toUpperCase() === table.tableName.toUpperCase()
        && !existingPhysical.has(key)
      ));
      if (!previous) continue;
      const previousKey = `${previous.schema_name}.${previous.table_name}`;
      await client.query(
        `UPDATE catalog_physical_tables SET
           schema_name = $1,
           table_name = $2,
           is_active = FALSE,
           last_seen_at = NULL
         WHERE id = $3`,
        [table.schemaName, table.tableName, previous.id]
      );
      existingPhysical.delete(previousKey);
      previous.schema_name = table.schemaName;
      previous.table_name = table.tableName;
      existingPhysical.set(key, previous);
      report.import.physicalTablesSchemaUpdated += 1;
    }

    for (const table of plan.physicalTables) {
      const key = `${table.schemaName}.${table.tableName}`;
      const assetId = assetIds.get(table.assetCode);
      const previous = existingPhysical.get(key);
      if (previous?.asset_id && String(previous.asset_id) !== String(assetId)) {
        report.import.databaseAssociationConflicts.push({
          physicalTable: key,
          existingAssetId: String(previous.asset_id),
          incomingAssetCode: table.assetCode,
          incomingSourceRow: table.sourceRow,
        });
      }
      await client.query(
        `INSERT INTO catalog_physical_tables (
           asset_id, source_id, schema_name, table_name, table_type, asset_type, data_layer, is_active
         ) VALUES ($1, $2, $3, $4, 'table', $5, $6, FALSE)
         ON CONFLICT (source_id, schema_name, table_name) DO UPDATE SET
           asset_id = COALESCE(catalog_physical_tables.asset_id, EXCLUDED.asset_id),
           asset_type = EXCLUDED.asset_type,
           data_layer = EXCLUDED.data_layer
         RETURNING id`,
        [
          assetId, sourceId, table.schemaName, table.tableName,
          table.assetType || null, table.dataLayer || null,
        ]
      );
    }
    report.import.physicalTablesExisting = plan.physicalTables.filter((table) => (
      existingPhysical.has(`${table.schemaName}.${table.tableName}`)
    )).length;
    report.import.physicalTablesCreated = plan.physicalTables.length - report.import.physicalTablesExisting;

    await client.query("COMMIT");
    report.status = "success";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.workbook)) throw new Error(`工作簿不存在：${options.workbook}`);
  const source = sourceConfig(options.sourceConfig);
  const extraction = extractWorkbook(options.workbook, source.schema);
  const plan = buildImportPlan(extraction);
  const report = baseReport(options, source, extraction, plan);

  if (options.dryRun) {
    writeReport(options.report, report);
    console.log(`校验完成：${plan.assets.length} 条资产，${plan.physicalTables.length} 张唯一物理表`);
    console.log(`报告：${options.report}`);
    return;
  }

  const client = new Client(catalogConnectionConfig());
  try {
    await client.connect();
    await importCatalog(client, source, plan, report);
    writeReport(options.report, report);
    console.log(`导入完成：新增 ${report.import.assetsCreated} 条资产、${report.import.physicalTablesCreated} 张物理表，更新 ${report.import.physicalTablesSchemaUpdated} 条 Schema`);
    console.log(`报告：${options.report}`);
  } catch (error) {
    report.status = "failed";
    report.error = String(error.message || "导入失败").slice(0, 500);
    writeReport(options.report, report);
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`目录导入失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildImportPlan, parseArgs, sourceConfig };
