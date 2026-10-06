(function () {
  "use strict";

  const state = {
    page: 1, pageSize: 20, pages: 1, query: "", online: "", lake: "", sort: "sourceRow", direction: "asc", items: [],
    hierarchy: { levels: [], nodes: [] }, managementView: "assets", selectedNodeId: null,
  };
  const els = {
    summaryAssets: document.getElementById("summaryAssets"), summaryPhysical: document.getElementById("summaryPhysical"),
    summaryDomains: document.getElementById("summaryDomains"), summaryColumns: document.getElementById("summaryColumns"),
    searchInput: document.getElementById("searchInput"), onlineFilter: document.getElementById("onlineFilter"),
    lakeFilter: document.getElementById("lakeFilter"), sortSelect: document.getElementById("sortSelect"),
    refreshButton: document.getElementById("refreshButton"), tableStatus: document.getElementById("tableStatus"),
    rows: document.getElementById("metadataRows"), emptyState: document.getElementById("emptyState"),
    previousPage: document.getElementById("previousPage"), nextPage: document.getElementById("nextPage"),
    pageNumber: document.getElementById("pageNumber"), pageSummary: document.getElementById("pageSummary"),
    dialog: document.getElementById("editDialog"), form: document.getElementById("editForm"),
    editIdentity: document.getElementById("editIdentity"), editPhysicalTables: document.getElementById("editPhysicalTables"),
    editMetricTabs: document.getElementById("editMetricTabs"), editMetricForm: document.getElementById("editMetricForm"),
    metricAssetType: document.getElementById("metricAssetType"), metricDataLayer: document.getElementById("metricDataLayer"),
    metricEmptyEditor: document.getElementById("metricEmptyEditor"), metricTotalSize: document.getElementById("metricTotalSize"),
    metricRowCount: document.getElementById("metricRowCount"), metricQualityScore: document.getElementById("metricQualityScore"),
    metricSlaRate: document.getElementById("metricSlaRate"), metricDownstreamReferences: document.getElementById("metricDownstreamReferences"),
    metricAccessHeat: document.getElementById("metricAccessHeat"),
    formMessage: document.getElementById("formMessage"), saveEdit: document.getElementById("saveEdit"),
    closeDialog: document.getElementById("closeDialog"), cancelEdit: document.getElementById("cancelEdit"), toast: document.getElementById("toast"),
    fieldsDialog: document.getElementById("fieldsDialog"), closeFieldsDialog: document.getElementById("closeFieldsDialog"),
    fieldsIdentity: document.getElementById("fieldsIdentity"), fieldsPhysicalTabs: document.getElementById("fieldsPhysicalTabs"),
    fieldsTableStatus: document.getElementById("fieldsTableStatus"), refreshFields: document.getElementById("refreshFields"),
    fieldsRows: document.getElementById("fieldsRows"), fieldsEmpty: document.getElementById("fieldsEmpty"),
    assetManagementView: document.getElementById("assetManagementView"), hierarchyManagementView: document.getElementById("hierarchyManagementView"),
    levelConfigList: document.getElementById("levelConfigList"), levelCount: document.getElementById("levelCount"),
    refreshHierarchy: document.getElementById("refreshHierarchy"), addHierarchyLevel: document.getElementById("addHierarchyLevel"),
    hierarchyTree: document.getElementById("hierarchyTree"), hierarchyEmpty: document.getElementById("hierarchyEmpty"),
    addRootNode: document.getElementById("addRootNode"), nodeForm: document.getElementById("nodeForm"),
    nodeEditorTitle: document.getElementById("nodeEditorTitle"), nodeEditorHint: document.getElementById("nodeEditorHint"),
    nodeImpact: document.getElementById("nodeImpact"), nodeFormMessage: document.getElementById("nodeFormMessage"),
    addChildNode: document.getElementById("addChildNode"), deleteNode: document.getElementById("deleteNode"), saveNode: document.getElementById("saveNode"),
    hierarchyAssignmentSelects: document.getElementById("hierarchyAssignmentSelects"),
    entityTableManager: document.getElementById("entityTableManager"), entityTableCount: document.getElementById("entityTableCount"),
    entityTableList: document.getElementById("entityTableList"), entityTableForm: document.getElementById("entityTableForm"),
    entityTableName: document.getElementById("entityTableName"), entityTableMessage: document.getElementById("entityTableMessage"),
  };
  let editingId = null;
  let editingItem = null;
  let activeMetricTableId = null;
  let metricDrafts = new Map();
  let fieldViewer = null;
  let searchTimer = null;
  let toastTimer = null;
  let nodeEditorMode = "idle";
  let assignmentSelections = [];
  let pendingEditAssetCode = new URLSearchParams(window.location.search).get("editAsset")?.trim() || "";

  if (pendingEditAssetCode) {
    state.query = pendingEditAssetCode;
    els.searchInput.value = pendingEditAssetCode;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({ ok: false, message: "服务返回了无效数据" }));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "请求失败");
    return payload;
  }

  function orderedLevels({ enabledOnly = false } = {}) {
    return state.hierarchy.levels
      .filter((level) => !enabledOnly || level.enabled)
      .slice()
      .sort((left, right) => left.order - right.order);
  }

  function directoryLevels({ enabledOnly = false } = {}) {
    return orderedLevels({ enabledOnly }).filter((level) => level.type !== "data_table");
  }

  function hierarchyNode(nodeId) {
    return state.hierarchy.nodes.find((node) => node.id === String(nodeId)) || null;
  }

  function nodesAt(levelId, parentId) {
    const normalizedParent = parentId ? String(parentId) : null;
    return state.hierarchy.nodes
      .filter((node) => node.levelId === String(levelId) && (node.parentId || null) === normalizedParent)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"));
  }

  function renderLevelConfig() {
    const levels = orderedLevels();
    const lastDirectory = levels.filter((level) => level.type !== "data_table").at(-1);
    els.levelCount.textContent = `${levels.length} / 6 级`;
    els.addHierarchyLevel.disabled = levels.length >= 6;
    els.levelConfigList.innerHTML = levels.map((level) => `
      <article class="level-config-card ${level.type === "data_table" ? "is-terminal" : ""}" data-level-card="${escapeHtml(level.id)}">
        <span class="level-code">${escapeHtml(level.code)}</span>
        <input type="text" value="${escapeHtml(level.name)}" maxlength="120" aria-label="${escapeHtml(level.code)} 层级名称" />
        <div class="level-card-actions">
          <label><input type="checkbox" data-level-required ${level.required ? "checked" : ""} ${level.type === "data_table" ? "disabled" : ""} />必填</label>
          <label><input type="checkbox" data-level-enabled ${level.enabled ? "checked" : ""} ${level.type === "data_table" ? "disabled" : ""} />${level.type === "data_table" ? "固定终端层" : "启用"}</label>
          <div><button class="mini-button" type="button" data-save-level>保存</button><button class="mini-button danger" type="button" data-delete-level ${level.id === lastDirectory?.id ? "" : "disabled"}>删除</button></div>
        </div>
      </article>
    `).join("");
  }

  function renderHierarchyTree() {
    const levels = orderedLevels();
    const levelById = new Map(levels.map((level) => [level.id, level]));
    const roots = state.hierarchy.nodes.filter((node) => !node.parentId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"));
    const renderBranch = (node) => {
      const children = state.hierarchy.nodes.filter((candidate) => candidate.parentId === node.id)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"));
      const level = levelById.get(node.levelId);
      const entityRows = level?.type === "data_table" ? (node.entityTables || []).map((entity) => `
        <div class="tree-entity-row" title="${escapeHtml(`${entity.schemaName}.${entity.tableName}`)}">
          <b>实体表</b><code>${escapeHtml(`${entity.schemaName}.${entity.tableName}`)}</code>
          <span class="physical-state ${entity.isActive ? "online" : "offline"}">${entity.isActive ? "在线" : "未同步"}</span>
        </div>
      `).join("") : "";
      return `<div class="tree-node">
        <button class="tree-node-row ${node.id === state.selectedNodeId ? "is-selected" : ""}" type="button" data-node-id="${escapeHtml(node.id)}" style="--node-color:${escapeHtml(node.color || "#5a5feb")}">
          <i class="tree-line"></i><b>${escapeHtml(level?.code || "—")}</b><strong>${escapeHtml(node.name)}</strong><span>${node.entityTableCount} 张实体表</span>
        </button>
        ${children.length ? `<div class="tree-node-children">${children.map(renderBranch).join("")}</div>` : ""}${entityRows}
      </div>`;
    };
    els.hierarchyTree.innerHTML = roots.map(renderBranch).join("");
    els.hierarchyEmpty.hidden = roots.length > 0;
  }

  function renderEntityTableManager(node, level) {
    const isDataTable = Boolean(node && node.assetId && level?.type === "data_table");
    els.entityTableManager.hidden = !isDataTable;
    els.entityTableMessage.textContent = "";
    if (!isDataTable) {
      els.entityTableList.innerHTML = "";
      els.entityTableCount.textContent = "0 张";
      return;
    }
    const tables = node.entityTables || [];
    els.entityTableCount.textContent = `${tables.length} 张`;
    els.entityTableList.innerHTML = tables.length ? tables.map((table) => `
      <div class="entity-table-item">
        <span class="physical-state ${table.isActive ? "online" : "offline"}">${table.isActive ? "在线" : "未同步"}</span>
        <code>${escapeHtml(`${table.schemaName}.${table.tableName}`)}</code>
        <button class="mini-button danger" type="button" data-remove-entity-table="${escapeHtml(table.id)}">移除</button>
      </div>
    `).join("") : '<div class="entity-table-empty">当前数据表还没有关联实体表</div>';
  }

  function renderNodeParentOptions(levelId, selectedParentId) {
    const level = orderedLevels().find((candidate) => candidate.id === String(levelId));
    const parentSelect = els.nodeForm.elements.parentId;
    if (!level || level.order === 1) {
      parentSelect.innerHTML = '<option value="">无（一级节点）</option>';
      parentSelect.value = "";
      parentSelect.disabled = true;
      return;
    }
    const previousLevel = orderedLevels().find((candidate) => candidate.order === level.order - 1);
    const options = previousLevel ? state.hierarchy.nodes.filter((node) => node.levelId === previousLevel.id && node.enabled) : [];
    parentSelect.innerHTML = `<option value="">请选择${escapeHtml(previousLevel?.name || "父节点")}</option>${options.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.name)}</option>`).join("")}`;
    parentSelect.disabled = false;
    parentSelect.value = selectedParentId || "";
  }

  function configureNodeEditor({ node = null, levelId = null, parentId = null } = {}) {
    const levels = orderedLevels({ enabledOnly: true });
    const form = els.nodeForm;
    form.reset();
    form.elements.levelId.innerHTML = levels.map((level) => `<option value="${escapeHtml(level.id)}">${escapeHtml(level.code)} · ${escapeHtml(level.name)}</option>`).join("");
    if (node) {
      nodeEditorMode = "edit";
      state.selectedNodeId = node.id;
      form.elements.nodeId.value = node.id;
      form.elements.levelId.value = node.levelId;
      form.elements.levelId.disabled = true;
      renderNodeParentOptions(node.levelId, node.parentId);
      form.elements.name.value = node.name;
      form.elements.code.value = node.code || "";
      form.elements.color.value = /^#[0-9a-f]{6}$/i.test(node.color || "") ? node.color : "#5a5feb";
      form.elements.sortOrder.value = node.sortOrder;
      form.elements.enabled.checked = node.enabled;
      const level = levels.find((candidate) => candidate.id === node.levelId);
      const isDataTable = level?.type === "data_table";
      form.elements.code.disabled = isDataTable;
      form.elements.enabled.disabled = isDataTable;
      els.nodeEditorTitle.textContent = isDataTable ? "编辑数据表节点" : "编辑目录节点";
      els.nodeEditorHint.textContent = `包含 ${node.dataTableCount} 张数据表、${node.entityTableCount} 张实体表`;
      els.nodeImpact.textContent = node.entityTableCount
        ? `修改名称或父节点会影响该节点及其下 ${node.entityTableCount} 张实体表的目录路径。`
        : "当前节点下没有实体表，可以调整目录位置。";
      els.deleteNode.disabled = isDataTable;
      const childLevel = levels.find((candidate) => candidate.order === (level?.order || 0) + 1);
      els.addChildNode.disabled = !childLevel || childLevel.type === "data_table";
      renderEntityTableManager(node, level);
    } else if (levelId) {
      nodeEditorMode = "create";
      state.selectedNodeId = null;
      form.elements.nodeId.value = "";
      form.elements.levelId.value = String(levelId);
      form.elements.levelId.disabled = true;
      renderNodeParentOptions(levelId, parentId);
      form.elements.name.value = "";
      form.elements.code.value = "";
      form.elements.color.value = "#5a5feb";
      form.elements.sortOrder.value = "0";
      form.elements.enabled.checked = true;
      els.nodeEditorTitle.textContent = "新增目录节点";
      els.nodeEditorHint.textContent = "填写节点名称后保存。";
      form.elements.code.disabled = false;
      form.elements.enabled.disabled = false;
      els.nodeImpact.textContent = "新增目录不会自动迁移数据表，可在数据表编辑窗口中调整归属。";
      els.deleteNode.disabled = true;
      els.addChildNode.disabled = true;
      renderEntityTableManager(null, null);
    } else {
      nodeEditorMode = "idle";
      state.selectedNodeId = null;
      form.elements.levelId.innerHTML = "";
      form.elements.parentId.innerHTML = '<option value="">请先选择目录节点</option>';
      form.elements.levelId.disabled = true;
      form.elements.parentId.disabled = true;
      els.nodeEditorTitle.textContent = "目录节点信息";
      els.nodeEditorHint.textContent = "从左侧选择一个节点进行编辑。";
      form.elements.code.disabled = false;
      form.elements.enabled.disabled = false;
      els.nodeImpact.textContent = "选择节点后显示其数据表和实体表数量。";
      els.deleteNode.disabled = true;
      els.addChildNode.disabled = true;
      renderEntityTableManager(null, null);
    }
    els.saveNode.disabled = nodeEditorMode === "idle";
    els.nodeFormMessage.textContent = "";
    renderHierarchyTree();
  }

  async function loadHierarchy({ keepSelection = true } = {}) {
    const selected = keepSelection ? state.selectedNodeId : null;
    const payload = await fetchJson("/api/catalog/hierarchy");
    state.hierarchy.levels = payload.levels;
    state.hierarchy.nodes = payload.nodes;
    renderLevelConfig();
    const selectedNode = selected ? hierarchyNode(selected) : null;
    if (selectedNode) configureNodeEditor({ node: selectedNode });
    else {
      state.selectedNodeId = null;
      renderHierarchyTree();
      if (nodeEditorMode !== "create") configureNodeEditor();
    }
    if (editingItem) renderHierarchyAssignment();
  }

  function renderHierarchyAssignment() {
    const levels = directoryLevels({ enabledOnly: true });
    let parentId = null;
    assignmentSelections = assignmentSelections.slice(0, levels.length);
    const fields = [];
    levels.forEach((level, index) => {
      const options = nodesAt(level.id, parentId).filter((node) => node.enabled);
      const selected = assignmentSelections[index];
      if (!options.some((node) => node.id === selected)) {
        assignmentSelections[index] = null;
        assignmentSelections = assignmentSelections.slice(0, index + 1);
      }
      const value = assignmentSelections[index] || "";
      fields.push(`<label><span>${escapeHtml(level.code)} · ${escapeHtml(level.name)}${level.required ? " *" : ""}</span><select data-assignment-index="${index}" ${index > 0 && !parentId ? "disabled" : ""}>
        <option value="">${level.required ? "请选择" : "可不选择"}</option>
        ${options.map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === value ? "selected" : ""}>${escapeHtml(node.name)}</option>`).join("")}
      </select></label>`);
      parentId = value || null;
    });
    els.hierarchyAssignmentSelects.innerHTML = fields.join("");
    const selectedNodes = assignmentSelections.map(hierarchyNode).filter(Boolean);
    els.form.elements.hierarchyNodeId.value = selectedNodes.at(-1)?.id || "";
    els.form.elements.l1Domain.value = selectedNodes[0]?.name || editingItem?.l1Domain || "";
    els.form.elements.l2Topic.value = selectedNodes[1]?.name || selectedNodes[0]?.name || editingItem?.l2Topic || "";
    els.form.elements.l3Object.value = selectedNodes[2]?.name || selectedNodes.at(-1)?.name || editingItem?.l3Object || "";
  }

  function validateHierarchyAssignment() {
    const levels = directoryLevels({ enabledOnly: true });
    const missing = levels.filter((level, index) => level.required && !assignmentSelections[index]);
    if (missing.length) {
      els.formMessage.textContent = `请选择：${missing.map((level) => level.name).join("、")}`;
      return false;
    }
    if (!els.form.elements.hierarchyNodeId.value) {
      els.formMessage.textContent = "至少需要选择一个目录节点";
      return false;
    }
    return true;
  }

  function statusChip(label, value) {
    const normalized = value || "待确认";
    const className = normalized === "是" ? "yes" : normalized === "否" ? "no" : "warn";
    return `<span class="status-chip ${className}">${escapeHtml(label)}：${escapeHtml(normalized)}</span>`;
  }

  function formatTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function formatMetricNumber(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(number) : "—";
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let amount = bytes;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
    return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(amount)} ${units[index]}`;
  }

  function inputMetricValue(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function captureMetricDraft() {
    if (!activeMetricTableId || !metricDrafts.has(activeMetricTableId)) return;
    metricDrafts.set(activeMetricTableId, {
      ...metricDrafts.get(activeMetricTableId),
      assetType: els.metricAssetType.value,
      dataLayer: els.metricDataLayer.value,
      qualityScore: els.metricQualityScore.value,
      slaAchievementRate: els.metricSlaRate.value,
      downstreamReferences: els.metricDownstreamReferences.value,
      accessHeat: els.metricAccessHeat.value,
    });
  }

  function renderMetricEditor() {
    const tables = editingItem?.physicalTables || [];
    const hasTables = tables.length > 0;
    els.editMetricTabs.hidden = !hasTables;
    els.editMetricForm.hidden = !hasTables;
    els.metricEmptyEditor.hidden = hasTables;
    if (!hasTables) {
      els.editMetricTabs.innerHTML = "";
      return;
    }
    if (!tables.some((table) => table.id === activeMetricTableId)) activeMetricTableId = tables[0].id;
    els.editMetricTabs.innerHTML = tables.map((table, index) => `
      <button class="metric-tab ${table.id === activeMetricTableId ? "is-active" : ""}" type="button" data-metric-table-id="${escapeHtml(table.id)}">
        <span>实体表 ${index + 1}</span><code>${escapeHtml(`${table.schemaName}.${table.tableName}`)}</code>
      </button>
    `).join("");
    const table = tables.find((candidate) => candidate.id === activeMetricTableId);
    const draft = metricDrafts.get(activeMetricTableId) || {};
    els.metricAssetType.value = draft.assetType || "";
    els.metricDataLayer.value = draft.dataLayer || "";
    els.metricTotalSize.value = table?.totalSize || formatBytes(table?.totalBytes);
    els.metricRowCount.value = formatMetricNumber(table?.exactRowCount);
    els.metricQualityScore.value = inputMetricValue(draft.qualityScore);
    els.metricSlaRate.value = inputMetricValue(draft.slaAchievementRate);
    els.metricDownstreamReferences.value = inputMetricValue(draft.downstreamReferences);
    els.metricAccessHeat.value = inputMetricValue(draft.accessHeat);
  }

  function renderRows(items) {
    els.emptyState.hidden = items.length > 0;
    els.rows.innerHTML = items.map((item) => {
      const hierarchy = item.hierarchyPath?.length
        ? item.hierarchyPath.map((node) => `<span><b>${escapeHtml(node.levelCode)}</b>${escapeHtml(node.name)}</span>`).join("")
        : `<span><b>L1</b>${escapeHtml(item.l1Domain)}</span><span><b>L2</b>${escapeHtml(item.l2Topic)}</span><span><b>L3</b>${escapeHtml(item.l3Object)}</span>`;
      const physical = item.physicalTables.length
        ? item.physicalTables.map((table) => `<span class="physical-chip ${table.isActive ? "" : "is-offline"}" title="${escapeHtml(`${table.schemaName}.${table.tableName} · ${table.isActive ? "在线" : "离线"}`)}">${escapeHtml(`${table.schemaName}.${table.tableName}`)}</span>`).join("")
        : '<span class="muted">实体表待补充</span>';
      return `<tr>
        <td><div class="asset-name"><strong>${escapeHtml(item.nameCn)}</strong><small>${escapeHtml(item.assetCode)} · Excel 第 ${escapeHtml(item.sourceRow)} 行</small></div></td>
        <td><div class="hierarchy">${hierarchy}</div></td>
        <td><div class="physical-list">${physical}</div></td>
        <td>${item.owner ? escapeHtml(item.owner) : '<span class="muted">未设置</span>'}</td>
        <td><div class="status-stack">${statusChip("线上", item.onlineStatus)}${statusChip("入湖", item.lakeStatus)}${item.sensitivityLevel ? `<span class="status-chip warn">${escapeHtml(item.sensitivityLevel)}</span>` : ""}</div></td>
        <td><span class="muted">${escapeHtml(formatTime(item.updatedAt))}</span></td>
        <td><div class="row-actions"><button class="fields-button" type="button" data-fields-id="${escapeHtml(item.id)}" ${item.physicalTables.length ? "" : "disabled"}>字段结构</button><button class="edit-button" type="button" data-edit-id="${escapeHtml(item.id)}">编辑</button></div></td>
      </tr>`;
    }).join("");
  }

  async function loadSummary() {
    const payload = await fetchJson("/api/catalog/summary");
    els.summaryAssets.textContent = payload.summary.assets;
    els.summaryPhysical.textContent = payload.summary.physicalTables;
    els.summaryDomains.textContent = payload.summary.domains;
    els.summaryColumns.textContent = payload.summary.columns;
  }

  async function loadAssets() {
    els.tableStatus.textContent = "正在加载元数据…";
    const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize, sort: state.sort, direction: state.direction });
    if (state.query) params.set("query", state.query);
    if (state.online) params.set("online", state.online);
    if (state.lake) params.set("lake", state.lake);
    try {
      const payload = await fetchJson(`/api/catalog/assets?${params}`);
      state.items = payload.items;
      state.pages = payload.pages;
      state.page = payload.page;
      renderRows(payload.items);
      const start = payload.total ? (payload.page - 1) * payload.pageSize + 1 : 0;
      const end = Math.min(payload.page * payload.pageSize, payload.total);
      els.tableStatus.textContent = `找到 ${payload.total} 张数据表，当前显示 ${start}–${end}`;
      els.pageSummary.textContent = `共 ${payload.total} 张数据表 · 每页 ${payload.pageSize} 条`;
      els.pageNumber.textContent = `${payload.page} / ${payload.pages}`;
      els.previousPage.disabled = payload.page <= 1;
      els.nextPage.disabled = payload.page >= payload.pages;
      if (pendingEditAssetCode) {
        const target = payload.items.find((item) => item.assetCode === pendingEditAssetCode);
        if (target) {
          pendingEditAssetCode = "";
          window.history.replaceState({}, "", "./metadata.html");
          openEditor(target);
        } else if (payload.total === 0) {
          els.tableStatus.textContent = "未找到要编辑的数据表";
        }
      }
    } catch (error) {
      state.items = [];
      renderRows([]);
      els.tableStatus.textContent = error.message;
    }
  }

  function openEditor(item) {
    editingId = item.id;
    editingItem = item;
    activeMetricTableId = item.physicalTables[0]?.id || null;
    metricDrafts = new Map(item.physicalTables.map((table) => [table.id, {
      id: table.id,
      assetType: table.assetType || "",
      dataLayer: table.dataLayer || "",
      qualityScore: inputMetricValue(table.qualityScore),
      slaAchievementRate: inputMetricValue(table.slaAchievementRate),
      downstreamReferences: inputMetricValue(table.downstreamReferences),
      accessHeat: inputMetricValue(table.accessHeat),
    }]));
    els.form.reset();
    els.form.elements.nameCn.value = item.nameCn || "";
    els.form.elements.l1Domain.value = item.l1Domain || "";
    els.form.elements.l2Topic.value = item.l2Topic || "";
    els.form.elements.l3Object.value = item.l3Object || "";
    els.form.elements.owner.value = item.owner || "";
    els.form.elements.description.value = item.description || "";
    els.form.elements.onlineStatus.value = item.onlineStatus || "";
    els.form.elements.lakeStatus.value = item.lakeStatus || "";
    els.form.elements.sensitivityLevel.value = item.sensitivityLevel || "";
    assignmentSelections = item.hierarchyPath
      ?.filter((node) => node.levelType !== "data_table")
      .map((node) => String(node.id)) || [];
    renderHierarchyAssignment();
    els.editIdentity.textContent = `${item.assetCode} · Excel 第 ${item.sourceRow} 行`;
    els.editPhysicalTables.innerHTML = item.physicalTables.length
      ? item.physicalTables.map((table) => `<span class="physical-chip">${escapeHtml(`${table.schemaName}.${table.tableName}`)}</span>`).join("")
      : '<span class="muted">暂无关联实体表</span>';
    renderMetricEditor();
    els.formMessage.textContent = "";
    els.dialog.showModal();
  }

  function closeEditor() { editingId = null; editingItem = null; activeMetricTableId = null; metricDrafts = new Map(); assignmentSelections = []; els.dialog.close(); }
  function showToast(message) { clearTimeout(toastTimer); els.toast.textContent = message; els.toast.classList.add("show"); toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2400); }

  function renderFields(columns) {
    els.fieldsEmpty.hidden = columns.length > 0;
    els.fieldsRows.innerHTML = columns.map((column) => `
      <tr>
        <td><span class="ordinal">${escapeHtml(column.ordinalPosition)}</span></td>
        <td><code class="column-name">${escapeHtml(column.columnName)}</code></td>
        <td><code class="column-type">${escapeHtml(column.dataType)}</code></td>
        <td>${column.isPrimaryKey ? '<span class="field-badge key">PK</span>' : '<span class="muted">—</span>'}</td>
        <td><span class="field-badge ${column.isNullable ? "nullable" : "required"}">${column.isNullable ? "可空" : "必填"}</span></td>
        <td><code class="default-value" title="${escapeHtml(column.defaultValue || "")}">${escapeHtml(column.defaultValue || "—")}</code></td>
        <td><span class="column-comment">${escapeHtml(column.columnComment || "暂无说明")}</span></td>
        <td>${column.sensitivityLevel ? `<span class="field-badge sensitive">${escapeHtml(column.sensitivityLevel)}</span>` : '<span class="muted">未设置</span>'}</td>
      </tr>
    `).join("");
  }

  function renderPhysicalTabs() {
    if (!fieldViewer) return;
    els.fieldsPhysicalTabs.innerHTML = fieldViewer.item.physicalTables.map((table, index) => `
      <button type="button" class="physical-tab ${index === fieldViewer.physicalIndex ? "is-active" : ""}" data-physical-index="${index}">
        <span class="physical-state ${table.isActive ? "online" : "offline"}">${table.isActive ? "在线" : "离线"}</span>
        <code>${escapeHtml(`${table.schemaName}.${table.tableName}`)}</code>
      </button>
    `).join("");
  }

  async function loadFields() {
    if (!fieldViewer) return;
    const { item, physicalIndex } = fieldViewer;
    const physical = item.physicalTables[physicalIndex];
    if (!physical) {
      renderFields([]);
      els.fieldsTableStatus.textContent = "当前数据表没有关联实体表";
      els.refreshFields.disabled = true;
      return;
    }
    els.refreshFields.disabled = true;
    els.refreshFields.textContent = "正在读取…";
    els.fieldsTableStatus.textContent = `正在读取 ${physical.schemaName}.${physical.tableName} 的字段结构…`;
    els.fieldsEmpty.hidden = true;
    els.fieldsRows.innerHTML = '<tr class="loading-row"><td colspan="8">正在加载字段元数据…</td></tr>';
    try {
      const payload = await fetchJson(`/api/catalog/assets/by-code/${encodeURIComponent(item.assetCode)}/fields?physicalIndex=${physicalIndex}`);
      if (!fieldViewer || fieldViewer.item.id !== item.id || fieldViewer.physicalIndex !== physicalIndex) return;
      renderFields(payload.columns);
      const syncedAt = payload.physicalTable.lastSeenAt ? ` · 最近同步 ${formatTime(payload.physicalTable.lastSeenAt)}` : "";
      els.fieldsTableStatus.textContent = `${physical.schemaName}.${physical.tableName} · ${payload.columns.length} 个字段${syncedAt}`;
    } catch (error) {
      if (!fieldViewer || fieldViewer.item.id !== item.id || fieldViewer.physicalIndex !== physicalIndex) return;
      renderFields([]);
      els.fieldsTableStatus.textContent = error.message;
    } finally {
      if (fieldViewer && fieldViewer.item.id === item.id && fieldViewer.physicalIndex === physicalIndex) {
        els.refreshFields.disabled = false;
        els.refreshFields.textContent = "刷新字段";
      }
    }
  }

  function openFields(item) {
    fieldViewer = { item, physicalIndex: 0 };
    els.fieldsIdentity.textContent = `${item.nameCn} · ${item.assetCode}`;
    renderPhysicalTabs();
    els.fieldsDialog.showModal();
    loadFields();
  }

  function closeFields() {
    fieldViewer = null;
    els.fieldsDialog.close();
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (!editingId) return;
    renderHierarchyAssignment();
    if (!validateHierarchyAssignment()) return;
    els.saveEdit.disabled = true;
    els.saveEdit.textContent = "正在保存…";
    els.formMessage.textContent = "";
    const data = Object.fromEntries(new FormData(els.form).entries());
    captureMetricDraft();
    data.physicalMetrics = [...metricDrafts.values()].map((metrics) => ({
      id: metrics.id,
      assetType: metrics.assetType,
      dataLayer: metrics.dataLayer,
      qualityScore: metrics.qualityScore,
      slaAchievementRate: metrics.slaAchievementRate,
      downstreamReferences: metrics.downstreamReferences,
      accessHeat: metrics.accessHeat,
    }));
    try {
      const payload = await fetchJson(`/api/catalog/assets/${editingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      closeEditor();
      showToast(payload.message);
      await Promise.all([loadSummary(), loadAssets(), loadHierarchy()]);
    } catch (error) {
      els.formMessage.textContent = error.message;
    } finally {
      els.saveEdit.disabled = false;
      els.saveEdit.textContent = "保存元数据";
    }
  }

  function switchManagementView(view) {
    state.managementView = view === "hierarchy" ? "hierarchy" : "assets";
    els.assetManagementView.hidden = state.managementView !== "assets";
    els.hierarchyManagementView.hidden = state.managementView !== "hierarchy";
    document.querySelectorAll("[data-management-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.managementView === state.managementView);
    });
    els.refreshButton.hidden = state.managementView !== "assets";
  }

  async function saveLevelCard(card) {
    const levelId = card.dataset.levelCard;
    const name = card.querySelector('input[type="text"]').value.trim();
    const payload = await fetchJson(`/api/catalog/hierarchy/levels/${levelId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        required: card.querySelector("[data-level-required]").checked,
        enabled: card.querySelector("[data-level-enabled]").checked,
      }),
    });
    showToast(payload.message);
    await loadHierarchy();
  }

  async function addHierarchyLevel() {
    const dataTableLevel = orderedLevels().find((level) => level.type === "data_table");
    const payload = await fetchJson("/api/catalog/hierarchy/levels", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `新目录层级 ${dataTableLevel?.order || state.hierarchy.levels.length + 1}`, required: false }),
    });
    showToast(payload.message);
    await loadHierarchy({ keepSelection: false });
  }

  async function deleteHierarchyLevel(levelId) {
    if (!window.confirm("仅紧邻数据表层且没有节点的最后一级业务目录可以删除。确定继续吗？")) return;
    const payload = await fetchJson(`/api/catalog/hierarchy/levels/${levelId}`, { method: "DELETE" });
    showToast(payload.message);
    await loadHierarchy({ keepSelection: false });
  }

  async function saveNodeForm(event) {
    event.preventDefault();
    if (nodeEditorMode === "idle") return;
    const form = els.nodeForm;
    const nodeId = form.elements.nodeId.value;
    const payload = {
      levelId: form.elements.levelId.value,
      parentId: form.elements.parentId.value,
      name: form.elements.name.value.trim(),
      code: form.elements.code.value.trim(),
      color: form.elements.color.value,
      sortOrder: Number(form.elements.sortOrder.value) || 0,
      enabled: form.elements.enabled.checked,
    };
    els.saveNode.disabled = true;
    els.nodeFormMessage.textContent = "";
    try {
      const result = await fetchJson(nodeId ? `/api/catalog/hierarchy/nodes/${nodeId}` : "/api/catalog/hierarchy/nodes", {
        method: nodeId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      state.selectedNodeId = nodeId || result.node.id;
      showToast(result.message);
      await Promise.all([loadHierarchy(), loadSummary(), loadAssets()]);
    } catch (error) {
      els.nodeFormMessage.textContent = error.message;
    } finally {
      els.saveNode.disabled = nodeEditorMode === "idle";
    }
  }

  function beginRootNode() {
    const firstLevel = orderedLevels({ enabledOnly: true })[0];
    if (!firstLevel) return;
    configureNodeEditor({ levelId: firstLevel.id, parentId: null });
    els.nodeForm.elements.name.focus();
  }

  function beginChildNode() {
    const node = hierarchyNode(state.selectedNodeId);
    if (!node) return;
    const currentLevel = orderedLevels({ enabledOnly: true }).find((level) => level.id === node.levelId);
    const childLevel = orderedLevels({ enabledOnly: true }).find((level) => level.order === (currentLevel?.order || 0) + 1);
    if (!childLevel) {
      showToast("当前节点已经处于最后一级");
      return;
    }
    if (childLevel.type === "data_table") {
      showToast("L4 数据表来自数据表元数据，请在数据表列表中维护");
      return;
    }
    configureNodeEditor({ levelId: childLevel.id, parentId: node.id });
    els.nodeForm.elements.name.focus();
  }

  async function deleteSelectedNode() {
    const node = hierarchyNode(state.selectedNodeId);
    if (!node || !window.confirm(`确定删除目录节点“${node.name}”吗？`)) return;
    try {
      const payload = await fetchJson(`/api/catalog/hierarchy/nodes/${node.id}`, { method: "DELETE" });
      showToast(payload.message);
      state.selectedNodeId = null;
      await loadHierarchy({ keepSelection: false });
    } catch (error) {
      els.nodeFormMessage.textContent = error.message;
    }
  }

  async function addEntityTable(event) {
    event.preventDefault();
    const node = hierarchyNode(state.selectedNodeId);
    if (!node?.assetId) return;
    const fullName = els.entityTableName.value.trim();
    if (!fullName) return;
    els.entityTableMessage.textContent = "";
    const button = els.entityTableForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const payload = await fetchJson(`/api/catalog/assets/${node.assetId}/physical-tables`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName }),
      });
      els.entityTableForm.reset();
      showToast(payload.message);
      await Promise.all([loadHierarchy(), loadSummary(), loadAssets()]);
    } catch (error) {
      els.entityTableMessage.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function removeEntityTable(physicalTableId) {
    const node = hierarchyNode(state.selectedNodeId);
    if (!node?.assetId || !window.confirm("确定从当前数据表移除这张实体表吗？源 PostgreSQL 表不会被删除。")) return;
    els.entityTableMessage.textContent = "";
    try {
      const payload = await fetchJson(`/api/catalog/assets/${node.assetId}/physical-tables/${physicalTableId}`, { method: "DELETE" });
      showToast(payload.message);
      await Promise.all([loadHierarchy(), loadSummary(), loadAssets()]);
    } catch (error) {
      els.entityTableMessage.textContent = error.message;
    }
  }

  els.rows.addEventListener("click", (event) => {
    const fieldsButton = event.target.closest("[data-fields-id]");
    const editButton = event.target.closest("[data-edit-id]");
    if (fieldsButton) {
      const item = state.items.find((candidate) => candidate.id === fieldsButton.dataset.fieldsId);
      if (item) openFields(item);
      return;
    }
    if (editButton) {
      const item = state.items.find((candidate) => candidate.id === editButton.dataset.editId);
      if (item) openEditor(item);
    }
  });
  els.fieldsPhysicalTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-physical-index]");
    if (!button || !fieldViewer) return;
    fieldViewer.physicalIndex = Number(button.dataset.physicalIndex);
    renderPhysicalTabs();
    loadFields();
  });
  els.editMetricTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-metric-table-id]");
    if (!button || button.dataset.metricTableId === activeMetricTableId) return;
    captureMetricDraft();
    activeMetricTableId = button.dataset.metricTableId;
    renderMetricEditor();
  });
  document.querySelectorAll("[data-management-view]").forEach((button) => {
    button.addEventListener("click", () => switchManagementView(button.dataset.managementView));
  });
  els.levelConfigList.addEventListener("click", async (event) => {
    const card = event.target.closest("[data-level-card]");
    if (!card) return;
    try {
      if (event.target.closest("[data-save-level]")) await saveLevelCard(card);
      if (event.target.closest("[data-delete-level]")) await deleteHierarchyLevel(card.dataset.levelCard);
    } catch (error) {
      showToast(error.message);
    }
  });
  els.hierarchyTree.addEventListener("click", (event) => {
    const row = event.target.closest("[data-node-id]");
    if (!row) return;
    const node = hierarchyNode(row.dataset.nodeId);
    if (node) configureNodeEditor({ node });
  });
  els.hierarchyAssignmentSelects.addEventListener("change", (event) => {
    const select = event.target.closest("[data-assignment-index]");
    if (!select) return;
    const index = Number(select.dataset.assignmentIndex);
    assignmentSelections[index] = select.value || null;
    assignmentSelections = assignmentSelections.slice(0, index + 1);
    renderHierarchyAssignment();
  });
  els.entityTableForm.addEventListener("submit", addEntityTable);
  els.entityTableList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-entity-table]");
    if (button) removeEntityTable(button.dataset.removeEntityTable);
  });
  els.nodeForm.addEventListener("submit", saveNodeForm);
  els.addRootNode.addEventListener("click", beginRootNode);
  els.addChildNode.addEventListener("click", beginChildNode);
  els.deleteNode.addEventListener("click", deleteSelectedNode);
  els.addHierarchyLevel.addEventListener("click", () => addHierarchyLevel().catch((error) => showToast(error.message)));
  els.refreshHierarchy.addEventListener("click", () => loadHierarchy().catch((error) => showToast(error.message)));
  els.searchInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = els.searchInput.value.trim(); state.page = 1; loadAssets(); }, 260); });
  els.onlineFilter.addEventListener("change", () => { state.online = els.onlineFilter.value; state.page = 1; loadAssets(); });
  els.lakeFilter.addEventListener("change", () => { state.lake = els.lakeFilter.value; state.page = 1; loadAssets(); });
  els.sortSelect.addEventListener("change", () => { [state.sort, state.direction] = els.sortSelect.value.split(":"); state.page = 1; loadAssets(); });
  els.previousPage.addEventListener("click", () => { if (state.page > 1) { state.page -= 1; loadAssets(); } });
  els.nextPage.addEventListener("click", () => { if (state.page < state.pages) { state.page += 1; loadAssets(); } });
  els.refreshButton.addEventListener("click", () => Promise.all([loadSummary(), loadAssets()]));
  els.refreshFields.addEventListener("click", loadFields);
  els.closeDialog.addEventListener("click", closeEditor); els.cancelEdit.addEventListener("click", closeEditor); els.form.addEventListener("submit", saveEditor);
  els.dialog.addEventListener("click", (event) => { if (event.target === els.dialog) closeEditor(); });
  els.closeFieldsDialog.addEventListener("click", closeFields);
  els.fieldsDialog.addEventListener("click", (event) => { if (event.target === els.fieldsDialog) closeFields(); });
  els.fieldsDialog.addEventListener("close", () => { fieldViewer = null; });

  loadHierarchy({ keepSelection: false })
    .then(() => Promise.all([loadSummary(), loadAssets()]))
    .catch((error) => { els.tableStatus.textContent = error.message; showToast(error.message); });
}());
