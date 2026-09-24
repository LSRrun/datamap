(function () {
  "use strict";

  const dataset = window.DATA_MAP || { domains: [], tables: [], meta: {} };
  const state = {
    domain: "all",
    topic: "all",
    businessObject: "all",
    query: "",
    online: "all",
    lake: "all",
    view: "cards",
    linkMode: "l3",
    related: null,
    selectedTableId: null,
    assetDetail: null,
    openGroups: new Set(),
    treeOpen: new Set(),
  };

  const els = {
    allDomainCount: document.getElementById("allDomainCount"),
    domainNavList: document.getElementById("domainNavList"),
    collapseAllTree: document.getElementById("collapseAllTree"),
    searchInput: document.getElementById("searchInput"),
    topicFilter: document.getElementById("topicFilter"),
    businessObjectFilter: document.getElementById("businessObjectFilter"),
    onlineFilter: document.getElementById("onlineFilter"),
    lakeFilter: document.getElementById("lakeFilter"),
    mapAllData: document.getElementById("mapAllData"),
    mapOnlineFilter: document.getElementById("mapOnlineFilter"),
    mapLakeFilter: document.getElementById("mapLakeFilter"),
    catalogGroups: document.getElementById("catalogGroups"),
    catalogTitle: document.getElementById("catalogTitle"),
    resultSummary: document.getElementById("resultSummary"),
    activeFilters: document.getElementById("activeFilters"),
    emptyState: document.getElementById("emptyState"),
    metricTables: document.getElementById("metricTables"),
    metricDomains: document.getElementById("metricDomains"),
    metricOnline: document.getElementById("metricOnline"),
    metricLake: document.getElementById("metricLake"),
    onlineRatio: document.getElementById("onlineRatio"),
    lakeRatio: document.getElementById("lakeRatio"),
    completionRing: document.getElementById("completionRing"),
    completionText: document.getElementById("completionText"),
    mapCaptionTitle: document.getElementById("mapCaptionTitle"),
    mapCaptionMeta: document.getElementById("mapCaptionMeta"),
    mapZoomLevel: document.getElementById("mapZoomLevel"),
    dataFreshness: document.getElementById("dataFreshness"),
    drawer: document.getElementById("detailDrawer"),
    drawerBody: document.getElementById("drawerBody"),
    drawerDomain: document.getElementById("drawerDomain"),
    assetDrawerLayer: document.getElementById("assetDrawerLayer"),
    assetDrawer: document.getElementById("assetDrawer"),
    assetDrawerContent: document.getElementById("assetDrawerContent"),
    assetDrawerScrim: document.getElementById("assetDrawerScrim"),
    sidebar: document.getElementById("sidebar"),
    sidebarScrim: document.getElementById("sidebarScrim"),
    guideModal: document.getElementById("guideModal"),
  };

  const domainByName = new Map(dataset.domains.map((domain) => [domain.name, domain]));
  const tableById = new Map(dataset.tables.map((table) => [String(table.id), table]));

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function statusClass(value) {
    if (value === "是") return "yes";
    if (value === "否") return "no";
    return "unknown";
  }

  function statusLabel(value, type) {
    if (value === "是") return type === "lake" ? "已入湖" : "已上线";
    if (value === "否") return type === "lake" ? "未入湖" : "未上线";
    return "待确认";
  }

  function groupOrdered(items, keyOf) {
    const groups = new Map();
    items.forEach((item) => {
      const key = keyOf(item) || "待分类";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return [...groups.entries()];
  }

  const hierarchy = dataset.domains.map((domain) => {
    const domainTables = dataset.tables.filter((table) => table.domain === domain.name);
    return {
      ...domain,
      topics: groupOrdered(domainTables, (table) => table.topic).map(([topic, topicTables]) => ({
        name: topic,
        count: topicTables.length,
        objects: groupOrdered(topicTables, (table) => table.businessObject).map(([object, objectTables]) => ({
          name: object,
          count: objectTables.length,
          tables: objectTables,
        })),
      })),
    };
  });

  function caretSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>';
  }

  function tableSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>';
  }

  function renderNavigation() {
    const nav = els.domainNavList.closest(".domain-nav");
    const savedScroll = nav ? nav.scrollTop : 0;
    els.allDomainCount.textContent = dataset.tables.length;
    const allButton = document.querySelector('.domain-nav-item[data-domain="all"]');
    if (allButton) allButton.classList.toggle("is-active", state.domain === "all");

    els.domainNavList.innerHTML = hierarchy.map((domain) => {
      const domainKey = `d::${domain.name}`;
      const domainOpen = state.treeOpen.has(domainKey);
      const topics = domain.topics.map((topic) => {
        const topicKey = `t::${domain.name}::${topic.name}`;
        const topicOpen = state.treeOpen.has(topicKey);
        const objects = topic.objects.map((object) => {
          const objectKey = `o::${domain.name}::${topic.name}::${object.name}`;
          const objectOpen = state.treeOpen.has(objectKey);
          const leaves = object.tables.map((table) => `
            <button class="tree-leaf" type="button" data-tree-table="${escapeHtml(table.id)}" title="${escapeHtml(table.name)}">
              ${tableSvg()}<span>${escapeHtml(table.name)}</span>
            </button>
          `).join("");
          return `
            <div class="tree-object">
              <button class="tree-row tree-l3" type="button" data-tree-toggle="${escapeHtml(objectKey)}" aria-expanded="${objectOpen}">
                <span class="tree-caret">${caretSvg()}</span>
                <span class="tree-name" title="${escapeHtml(object.name)}">${escapeHtml(object.name)}</span>
                <span class="tree-count">${object.count}</span>
              </button>
              <div class="tree-children ${objectOpen ? "is-open" : ""}">${leaves}</div>
            </div>
          `;
        }).join("");
        return `
          <div class="tree-topic">
            <button class="tree-row tree-l2" type="button" data-tree-toggle="${escapeHtml(topicKey)}" aria-expanded="${topicOpen}">
              <span class="tree-caret">${caretSvg()}</span>
              <span class="tree-name" title="${escapeHtml(topic.name)}">${escapeHtml(topic.name)}</span>
              <span class="tree-count">${topic.count}</span>
            </button>
            <div class="tree-children ${topicOpen ? "is-open" : ""}">${objects}</div>
          </div>
        `;
      }).join("");

      return `
        <div class="tree-domain ${domain.count === 0 ? "is-empty" : ""}">
          <button class="tree-row tree-l1 ${state.domain === domain.name ? "is-active" : ""}" type="button"
            data-tree-toggle="${escapeHtml(domainKey)}" data-domain-focus="${escapeHtml(domain.name)}" aria-expanded="${domainOpen}">
            <span class="tree-caret">${caretSvg()}</span>
            <span class="domain-dot" style="--dot:${domain.color}"></span>
            <span class="tree-name" title="${escapeHtml(domain.name)}">${escapeHtml(domain.name)}</span>
            <span class="tree-count">${domain.count}</span>
          </button>
          <div class="tree-children ${domainOpen ? "is-open" : ""}">${topics}</div>
        </div>
      `;
    }).join("");

    if (nav) requestAnimationFrame(() => { nav.scrollTop = savedScroll; });
    els.collapseAllTree.disabled = state.treeOpen.size === 0;
  }

  function renderMetrics() {
    const total = dataset.tables.length;
    const online = dataset.tables.filter((item) => item.online === "是").length;
    const lake = dataset.tables.filter((item) => item.inLake === "是").length;
    const onlinePercent = total ? Math.round((online / total) * 100) : 0;
    const lakePercent = total ? Math.round((lake / total) * 100) : 0;

    els.metricTables.textContent = total;
    els.metricDomains.textContent = dataset.domains.length;
    els.metricOnline.textContent = online;
    els.metricLake.textContent = lake;
    els.onlineRatio.textContent = `占全部数据表 ${onlinePercent}%`;
    els.lakeRatio.textContent = `占全部数据表 ${lakePercent}%`;
    els.completionRing.style.setProperty("--progress", `${lakePercent * 3.6}deg`);
    els.completionRing.querySelector("span").textContent = `${lakePercent}%`;
    els.completionText.textContent = `${lake} / ${total} 张表`;
    if (dataset.meta?.sourceDate) els.dataFreshness.textContent = `目录更新时间：${dataset.meta.sourceDate}`;
  }

  function tableMatches(table, includeDomain = true) {
    if (includeDomain && state.domain !== "all" && table.domain !== state.domain) return false;
    if (state.topic !== "all" && table.topic !== state.topic) return false;
    if (state.businessObject !== "all" && table.businessObject !== state.businessObject) return false;
    if (state.related) {
      if (table.domain !== state.related.domain || table.topic !== state.related.topic) return false;
      if (state.related.type === "l3" && table.businessObject !== state.related.businessObject) return false;
    }
    if (state.online !== "all") {
      if (state.online === "unknown" ? Boolean(table.online) : table.online !== state.online) return false;
    }
    if (state.lake !== "all") {
      if (state.lake === "unknown" ? Boolean(table.inLake) : table.inLake !== state.lake) return false;
    }
    const query = state.query.trim().toLowerCase();
    if (!query) return true;
    return [table.name, table.englishName, table.domain, table.topic, table.businessObject, table.owner]
      .join(" ").toLowerCase().includes(query);
  }

  function filteredTables() {
    return dataset.tables.filter((table) => tableMatches(table, true));
  }

  function tableCard(table) {
    const domain = domainByName.get(table.domain) || { color: "#5a5feb" };
    const english = table.englishName ? escapeHtml(table.englishName) : "英文表名待完善";
    const selected = state.selectedTableId === String(table.id);
    return `
      <button class="table-card ${selected ? "is-selected" : ""}" type="button" data-table-id="${table.id}"
        aria-pressed="${selected}" style="--card-color:${domain.color}">
        <span class="card-top">
          <h4 title="${escapeHtml(table.name)}">${escapeHtml(table.name)}</h4>
          <span class="open-arrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></span>
        </span>
        <span class="english-name ${table.englishName ? "" : "is-empty"}">${english}</span>
        <span class="card-meta">
          <span class="business-object" title="${escapeHtml(table.businessObject)}">${escapeHtml(table.businessObject || "业务对象待完善")}</span>
          <span class="status-set">
            <span class="status-chip ${statusClass(table.online)}">${statusLabel(table.online, "online")}</span>
            <span class="status-chip ${statusClass(table.inLake)}">${statusLabel(table.inLake, "lake")}</span>
          </span>
        </span>
      </button>
    `;
  }

  function renderCatalog() {
    const tables = filteredTables();
    const groups = groupOrdered(tables, (table) => `${table.domain}|||${table.topic}`).map(([key, groupTables]) => {
      const [domain, topic] = key.split("|||");
      return { domain, topic, tables: groupTables };
    });
    const selectedDomain = state.domain === "all" ? null : domainByName.get(state.domain);
    const relatedTitle = state.related
      ? state.related.type === "l3"
        ? `同 L3 业务对象：${state.related.businessObject || "待完善"}`
        : `同 L2 主题域：${state.related.topic}`
      : null;

    els.catalogTitle.textContent = relatedTitle || (selectedDomain ? selectedDomain.name : "全部数据表");
    els.resultSummary.textContent = `共找到 ${tables.length} 张数据表，分布在 ${new Set(tables.map((item) => item.topic)).size} 个二级主题域`;
    els.catalogGroups.classList.toggle("is-compact", state.view === "compact");
    els.catalogGroups.innerHTML = groups.map((group) => {
      const domain = domainByName.get(group.domain) || { color: "#5a5feb" };
      const groupKey = `${group.domain}|||${group.topic}`;
      const collapsed = state.openGroups.has(groupKey);
      return `
        <section class="domain-section ${collapsed ? "is-collapsed" : ""}" style="--group-color:${domain.color}">
          <div class="group-header">
            <div class="group-title"><i></i><h3>${escapeHtml(group.topic)}</h3><span>${escapeHtml(group.domain)} · ${group.tables.length} 张</span></div>
            <button type="button" class="collapse-group" data-group="${escapeHtml(groupKey)}">
              ${collapsed ? "展开" : "收起"}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
          <div class="table-grid">${group.tables.map(tableCard).join("")}</div>
        </section>
      `;
    }).join("");

    els.emptyState.hidden = tables.length !== 0;
    els.catalogGroups.hidden = tables.length === 0;
    document.querySelectorAll("[data-table-id]").forEach((button) => button.addEventListener("click", () => openAssetDrawer(button.dataset.tableId)));
    document.querySelectorAll("[data-group]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.group;
      state.openGroups.has(key) ? state.openGroups.delete(key) : state.openGroups.add(key);
      renderCatalog();
    }));
    renderActiveFilters();
    updateMapCaption(tables);
    syncStatusControls();
    syncSelectedTableCard();
  }

  function renderActiveFilters() {
    const filters = [];
    if (state.domain !== "all") filters.push({ key: "domain", label: `主题域：${state.domain}` });
    if (state.topic !== "all") filters.push({ key: "topic", label: `L2：${state.topic}` });
    if (state.businessObject !== "all") filters.push({ key: "businessObject", label: `L3：${state.businessObject}` });
    if (state.related) filters.push({
      key: "related",
      label: state.related.type === "l3"
        ? `同 L3：${state.related.businessObject || "待完善"}`
        : `同 L2：${state.related.topic}`,
    });
    if (state.query) filters.push({ key: "query", label: `搜索：${state.query}` });
    if (state.online !== "all") filters.push({ key: "online", label: `线上：${statusLabel(state.online === "unknown" ? "" : state.online, "online")}` });
    if (state.lake !== "all") filters.push({ key: "lake", label: `入湖：${statusLabel(state.lake === "unknown" ? "" : state.lake, "lake")}` });
    els.activeFilters.hidden = filters.length === 0;
    els.activeFilters.innerHTML = filters.map((filter) => `
      <span class="filter-chip">${escapeHtml(filter.label)}
        <button type="button" data-clear-filter="${filter.key}" aria-label="清除${escapeHtml(filter.label)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
        </button>
      </span>
    `).join("");
    document.querySelectorAll("[data-clear-filter]").forEach((button) => button.addEventListener("click", () => clearFilter(button.dataset.clearFilter)));
  }

  function updateMapCaption(tables) {
    els.mapCaptionTitle.textContent = state.related
      ? state.related.type === "l3"
        ? `L3 · ${state.related.businessObject || "待完善"}`
        : `L2 · ${state.related.topic}`
      : state.businessObject !== "all"
        ? `L3 · ${state.businessObject}`
        : state.topic !== "all"
          ? `L2 · ${state.topic}`
          : state.domain === "all" ? "全部主题域" : state.domain;
    const linkLabel = state.linkMode === "l3" ? "L3 业务对象连线" : "L2 主题域连线";
    els.mapCaptionMeta.textContent = `${tables.length} 张表 · ${linkLabel}`;
  }

  function selectDomain(domain, options = {}) {
    const nextDomain = domain || "all";
    if (state.related) state.related = null;
    state.domain = nextDomain;
    state.topic = "all";
    state.businessObject = "all";
    if (nextDomain !== "all" && options.expandTree !== false) state.treeOpen.add(`d::${nextDomain}`);
    renderNavigation();
    renderCatalog();
    if (options.focus !== false) dataMap.focusDomain(nextDomain);
    if (options.closeMobile !== false) closeSidebar();
  }

  function syncHierarchyControls() {
    const domainTables = dataset.tables.filter((table) => state.domain === "all" || table.domain === state.domain);
    const topics = [...new Set(domainTables.map((table) => table.topic).filter(Boolean))];
    if (state.topic !== "all" && !topics.includes(state.topic)) {
      state.topic = "all";
      state.businessObject = "all";
    }
    els.topicFilter.innerHTML = `<option value="all">全部 L2</option>${topics.map((topic) =>
      `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`
    ).join("")}`;
    els.topicFilter.value = state.topic;

    const topicTables = domainTables.filter((table) => state.topic === "all" || table.topic === state.topic);
    const objects = [...new Set(topicTables.map((table) => table.businessObject || "待完善"))];
    if (state.businessObject !== "all" && !objects.includes(state.businessObject)) state.businessObject = "all";
    els.businessObjectFilter.innerHTML = `<option value="all">全部 L3</option>${objects.map((object) =>
      `<option value="${escapeHtml(object)}">${escapeHtml(object)}</option>`
    ).join("")}`;
    els.businessObjectFilter.value = state.businessObject;
  }

  function syncStatusControls() {
    syncHierarchyControls();
    els.onlineFilter.value = state.online;
    els.lakeFilter.value = state.lake;
    els.mapOnlineFilter.value = state.online;
    els.mapLakeFilter.value = state.lake;
    els.mapAllData.classList.toggle("is-active", state.online === "all" && state.lake === "all");
    els.mapOnlineFilter.closest(".map-status-select").classList.toggle("is-filtered", state.online !== "all");
    els.mapLakeFilter.closest(".map-status-select").classList.toggle("is-filtered", state.lake !== "all");
  }

  function setStatusFilter(key, value) {
    state[key] = value;
    renderCatalog();
  }

  function setHierarchyFilter(level, value) {
    state.related = null;
    if (level === "topic") {
      state.topic = value;
      state.businessObject = "all";
    } else {
      state.businessObject = value;
    }
    renderCatalog();
  }

  function clearFilter(key) {
    if (key === "domain") return selectDomain("all");
    if (key === "query") { state.query = ""; els.searchInput.value = ""; }
    if (key === "topic") { state.topic = "all"; state.businessObject = "all"; }
    if (key === "businessObject") state.businessObject = "all";
    if (key === "online") state.online = "all";
    if (key === "lake") state.lake = "all";
    if (key === "related") state.related = null;
    renderCatalog();
  }

  function clearAllFilters() {
    state.query = "";
    state.topic = "all";
    state.businessObject = "all";
    state.online = "all";
    state.lake = "all";
    state.related = null;
    els.searchInput.value = "";
    selectDomain("all");
  }

  function syncSelectedTableCard() {
    document.querySelectorAll("[data-table-id]").forEach((card) => {
      const selected = card.dataset.tableId === state.selectedTableId;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
      card.style.border = selected ? "2px solid #5a5feb" : "";
      card.style.boxShadow = selected ? "0 14px 32px rgba(45,50,160,.20)" : "";
      card.style.background = selected ? "#f5f5ff" : "";
    });
  }

  function physicalTableNames(table) {
    const raw = String(table.englishName || "").trim();
    if (!raw) return [];
    let names = raw.split(/[、，,；;\n]+/).map((name) => name.trim()).filter(Boolean);
    if (names.length === 1 && /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.]+$/.test(raw)) {
      names = raw.split("/").map((name) => name.trim()).filter(Boolean);
    }
    return [...new Set(names)];
  }

  function tableLayer(name) {
    const value = String(name || "").toUpperCase();
    if (!value) return "层级待完善";
    if (/(^|\.)DWI_/.test(value)) return "DWI 贴源层";
    if (/(^|\.)DWR_/.test(value)) return "DWR 明细层";
    if (/(^|\.)DM_/.test(value)) return "DM 数据集市";
    if (/(^|\.)ODS_/.test(value)) return "ODS 贴源层";
    return "层级待完善";
  }

  function renderAssetDrawer() {
    if (!state.assetDetail) return;
    const table = tableById.get(String(state.assetDetail.tableId));
    if (!table) return;
    const names = physicalTableNames(table);
    const maxIndex = Math.max(names.length - 1, 0);
    state.assetDetail.physicalIndex = Math.min(Math.max(state.assetDetail.physicalIndex || 0, 0), maxIndex);
    const activeIndex = state.assetDetail.physicalIndex;
    const activeName = names[activeIndex] || "英文表名待完善";
    const hasMultiple = names.length > 1;
    const domain = domainByName.get(table.domain) || { color: "#5a5feb" };
    const tableOptions = hasMultiple ? `
      <section class="physical-switcher" aria-label="物理表切换">
        <div class="physical-switcher-head">
          <strong>包含 ${names.length} 张物理表</strong>
          <span>${activeIndex + 1} / ${names.length}</span>
        </div>
        <div class="physical-table-options" role="tablist" aria-label="选择物理表">
          ${names.map((name, index) => `
            <button class="physical-table-option ${index === activeIndex ? "is-active" : ""}" type="button"
              role="tab" aria-selected="${index === activeIndex}" data-physical-index="${index}" title="${escapeHtml(name)}">
              <span>表 ${index + 1}</span><code>${escapeHtml(name)}</code>
            </button>
          `).join("")}
        </div>
        <div class="physical-switch-actions">
          <button type="button" data-physical-step="-1" ${activeIndex === 0 ? "disabled" : ""}>← 上一张</button>
          <button type="button" data-physical-step="1" ${activeIndex === names.length - 1 ? "disabled" : ""}>下一张 →</button>
        </div>
      </section>
    ` : "";

    els.assetDrawer.style.setProperty("--asset-color", domain.color);
    els.assetDrawerContent.innerHTML = `
      <header class="asset-drawer-header">
        <div class="asset-heading-row">
          <div>
            <span class="asset-domain"><i></i>${escapeHtml(table.domain)}</span>
            <h2 id="assetDrawerTitle">${escapeHtml(table.name)}</h2>
          </div>
          <button class="asset-drawer-close" type="button" data-close-asset-drawer aria-label="关闭数据表详情">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <p class="asset-breadcrumb">${escapeHtml(table.domain)}<b>›</b>${escapeHtml(table.topic || "待分类")}<b>›</b>${escapeHtml(table.businessObject || "待完善")}</p>
        <div class="asset-table-name">
          <code class="${names.length ? "" : "is-empty"}">${escapeHtml(activeName)}</code>
          <button type="button" data-copy-table-name ${names.length ? "" : "disabled"} aria-label="复制英文表名">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>
            <span>复制</span>
          </button>
        </div>
      </header>
      <div class="asset-drawer-body">
        ${tableOptions}
        <div class="asset-badges">
          <span class="status-chip ${statusClass(table.online)}">${statusLabel(table.online, "online")}</span>
          <span class="status-chip ${statusClass(table.inLake)}">${statusLabel(table.inLake, "lake")}</span>
          <span class="asset-outline-chip">${escapeHtml(tableLayer(activeName))}</span>
        </div>

        <section class="asset-section">
          <h3>资产信息</h3>
          <dl class="asset-info-grid">
            <div><dt>L2 主题域</dt><dd>${escapeHtml(table.topic || "待完善")}</dd></div>
            <div><dt>L3 业务对象</dt><dd>${escapeHtml(table.businessObject || "待完善")}</dd></div>
            <div><dt>模型负责人</dt><dd>${escapeHtml(table.owner || "待完善")}</dd></div>
            <div><dt>上线时间</dt><dd>${escapeHtml(table.launchDate || "待完善")}</dd></div>
            <div><dt>目录序号</dt><dd>#${escapeHtml(table.sourceRow || table.id)}</dd></div>
            <div><dt>物理表数量</dt><dd>${Math.max(names.length, 1)} 张</dd></div>
          </dl>
        </section>

        <section class="asset-section">
          <h3>资产说明</h3>
          <p class="asset-description">${escapeHtml(table.description || "当前目录暂未维护该数据表的资产说明。")}</p>
        </section>

        <section class="asset-section">
          <div class="asset-section-title"><h3>字段结构</h3><span>当前物理表</span></div>
          <div class="asset-empty-fields">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 10h16M9 5v14"/></svg>
            <strong>字段信息尚未维护</strong>
            <span>后续接入元数据平台后，可在这里展示字段名、类型及说明。</span>
          </div>
        </section>

        <section class="asset-section">
          <h3>归属与责任</h3>
          <dl class="asset-owner-list">
            <div><dt>所属一级主题域</dt><dd>${escapeHtml(table.domain)}</dd></div>
            <div><dt>责任人</dt><dd>${escapeHtml(table.owner || "待完善")}</dd></div>
            <div><dt>数据来源</dt><dd>部门数据模型目录</dd></div>
          </dl>
        </section>
      </div>
      <footer class="asset-drawer-footer">
        <button type="button" class="asset-secondary-action" data-copy-table-name ${names.length ? "" : "disabled"}>复制表名</button>
        <button type="button" class="asset-primary-action" data-close-asset-drawer>关闭详情</button>
      </footer>
    `;

    els.assetDrawerContent.querySelectorAll("[data-close-asset-drawer]").forEach((button) => {
      button.addEventListener("click", () => closeAssetDrawer());
    });
    els.assetDrawerContent.querySelectorAll("[data-physical-index]").forEach((button) => {
      button.addEventListener("click", () => {
        state.assetDetail.physicalIndex = Number(button.dataset.physicalIndex);
        renderAssetDrawer();
      });
    });
    els.assetDrawerContent.querySelectorAll("[data-physical-step]").forEach((button) => {
      button.addEventListener("click", () => {
        state.assetDetail.physicalIndex += Number(button.dataset.physicalStep);
        renderAssetDrawer();
      });
    });
    els.assetDrawerContent.querySelectorAll("[data-copy-table-name]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!names.length) return;
        try {
          await navigator.clipboard.writeText(activeName);
          els.assetDrawerContent.querySelectorAll("[data-copy-table-name]").forEach((copyButton) => {
            const label = copyButton.querySelector("span");
            if (label) label.textContent = "已复制";
            else copyButton.textContent = "已复制";
          });
        } catch (_) {
          window.prompt("复制表名", activeName);
        }
      });
    });
  }

  function openAssetDrawer(id) {
    const table = tableById.get(String(id));
    if (!table) return;
    els.drawer.classList.remove("is-open");
    els.drawer.setAttribute("aria-hidden", "true");
    state.selectedTableId = String(table.id);
    state.assetDetail = { tableId: String(table.id), physicalIndex: 0 };
    syncSelectedTableCard();
    dataMap.selectTable(table.id);
    renderAssetDrawer();
    els.assetDrawerLayer.classList.add("is-open");
    els.assetDrawerLayer.setAttribute("aria-hidden", "false");
    document.body.classList.add("asset-drawer-open");
    requestAnimationFrame(() => els.assetDrawerContent.querySelector("[data-close-asset-drawer]")?.focus());
  }

  function closeAssetDrawer(options = {}) {
    state.assetDetail = null;
    els.assetDrawerLayer.classList.remove("is-open");
    els.assetDrawerLayer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("asset-drawer-open");
    if (!options.preserveSelection) {
      state.selectedTableId = null;
      dataMap.selectTable(null);
      syncSelectedTableCard();
    }
  }

  function openDrawer(id) {
    const table = tableById.get(String(id));
    if (!table) return;
    closeAssetDrawer({ preserveSelection: true });
    state.selectedTableId = String(table.id);
    syncSelectedTableCard();
    dataMap.selectTable(table.id);
    const domain = domainByName.get(table.domain) || { color: "#5a5feb" };
    const sameL3Count = dataset.tables.filter((item) =>
      item.domain === table.domain && item.topic === table.topic && item.businessObject === table.businessObject
    ).length;
    const sameL2Count = dataset.tables.filter((item) => item.domain === table.domain && item.topic === table.topic).length;
    const activeRelation = state.related?.type || null;
    els.drawer.style.setProperty("--drawer-color", domain.color);
    els.drawerDomain.textContent = table.domain;
    els.drawerBody.innerHTML = `
      <div class="drawer-title-row">
        <h2 id="drawerTitle">${escapeHtml(table.name)}</h2>
        <code class="${table.englishName ? "" : "is-empty"}">${escapeHtml(table.englishName || "英文表名待完善")}</code>
      </div>
      <div class="drawer-badges">
        <span class="status-chip ${statusClass(table.online)}">${statusLabel(table.online, "online")}</span>
        <span class="status-chip ${statusClass(table.inLake)}">${statusLabel(table.inLake, "lake")}</span>
      </div>
      <dl class="detail-list">
        <div><dt>主题域</dt><dd>${escapeHtml(table.topic)}</dd></div>
        <div><dt>业务对象</dt><dd>${escapeHtml(table.businessObject || "待完善")}</dd></div>
        <div><dt>模型负责人</dt><dd>${escapeHtml(table.owner || "待完善")}</dd></div>
      </dl>
      <div class="related-actions">
        <button class="relation-button relation-l3 ${activeRelation === "l3" ? "is-active" : ""}" type="button" data-related-action="l3">
          <span>${activeRelation === "l3" ? "返回全部数据表" : `查看相同 L3 业务对象数据表（${sameL3Count}）`}</span><b>${activeRelation === "l3" ? "↺" : "→"}</b>
        </button>
        <button class="relation-button relation-l2 ${activeRelation === "l2" ? "is-active" : ""}" type="button" data-related-action="l2">
          <span>${activeRelation === "l2" ? "返回全部数据表" : `查看相同 L2 主题域数据表（${sameL2Count}）`}</span><b>${activeRelation === "l2" ? "↺" : "→"}</b>
        </button>
      </div>
    `;
    els.drawerBody.querySelectorAll("[data-related-action]").forEach((button) => button.addEventListener("click", () => {
      applyRelatedFilter(table, button.dataset.relatedAction);
    }));
    els.drawer.classList.add("is-open");
    els.drawer.setAttribute("aria-hidden", "false");
  }

  function applyRelatedFilter(table, type) {
    const nextType = state.related?.type === type ? "reset" : type;
    state.domain = table.domain;
    state.topic = "all";
    state.businessObject = "all";
    state.related = nextType === "reset" ? null : {
      type: nextType,
      domain: table.domain,
      topic: table.topic,
      businessObject: table.businessObject,
      sourceId: String(table.id),
    };
    if (nextType !== "reset") state.linkMode = nextType;
    document.querySelectorAll("[data-link-mode]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.linkMode === state.linkMode);
    });
    state.treeOpen.add(`d::${table.domain}`);
    renderNavigation();
    renderCatalog();
    dataMap.selectTable(table.id);
    openDrawer(table.id);
  }

  function closeDrawer() {
    state.selectedTableId = null;
    els.drawer.classList.remove("is-open");
    els.drawer.setAttribute("aria-hidden", "true");
    dataMap.selectTable(null);
    if (state.related) {
      state.related = null;
      renderCatalog();
    }
    syncSelectedTableCard();
  }

  function openSidebar() { els.sidebar.classList.add("is-open"); els.sidebarScrim.classList.add("is-open"); }
  function closeSidebar() { els.sidebar.classList.remove("is-open"); els.sidebarScrim.classList.remove("is-open"); }
  function closeGuide() { els.guideModal.hidden = true; }

  function initMapResizer() {
    const stage = document.getElementById("mapStage");
    const handle = document.getElementById("mapResizeHandle");
    const storageKey = "datamap.map.height.v1";
    const minHeight = 420;
    const maxHeight = 1200;
    let startY = 0;
    let startHeight = 0;
    let activePointer = null;

    function clampHeight(value) {
      return Math.min(maxHeight, Math.max(minHeight, Math.round(value)));
    }

    function applyHeight(value, persist = false) {
      const height = clampHeight(value);
      stage.style.height = `${height}px`;
      handle.setAttribute("aria-valuenow", String(height));
      handle.setAttribute("aria-valuetext", `${height} 像素`);
      if (persist) localStorage.setItem(storageKey, String(height));
    }

    const savedHeight = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(savedHeight) && savedHeight >= minHeight) applyHeight(savedHeight);
    else requestAnimationFrame(() => applyHeight(stage.getBoundingClientRect().height));

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      activePointer = event.pointerId;
      startY = event.clientY;
      startHeight = stage.getBoundingClientRect().height;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("is-dragging");
      document.body.classList.add("is-resizing-map");
    });

    handle.addEventListener("pointermove", (event) => {
      if (activePointer !== event.pointerId) return;
      applyHeight(startHeight + event.clientY - startY);
    });

    function finishResize(event) {
      if (activePointer !== event.pointerId) return;
      activePointer = null;
      handle.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing-map");
      applyHeight(stage.getBoundingClientRect().height, true);
    }

    handle.addEventListener("pointerup", finishResize);
    handle.addEventListener("pointercancel", finishResize);
    handle.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 100 : 40;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        applyHeight(stage.getBoundingClientRect().height + direction * step, true);
      }
      if (event.key === "Home") {
        event.preventDefault();
        applyHeight(minHeight, true);
      }
    });
  }

  const dataMap = (() => {
    const canvas = document.getElementById("dataMap");
    const stage = document.getElementById("mapStage");
    const tooltip = document.getElementById("mapTooltip");
    const ctx = canvas.getContext("2d");
    const domainHubs = [];
    const nodes = [];
    const links = { l2: [], l3: [] };
    const nodeById = new Map();
    const domainHubByName = new Map();
    let width = 0;
    let height = 0;
    let dpr = 1;
    let baseScale = 1;
    let selectedId = null;
    let hoveredNode = null;
    let dragging = false;
    let moved = false;
    let pointerStart = null;
    let lastPointer = { x: 0, y: 0 };
    let cameraTween = null;
    const camera = { zoom: 1, panX: 0, panY: 0 };

    function hash(value) {
      let result = 2166136261;
      const text = String(value);
      for (let index = 0; index < text.length; index += 1) {
        result ^= text.charCodeAt(index);
        result = Math.imul(result, 16777619);
      }
      return Math.abs(result >>> 0);
    }

    function unit(value, salt) { return (hash(`${value}:${salt}`) % 10000) / 10000; }

    function buildLayout() {
      const active = hierarchy.filter((domain) => domain.count > 0);
      active.forEach((domain, domainIndex) => {
        const angle = -Math.PI / 2 + (domainIndex / active.length) * Math.PI * 2;
        const ring = domainIndex % 2 === 0 ? 1 : .82;
        const domainHub = {
          kind: "domain", domain: domain.name, label: domain.name, color: domain.color,
          x: Math.cos(angle) * 315 * ring, y: Math.sin(angle) * 210 * ring,
          phase: domainIndex,
          tableIds: domain.topics.flatMap((topic) => topic.objects.flatMap((object) => object.tables.map((table) => String(table.id)))),
        };
        domainHubs.push(domainHub);
        domainHubByName.set(domain.name, domainHub);
      });

      dataset.tables.forEach((table, tableIndex) => {
        const cluster = domainHubByName.get(table.domain) || { x: 0, y: 0, color: "#5a5feb" };
        const radius = 24 + unit(table.name, "radius") * (44 + Math.sqrt(tableIndex + 1) * 1.5);
        const angle = unit(`${table.name}${table.businessObject}`, "angle") * Math.PI * 2;
        const jitterX = (unit(table.englishName || table.name, "jx") - .5) * 28;
        const jitterY = (unit(table.owner || table.name, "jy") - .5) * 22;
        const node = {
          kind: "node", id: String(table.id), table, domain: table.domain, color: cluster.color,
          x: cluster.x + Math.cos(angle) * radius + jitterX,
          y: cluster.y + Math.sin(angle) * radius * .78 + jitterY,
          radius: 2.4 + (table.online === "是" ? 1 : 0) + (table.inLake === "是" ? .65 : 0),
          phase: unit(table.name, "phase") * Math.PI * 2,
        };
        nodes.push(node);
        nodeById.set(node.id, node);
      });

      ["l2", "l3"].forEach((mode) => {
        const groups = new Map();
        nodes.forEach((node) => {
          const relation = mode === "l2" ? node.table.topic : node.table.businessObject;
          const key = `${node.domain}|${relation || "待分类"}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(node);
        });
        groups.forEach((groupNodes, key) => {
          for (let index = 1; index < groupNodes.length; index += 1) {
            links[mode].push({ from: groupNodes[index - 1], to: groupNodes[index], key });
          }
        });
      });
    }

    function updateCameraTween(time) {
      if (!cameraTween) return;
      const elapsed = Math.min(1, (time - cameraTween.startedAt) / cameraTween.duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      camera.zoom = cameraTween.from.zoom + (cameraTween.to.zoom - cameraTween.from.zoom) * eased;
      camera.panX = cameraTween.from.panX + (cameraTween.to.panX - cameraTween.from.panX) * eased;
      camera.panY = cameraTween.from.panY + (cameraTween.to.panY - cameraTween.from.panY) * eased;
      if (elapsed >= 1) cameraTween = null;
      updateZoomLabel();
    }

    function animateCamera(target, duration = 680) {
      cameraTween = { from: { ...camera }, to: target, duration, startedAt: performance.now() };
    }

    function pointFor(item, time = 0) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const wobble = item.kind === "node" && !reduced ? 1 : 0;
      const worldX = item.x + Math.sin(time * .00042 + (item.phase || 0)) * 1.4 * wobble;
      const worldY = item.y + Math.cos(time * .00037 + (item.phase || 0)) * 1.15 * wobble;
      const scale = baseScale * camera.zoom;
      return { x: width / 2 + camera.panX + worldX * scale, y: height / 2 + camera.panY + worldY * scale, scale };
    }

    function resize() {
      const rect = stage.getBoundingClientRect();
      width = Math.max(320, rect.width);
      height = Math.max(360, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      baseScale = Math.min(width / 1050, height / 720);
    }

    function activeDomain(item) { return state.domain === "all" || item.domain === state.domain; }
    function visibleIds() { return new Set(dataset.tables.filter((table) => tableMatches(table, true)).map((table) => String(table.id))); }
    function descendantsVisible(item, ids) { return !item.tableIds || item.tableIds.some((id) => ids.has(String(id))); }
    function relationKey(node, mode = state.linkMode) {
      const relation = mode === "l2" ? node.table.topic : node.table.businessObject;
      return `${node.domain}|${relation || "待分类"}`;
    }

    function draw(time) {
      updateCameraTween(time);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const ids = visibleIds();
      const selectedNode = selectedId ? nodeById.get(String(selectedId)) : null;
      const selectedPeers = selectedNode
        ? new Set(nodes.filter((node) => relationKey(node) === relationKey(selectedNode)).map((node) => node.id))
        : new Set();

      domainHubs.forEach((hub) => {
        if (!activeDomain(hub) || !descendantsVisible(hub, ids)) return;
        const point = pointFor(hub, time);
        hub.screenX = point.x;
        hub.screenY = point.y;
        const haloRadius = 86 * point.scale;
        const gradient = ctx.createRadialGradient(point.x, point.y, 2, point.x, point.y, Math.max(38, haloRadius));
        gradient.addColorStop(0, `${hub.color}12`);
        gradient.addColorStop(1, `${hub.color}00`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(38, haloRadius), 0, Math.PI * 2);
        ctx.fill();
      });

      links[state.linkMode].forEach((edge) => {
        if (!activeDomain(edge.from) || !ids.has(edge.from.id) || !ids.has(edge.to.id)) return;
        const from = pointFor(edge.from, time);
        const to = pointFor(edge.to, time);
        const emphasized = selectedNode && edge.key === relationKey(selectedNode);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = emphasized ? `${edge.from.color}70` : "rgba(111,132,177,.11)";
        ctx.lineWidth = emphasized ? 1.2 : .55;
        ctx.stroke();
      });

      domainHubs.forEach((hub) => {
        if (!activeDomain(hub) || !descendantsVisible(hub, ids)) return;
        const point = pointFor(hub, time);
        ctx.fillStyle = "rgba(83,94,117,.64)";
        ctx.font = "600 10px Inter, PingFang SC, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${hub.label} · ${hub.tableIds.length}`, point.x, point.y - 50 * point.scale);
      });

      nodes.forEach((node) => {
        if (!activeDomain(node)) return;
        const point = pointFor(node, time);
        node.screenX = point.x;
        node.screenY = point.y;
        const match = ids.has(node.id);
        const selected = selectedId === node.id;
        const hovered = hoveredNode === node;
        const peer = selectedPeers.has(node.id);
        const radius = Math.max(2.1, node.radius * point.scale) * (selected ? 1.95 : hovered ? 1.5 : peer ? 1.25 : 1);
        if (selected || hovered) {
          const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 5);
          glow.addColorStop(0, `${node.color}75`);
          glow.addColorStop(1, `${node.color}00`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius * 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = match ? .82 : .055;
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (selected) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "rgba(255,255,255,.98)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });

      requestAnimationFrame(draw);
    }

    function hitTest(x, y) {
      const ids = visibleIds();
      let nearest = null;
      let distance = 14;
      nodes.forEach((node) => {
        if (!activeDomain(node) || !ids.has(node.id)) return;
        const current = Math.hypot(x - node.screenX, y - node.screenY);
        if (current < distance) { nearest = node; distance = current; }
      });
      if (nearest) return { type: "node", value: nearest };
      return null;
    }

    function showTooltip(hit, x, y) {
      if (!hit || dragging) { tooltip.classList.remove("is-visible"); return; }
      if (hit.type === "node") {
        const relation = state.linkMode === "l3" ? hit.value.table.businessObject : hit.value.table.topic;
        tooltip.innerHTML = `<strong>${escapeHtml(hit.value.table.name)}</strong><span>${state.linkMode.toUpperCase()} · ${escapeHtml(relation || "未分类")}</span>`;
      }
      const rect = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(10, Math.min(width - rect.width - 12, x + 14))}px`;
      tooltip.style.top = `${Math.max(10, Math.min(height - rect.height - 12, y + 14))}px`;
      tooltip.classList.add("is-visible");
    }

    function setZoom(nextZoom, centerX = width / 2, centerY = height / 2) {
      cameraTween = null;
      const previous = baseScale * camera.zoom;
      camera.zoom = Math.max(.58, Math.min(3.2, nextZoom));
      const ratio = (baseScale * camera.zoom) / previous;
      camera.panX = centerX - width / 2 - (centerX - width / 2 - camera.panX) * ratio;
      camera.panY = centerY - height / 2 - (centerY - height / 2 - camera.panY) * ratio;
      updateZoomLabel();
    }

    function updateZoomLabel() { els.mapZoomLevel.textContent = `${Math.round(camera.zoom * 100)}%`; }

    function focusDomain(domain) {
      selectedId = null;
      if (domain === "all") {
        animateCamera({ zoom: 1, panX: 0, panY: 0 }, 760);
        return;
      }
      const hub = domainHubByName.get(domain);
      if (!hub) return;
      const zoom = width < 650 ? 1.65 : 1.9;
      animateCamera({ zoom, panX: -hub.x * baseScale * zoom, panY: -hub.y * baseScale * zoom }, 760);
    }

    function focusTable(id) {
      const node = nodeById.get(String(id));
      if (!node) return;
      selectedId = node.id;
      const zoom = width < 650 ? 2.05 : 2.35;
      animateCamera({ zoom, panX: -node.x * baseScale * zoom, panY: -node.y * baseScale * zoom }, 720);
    }

    canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      moved = false;
      cameraTween = null;
      pointerStart = { x: event.clientX, y: event.clientY, panX: camera.panX, panY: camera.panY };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    });

    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      lastPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (dragging && pointerStart) {
        const dx = event.clientX - pointerStart.x;
        const dy = event.clientY - pointerStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        camera.panX = pointerStart.panX + dx;
        camera.panY = pointerStart.panY + dy;
        showTooltip(null);
        return;
      }
      const hit = hitTest(lastPointer.x, lastPointer.y);
      hoveredNode = hit?.type === "node" ? hit.value : null;
      canvas.style.cursor = hit ? "pointer" : "grab";
      showTooltip(hit, lastPointer.x, lastPointer.y);
    });

    function endPointer(event) {
      if (!dragging) return;
      const didMove = moved;
      dragging = false;
      pointerStart = null;
      canvas.classList.remove("is-dragging");
      if (!didMove) {
        const hit = hitTest(lastPointer.x, lastPointer.y);
        if (hit?.type === "node") openDrawer(hit.value.id);
      }
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }

    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("pointerleave", () => {
      if (!dragging) {
        hoveredNode = null;
        tooltip.classList.remove("is-visible");
      }
    });
    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      setZoom(camera.zoom * (event.deltaY < 0 ? 1.12 : .89), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    buildLayout();
    new ResizeObserver(resize).observe(stage);
    resize();
    updateZoomLabel();
    requestAnimationFrame(draw);

    return {
      focusDomain,
      focusTable,
      selectTable(id) { selectedId = id === null ? null : String(id); },
      zoomBy(factor) { setZoom(camera.zoom * factor); },
    };
  })();

  function selectTreeTable(table) {
    state.domain = table.domain;
    state.topic = table.topic || "all";
    state.businessObject = table.businessObject || "all";
    state.query = "";
    state.online = "all";
    state.lake = "all";
    state.related = null;
    els.searchInput.value = "";
    renderNavigation();
    renderCatalog();
    openDrawer(table.id);
    dataMap.focusTable(table.id);
    closeSidebar();
  }

  function bindControls() {
    document.querySelector('.domain-nav-item[data-domain="all"]').addEventListener("click", () => selectDomain("all"));
    els.collapseAllTree.addEventListener("click", () => {
      state.treeOpen.clear();
      renderNavigation();
    });
    els.domainNavList.addEventListener("click", (event) => {
      const leaf = event.target.closest("[data-tree-table]");
      if (leaf) {
        const table = tableById.get(String(leaf.dataset.treeTable));
        if (!table) return;
        selectTreeTable(table);
        return;
      }
      const row = event.target.closest("[data-tree-toggle]");
      if (!row) return;
      const key = row.dataset.treeToggle;
      state.treeOpen.has(key) ? state.treeOpen.delete(key) : state.treeOpen.add(key);
      if (row.dataset.domainFocus) selectDomain(row.dataset.domainFocus, { closeMobile: false, expandTree: false });
      else renderNavigation();
    });

    els.searchInput.addEventListener("input", (event) => { state.query = event.target.value; renderCatalog(); });
    els.topicFilter.addEventListener("change", (event) => setHierarchyFilter("topic", event.target.value));
    els.businessObjectFilter.addEventListener("change", (event) => setHierarchyFilter("businessObject", event.target.value));
    els.onlineFilter.addEventListener("change", (event) => setStatusFilter("online", event.target.value));
    els.lakeFilter.addEventListener("change", (event) => setStatusFilter("lake", event.target.value));
    els.mapOnlineFilter.addEventListener("change", (event) => setStatusFilter("online", event.target.value));
    els.mapLakeFilter.addEventListener("change", (event) => setStatusFilter("lake", event.target.value));
    els.mapAllData.addEventListener("click", () => {
      state.online = "all";
      state.lake = "all";
      renderCatalog();
    });
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
      state.view = button.dataset.view;
      document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderCatalog();
    }));
    document.querySelectorAll("[data-link-mode]").forEach((button) => button.addEventListener("click", () => {
      state.linkMode = button.dataset.linkMode;
      document.querySelectorAll("[data-link-mode]").forEach((item) => item.classList.toggle("is-active", item === button));
      updateMapCaption(filteredTables());
    }));
    document.getElementById("clearFilters").addEventListener("click", clearAllFilters);
    document.getElementById("mapReset").addEventListener("click", () => selectDomain("all", { closeMobile: false }));
    document.getElementById("mapZoomIn").addEventListener("click", () => dataMap.zoomBy(1.18));
    document.getElementById("mapZoomOut").addEventListener("click", () => dataMap.zoomBy(.84));
    document.getElementById("closeDrawer").addEventListener("click", closeDrawer);
    els.assetDrawerScrim.addEventListener("click", () => closeAssetDrawer());
    document.getElementById("openSidebar").addEventListener("click", openSidebar);
    document.getElementById("closeSidebar").addEventListener("click", closeSidebar);
    els.sidebarScrim.addEventListener("click", closeSidebar);
    document.getElementById("showGuide").addEventListener("click", () => { els.guideModal.hidden = false; });
    document.getElementById("closeGuide").addEventListener("click", closeGuide);
    document.getElementById("startExplore").addEventListener("click", closeGuide);
    els.guideModal.addEventListener("click", (event) => { if (event.target === els.guideModal) closeGuide(); });
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); els.searchInput.focus(); }
      if (event.key === "Escape") { closeAssetDrawer(); closeDrawer(); closeSidebar(); closeGuide(); }
    });
  }

  renderNavigation();
  renderMetrics();
  bindControls();
  initMapResizer();
  renderCatalog();
})();
