"use strict";

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const KEY_VERSION = 1;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

class CredentialStoreError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CredentialStoreError";
    this.code = code;
  }
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseMasterKey(value = process.env.DATAMAP_CREDENTIAL_MASTER_KEY) {
  const encoded = cleanText(value, 256);
  if (!encoded) {
    throw new CredentialStoreError(
      "缺少 DATAMAP_CREDENTIAL_MASTER_KEY，无法读取或保存业务数据库密码",
      "CREDENTIAL_MASTER_KEY_MISSING"
    );
  }

  let key;
  if (/^[a-fA-F0-9]{64}$/.test(encoded)) {
    key = Buffer.from(encoded, "hex");
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) && encoded.length % 4 === 0) {
    key = Buffer.from(encoded, "base64");
  } else {
    throw new CredentialStoreError(
      "DATAMAP_CREDENTIAL_MASTER_KEY 必须是 32 字节密钥的 Base64 或 64 位十六进制编码",
      "CREDENTIAL_MASTER_KEY_INVALID"
    );
  }

  if (key.length !== 32) {
    throw new CredentialStoreError(
      "DATAMAP_CREDENTIAL_MASTER_KEY 解码后必须正好为 32 字节",
      "CREDENTIAL_MASTER_KEY_INVALID"
    );
  }
  return key;
}

function additionalAuthenticatedData(sourceId, keyVersion = KEY_VERSION) {
  return Buffer.from(`dongpeng-datamap/source/${String(sourceId)}/credential/v${keyVersion}`, "utf8");
}

function encryptPassword(sourceId, password, key = parseMasterKey()) {
  const plaintext = String(password ?? "");
  if (!plaintext) {
    throw new CredentialStoreError("业务数据库密码不能为空", "CREDENTIAL_EMPTY");
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(additionalAuthenticatedData(sourceId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    algorithm: ALGORITHM,
    keyVersion: KEY_VERSION,
    ciphertext,
    iv,
    authTag: cipher.getAuthTag(),
  };
}

function decryptPassword(sourceId, record, key = parseMasterKey()) {
  if (!record?.ciphertext) return "";
  const algorithm = cleanText(record.algorithm, 30);
  const keyVersion = Number(record.keyVersion);
  if (algorithm !== ALGORITHM || keyVersion !== KEY_VERSION) {
    throw new CredentialStoreError("业务数据库密码使用了不受支持的加密版本", "CREDENTIAL_VERSION_UNSUPPORTED");
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, record.iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(additionalAuthenticatedData(sourceId, keyVersion));
    decipher.setAuthTag(record.authTag);
    return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString("utf8");
  } catch (_) {
    throw new CredentialStoreError(
      "业务数据库密码解密失败，请确认 DATAMAP_CREDENTIAL_MASTER_KEY 与保存密码时一致",
      "CREDENTIAL_DECRYPT_FAILED"
    );
  }
}

const SOURCE_COLUMNS = `
  source.id::TEXT AS "sourceId",
  source.name AS "connectionName",
  source.host,
  source.port,
  source.database_name AS "database",
  source.default_schema AS "schema",
  source.username,
  source.ssl_mode AS "sslMode",
  credential.algorithm,
  credential.key_version AS "keyVersion",
  credential.ciphertext,
  credential.iv,
  credential.auth_tag AS "authTag"
`;

function sourceConfigFromRow(row) {
  if (!row) return null;
  return {
    sourceId: String(row.sourceId),
    connectionName: row.connectionName,
    host: row.host,
    port: Number(row.port),
    database: row.database,
    schema: row.schema || "public",
    username: row.username,
    sslMode: row.sslMode || "disable",
    timeout: 10,
    credentialProvider: row.ciphertext ? "catalog_encrypted" : "none",
    hasPassword: Boolean(row.ciphertext),
  };
}

async function findSourceRecord(client, config = null, lock = false) {
  const lockClause = lock ? "FOR UPDATE OF source" : "";
  if (config?.sourceId && /^\d+$/.test(String(config.sourceId))) {
    const result = await client.query(`
      SELECT ${SOURCE_COLUMNS}
      FROM data_sources source
      LEFT JOIN data_source_credentials credential ON credential.source_id = source.id
      WHERE source.id = $1
      ${lockClause}
    `, [String(config.sourceId)]);
    if (result.rows[0]) return result.rows[0];
  }

  if (config) {
    const result = await client.query(`
      SELECT ${SOURCE_COLUMNS}
      FROM data_sources source
      LEFT JOIN data_source_credentials credential ON credential.source_id = source.id
      WHERE source.name = $1 OR (
        source.host = $2 AND source.port = $3
        AND source.database_name = $4 AND source.username = $5
      )
      ORDER BY CASE WHEN source.host = $2 AND source.port = $3
        AND source.database_name = $4 AND source.username = $5 THEN 0 ELSE 1 END,
        source.id
      LIMIT 1
      ${lockClause}
    `, [
      cleanText(config.connectionName, 120) || "数据地图 PostgreSQL",
      cleanText(config.host), Number(config.port),
      cleanText(config.database, 120), cleanText(config.username, 120),
    ]);
    if (result.rows[0]) return result.rows[0];
  }

  if (config) return null;
  const result = await client.query(`
    SELECT ${SOURCE_COLUMNS}
    FROM data_sources source
    LEFT JOIN data_source_credentials credential ON credential.source_id = source.id
    WHERE source.enabled = TRUE
    ORDER BY source.id
    LIMIT 1
    ${lockClause}
  `);
  return result.rows[0] || null;
}

async function loadSourceConfig(client, config = null) {
  return sourceConfigFromRow(await findSourceRecord(client, config));
}

async function loadSourceConnection(client, config = null) {
  const row = await findSourceRecord(client, config);
  if (!row) return null;
  return {
    ...sourceConfigFromRow(row),
    password: row.ciphertext ? decryptPassword(row.sourceId, row) : "",
  };
}

async function saveSourceConnection(client, config, password) {
  await client.query("BEGIN");
  try {
    const existing = await findSourceRecord(client, config, true);
    let sourceId;
    const values = [
      cleanText(config.connectionName, 120) || "数据地图 PostgreSQL",
      cleanText(config.host), Number(config.port), cleanText(config.database, 120),
      cleanText(config.username, 120), cleanText(config.schema, 120) || "public",
      cleanText(config.sslMode, 20) || "disable",
    ];

    if (existing) {
      sourceId = existing.sourceId;
      await client.query(`
        UPDATE data_sources SET
          name = $1, host = $2, port = $3, database_name = $4,
          username = $5, default_schema = $6, ssl_mode = $7, enabled = TRUE
        WHERE id = $8
      `, [...values, sourceId]);
    } else {
      const inserted = await client.query(`
        INSERT INTO data_sources (
          name, type, host, port, database_name, username, default_schema,
          ssl_mode, credential_provider, enabled
        ) VALUES ($1, 'postgresql', $2, $3, $4, $5, $6, $7, 'none', TRUE)
        RETURNING id::TEXT AS "sourceId"
      `, values);
      sourceId = inserted.rows[0].sourceId;
    }

    if (String(password ?? "")) {
      const encrypted = encryptPassword(sourceId, password);
      await client.query(`
        INSERT INTO data_source_credentials (
          source_id, algorithm, key_version, ciphertext, iv, auth_tag
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (source_id) DO UPDATE SET
          algorithm = EXCLUDED.algorithm,
          key_version = EXCLUDED.key_version,
          ciphertext = EXCLUDED.ciphertext,
          iv = EXCLUDED.iv,
          auth_tag = EXCLUDED.auth_tag,
          updated_at = CURRENT_TIMESTAMP
      `, [
        sourceId, encrypted.algorithm, encrypted.keyVersion,
        encrypted.ciphertext, encrypted.iv, encrypted.authTag,
      ]);
    }

    const credentialResult = await client.query(
      "SELECT 1 FROM data_source_credentials WHERE source_id = $1",
      [sourceId]
    );
    const hasPassword = Boolean(credentialResult.rows[0]);
    await client.query(`
      UPDATE data_sources SET credential_provider = $1, credential_ref = $2
      WHERE id = $3
    `, [
      hasPassword ? "catalog_encrypted" : "none",
      hasPassword ? `data_source_credentials:${sourceId}` : null,
      sourceId,
    ]);
    await client.query("COMMIT");
    return loadSourceConfig(client, { sourceId });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

module.exports = {
  CredentialStoreError,
  decryptPassword,
  encryptPassword,
  loadSourceConfig,
  loadSourceConnection,
  parseMasterKey,
  saveSourceConnection,
};
