"use strict";

const { Pool } = require("pg");
const {
  loadSourceConfig,
  loadSourceConnection,
  saveSourceConnection,
} = require("./credential-store");

const LOCAL_CATALOG_DATABASE_URL = "postgresql://datamap_catalog_app@127.0.0.1:5432/datamap_catalog";
const MAX_BODY_BYTES = 32 * 1024;
const PG_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;
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

function normalizeEntityTableName(value) {
  const fullName = cleanText(value, 380).toUpperCase();
  const parts = fullName.split(".");
  if (parts.length !== 2 || !parts.every((part) => PG_IDENTIFIER.test(part))) {
    throw new HttpError(400, "实体表名必须使用 SCHEMA.TABLE 格式");
  }
  return { schemaName: parts[0], tableName: parts[1] };
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

function nullableNumber(value, label, minimum, maximum, integer = false) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < minimum || number > maximum) {
    const range = maximum === Number.MAX_SAFE_INTEGER ? `不小于 ${minimum}` : `${minimum} 到 ${maximum}`;
    throw new HttpError(400, `${label}必须是${range}${integer ? "的整数" : "的数字"}`);
  }
  return number;
}

function normalizePhysicalMetrics(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new HttpError(400, "实体表指标格式无效");
  const seen = new Set();
  return value.map((item) => {
    const id = cleanText(item?.id, 30);
    if (!/^\d+$/.test(id) || id === "0" || seen.has(id)) throw new HttpError(400, "实体表指标 ID 无效或重复");
    seen.add(id);
    const assetType = cleanText(item.assetType, 30) || null;
    const dataLayer = cleanText(item.dataLayer, 30) || null;
    if (!new Set([null, "事实表", "维度表"]).has(assetType)) {
      throw new HttpError(400, "资产类型只能为：事实表、维度表");
    }
    if (!new Set([null, "模型层", "应用层"]).has(dataLayer)) {
      throw new HttpError(400, "数据分层只能为：模型层、应用层");
    }
    return {
      id,
      assetType,
      dataLayer,
      qualityScore: nullableNumber(item.qualityScore, "质量分", 0, 100),
      slaAchievementRate: nullableNumber(item.slaAchievementRate, "SLA 达成率", 0, 100),
      downstreamReferences: nullableNumber(item.downstreamReferences, "下游引用", 0, Number.MAX_SAFE_INTEGER, true),
      accessHeat: nullableNumber(item.accessHeat, "访问热度", 0, Number.MAX_SAFE_INTEGER, true),
    };
  });
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
    hierarchyNodeId: body.hierarchyNodeId === undefined || body.hierarchyNodeId === null || body.hierarchyNodeId === ""
      ? null
      : cleanText(body.hierarchyNodeId, 30),
    physicalMetrics: normalizePhysicalMetrics(body.physicalMetrics),
  };
  if (asset.hierarchyNodeId !== null && (!/^\d+$/.test(asset.hierarchyNodeId) || asset.hierarchyNodeId === "0")) {
    throw new HttpError(400, "目录节点 ID 无效");
  }
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

  async function withCatalogClient(callback) {
    const client = await pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  function getDefaultSourceConfig() {
    return withCatalogClient((client) => loadSourceConfig(client));
  }

  function getSourceConnection(config) {
    return withCatalogClient((client) => loadSourceConnection(client, config));
  }

  function storeSourceConnection(config, password) {
    return withCatalogClient((client) => saveSourceConnection(client, config, password));
  }

  async function hierarchyPath(client, nodeId) {
    const result = await client.query(`
      WITH RECURSIVE path AS (
        SELECT n.id, n.parent_id, n.level_id, n.node_name, n.node_code, n.color
        FROM catalog_hierarchy_nodes n
        WHERE n.id = $1 AND n.is_enabled = TRUE
        UNION ALL
        SELECT parent.id, parent.parent_id, parent.level_id, parent.node_name, parent.node_code, parent.color
        FROM catalog_hierarchy_nodes parent
        JOIN path child ON child.parent_id = parent.id
        WHERE parent.is_enabled = TRUE
      )
      SELECT
        path.id::TEXT AS "id",
        levels.id::TEXT AS "levelId",
        levels.level_code AS "levelCode",
        levels.display_name AS "levelName",
        levels.level_order AS "levelOrder",
        levels.level_type AS "levelType",
        path.node_name AS "name",
        path.node_code AS "code",
        path.color
      FROM path
      JOIN catalog_hierarchy_levels levels ON levels.id = path.level_id AND levels.is_enabled = TRUE
      ORDER BY levels.level_order
    `, [nodeId]);
    if (!result.rows.length) throw new HttpError(400, "所选目录节点不存在或已停用");
    for (let index = 0; index < result.rows.length; index += 1) {
      if (result.rows[index].levelOrder !== index + 1) throw new HttpError(400, "所选目录节点的父级路径不完整");
    }
    return result.rows;
  }

  async function synchronizeLegacyHierarchy(client) {
    await client.query(`
      WITH RECURSIVE paths AS (
        SELECT assignment.asset_id, node.id, node.parent_id, node.level_id, node.node_name
        FROM catalog_asset_hierarchy assignment
        JOIN catalog_hierarchy_nodes node ON node.id = assignment.leaf_node_id
        UNION ALL
        SELECT paths.asset_id, parent.id, parent.parent_id, parent.level_id, parent.node_name
        FROM paths
        JOIN catalog_hierarchy_nodes parent ON parent.id = paths.parent_id
      ), flattened AS (
        SELECT
          paths.asset_id,
          MAX(paths.node_name) FILTER (WHERE level.level_order = 1) AS l1_domain,
          MAX(paths.node_name) FILTER (WHERE level.level_order = 2) AS l2_topic,
          MAX(paths.node_name) FILTER (WHERE level.level_order = 3) AS l3_object
        FROM paths
        JOIN catalog_hierarchy_levels level ON level.id = paths.level_id
        GROUP BY paths.asset_id
      )
      UPDATE catalog_assets asset SET
        l1_domain = COALESCE(flattened.l1_domain, asset.l1_domain),
        l2_topic = COALESCE(flattened.l2_topic, flattened.l1_domain, asset.l2_topic),
        l3_object = COALESCE(flattened.l3_object, flattened.l2_topic, flattened.l1_domain, asset.l3_object)
      FROM flattened
      WHERE asset.id = flattened.asset_id
    `);
  }

  async function getHierarchy(response) {
    const [levelsResult, nodesResult] = await Promise.all([
      pool.query(`
        SELECT
          id::TEXT AS "id", level_code AS "code", display_name AS "name",
          level_order AS "order", level_type AS "type",
          is_required AS "required", is_enabled AS "enabled"
        FROM catalog_hierarchy_levels
        ORDER BY level_order, id
      `),
      pool.query(`
        WITH RECURSIVE descendants AS (
          SELECT id AS ancestor_id, id AS descendant_id FROM catalog_hierarchy_nodes
          UNION ALL
          SELECT descendants.ancestor_id, child.id
          FROM descendants
          JOIN catalog_hierarchy_nodes child ON child.parent_id = descendants.descendant_id
        )
        SELECT
          node.id::TEXT AS "id",
          node.level_id::TEXT AS "levelId",
          node.parent_id::TEXT AS "parentId",
          node.node_code AS "code",
          node.node_name AS "name",
          node.sort_order AS "sortOrder",
          node.color,
          node.is_enabled AS "enabled",
          MAX(direct_asset.asset_id)::TEXT AS "assetId",
          COUNT(DISTINCT direct_asset.asset_id)::INTEGER AS "directDataTableCount",
          COUNT(DISTINCT descendant_asset.asset_id)::INTEGER AS "dataTableCount",
          COUNT(DISTINCT direct_entity.id)::INTEGER AS "directEntityTableCount",
          COUNT(DISTINCT descendant_entity.id)::INTEGER AS "entityTableCount",
          COALESCE((
            SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
              'id', physical.id::TEXT,
              'schemaName', physical.schema_name,
              'tableName', physical.table_name,
              'isActive', physical.is_active,
              'lastSeenAt', physical.last_seen_at
            ) ORDER BY physical.id)
            FROM catalog_asset_hierarchy table_assignment
            JOIN catalog_physical_tables physical ON physical.asset_id = table_assignment.asset_id
            WHERE table_assignment.leaf_node_id = node.id
          ), '[]'::JSONB) AS "entityTables"
        FROM catalog_hierarchy_nodes node
        LEFT JOIN catalog_asset_hierarchy direct_asset ON direct_asset.leaf_node_id = node.id
        LEFT JOIN catalog_physical_tables direct_entity ON direct_entity.asset_id = direct_asset.asset_id
        LEFT JOIN descendants ON descendants.ancestor_id = node.id
        LEFT JOIN catalog_asset_hierarchy descendant_asset ON descendant_asset.leaf_node_id = descendants.descendant_id
        LEFT JOIN catalog_physical_tables descendant_entity ON descendant_entity.asset_id = descendant_asset.asset_id
        GROUP BY node.id
        ORDER BY node.level_id, node.sort_order, node.node_name, node.id
      `),
    ]);
    sendJson(response, 200, { ok: true, levels: levelsResult.rows, nodes: nodesResult.rows });
  }

  async function createHierarchyLevel(request, response) {
    const body = await readJsonBody(request);
    const name = cleanText(body.name, 120);
    if (!name) throw new HttpError(400, "层级名称不能为空");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const terminalResult = await client.query(`
        SELECT id, level_order AS "order"
        FROM catalog_hierarchy_levels
        WHERE level_type = 'data_table'
        FOR UPDATE
      `);
      const terminal = terminalResult.rows[0];
      if (!terminal) throw new HttpError(409, "缺少数据表层，请先执行最新数据库迁移", "DATA_TABLE_LEVEL_MISSING");
      if (terminal.order >= 6) throw new HttpError(400, "业务目录和数据表合计最多支持 6 级");
      await client.query(`
        UPDATE catalog_hierarchy_levels
        SET level_order = $1, level_code = 'L' || $1
        WHERE id = $2
      `, [terminal.order + 1, terminal.id]);
      const result = await client.query(`
        INSERT INTO catalog_hierarchy_levels (
          level_code, display_name, level_order, level_type, is_required
        ) VALUES ('L' || $1, $2, $1, 'directory', $3)
        RETURNING id::TEXT AS "id", level_code AS "code", display_name AS "name",
          level_order AS "order", level_type AS "type",
          is_required AS "required", is_enabled AS "enabled"
      `, [terminal.order, name, body.required === true]);
      await client.query(`
        WITH current_parents AS (
          SELECT DISTINCT data_table.parent_id
          FROM catalog_hierarchy_nodes data_table
          WHERE data_table.level_id = $1 AND data_table.parent_id IS NOT NULL
        ), inserted_parents AS (
          INSERT INTO catalog_hierarchy_nodes (
            level_id, parent_id, node_name, sort_order, is_enabled
          )
          SELECT $2, current_parents.parent_id, '待分类', 0, TRUE
          FROM current_parents
          RETURNING id, parent_id
        )
        UPDATE catalog_hierarchy_nodes data_table
        SET parent_id = inserted_parents.id
        FROM inserted_parents
        WHERE data_table.level_id = $1
          AND data_table.parent_id = inserted_parents.parent_id
      `, [terminal.id, result.rows[0].id]);
      await client.query("COMMIT");
      sendJson(response, 201, {
        ok: true,
        level: result.rows[0],
        message: "目录层级已插入到数据表层之前，现有数据表已归入对应的待分类节点",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateHierarchyLevel(request, response, levelId) {
    const body = await readJsonBody(request);
    const name = cleanText(body.name, 120);
    if (!name) throw new HttpError(400, "层级名称不能为空");
    const result = await pool.query(`
      UPDATE catalog_hierarchy_levels
      SET
        display_name = $1,
        is_required = CASE WHEN level_type = 'data_table' THEN TRUE ELSE $2 END,
        is_enabled = CASE WHEN level_type = 'data_table' THEN TRUE ELSE $3 END
      WHERE id = $4
      RETURNING id::TEXT AS "id", level_code AS "code", display_name AS "name",
        level_order AS "order", level_type AS "type",
        is_required AS "required", is_enabled AS "enabled"
    `, [name, body.required !== false, body.enabled !== false, levelId]);
    if (!result.rows[0]) throw new HttpError(404, "未找到该层级", "NOT_FOUND");
    sendJson(response, 200, { ok: true, level: result.rows[0], message: "层级设置已保存" });
  }

  async function deleteHierarchyLevel(response, levelId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const levelsResult = await client.query(`
        SELECT id::TEXT AS "id", level_order AS "order", level_type AS "type"
        FROM catalog_hierarchy_levels
        WHERE id = $1 OR level_type = 'data_table'
        ORDER BY level_order
        FOR UPDATE
      `, [levelId]);
      const target = levelsResult.rows.find((level) => level.id === String(levelId));
      const terminal = levelsResult.rows.find((level) => level.type === "data_table");
      if (!target || !terminal) throw new HttpError(404, "未找到该层级", "NOT_FOUND");
      if (target.type === "data_table") throw new HttpError(409, "数据表层是固定终端层，不能删除", "DATA_TABLE_LEVEL_REQUIRED");
      if (target.order !== terminal.order - 1) {
        throw new HttpError(409, "只能删除紧邻数据表层且没有节点的最后一级业务目录", "HIERARCHY_LEVEL_IN_USE");
      }
      const result = await client.query(`
        DELETE FROM catalog_hierarchy_levels level
        WHERE level.id = $1
          AND NOT EXISTS (SELECT 1 FROM catalog_hierarchy_nodes node WHERE node.level_id = level.id)
        RETURNING id
      `, [levelId]);
      if (!result.rows[0]) throw new HttpError(409, "该层级仍有目录节点，不能删除", "HIERARCHY_LEVEL_IN_USE");
      await client.query(`
        UPDATE catalog_hierarchy_levels
        SET level_order = $1, level_code = 'L' || $1
        WHERE id = $2
      `, [terminal.order - 1, terminal.id]);
      await client.query("COMMIT");
      sendJson(response, 200, { ok: true, message: "目录层级已删除，数据表层已自动前移" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function validateNodeParent(client, levelId, parentId, nodeId = null) {
    const levelResult = await client.query(
      "SELECT level_order AS \"order\", level_type AS \"type\" FROM catalog_hierarchy_levels WHERE id = $1 AND is_enabled = TRUE",
      [levelId],
    );
    const level = levelResult.rows[0];
    if (!level) throw new HttpError(400, "目录层级不存在或已停用");
    if (level.type === "data_table" && !nodeId) {
      throw new HttpError(400, "数据表节点来自数据表元数据，不能创建空的数据表节点");
    }
    if (level.order === 1) {
      if (parentId) throw new HttpError(400, "第一级目录不能设置父节点");
      return level;
    }
    if (!parentId) throw new HttpError(400, "该层级必须选择父节点");
    const parentResult = await client.query(`
      SELECT parent.id
      FROM catalog_hierarchy_nodes parent
      JOIN catalog_hierarchy_levels parent_level ON parent_level.id = parent.level_id
      WHERE parent.id = $1 AND parent.is_enabled = TRUE AND parent_level.is_enabled = TRUE
        AND parent_level.level_order = $2
    `, [parentId, level.order - 1]);
    if (!parentResult.rows[0]) throw new HttpError(400, "父节点必须属于上一级目录");
    if (nodeId && String(parentId) === String(nodeId)) throw new HttpError(400, "目录节点不能以自身为父节点");
    return level;
  }

  async function createHierarchyNode(request, response) {
    const body = await readJsonBody(request);
    const levelId = cleanText(body.levelId, 30);
    const parentId = cleanText(body.parentId, 30) || null;
    const name = cleanText(body.name, 255);
    const color = cleanText(body.color, 20) || null;
    if (!/^\d+$/.test(levelId) || (parentId && !/^\d+$/.test(parentId))) throw new HttpError(400, "层级或父节点 ID 无效");
    if (!name) throw new HttpError(400, "目录节点名称不能为空");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await validateNodeParent(client, levelId, parentId);
      const result = await client.query(`
        INSERT INTO catalog_hierarchy_nodes (level_id, parent_id, node_name, node_code, color, sort_order)
        VALUES ($1, $2, $3, $4, $5, COALESCE((
          SELECT MAX(sort_order) + 10 FROM catalog_hierarchy_nodes
          WHERE level_id = $1 AND parent_id IS NOT DISTINCT FROM $2
        ), 10))
        RETURNING id::TEXT AS "id"
      `, [levelId, parentId, name, cleanText(body.code, 120) || null, color]);
      await client.query("COMMIT");
      sendJson(response, 201, { ok: true, node: result.rows[0], message: "目录节点已新增" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error.code === "23505") throw new HttpError(409, "同一父节点下已存在同名目录", "DUPLICATE_HIERARCHY_NODE");
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateHierarchyNode(request, response, nodeId) {
    const body = await readJsonBody(request);
    const levelId = cleanText(body.levelId, 30);
    const parentId = cleanText(body.parentId, 30) || null;
    const name = cleanText(body.name, 255);
    if (!/^\d+$/.test(levelId) || (parentId && !/^\d+$/.test(parentId))) throw new HttpError(400, "层级或父节点 ID 无效");
    if (!name) throw new HttpError(400, "目录节点名称不能为空");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const destinationLevel = await validateNodeParent(client, levelId, parentId, nodeId);
      const currentResult = await client.query(`
        SELECT level.level_type AS "type"
        FROM catalog_hierarchy_nodes node
        JOIN catalog_hierarchy_levels level ON level.id = node.level_id
        WHERE node.id = $1
      `, [nodeId]);
      const current = currentResult.rows[0];
      if (!current) throw new HttpError(404, "未找到该目录节点", "NOT_FOUND");
      if ((current.type === "data_table") !== (destinationLevel.type === "data_table")) {
        throw new HttpError(409, "数据表节点不能转换为普通目录，普通目录也不能转换为数据表", "HIERARCHY_NODE_TYPE_LOCKED");
      }
      const result = await client.query(`
        UPDATE catalog_hierarchy_nodes SET
          level_id = $1, parent_id = $2, node_name = $3,
          node_code = CASE WHEN $9 = 'data_table' THEN node_code ELSE $4 END,
          color = $5, sort_order = $6, is_enabled = $7
        WHERE id = $8
        RETURNING id::TEXT AS "id"
      `, [
        levelId, parentId, name, cleanText(body.code, 120) || null,
        cleanText(body.color, 20) || null, Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        body.enabled !== false, nodeId, destinationLevel.type,
      ]);
      if (destinationLevel.type === "data_table") {
        await client.query(`
          UPDATE catalog_assets asset SET name_cn = $1
          FROM catalog_asset_hierarchy assignment
          WHERE assignment.asset_id = asset.id AND assignment.leaf_node_id = $2
        `, [name, nodeId]);
      }
      await synchronizeLegacyHierarchy(client);
      await client.query("COMMIT");
      sendJson(response, 200, { ok: true, node: result.rows[0], message: "目录节点已保存" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error.code === "23505") throw new HttpError(409, "同一父节点下已存在同名目录或数据表", "DUPLICATE_HIERARCHY_NODE");
      throw error;
    } finally {
      client.release();
    }
  }

  async function deleteHierarchyNode(response, nodeId) {
    const result = await pool.query(`
      DELETE FROM catalog_hierarchy_nodes node
      WHERE node.id = $1
        AND NOT EXISTS (SELECT 1 FROM catalog_hierarchy_nodes child WHERE child.parent_id = node.id)
        AND NOT EXISTS (SELECT 1 FROM catalog_asset_hierarchy asset WHERE asset.leaf_node_id = node.id)
      RETURNING id
    `, [nodeId]);
    if (!result.rows[0]) throw new HttpError(409, "该节点仍包含子节点或数据表，请先迁移后再删除", "HIERARCHY_NODE_IN_USE");
    sendJson(response, 200, { ok: true, message: "目录节点已删除" });
  }

  async function getSummary(response) {
    const result = await pool.query(`
      SELECT
        COUNT(*)::INTEGER AS "assets",
        COUNT(DISTINCT l1_domain)::INTEGER AS "domains",
        COUNT(*) FILTER (WHERE online_status = '是')::INTEGER AS "online",
        COUNT(*) FILTER (WHERE lake_status = '是')::INTEGER AS "inLake",
        (SELECT COUNT(*)::INTEGER FROM catalog_physical_tables WHERE asset_id IS NOT NULL) AS "physicalTables",
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
          COALESCE(hierarchy."path", '[]'::JSONB) AS "hierarchyPath",
          COALESCE(physical."tables", '[]'::JSONB) AS "physicalTables"
        FROM catalog_assets a
        LEFT JOIN LATERAL (
          WITH RECURSIVE node_path AS (
            SELECT node.id, node.parent_id, node.level_id, node.node_name, node.node_code, node.color
            FROM catalog_asset_hierarchy assignment
            JOIN catalog_hierarchy_nodes node ON node.id = assignment.leaf_node_id
            WHERE assignment.asset_id = a.id
            UNION ALL
            SELECT parent.id, parent.parent_id, parent.level_id, parent.node_name, parent.node_code, parent.color
            FROM catalog_hierarchy_nodes parent
            JOIN node_path child ON child.parent_id = parent.id
          )
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'id', node_path.id::TEXT,
            'levelId', level.id::TEXT,
            'levelCode', level.level_code,
            'levelName', level.display_name,
            'levelOrder', level.level_order,
            'levelType', level.level_type,
            'name', node_path.node_name,
            'code', node_path.node_code,
            'color', node_path.color
          ) ORDER BY level.level_order) AS "path"
          FROM node_path
          JOIN catalog_hierarchy_levels level ON level.id = node_path.level_id
        ) hierarchy ON TRUE
        LEFT JOIN LATERAL (
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'id', p.id::TEXT,
            'schemaName', p.schema_name,
            'tableName', p.table_name,
            'tableType', p.table_type,
            'assetType', p.asset_type,
            'dataLayer', p.data_layer,
            'isActive', p.is_active,
            'estimatedRows', p.estimated_rows,
            'totalBytes', p.total_bytes,
            'totalSize', p.total_size_pretty,
            'exactRowCount', p.exact_row_count,
            'qualityScore', p.quality_score,
            'slaAchievementRate', p.sla_achievement_rate,
            'downstreamReferences', p.downstream_references,
            'accessHeat', p.access_heat,
            'lastSeenAt', p.last_seen_at
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
    if (!/^\d+$/.test(assetId) || assetId === "0") throw new HttpError(400, "数据表 ID 无效");
    const asset = normalizeAssetInput(await readJsonBody(request));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let selectedHierarchyPath = null;
      if (asset.hierarchyNodeId) {
        const directoryPath = await hierarchyPath(client, asset.hierarchyNodeId);
        const dataTableLevelResult = await client.query(`
          SELECT level_order AS "order"
          FROM catalog_hierarchy_levels
          WHERE level_type = 'data_table' AND is_enabled = TRUE
        `);
        const dataTableLevel = dataTableLevelResult.rows[0];
        const selectedParent = directoryPath.at(-1);
        if (!dataTableLevel || selectedParent?.levelType !== "directory" || selectedParent.levelOrder !== dataTableLevel.order - 1) {
          throw new HttpError(400, "数据表必须归属到数据表层的直接上级目录");
        }
        asset.l1Domain = directoryPath[0]?.name || asset.l1Domain;
        asset.l2Topic = directoryPath[1]?.name || directoryPath[0]?.name || asset.l2Topic;
        asset.l3Object = directoryPath[2]?.name || directoryPath.at(-1)?.name || asset.l3Object;
      }
      const result = await client.query(`
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
      if (!result.rows[0]) throw new HttpError(404, "未找到该元数据数据表", "NOT_FOUND");
      const dataTableNodeResult = await client.query(`
        UPDATE catalog_hierarchy_nodes node SET
          parent_id = COALESCE($2, node.parent_id),
          node_name = $3
        FROM catalog_asset_hierarchy assignment
        JOIN catalog_hierarchy_levels level ON level.level_type = 'data_table'
        WHERE assignment.asset_id = $1
          AND assignment.leaf_node_id = node.id
          AND node.level_id = level.id
        RETURNING node.id::TEXT AS "id"
      `, [assetId, asset.hierarchyNodeId, asset.nameCn]);
      if (!dataTableNodeResult.rows[0]) {
        throw new HttpError(409, "数据表尚未迁移到 L4，请先执行最新数据库迁移", "DATA_TABLE_NODE_MISSING");
      }
      selectedHierarchyPath = await hierarchyPath(client, dataTableNodeResult.rows[0].id);
      for (const metrics of asset.physicalMetrics) {
        const metricResult = await client.query(`
          UPDATE catalog_physical_tables SET
            quality_score = $1,
            sla_achievement_rate = $2,
            downstream_references = $3,
            access_heat = $4,
            asset_type = $5,
            data_layer = $6
          WHERE id = $7 AND asset_id = $8
          RETURNING id
        `, [
          metrics.qualityScore, metrics.slaAchievementRate,
          metrics.downstreamReferences, metrics.accessHeat,
          metrics.assetType, metrics.dataLayer, metrics.id, assetId,
        ]);
        if (!metricResult.rows[0]) throw new HttpError(400, "实体表指标与当前数据表不匹配");
      }
      await client.query("COMMIT");
      sendJson(response, 200, {
        ok: true,
        asset: { ...result.rows[0], hierarchyPath: selectedHierarchyPath },
        message: "数据表元数据、目录归属、实体表标签与指标已保存",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error.code === "23505") throw new HttpError(409, "同一目录下已存在同名数据表", "DUPLICATE_DATA_TABLE");
      throw error;
    } finally {
      client.release();
    }
  }

  async function addEntityTable(request, response, assetId) {
    if (!/^\d+$/.test(assetId) || assetId === "0") throw new HttpError(400, "数据表 ID 无效");
    const body = await readJsonBody(request);
    const entity = normalizeEntityTableName(body.fullName);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const contextResult = await client.query(`
        SELECT
          EXISTS (SELECT 1 FROM catalog_assets WHERE id = $1) AS "assetExists",
          (SELECT id FROM data_sources WHERE enabled = TRUE ORDER BY id LIMIT 1) AS "sourceId"
      `, [assetId]);
      const context = contextResult.rows[0];
      if (!context?.assetExists) throw new HttpError(404, "未找到该数据表", "NOT_FOUND");
      if (!context.sourceId) throw new HttpError(409, "当前没有启用的数据源，无法新增实体表", "DATA_SOURCE_MISSING");
      const existingResult = await client.query(`
        SELECT id::TEXT AS "id", asset_id::TEXT AS "assetId"
        FROM catalog_physical_tables
        WHERE source_id = $1 AND schema_name = $2 AND table_name = $3
        FOR UPDATE
      `, [context.sourceId, entity.schemaName, entity.tableName]);
      const existing = existingResult.rows[0];
      let result;
      if (existing) {
        if (existing.assetId === String(assetId)) {
          throw new HttpError(409, "该实体表已经属于当前数据表", "ENTITY_TABLE_EXISTS");
        }
        if (existing.assetId) {
          throw new HttpError(409, "该实体表已经属于其他数据表，请先解除原有关系", "ENTITY_TABLE_IN_USE");
        }
        result = await client.query(`
          UPDATE catalog_physical_tables SET asset_id = $1
          WHERE id = $2
          RETURNING id::TEXT AS "id", schema_name AS "schemaName", table_name AS "tableName",
            is_active AS "isActive", last_seen_at AS "lastSeenAt"
        `, [assetId, existing.id]);
      } else {
        result = await client.query(`
          INSERT INTO catalog_physical_tables (
            asset_id, source_id, schema_name, table_name, table_type, is_active
          ) VALUES ($1, $2, $3, $4, 'table', FALSE)
          RETURNING id::TEXT AS "id", schema_name AS "schemaName", table_name AS "tableName",
            is_active AS "isActive", last_seen_at AS "lastSeenAt"
        `, [assetId, context.sourceId, entity.schemaName, entity.tableName]);
      }
      await client.query("COMMIT");
      sendJson(response, 201, {
        ok: true,
        entityTable: result.rows[0],
        message: "实体表已加入该数据表；下次字段同步会校验它是否存在于数据源",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function removeEntityTable(response, assetId, physicalTableId) {
    if (!/^\d+$/.test(assetId) || assetId === "0" || !/^\d+$/.test(physicalTableId) || physicalTableId === "0") {
      throw new HttpError(400, "数据表或实体表 ID 无效");
    }
    const result = await pool.query(`
      UPDATE catalog_physical_tables
      SET asset_id = NULL
      WHERE id = $1 AND asset_id = $2
      RETURNING id
    `, [physicalTableId, assetId]);
    if (!result.rows[0]) throw new HttpError(404, "未找到该数据表下的实体表", "NOT_FOUND");
    sendJson(response, 200, {
      ok: true,
      message: "实体表已从目录关系中移除，源 PostgreSQL 表及已同步字段未被删除",
    });
  }

  async function findPreviewTarget(assetCode, physicalIndex) {
    const result = await pool.query(`
      SELECT JSONB_BUILD_OBJECT(
        'id', p.id::TEXT,
        'schemaName', p.schema_name,
        'tableName', p.table_name,
        'tableType', p.table_type,
        'assetType', p.asset_type,
        'dataLayer', p.data_layer,
        'isActive', p.is_active,
        'lastSeenAt', p.last_seen_at,
        'totalBytes', p.total_bytes,
        'totalSize', p.total_size_pretty,
        'exactRowCount', p.exact_row_count,
        'qualityScore', p.quality_score,
        'slaAchievementRate', p.sla_achievement_rate,
        'downstreamReferences', p.downstream_references,
        'accessHeat', p.access_heat
      ) AS target
      FROM catalog_assets a
      JOIN catalog_physical_tables p ON p.asset_id = a.id
      WHERE a.asset_code = $1
      ORDER BY p.id
      LIMIT 1 OFFSET $2
    `, [assetCode, physicalIndex]);
    return result.rows[0]?.target || null;
  }

  async function updatePhysicalTableTechnicalMetrics(physicalTableId, metrics) {
    await pool.query(`
      UPDATE catalog_physical_tables SET
        total_bytes = $1,
        total_size_pretty = $2,
        exact_row_count = $3,
        last_seen_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `, [metrics.totalBytes, metrics.totalSize, metrics.exactRowCount, physicalTableId]);
  }

  async function getAssetFields(response, assetCode, physicalIndex) {
    const target = await findPreviewTarget(assetCode, physicalIndex);
    if (!target) throw new HttpError(404, "当前数据表没有可读取字段的实体表", "PHYSICAL_TABLE_NOT_FOUND");
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
      if (request.method === "GET" && url.pathname === "/api/catalog/hierarchy") {
        await getHierarchy(response);
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/catalog/hierarchy/levels") {
        await createHierarchyLevel(request, response);
        return true;
      }
      const levelMatch = url.pathname.match(/^\/api\/catalog\/hierarchy\/levels\/(\d+)$/);
      if (request.method === "PATCH" && levelMatch) {
        await updateHierarchyLevel(request, response, levelMatch[1]);
        return true;
      }
      if (request.method === "DELETE" && levelMatch) {
        await deleteHierarchyLevel(response, levelMatch[1]);
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/catalog/hierarchy/nodes") {
        await createHierarchyNode(request, response);
        return true;
      }
      const nodeMatch = url.pathname.match(/^\/api\/catalog\/hierarchy\/nodes\/(\d+)$/);
      if (request.method === "PATCH" && nodeMatch) {
        await updateHierarchyNode(request, response, nodeMatch[1]);
        return true;
      }
      if (request.method === "DELETE" && nodeMatch) {
        await deleteHierarchyNode(response, nodeMatch[1]);
        return true;
      }
      const entityCollectionMatch = url.pathname.match(/^\/api\/catalog\/assets\/(\d+)\/physical-tables$/);
      if (request.method === "POST" && entityCollectionMatch) {
        await addEntityTable(request, response, entityCollectionMatch[1]);
        return true;
      }
      const entityItemMatch = url.pathname.match(/^\/api\/catalog\/assets\/(\d+)\/physical-tables\/(\d+)$/);
      if (request.method === "DELETE" && entityItemMatch) {
        await removeEntityTable(response, entityItemMatch[1], entityItemMatch[2]);
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
    getDefaultSourceConfig,
    getSourceConnection,
    storeSourceConnection,
    updatePhysicalTableTechnicalMetrics,
    close: () => pool.end(),
  };
}

module.exports = { createCatalogApi };
