"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "db", "migrations");
const MIGRATION_FILE_PATTERN = /^(\d+)_([a-z0-9_-]+)\.sql$/;
const MIGRATION_LOCK_ID = 738214067;

function loadMigrations() {
  const versions = new Set();
  const migrations = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(MIGRATION_FILE_PATTERN);
      const version = Number.parseInt(match[1], 10);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new Error(`migration 版本号无效：${entry.name}`);
      }
      if (versions.has(version)) {
        throw new Error(`migration 版本号重复：${version}`);
      }
      versions.add(version);

      const filePath = path.join(MIGRATIONS_DIR, entry.name);
      const sql = fs.readFileSync(filePath, "utf8").trim();
      if (!sql) throw new Error(`migration 文件为空：${entry.name}`);
      return {
        version,
        filename: entry.name,
        sql,
        checksum: crypto.createHash("sha256").update(sql).digest("hex"),
      };
    })
    .sort((left, right) => left.version - right.version);

  if (migrations.length === 0) throw new Error("没有找到可执行的 migration 文件");
  return migrations;
}

function connectionConfig() {
  const connectionString = String(process.env.CATALOG_DATABASE_URL || "").trim();
  if (!connectionString) {
    throw new Error("缺少 CATALOG_DATABASE_URL，未连接元数据仓库");
  }

  const config = {
    connectionString,
    application_name: "dongpeng_datamap_migrations",
  };
  const sslMode = String(process.env.CATALOG_DATABASE_SSL_MODE || "").trim().toLowerCase();
  if (sslMode === "disable") config.ssl = false;
  if (sslMode === "require") config.ssl = { rejectUnauthorized: false };
  if (sslMode === "verify") config.ssl = { rejectUnauthorized: true };
  return config;
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS catalog_schema_migrations (
      version BIGINT PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function runMigrations(client, migrations) {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
  try {
    await ensureMigrationTable(client);
    const result = await client.query(
      "SELECT version, filename, checksum FROM catalog_schema_migrations ORDER BY version"
    );
    const applied = new Map(result.rows.map((row) => [String(row.version), row]));

    for (const migration of migrations) {
      const previous = applied.get(String(migration.version));
      if (previous) {
        if (previous.filename !== migration.filename || previous.checksum.trim() !== migration.checksum) {
          throw new Error(`已执行的 migration 不允许修改：${migration.filename}`);
        }
        console.log(`跳过 ${migration.filename}（已执行）`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO catalog_schema_migrations (version, filename, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.filename, migration.checksum]
        );
        await client.query("COMMIT");
        console.log(`完成 ${migration.filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
  }
}

async function main() {
  const migrations = loadMigrations();
  if (process.argv.includes("--dry-run")) {
    migrations.forEach((migration) => {
      console.log(`${migration.filename} sha256:${migration.checksum}`);
    });
    console.log(`校验完成，共 ${migrations.length} 个 migration，未连接数据库`);
    return;
  }

  const client = new Client(connectionConfig());
  try {
    await client.connect();
    await runMigrations(client, migrations);
    console.log("元数据仓库 migration 已是最新版本");
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`元数据仓库 migration 失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { connectionConfig, loadMigrations, runMigrations };
