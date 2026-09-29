(function () {
  "use strict";

  const state = { page: 1, pageSize: 20, pages: 1, query: "", online: "", lake: "", sort: "sourceRow", direction: "asc", items: [] };
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
  };
  let editingId = null;
  let editingItem = null;
  let activeMetricTableId = null;
  let metricDrafts = new Map();
  let fieldViewer = null;
  let searchTimer = null;
  let toastTimer = null;
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
        <span>物理表 ${index + 1}</span><code>${escapeHtml(`${table.schemaName}.${table.tableName}`)}</code>
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
      const physical = item.physicalTables.length
        ? item.physicalTables.map((table) => `<span class="physical-chip ${table.isActive ? "" : "is-offline"}" title="${escapeHtml(`${table.schemaName}.${table.tableName} · ${table.isActive ? "在线" : "离线"}`)}">${escapeHtml(`${table.schemaName}.${table.tableName}`)}</span>`).join("")
        : '<span class="muted">英文表名待补充</span>';
      return `<tr>
        <td><div class="asset-name"><strong>${escapeHtml(item.nameCn)}</strong><small>${escapeHtml(item.assetCode)} · Excel 第 ${escapeHtml(item.sourceRow)} 行</small></div></td>
        <td><div class="hierarchy"><span><b>L1</b>${escapeHtml(item.l1Domain)}</span><span><b>L2</b>${escapeHtml(item.l2Topic)}</span><span><b>L3</b>${escapeHtml(item.l3Object)}</span></div></td>
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
      els.tableStatus.textContent = `找到 ${payload.total} 条元数据，当前显示 ${start}–${end}`;
      els.pageSummary.textContent = `共 ${payload.total} 条 · 每页 ${payload.pageSize} 条`;
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
          els.tableStatus.textContent = "未找到要编辑的元数据资产";
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
    els.editIdentity.textContent = `${item.assetCode} · Excel 第 ${item.sourceRow} 行`;
    els.editPhysicalTables.innerHTML = item.physicalTables.length
      ? item.physicalTables.map((table) => `<span class="physical-chip">${escapeHtml(`${table.schemaName}.${table.tableName}`)}</span>`).join("")
      : '<span class="muted">暂无关联物理表</span>';
    renderMetricEditor();
    els.formMessage.textContent = "";
    els.dialog.showModal();
  }

  function closeEditor() { editingId = null; editingItem = null; activeMetricTableId = null; metricDrafts = new Map(); els.dialog.close(); }
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
      els.fieldsTableStatus.textContent = "当前资产没有关联物理表";
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
      await Promise.all([loadSummary(), loadAssets()]);
    } catch (error) {
      els.formMessage.textContent = error.message;
    } finally {
      els.saveEdit.disabled = false;
      els.saveEdit.textContent = "保存元数据";
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

  Promise.all([loadSummary(), loadAssets()]).catch((error) => { els.tableStatus.textContent = error.message; });
}());
