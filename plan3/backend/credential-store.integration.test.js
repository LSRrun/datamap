"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Client } = require("pg");
const {
  loadSourceConfig,
  loadSourceConnection,
  saveSourceConnection,
} = require("./credential-store");

const connectionString = String(process.env.TEST_CATALOG_DATABASE_URL || "");

test("stores only ciphertext and restores the source password", { skip: !connectionString }, async () => {
  const client = new Client({ connectionString });
  const previousKey = process.env.DATAMAP_CREDENTIAL_MASTER_KEY;
  const connectionName = `credential-test-${Date.now()}`;
  process.env.DATAMAP_CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 23).toString("base64");
  await client.connect();
  try {
    const saved = await saveSourceConnection(client, {
      connectionName,
      host: "127.0.0.1",
      port: 5432,
      database: "source_test",
      schema: "public",
      username: "source_reader",
      sslMode: "disable",
    }, "integration-secret");

    assert.equal(saved.hasPassword, true);
    const publicConfig = await loadSourceConfig(client, { sourceId: saved.sourceId });
    assert.equal(publicConfig.hasPassword, true);
    assert.equal(Object.hasOwn(publicConfig, "password"), false);

    const runtimeConfig = await loadSourceConnection(client, { sourceId: saved.sourceId });
    assert.equal(runtimeConfig.password, "integration-secret");

    const encrypted = await client.query(`
      SELECT ciphertext, iv, auth_tag AS "authTag"
      FROM data_source_credentials
      WHERE source_id = $1
    `, [saved.sourceId]);
    assert.equal(encrypted.rows.length, 1);
    assert.notEqual(encrypted.rows[0].ciphertext.toString("utf8"), "integration-secret");
    assert.equal(encrypted.rows[0].iv.length, 12);
    assert.equal(encrypted.rows[0].authTag.length, 16);
  } finally {
    await client.query("DELETE FROM data_sources WHERE name = $1", [connectionName]).catch(() => {});
    await client.end().catch(() => {});
    if (previousKey === undefined) delete process.env.DATAMAP_CREDENTIAL_MASTER_KEY;
    else process.env.DATAMAP_CREDENTIAL_MASTER_KEY = previousKey;
  }
});
