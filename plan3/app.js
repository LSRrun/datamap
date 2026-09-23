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
    if (value === "是") return type === "lake" ? "已入湖" : "已线上";
    if (value === "否") return type === "lake" ? "未入湖" : "未线上";
    return "待确认";
  }

  function domainIcon(index) {
    const paths = [
      '<path d="M4 17V7l8-4 8 4v10l-8 4zM4 7l8 4 8-4M12 11v10"/>',
      '<path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4"/>',
      '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.2 4 5 4 8s-1.5 5.8-4 8c-2.5-2.2-4-5-4-8s1.5-5.8 4-8"/>',
      '<path d="M4 19h16M6 17V9h4v8M14 17V5h4v12"/>',
    ];
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[index % paths.length]}</svg>`;
  }

  function renderNavigation() {
    els.allDomainCount.textContent = dataset.tables.length;
    els.domainNavList.innerHTML = dataset.domains.map((domain, index) => `
      <button class="domain-nav-item ${domain.count === 0 ? "is-empty" : ""}" type="button" data-domain="${escapeHtml(domain.name)}">
        <span class="nav-icon" style="color:${domain.color}">${domainIcon(index)}</span>
        <span class="nav-label" title="${escapeHtml(domain.name)}">${escapeHtml(domain.name)}</span>
        <span class="nav-count">${domain.count}</span>
      </button>
    `).join("");

    document.querySelectorAll(".domain-nav-item").forEach((button) => {
      button.addEventListener("click", () => {
        selectDomain(button.dataset.domain);
        closeSidebar();
      });
    });
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
    if (dataset.meta?.sourceDate) {
      els.dataFreshness.textContent = `目录更新时间：${dataset.meta.sourceDate}`;
    }
  }

  function filteredTables() {
    const query = state.query.trim().toLowerCase();
    return dataset.tables.filter((table) => {
      if (state.domain !== "all" && table.domain !== state.domain) return false;
      if (state.online !== "all") {
        if (state.online === "unknown" ? Boolean(table.online) : table.online !== state.online) return false;
      }
      if (state.lake !== "all") {
        if (state.lake === "unknown" ? Boolean(table.inLake) : table.inLake !== state.lake) return false;
      }
      if (!query) return true;
      return [table.name, table.englishName, table.domain, table.topic, table.businessObject, table.owner]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }

  function groupTables(tables) {
    const groups = new Map();
    tables.forEach((table) => {
      const key = `${table.domain}|||${table.topic}`;
      if (!groups.has(key)) groups.set(key, { domain: table.domain, topic: table.topic, tables: [] });
      groups.get(key).tables.push(table);
    });
    return [...groups.values()];
  }

  function tableCard(table) {
    const domain = domainByName.get(table.domain) || { color: "#5a5feb" };
    const english = table.englishName
      ? escapeHtml(table.englishName)
      : '<span class="is-empty">英文表名待完善</span>';
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
    const groups = groupTables(tables);
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
            <div class="group-title">
              <i></i>
              <h3>${escapeHtml(group.topic)}</h3>
              <span>${escapeHtml(group.domain)} · ${group.tables.length} 张</span>
            </div>
            <button type="button" class="collapse-group" data-group="${escapeHtml(groupKey)}">
              ${collapsed ? "展开" : "收起"}
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
          <div class="table-grid">${group.tables.map(tableCard).join("")}</div>
        </section>
      `;
    }).join("");

    els.emptyState.hidden = tables.length !== 0;
    els.catalogGroups.hidden = tables.length === 0;
    bindCatalogEvents();
    renderActiveFilters();
    updateMapCaption(tables);
  }

  function bindCatalogEvents() {
    document.querySelectorAll("[data-table-id]").forEach((button) => {
      button.addEventListener("click", () => openDrawer(button.dataset.tableId));
    });
    document.querySelectorAll("[data-group]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.group;
        state.openGroups.has(key) ? state.openGroups.delete(key) : state.openGroups.add(key);
        renderCatalog();
      });
    });
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
    document.querySelectorAll("[data-clear-filter]").forEach((button) => {
      button.addEventListener("click", () => clearFilter(button.dataset.clearFilter));
    });
  }

  function clearFilter(key) {
    if (key === "domain") selectDomain("all");
    if (key === "query") { state.query = ""; els.searchInput.value = ""; }
    if (key === "online") { state.online = "all"; els.onlineFilter.value = "all"; }
    if (key === "lake") { state.lake = "all"; els.lakeFilter.value = "all"; }
    renderCatalog();
    dataMap.draw();
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

  function selectDomain(domain) {
    state.domain = domain || "all";
    document.querySelectorAll(".domain-nav-item").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.domain === state.domain);
    });
    renderCatalog();
    dataMap.draw();
  }

  function updateMapCaption(tables) {
    const title = state.domain === "all" ? "全部主题域" : state.domain;
    els.mapCaptionTitle.textContent = title;
    els.mapCaptionMeta.textContent = `${tables.length} 张表 · ${new Set(tables.map((item) => item.topic)).size} 个二级主题域`;
  }

  function openDrawer(id) {
    const table = dataset.tables.find((item) => String(item.id) === String(id));
    if (!table) return;
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
        <span>${escapeHtml(table.domain)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        <span>${escapeHtml(table.topic)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        <span>${escapeHtml(table.businessObject || "待完善")}</span>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><span>模型负责人</span><strong>${escapeHtml(table.owner || "待完善")}</strong></div>
        <div class="detail-item"><span>上线时间</span><strong>${escapeHtml(table.launchDate || "待完善")}</strong></div>
        <div class="detail-item"><span>目录序号</span><strong>#${escapeHtml(table.sourceRow)}</strong></div>
        <div class="detail-item"><span>业务对象</span><strong>${escapeHtml(table.businessObject || "待完善")}</strong></div>
      </div>
      <div class="detail-note">
        <span>说明</span>
        <p>${escapeHtml(table.description || "暂无补充说明。")}</p>
      </div>
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
  }

  function openSidebar() {
    els.sidebar.classList.add("is-open");
    els.sidebarScrim.classList.add("is-open");
  }

  function closeSidebar() {
    els.sidebar.classList.remove("is-open");
    els.sidebarScrim.classList.remove("is-open");
  }

  function closeGuide() { els.guideModal.hidden = true; }

  const dataMap = (() => {
    const canvas = document.getElementById("dataMap");
    const stage = document.getElementById("mapStage");
    const tooltip = document.getElementById("mapTooltip");
    const context = canvas.getContext("2d");
    let points = [];
    let hoverPoint = null;
    let width = 0;
    let height = 0;
    let dpr = 1;

    function hash(seed) {
      let value = Math.sin(seed * 12.9898) * 43758.5453;
      return value - Math.floor(value);
    }

    function resize() {
      const rect = stage.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildPoints();
      draw();
    }

    function anchors() {
      const count = dataset.domains.length;
      const usable = dataset.domains.filter((domain) => domain.count > 0);
      const centers = new Map();
      usable.forEach((domain, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(usable.length, 1);
        const ring = index % 2 === 0 ? .25 : .36;
        centers.set(domain.name, {
          x: width * .5 + Math.cos(angle) * width * ring,
          y: height * .51 + Math.sin(angle) * height * (ring + .02),
        });
      });
      dataset.domains.filter((domain) => domain.count === 0).forEach((domain, index) => {
        centers.set(domain.name, { x: 38 + index * 35, y: 28 });
      });
      return centers;
    }

    function buildPoints() {
      const centers = anchors();
      points = dataset.tables.map((table, index) => {
        const center = centers.get(table.domain) || { x: width / 2, y: height / 2 };
        const angle = hash(index + 11) * Math.PI * 2;
        const radius = Math.pow(hash(index + 91), .58) * Math.min(width, height) * .115;
        return {
          table,
          x: center.x + Math.cos(angle) * radius,
          y: center.y + Math.sin(angle) * radius * .64,
          size: 2.1 + hash(index + 203) * 2.8,
          color: (domainByName.get(table.domain) || {}).color || "#5a5feb",
        };
      });
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      const query = state.query.trim().toLowerCase();
      points.forEach((point) => {
        const domainActive = state.domain === "all" || point.table.domain === state.domain;
        const queryMatch = !query || [point.table.name, point.table.englishName, point.table.businessObject, point.table.owner]
          .join(" ").toLowerCase().includes(query);
        const active = domainActive && queryMatch;
        const selected = hoverPoint === point;
        context.beginPath();
        context.arc(point.x, point.y, point.size + (selected ? 3 : 0), 0, Math.PI * 2);
        if (point.table.online === "否") {
          context.fillStyle = active ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.35)";
          context.fill();
          context.strokeStyle = active ? point.color : "rgba(152,164,184,.18)";
          context.lineWidth = selected ? 2.2 : 1.2;
          context.stroke();
        } else {
          context.fillStyle = active ? point.color : "rgba(145,156,177,.12)";
          context.globalAlpha = active ? (selected ? 1 : .58) : 1;
          context.fill();
          context.globalAlpha = 1;
        }
        if (selected) {
          context.beginPath();
          context.arc(point.x, point.y, point.size + 7, 0, Math.PI * 2);
          context.strokeStyle = `${point.color}55`;
          context.lineWidth = 2;
          context.stroke();
        }
      });
    }

    function nearest(event) {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let nearestPoint = null;
      let nearestDistance = 13;
      points.forEach((point) => {
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPoint = point;
        }
      });
      return { point: nearestPoint, x, y };
    }

    canvas.addEventListener("mousemove", (event) => {
      const result = nearest(event);
      hoverPoint = result.point;
      if (hoverPoint) {
        tooltip.innerHTML = `<strong>${escapeHtml(hoverPoint.table.name)}</strong><span>${escapeHtml(hoverPoint.table.domain)} · ${escapeHtml(hoverPoint.table.topic)}</span>`;
        const left = Math.min(result.x + 14, width - 265);
        const top = Math.max(8, Math.min(result.y + 12, height - 70));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.classList.add("is-visible");
        canvas.style.cursor = "pointer";
      } else {
        tooltip.classList.remove("is-visible");
        canvas.style.cursor = "crosshair";
      }
      draw();
    });

    canvas.addEventListener("mouseleave", () => {
      hoverPoint = null;
      tooltip.classList.remove("is-visible");
      draw();
    });

    canvas.addEventListener("click", (event) => {
      const result = nearest(event);
      if (result.point) {
        selectDomain(result.point.table.domain);
        document.getElementById("catalog").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    window.addEventListener("resize", resize);
    return { resize, draw };
  })();

  function bindControls() {
    let searchTimer;
    els.searchInput.addEventListener("input", (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = event.target.value;
        renderCatalog();
        dataMap.draw();
      }, 120);
    });
    els.onlineFilter.addEventListener("change", (event) => { state.online = event.target.value; renderCatalog(); });
    els.lakeFilter.addEventListener("change", (event) => { state.lake = event.target.value; renderCatalog(); });
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = button.dataset.view;
        document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("is-active", item === button));
        renderCatalog();
      });
    });
    document.getElementById("clearFilters").addEventListener("click", clearAllFilters);
    document.getElementById("mapReset").addEventListener("click", () => selectDomain("all"));
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        els.searchInput.focus();
      }
      if (event.key === "Escape") {
        closeDrawer();
        closeSidebar();
        closeGuide();
      }
    });
  }

  renderNavigation();
  renderMetrics();
  bindControls();
  renderCatalog();
  requestAnimationFrame(dataMap.resize);
  setTimeout(dataMap.resize, 80);
})();
