"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Client, Pool } = require("pg");
const { createCatalogApi } = require("./catalog-api");
const { createTablePreviewApi } = require("./table-preview-api");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 58973);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const FRONTEND_ROOT = path.join(PROJECT_ROOT, "frontend");
const MAX_BODY_BYTES = 16 * 1024;
const DATA_DIR = path.join(PROJECT_ROOT, ".data");
const CONNECTION_FILE = path.join(DATA_DIR, "postgres-connection.json");
const KEYCHAIN_SERVICE = "com.dongpeng.datamap.postgres";
const HEARTBEAT_INTERVAL_MS = 15 * 1000;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

let savedConfig = null;
let activePool = null;
let heartbeatTimer = null;
const catalogApi = createCatalogApi();
const tablePreviewApi = createTablePreviewApi({ catalogApi, getSourcePool });
let connectionState = {
  status: "not_configured",
  lastConnectedAt: null,
  lastCheckedAt: null,
  lastError: null,
  server: null,
};

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求内容过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (_) { reject(new Error("请求格式无效")); }
    });
    request.on("error", reject);
  });
}

function cleanText(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function connectionConfig(input) {
  const host = cleanText(input.host);
  const database = cleanText(input.database);
  const user = cleanText(input.username);
  const password = String(input.password ?? "").slice(0, 1024);
  const port = Number(input.port);
  const timeoutSeconds = Math.min(Math.max(Number(input.timeout) || 10, 3), 30);
  const sslMode = ["disable", "verify", "require"].includes(input.sslMode) ? input.sslMode : "disable";

  if (!host || !database || !user) throw new Error("主机地址、数据库名和用户名不能为空");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须在 1 到 65535 之间");

  return {
    host,
    port,
    database,
    user,
    password,
    connectionTimeoutMillis: timeoutSeconds * 1000,
    query_timeout: timeoutSeconds * 1000,
    application_name: "dongpeng_data_map",
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: sslMode === "verify" },
  };
}

function publicConfig(config) {
  if (!config) return null;
  return {
    connectionName: cleanText(config.connectionName, 60) || "数据地图 PostgreSQL",
    host: cleanText(config.host),
    port: Number(config.port),
    database: cleanText(config.database),
    schema: cleanText(config.schema, 80) || "public",
    username: cleanText(config.username),
    sslMode: ["disable", "verify", "require"].includes(config.sslMode) ? config.sslMode : "disable",
    timeout: Math.min(Math.max(Number(config.timeout) || 10, 3), 30),
    hasPassword: Boolean(config.credentialAccount),
  };
}

function sameConnectionIdentity(left, right) {
  return Boolean(left && right)
    && cleanText(left.host) === cleanText(right.host)
    && Number(left.port) === Number(right.port)
    && cleanText(left.database) === cleanText(right.database)
    && cleanText(left.username) === cleanText(right.username);
}

function resolvedInput(input) {
  const next = { ...input };
  if (!String(next.password ?? "") && sameConnectionIdentity(next, savedConfig)) {
    next.password = readCredential(savedConfig);
  }
  return next;
}

function credentialAccount(config) {
  return `${cleanText(config.username)}@${cleanText(config.host)}:${Number(config.port)}/${cleanText(config.database)}`.slice(0, 255);
}

function readCredential(config) {
  const account = cleanText(config?.credentialAccount) || credentialAccount(config || {});
  if (!account) return "";
  try {
    return execFileSync("/usr/bin/security", ["find-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_) {
    return "";
  }
}

function saveCredential(config, password) {
  if (!password) return;
  try {
    execFileSync("/usr/bin/security", [
      "add-generic-password", "-U", "-a", config.credentialAccount,
      "-s", KEYCHAIN_SERVICE, "-w", password,
    ], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (_) {
    throw new Error("无法将数据库密码保存到 macOS 钥匙串，请确认钥匙串可用");
  }
}

function persistentConfig(input) {
  const normalized = connectionConfig(input);
  return {
    connectionName: cleanText(input.connectionName, 60) || "数据地图 PostgreSQL",
    host: normalized.host,
    port: normalized.port,
    database: normalized.database,
    schema: cleanText(input.schema, 80) || "public",
    username: normalized.user,
    credentialAccount: normalized.password ? credentialAccount(input) : "",
    sslMode: ["disable", "verify", "require"].includes(input.sslMode) ? input.sslMode : "disable",
    timeout: Math.min(Math.max(Number(input.timeout) || 10, 3), 30),
    savedAt: new Date().toISOString(),
  };
}

function safeError(error) {
  return cleanText(error?.message || "无法连接 PostgreSQL", 300)
    .replace(/password=[^\s]+/gi, "password=***")
    .replace(/-w\s+[^\s]+/g, "-w ***");
}

function loadSavedConfig() {
  try {
    if (!fs.existsSync(CONNECTION_FILE)) return null;
    return JSON.parse(fs.readFileSync(CONNECTION_FILE, "utf8"));
  } catch (error) {
    console.error(`读取 PostgreSQL 配置失败：${safeError(error)}`);
    return null;
  }
}

function saveConfig(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporaryFile = `${CONNECTION_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryFile, CONNECTION_FILE);
  fs.chmodSync(CONNECTION_FILE, 0o600);
}

function statusPayload() {
  return {
    ok: true,
    configured: Boolean(savedConfig),
    config: publicConfig(savedConfig),
    connection: { ...connectionState },
  };
}

function markConnected(serverInfo) {
  const now = new Date().toISOString();
  connectionState = {
    status: "connected",
    lastConnectedAt: connectionState.lastConnectedAt || now,
    lastCheckedAt: now,
    lastError: null,
    server: serverInfo || connectionState.server,
  };
}

function markDisconnected(error) {
  connectionState = {
    ...connectionState,
    status: savedConfig ? "reconnecting" : "disconnected",
    lastCheckedAt: new Date().toISOString(),
    lastError: safeError(error),
  };
}

function serverInfoFromRow(row) {
  const versionMatch = String(row.version || "").match(/PostgreSQL\s+[\d.]+/i);
  return {
    database: row.database,
    user: row.username,
    version: versionMatch ? versionMatch[0] : "PostgreSQL",
  };
}

async function createVerifiedPool(config) {
  const pool = new Pool({
    ...connectionConfig(config),
    max: 5,
    min: 1,
    idleTimeoutMillis: 0,
    allowExitOnIdle: false,
  });
  pool.on("error", (error) => markDisconnected(error));
  try {
    const result = await pool.query("SELECT current_database() AS database, current_user AS username, version() AS version");
    return { pool, server: serverInfoFromRow(result.rows[0] || {}) };
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}

async function activateConnection(runtimeConfig, configToSave) {
  const verified = await createVerifiedPool(runtimeConfig);
  const nextSavedConfig = configToSave || savedConfig;
  if (!nextSavedConfig) {
    await verified.pool.end().catch(() => {});
    throw new Error("缺少可保存的数据库连接配置");
  }
  const previousPool = activePool;
  activePool = verified.pool;
  savedConfig = nextSavedConfig;
  connectionState.lastConnectedAt = null;
  markConnected(verified.server);
  if (previousPool) await previousPool.end().catch(() => {});
  return verified.server;
}

async function heartbeat() {
  if (!savedConfig) return;
  try {
    if (!activePool) {
      await activateConnection({ ...savedConfig, password: readCredential(savedConfig) }, null);
      return;
    }
    await activePool.query("SELECT 1");
    markConnected();
  } catch (error) {
    markDisconnected(error);
    if (activePool) await activePool.end().catch(() => {});
    activePool = null;
  }
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => heartbeat().catch((error) => markDisconnected(error)), HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
}

async function getSourcePool() {
  if (activePool) return activePool;
  if (!savedConfig) return null;
  try {
    await activateConnection({ ...savedConfig, password: readCredential(savedConfig) }, null);
    return activePool;
  } catch (error) {
    markDisconnected(error);
    return null;
  }
}

async function testPostgres(request, response) {
  let client;
  try {
    const input = resolvedInput(await readJsonBody(request));
    client = new Client(connectionConfig(input));
    await client.connect();
    const result = await client.query("SELECT current_database() AS database, current_user AS username, version() AS version");
    json(response, 200, {
      ok: true,
      server: serverInfoFromRow(result.rows[0] || {}),
    });
  } catch (error) {
    json(response, 400, { ok: false, message: safeError(error), code: cleanText(error.code, 40) || undefined });
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

async function savePostgres(request, response) {
  let verified;
  try {
    const input = resolvedInput(await readJsonBody(request));
    const config = persistentConfig(input);
    verified = await createVerifiedPool(input);
    saveCredential(config, input.password);
    saveConfig(config);
    const serverInfo = verified.server;
    const previousPool = activePool;
    activePool = verified.pool;
    verified = null;
    savedConfig = config;
    connectionState.lastConnectedAt = null;
    markConnected(serverInfo);
    if (previousPool) await previousPool.end().catch(() => {});
    json(response, 200, {
      ...statusPayload(),
      message: "配置已保存，PostgreSQL 将持续保持连接并在服务启动后自动重连。",
      server: serverInfo,
    });
  } catch (error) {
    if (verified?.pool) await verified.pool.end().catch(() => {});
    if (activePool) {
      connectionState = { ...connectionState, lastError: safeError(error) };
    } else {
      markDisconnected(error);
    }
    json(response, 400, { ok: false, message: safeError(error), code: cleanText(error.code, 40) || undefined });
  }
}

function serveStatic(request, response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = path.resolve(FRONTEND_ROOT, relativePath);
  if (!filePath.startsWith(`${FRONTEND_ROOT}${path.sep}`) && filePath !== FRONTEND_ROOT) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": /\.(html|js|css)$/.test(filePath) ? "no-store" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (await tablePreviewApi.handle(request, response, url)) return;
  if (await catalogApi.handle(request, response, url)) return;
  if (request.method === "POST" && url.pathname === "/api/postgres/test") {
    await testPostgres(request, response);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/postgres/save") {
    await savePostgres(request, response);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/postgres/status") {
    json(response, 200, statusPayload());
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    json(response, 405, { ok: false, message: "Method Not Allowed" });
    return;
  }
  serveStatic(request, response, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`东鹏数据地图已启动：http://${HOST}:${PORT}`);
});

savedConfig = loadSavedConfig();
if (savedConfig) {
  connectionState.status = "reconnecting";
  heartbeat().catch((error) => markDisconnected(error));
}
startHeartbeat();

async function shutdown() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (activePool) await activePool.end().catch(() => {});
  await catalogApi.close().catch(() => {});
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
