(function () {
  "use strict";

  const dataset = window.DATA_MAP || { domains: [], tables: [], meta: {} };
  const state = {
    domain: "all",
    query: "",
    online: "all",
    lake: "all",
    view: "cards",
    openGroups: new Set(),
    treeOpen: new Set(),
  };

  const els = {
    allDomainCount: document.getElementById("allDomainCount"),
    domainNavList: document.getElementById("domainNavList"),
    searchInput: document.getElementById("searchInput"),
    onlineFilter: document.getElementById("onlineFilter"),
    lakeFilter: document.getElementById("lakeFilter"),
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
    drawerScrim: document.getElementById("drawerScrim"),
    drawerBody: document.getElementById("drawerBody"),
    drawerDomain: document.getElementById("drawerDomain"),
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
    return `
      <button class="table-card" type="button" data-table-id="${table.id}" style="--card-color:${domain.color}">
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

    els.catalogTitle.textContent = selectedDomain ? selectedDomain.name : "全部数据表";
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
    document.querySelectorAll("[data-table-id]").forEach((button) => button.addEventListener("click", () => openDrawer(button.dataset.tableId)));
    document.querySelectorAll("[data-group]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.group;
      state.openGroups.has(key) ? state.openGroups.delete(key) : state.openGroups.add(key);
      renderCatalog();
    }));
    renderActiveFilters();
    updateMapCaption(tables);
  }

  function renderActiveFilters() {
    const filters = [];
    if (state.domain !== "all") filters.push({ key: "domain", label: `主题域：${state.domain}` });
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
    els.mapCaptionTitle.textContent = state.domain === "all" ? "全部主题域" : state.domain;
    els.mapCaptionMeta.textContent = `${tables.length} 张表 · ${new Set(tables.map((item) => item.topic)).size} 个二级主题域`;
  }

  function selectDomain(domain, options = {}) {
    const nextDomain = domain || "all";
    state.domain = nextDomain;
    if (nextDomain !== "all" && options.expandTree !== false) state.treeOpen.add(`d::${nextDomain}`);
    renderNavigation();
    renderCatalog();
    if (options.focus !== false) dataMap.focusDomain(nextDomain);
    if (options.closeMobile !== false) closeSidebar();
  }

  function clearFilter(key) {
    if (key === "domain") return selectDomain("all");
    if (key === "query") { state.query = ""; els.searchInput.value = ""; }
    if (key === "online") { state.online = "all"; els.onlineFilter.value = "all"; }
    if (key === "lake") { state.lake = "all"; els.lakeFilter.value = "all"; }
    renderCatalog();
  }

  function clearAllFilters() {
    state.query = "";
    state.online = "all";
    state.lake = "all";
    els.searchInput.value = "";
    els.onlineFilter.value = "all";
    els.lakeFilter.value = "all";
    selectDomain("all");
  }

  function openDrawer(id) {
    const table = tableById.get(String(id));
    if (!table) return;
    dataMap.selectTable(table.id);
    const domain = domainByName.get(table.domain) || { color: "#5a5feb" };
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
      <div class="detail-path">
        <span>${escapeHtml(table.domain)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        <span>${escapeHtml(table.topic)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        <span>${escapeHtml(table.businessObject || "待完善")}</span>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><span>模型负责人</span><strong>${escapeHtml(table.owner || "待完善")}</strong></div>
        <div class="detail-item"><span>上线时间</span><strong>${escapeHtml(table.launchDate || "待完善")}</strong></div>
        <div class="detail-item"><span>目录序号</span><strong>#${escapeHtml(table.sourceRow)}</strong></div>
        <div class="detail-item"><span>业务对象</span><strong>${escapeHtml(table.businessObject || "待完善")}</strong></div>
      </div>
      <div class="detail-note"><span>说明</span><p>${escapeHtml(table.description || "暂无补充说明。")}</p></div>
    `;
    els.drawer.classList.add("is-open");
    els.drawerScrim.classList.add("is-open");
    els.drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    document.getElementById("closeDrawer").focus();
  }

  function closeDrawer() {
    els.drawer.classList.remove("is-open");
    els.drawerScrim.classList.remove("is-open");
    els.drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    dataMap.selectTable(null);
  }

  function openSidebar() { els.sidebar.classList.add("is-open"); els.sidebarScrim.classList.add("is-open"); }
  function closeSidebar() { els.sidebar.classList.remove("is-open"); els.sidebarScrim.classList.remove("is-open"); }
  function closeGuide() { els.guideModal.hidden = true; }

  const dataMap = (() => {
    const canvas = document.getElementById("dataMap");
    const stage = document.getElementById("mapStage");
    const tooltip = document.getElementById("mapTooltip");
    const ctx = canvas.getContext("2d");
    const domainHubs = [];
    const topicHubs = [];
    const objectHubs = [];
    const nodes = [];
    const edges = [];
    const nodeById = new Map();
    const domainHubByName = new Map();
    let width = 0;
    let height = 0;
    let dpr = 1;
    let baseScale = 1;
    let selectedId = null;
    let hoveredNode = null;
    let hoveredDomain = null;
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
        const ring = domainIndex % 2 === 0 ? 1 : .86;
        const domainHub = {
          kind: "domain", domain: domain.name, label: domain.name, color: domain.color,
          x: Math.cos(angle) * 500 * ring, y: Math.sin(angle) * 320 * ring,
          tableIds: domain.topics.flatMap((topic) => topic.objects.flatMap((object) => object.tables.map((table) => String(table.id)))),
        };
        domainHubs.push(domainHub);
        domainHubByName.set(domain.name, domainHub);

        domain.topics.forEach((topic, topicIndex) => {
          const topicAngle = -Math.PI / 2 + (topicIndex / Math.max(domain.topics.length, 1)) * Math.PI * 2;
          const topicRing = 62 + Math.min(78, domain.topics.length * 7);
          const topicHub = {
            kind: "topic", domain: domain.name, label: topic.name, color: domain.color,
            x: domainHub.x + Math.cos(topicAngle) * topicRing,
            y: domainHub.y + Math.sin(topicAngle) * topicRing * .72,
            tableIds: topic.objects.flatMap((object) => object.tables.map((table) => String(table.id))),
          };
          topicHubs.push(topicHub);
          edges.push({ from: domainHub, to: topicHub, domain: domain.name, depth: 1, tableIds: topicHub.tableIds });

          topic.objects.forEach((object, objectIndex) => {
            const objectAngle = topicAngle + (objectIndex / Math.max(topic.objects.length, 1)) * Math.PI * 2;
            const objectRing = 22 + Math.min(34, topic.objects.length * 4.2);
            const objectHub = {
              kind: "object", domain: domain.name, label: object.name, color: domain.color,
              x: topicHub.x + Math.cos(objectAngle) * objectRing,
              y: topicHub.y + Math.sin(objectAngle) * objectRing * .7,
              tableIds: object.tables.map((table) => String(table.id)),
            };
            objectHubs.push(objectHub);
            edges.push({ from: topicHub, to: objectHub, domain: domain.name, depth: 2, tableIds: objectHub.tableIds });

            object.tables.forEach((table, tableIndex) => {
              const nodeAngle = unit(table.id, "angle") * Math.PI * 2 + tableIndex * .8;
              const nodeRing = 11 + Math.sqrt(object.tables.length) * 4.5 + unit(table.name, "ring") * 11;
              const node = {
                kind: "node", id: String(table.id), table, domain: domain.name, color: domain.color,
                x: objectHub.x + Math.cos(nodeAngle) * nodeRing,
                y: objectHub.y + Math.sin(nodeAngle) * nodeRing * .72,
                radius: 2.6 + (table.online === "是" ? .8 : 0) + (table.inLake === "是" ? .55 : 0),
                phase: unit(table.id, "phase") * Math.PI * 2,
              };
              nodes.push(node);
              nodeById.set(node.id, node);
              edges.push({ from: objectHub, to: node, domain: domain.name, depth: 3, tableIds: [node.id] });
            });
          });
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
      baseScale = Math.min(width / 1450, height / 980);
    }

    function activeDomain(item) { return state.domain === "all" || item.domain === state.domain; }
    function visibleIds() { return new Set(dataset.tables.filter((table) => tableMatches(table, true)).map((table) => String(table.id))); }
    function descendantsVisible(item, ids) { return !item.tableIds || item.tableIds.some((id) => ids.has(String(id))); }

    function curvedLine(from, to, bend) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const midX = (from.x + to.x) / 2 - (dy / length) * bend;
      const midY = (from.y + to.y) / 2 + (dx / length) * bend;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(midX, midY, to.x, to.y);
      ctx.stroke();
    }

    function draw(time) {
      updateCameraTween(time);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const ids = visibleIds();
      const selectedNode = selectedId ? nodeById.get(String(selectedId)) : null;

      domainHubs.forEach((hub) => {
        if (!activeDomain(hub) || !descendantsVisible(hub, ids)) return;
        const point = pointFor(hub, time);
        hub.screenX = point.x;
        hub.screenY = point.y;
        const selected = state.domain === hub.domain;
        const haloRadius = (selected ? 145 : 105) * point.scale;
        const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, Math.max(48, haloRadius));
        gradient.addColorStop(0, `${hub.color}${selected ? "24" : "14"}`);
        gradient.addColorStop(1, `${hub.color}00`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(48, haloRadius), 0, Math.PI * 2);
        ctx.fill();
      });

      edges.forEach((edge, index) => {
        if (!activeDomain(edge) || !descendantsVisible(edge, ids)) return;
        const from = pointFor(edge.from, time);
        const to = pointFor(edge.to, time);
        const selectedPath = selectedNode && edge.tableIds.includes(selectedNode.id);
        const domainFocused = state.domain === edge.domain;
        const alpha = selectedPath ? "9A" : domainFocused ? (edge.depth === 3 ? "50" : "3C") : (edge.depth === 1 ? "25" : "17");
        ctx.strokeStyle = `${edge.from.color}${alpha}`;
        ctx.lineWidth = selectedPath ? 1.7 : edge.depth === 1 ? 1.05 : .72;
        curvedLine(from, to, (unit(index, "bend") - .5) * 14);
      });

      topicHubs.forEach((hub) => {
        if (!activeDomain(hub) || !descendantsVisible(hub, ids)) return;
        const point = pointFor(hub, time);
        ctx.fillStyle = `${hub.color}${state.domain === hub.domain ? "D8" : "9A"}`;
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(2.8, 4.2 * point.scale), 0, Math.PI * 2);
        ctx.fill();
        if (state.domain === hub.domain || camera.zoom > 1.55) {
          ctx.fillStyle = "rgba(65,76,98,.72)";
          ctx.font = "600 10px Inter, PingFang SC, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(hub.label, point.x, point.y - Math.max(10, 12 * point.scale));
        }
      });

      objectHubs.forEach((hub) => {
        if (!activeDomain(hub) || !descendantsVisible(hub, ids)) return;
        const point = pointFor(hub, time);
        ctx.fillStyle = `${hub.color}9F`;
        ctx.beginPath();
        ctx.arc(point.x, point.y, Math.max(2, 3.1 * point.scale), 0, Math.PI * 2);
        ctx.fill();
        if (state.domain === hub.domain && camera.zoom > 2.25) {
          ctx.fillStyle = "rgba(87,98,118,.62)";
          ctx.font = "500 9px Inter, PingFang SC, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(hub.label, point.x, point.y - Math.max(8, 9 * point.scale));
        }
      });

      domainHubs.forEach((hub) => {
        if (!activeDomain(hub) || !descendantsVisible(hub, ids)) return;
        const point = pointFor(hub, time);
        const hovered = hoveredDomain === hub.domain;
        ctx.fillStyle = hub.color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, hovered ? 9 : 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.96)";
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.fillStyle = "rgba(39,49,69,.82)";
        ctx.font = `${state.domain === hub.domain ? 700 : 650} ${state.domain === hub.domain ? 13 : 11}px Inter, PingFang SC, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(hub.label, point.x, point.y - 17);
      });

      nodes.forEach((node) => {
        if (!activeDomain(node)) return;
        const point = pointFor(node, time);
        node.screenX = point.x;
        node.screenY = point.y;
        const match = ids.has(node.id);
        const selected = selectedId === node.id;
        const hovered = hoveredNode === node;
        const radius = Math.max(2.2, node.radius * point.scale) * (selected ? 2 : hovered ? 1.55 : 1);
        if (selected || hovered) {
          const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 5);
          glow.addColorStop(0, `${node.color}75`);
          glow.addColorStop(1, `${node.color}00`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius * 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = match ? .86 : .055;
        if (node.table.online === "否") {
          ctx.fillStyle = "rgba(255,255,255,.95)";
          ctx.strokeStyle = node.color;
          ctx.lineWidth = selected ? 2.1 : 1.25;
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = node.color;
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        if (selected) {
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
      let domain = null;
      distance = 22;
      domainHubs.forEach((hub) => {
        if (!activeDomain(hub) || !descendantsVisible(hub, ids)) return;
        const current = Math.hypot(x - hub.screenX, y - hub.screenY);
        if (current < distance) { domain = hub; distance = current; }
      });
      return domain ? { type: "domain", value: domain } : null;
    }

    function showTooltip(hit, x, y) {
      if (!hit || dragging) { tooltip.classList.remove("is-visible"); return; }
      if (hit.type === "node") {
        tooltip.innerHTML = `<strong>${escapeHtml(hit.value.table.name)}</strong><span>${escapeHtml(hit.value.table.domain)} · ${escapeHtml(hit.value.table.businessObject || "未分类")}</span>`;
      } else {
        tooltip.innerHTML = `<strong>${escapeHtml(hit.value.label)}</strong><span>${hit.value.tableIds.length} 张数据表 · 点击聚焦</span>`;
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
      hoveredDomain = hit?.type === "domain" ? hit.value.domain : null;
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
        if (hit?.type === "domain") selectDomain(hit.value.domain, { closeMobile: false });
      }
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }

    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("pointerleave", () => {
      if (!dragging) {
        hoveredNode = null;
        hoveredDomain = null;
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

  function bindControls() {
    document.querySelector('.domain-nav-item[data-domain="all"]').addEventListener("click", () => selectDomain("all"));
    els.domainNavList.addEventListener("click", (event) => {
      const leaf = event.target.closest("[data-tree-table]");
      if (leaf) {
        const table = tableById.get(String(leaf.dataset.treeTable));
        if (!table) return;
        selectDomain(table.domain, { focus: false, closeMobile: false });
        openDrawer(table.id);
        dataMap.focusTable(table.id);
        closeSidebar();
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
    els.onlineFilter.addEventListener("change", (event) => { state.online = event.target.value; renderCatalog(); });
    els.lakeFilter.addEventListener("change", (event) => { state.lake = event.target.value; renderCatalog(); });
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
      state.view = button.dataset.view;
      document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderCatalog();
    }));
    document.getElementById("clearFilters").addEventListener("click", clearAllFilters);
    document.getElementById("mapReset").addEventListener("click", () => selectDomain("all", { closeMobile: false }));
    document.getElementById("mapZoomIn").addEventListener("click", () => dataMap.zoomBy(1.18));
    document.getElementById("mapZoomOut").addEventListener("click", () => dataMap.zoomBy(.84));
    document.getElementById("closeDrawer").addEventListener("click", closeDrawer);
    els.drawerScrim.addEventListener("click", closeDrawer);
    document.getElementById("openSidebar").addEventListener("click", openSidebar);
    document.getElementById("closeSidebar").addEventListener("click", closeSidebar);
    els.sidebarScrim.addEventListener("click", closeSidebar);
    document.getElementById("showGuide").addEventListener("click", () => { els.guideModal.hidden = false; });
    document.getElementById("closeGuide").addEventListener("click", closeGuide);
    document.getElementById("startExplore").addEventListener("click", closeGuide);
    els.guideModal.addEventListener("click", (event) => { if (event.target === els.guideModal) closeGuide(); });
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); els.searchInput.focus(); }
      if (event.key === "Escape") { closeDrawer(); closeSidebar(); closeGuide(); }
    });
  }

  renderNavigation();
  renderMetrics();
  bindControls();
  renderCatalog();
})();
