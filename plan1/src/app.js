(function () {
  "use strict";

  const catalog = window.DATA_MAP || { domains: [], tables: [] };
  const palette = [
    "#6d5dfc", "#168ce8", "#08aeca", "#16aa79", "#f09b3d",
    "#e75e8d", "#8b62d9", "#3475c8", "#64a04a", "#d56b45",
    "#5868d9", "#4196aa", "#b47727", "#7c72b8"
  ];

  const cleanLevel = (value) => String(value || "").replace(/^L[1-4]\s*/, "").trim();
  const yes = (value) => String(value || "").trim() === "是";
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[char]);

  const tables = catalog.tables.map((table, index) => ({
    ...table,
    id: index,
    domainLabel: cleanLevel(table.domain),
    subdomainLabel: cleanLevel(table.subdomain),
    objectLabel: cleanLevel(table.object),
    nameLabel: cleanLevel(table.name),
    onlineValue: yes(table.online),
    lakeValue: yes(table.inLake),
  }));

  const domainNames = catalog.domains.map((domain) => domain.name);
  const domainIndex = new Map(domainNames.map((name, index) => [name, index]));
  const colorFor = (domain) => palette[(domainIndex.get(domain) || 0) % palette.length];

  const state = {
    domain: "all",
    filter: "all",
    query: "",
    selectedId: null,
    hoveredId: null,
    relatedObject: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    dragging: false,
    moved: false,
    pointerStart: null,
  };

  const els = {
    domainNav: document.querySelector("#domainNav"),
    domainTotal: document.querySelector("#domainTotal"),
    tableCount: document.querySelector("#tableCount"),
    domainCount: document.querySelector("#domainCount"),
    onlineCount: document.querySelector("#onlineCount"),
    lakeCount: document.querySelector("#lakeCount"),
    searchInput: document.querySelector("#searchInput"),
    visibleSummary: document.querySelector("#visibleSummary"),
    canvasStage: document.querySelector("#canvasStage"),
    canvas: document.querySelector("#networkCanvas"),
    tooltip: document.querySelector("#canvasTooltip"),
    detailPanel: document.querySelector("#detailPanel"),
    detailSwatch: document.querySelector("#detailSwatch"),
    detailDomain: document.querySelector("#detailDomain"),
    detailName: document.querySelector("#detailName"),
    detailEnglish: document.querySelector("#detailEnglish"),
    detailOnline: document.querySelector("#detailOnline"),
    detailLake: document.querySelector("#detailLake"),
    detailL2: document.querySelector("#detailL2"),
    detailL3: document.querySelector("#detailL3"),
    detailOwner: document.querySelector("#detailOwner"),
    relatedBtn: document.querySelector("#relatedBtn"),
    closeDetailBtn: document.querySelector("#closeDetailBtn"),
    zoomInBtn: document.querySelector("#zoomInBtn"),
    zoomOutBtn: document.querySelector("#zoomOutBtn"),
    resetViewBtn: document.querySelector("#resetViewBtn"),
    overviewBtn: document.querySelector("#overviewBtn"),
    emptyState: document.querySelector("#emptyState"),
  };

  const ctx = els.canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let dpr = 1;
  let baseScale = 1;
  let lastPointer = { x: 0, y: 0 };

  function hash(value) {
    let result = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      result ^= value.charCodeAt(i);
      result = Math.imul(result, 16777619);
    }
    return Math.abs(result >>> 0);
  }

  function seededUnit(value, salt) {
    const number = hash(`${value}:${salt}`);
    return (number % 10000) / 10000;
  }

  const activeDomains = catalog.domains.filter((domain) => domain.count > 0);
  const clusterCenters = new Map();
  activeDomains.forEach((domain, index) => {
    const count = activeDomains.length;
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const ring = index % 2 === 0 ? 1 : 0.82;
    clusterCenters.set(domain.name, {
      x: Math.cos(angle) * 315 * ring,
      y: Math.sin(angle) * 210 * ring,
      color: colorFor(domain.name),
      label: cleanLevel(domain.name),
      count: domain.count,
      index,
    });
  });

  const nodes = tables.map((table) => {
    const cluster = clusterCenters.get(table.domain) || { x: 0, y: 0, index: 0 };
    const radius = 24 + seededUnit(table.name, "radius") * (44 + Math.sqrt(table.id + 1) * 1.5);
    const angle = seededUnit(table.name + table.object, "angle") * Math.PI * 2;
    const jitterX = (seededUnit(table.englishName || table.name, "jx") - 0.5) * 28;
    const jitterY = (seededUnit(table.owner || table.name, "jy") - 0.5) * 22;
    return {
      ...table,
      x: cluster.x + Math.cos(angle) * radius + jitterX,
      y: cluster.y + Math.sin(angle) * radius * 0.78 + jitterY,
      radius: 2.4 + (table.onlineValue ? 1.0 : 0) + (table.lakeValue ? 0.65 : 0),
      phase: seededUnit(table.name, "phase") * Math.PI * 2,
    };
  });

  const links = [];
  const byObject = new Map();
  nodes.forEach((node) => {
    const key = `${node.domain}|${node.object}`;
    if (!byObject.has(key)) byObject.set(key, []);
    byObject.get(key).push(node.id);
  });
  byObject.forEach((ids) => {
    for (let i = 1; i < ids.length; i += 1) links.push([ids[i - 1], ids[i]]);
  });

  function renderStats() {
    els.tableCount.textContent = tables.length;
    els.domainCount.textContent = catalog.domains.length;
    els.domainTotal.textContent = catalog.domains.length;
    els.onlineCount.textContent = tables.filter((table) => table.onlineValue).length;
    els.lakeCount.textContent = tables.filter((table) => table.lakeValue).length;
  }

  function renderDomainNav() {
    const allButton = `
      <button class="domain-item ${state.domain === "all" ? "active" : ""}" type="button" data-domain="all" style="--domain-color:#8b97ad">
        <span class="domain-dot"></span><span class="domain-name">全部主题域</span><span class="domain-count">${tables.length}</span>
      </button>`;
    const domainButtons = catalog.domains.map((domain) => `
      <button class="domain-item ${state.domain === domain.name ? "active" : ""}" type="button" data-domain="${escapeHtml(domain.name)}" style="--domain-color:${colorFor(domain.name)}">
        <span class="domain-dot"></span><span class="domain-name">${escapeHtml(cleanLevel(domain.name))}</span><span class="domain-count">${domain.count}</span>
      </button>`).join("");
    els.domainNav.innerHTML = allButton + domainButtons;
  }

  function nodeMatches(node) {
    if (state.domain !== "all" && node.domain !== state.domain) return false;
    if (state.filter === "online" && !node.onlineValue) return false;
    if (state.filter === "lake" && !node.lakeValue) return false;
    if (state.relatedObject && node.object !== state.relatedObject) return false;
    if (state.query) {
      const haystack = [node.name, node.englishName, node.object, node.subdomain, node.owner].join(" ").toLowerCase();
      if (!haystack.includes(state.query)) return false;
    }
    return true;
  }

  function visibleNodes() {
    return nodes.filter(nodeMatches);
  }

  function updateSummary() {
    const count = visibleNodes().length;
    const scope = state.domain === "all" ? "全部主题域" : cleanLevel(state.domain);
    els.visibleSummary.textContent = `${scope} · ${count} 张表`;
    els.emptyState.hidden = count !== 0;
  }

  function renderDetail(node) {
    if (!node) {
      els.detailPanel.classList.remove("open");
      return;
    }
    const color = colorFor(node.domain);
    els.detailSwatch.style.background = color;
    els.detailSwatch.style.boxShadow = `0 0 12px ${color}80`;
    els.detailDomain.textContent = node.domainLabel;
    els.detailName.textContent = node.nameLabel || "未命名数据表";
    els.detailEnglish.textContent = node.englishName || "暂无英文表名";
    els.detailL2.textContent = node.subdomainLabel || "—";
    els.detailL3.textContent = node.objectLabel || "—";
    els.detailOwner.textContent = node.owner || "待完善";
    els.detailOnline.textContent = node.onlineValue ? "● 已线上化" : "○ 未线上化";
    els.detailOnline.className = `status-badge ${node.onlineValue ? "positive" : "neutral"}`;
    els.detailLake.textContent = node.lakeValue ? "● 已入湖" : "○ 未入湖";
    els.detailLake.className = `status-badge ${node.lakeValue ? "positive" : "neutral"}`;
    els.relatedBtn.innerHTML = state.relatedObject ? "返回全部数据表 <span>↺</span>" : "查看同业务对象数据表 <span>→</span>";
    els.detailPanel.classList.add("open");
  }

  function resizeCanvas() {
    const rect = els.canvasStage.getBoundingClientRect();
    width = Math.max(320, rect.width);
    height = Math.max(480, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    els.canvas.width = Math.round(width * dpr);
    els.canvas.height = Math.round(height * dpr);
    els.canvas.style.width = `${width}px`;
    els.canvas.style.height = `${height}px`;
    baseScale = Math.min(width / 1050, height / 720);
  }

  function worldToScreen(x, y, time, phase) {
    const wobble = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1;
    const wx = x + Math.sin(time * 0.00045 + phase) * 1.8 * wobble;
    const wy = y + Math.cos(time * 0.00038 + phase) * 1.5 * wobble;
    const scale = baseScale * state.zoom;
    return {
      x: width / 2 + state.panX + wx * scale,
      y: height / 2 + state.panY + wy * scale,
      scale,
    };
  }

  function draw(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const visibleIds = new Set(visibleNodes().map((node) => node.id));
    const selected = state.selectedId === null ? null : nodes[state.selectedId];
    const selectedPeers = selected
      ? new Set(nodes.filter((node) => node.object === selected.object).map((node) => node.id))
      : new Set();

    clusterCenters.forEach((cluster, domain) => {
      const isDomainActive = state.domain === "all" || state.domain === domain;
      if (!isDomainActive && !state.query) return;
      const point = worldToScreen(cluster.x, cluster.y, time, cluster.index);
      const clusterVisible = nodes.some((node) => node.domain === domain && visibleIds.has(node.id));
      if (!clusterVisible) return;

      const halo = ctx.createRadialGradient(point.x, point.y, 2, point.x, point.y, 86 * point.scale);
      halo.addColorStop(0, `${cluster.color}12`);
      halo.addColorStop(1, `${cluster.color}00`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(38, 86 * point.scale), 0, Math.PI * 2);
      ctx.fill();

      if (state.zoom > 0.72) {
        ctx.fillStyle = "rgba(83, 94, 117, .64)";
        ctx.font = "600 10px Inter, PingFang SC, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${cluster.label} · ${cluster.count}`, point.x, point.y - 50 * point.scale);
      }
    });

    links.forEach(([fromId, toId]) => {
      if (!visibleIds.has(fromId) || !visibleIds.has(toId)) return;
      const from = nodes[fromId];
      const to = nodes[toId];
      const fromPoint = worldToScreen(from.x, from.y, time, from.phase);
      const toPoint = worldToScreen(to.x, to.y, time, to.phase);
      const emphasized = selected && selected.object === from.object;
      ctx.beginPath();
      ctx.moveTo(fromPoint.x, fromPoint.y);
      ctx.lineTo(toPoint.x, toPoint.y);
      ctx.strokeStyle = emphasized ? `${colorFor(from.domain)}70` : "rgba(111, 132, 177, .09)";
      ctx.lineWidth = emphasized ? 1.2 : 0.55;
      ctx.stroke();
    });

    nodes.forEach((node) => {
      const match = visibleIds.has(node.id);
      const isSelected = node.id === state.selectedId;
      const isHovered = node.id === state.hoveredId;
      const isPeer = selectedPeers.has(node.id);
      const point = worldToScreen(node.x, node.y, time, node.phase);
      node.screenX = point.x;
      node.screenY = point.y;
      const radius = Math.max(2.1, node.radius * point.scale) * (isSelected ? 1.95 : isHovered ? 1.5 : isPeer ? 1.25 : 1);
      const color = colorFor(node.domain);

      if (isSelected || isHovered) {
        const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 4.2);
        glow.addColorStop(0, `${color}60`);
        glow.addColorStop(1, `${color}00`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * 4.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = match ? 0.82 : 0.055;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (isSelected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,.94)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    requestAnimationFrame(draw);
  }

  function hitTest(x, y) {
    let nearest = null;
    let distance = Infinity;
    nodes.forEach((node) => {
      if (!nodeMatches(node)) return;
      const dx = x - node.screenX;
      const dy = y - node.screenY;
      const current = Math.sqrt(dx * dx + dy * dy);
      const threshold = Math.max(9, node.radius * baseScale * state.zoom + 5);
      if (current < threshold && current < distance) {
        nearest = node;
        distance = current;
      }
    });
    return nearest;
  }

  function showTooltip(node, x, y) {
    if (!node || state.dragging) {
      els.tooltip.hidden = true;
      return;
    }
    els.tooltip.innerHTML = `<strong>${escapeHtml(node.nameLabel)}</strong><span>${escapeHtml(node.domainLabel)} · ${escapeHtml(node.objectLabel || "未分类")}</span>`;
    els.tooltip.hidden = false;
    const tooltipRect = els.tooltip.getBoundingClientRect();
    const left = Math.min(width - tooltipRect.width - 12, x + 14);
    const top = Math.min(height - tooltipRect.height - 12, y + 14);
    els.tooltip.style.left = `${Math.max(10, left)}px`;
    els.tooltip.style.top = `${Math.max(60, top)}px`;
  }

  function selectNode(node) {
    state.selectedId = node ? node.id : null;
    if (!node) state.relatedObject = null;
    renderDetail(node);
    updateSummary();
  }

  function setZoom(nextZoom, centerX = width / 2, centerY = height / 2) {
    const previousScale = baseScale * state.zoom;
    state.zoom = Math.min(2.4, Math.max(0.55, nextZoom));
    const nextScale = baseScale * state.zoom;
    const ratio = nextScale / previousScale;
    state.panX = centerX - width / 2 - (centerX - width / 2 - state.panX) * ratio;
    state.panY = centerY - height / 2 - (centerY - height / 2 - state.panY) * ratio;
  }

  function resetView() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.relatedObject = null;
    if (state.selectedId !== null) renderDetail(nodes[state.selectedId]);
    updateSummary();
  }

  els.domainNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-domain]");
    if (!button) return;
    state.domain = button.dataset.domain;
    state.relatedObject = null;
    renderDomainNav();
    updateSummary();
  });

  document.querySelectorAll(".filter-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      state.relatedObject = null;
      document.querySelectorAll(".filter-tab").forEach((item) => item.classList.toggle("active", item === button));
      if (state.selectedId !== null && !nodeMatches(nodes[state.selectedId])) selectNode(null);
      updateSummary();
    });
  });

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value.trim().toLowerCase();
    state.relatedObject = null;
    updateSummary();
  });

  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = visibleNodes()[0];
      if (first) selectNode(first);
    }
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      els.searchInput.focus();
    }
    if (event.key === "Escape") {
      els.searchInput.value = "";
      state.query = "";
      selectNode(null);
      updateSummary();
    }
  });

  els.canvasStage.addEventListener("pointerdown", (event) => {
    if (event.target !== els.canvas) return;
    state.dragging = true;
    state.moved = false;
    state.pointerStart = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
    els.canvas.setPointerCapture(event.pointerId);
  });

  els.canvasStage.addEventListener("pointermove", (event) => {
    const rect = els.canvas.getBoundingClientRect();
    lastPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (state.dragging && state.pointerStart) {
      const dx = event.clientX - state.pointerStart.x;
      const dy = event.clientY - state.pointerStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) state.moved = true;
      state.panX = state.pointerStart.panX + dx;
      state.panY = state.pointerStart.panY + dy;
      els.canvas.style.cursor = "grabbing";
      showTooltip(null);
      return;
    }
    const node = hitTest(lastPointer.x, lastPointer.y);
    state.hoveredId = node ? node.id : null;
    els.canvas.style.cursor = node ? "pointer" : "grab";
    showTooltip(node, lastPointer.x, lastPointer.y);
  });

  function endPointer(event) {
    if (!state.dragging) return;
    const didMove = state.moved;
    state.dragging = false;
    state.pointerStart = null;
    els.canvas.style.cursor = "grab";
    if (!didMove) {
      const node = hitTest(lastPointer.x, lastPointer.y);
      if (node) selectNode(node);
    }
    if (event.pointerId !== undefined && els.canvas.hasPointerCapture(event.pointerId)) els.canvas.releasePointerCapture(event.pointerId);
  }

  els.canvasStage.addEventListener("pointerup", endPointer);
  els.canvasStage.addEventListener("pointercancel", endPointer);
  els.canvasStage.addEventListener("pointerleave", () => {
    if (!state.dragging) {
      state.hoveredId = null;
      showTooltip(null);
    }
  });

  els.canvasStage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = els.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setZoom(state.zoom * (event.deltaY < 0 ? 1.1 : 0.9), x, y);
  }, { passive: false });

  els.zoomInBtn.addEventListener("click", () => setZoom(state.zoom * 1.16));
  els.zoomOutBtn.addEventListener("click", () => setZoom(state.zoom * 0.86));
  els.resetViewBtn.addEventListener("click", resetView);
  els.overviewBtn.addEventListener("click", () => {
    state.domain = "all";
    state.filter = "all";
    state.query = "";
    state.relatedObject = null;
    els.searchInput.value = "";
    document.querySelectorAll(".filter-tab").forEach((item) => item.classList.toggle("active", item.dataset.filter === "all"));
    renderDomainNav();
    resetView();
    selectNode(null);
  });
  els.closeDetailBtn.addEventListener("click", () => selectNode(null));
  els.relatedBtn.addEventListener("click", () => {
    const selected = state.selectedId === null ? null : nodes[state.selectedId];
    if (!selected) return;
    state.relatedObject = state.relatedObject ? null : selected.object;
    renderDetail(selected);
    updateSummary();
  });

  new ResizeObserver(resizeCanvas).observe(els.canvasStage);
  renderStats();
  renderDomainNav();
  updateSummary();
  resizeCanvas();
  requestAnimationFrame(draw);

  const initialNode = nodes.find((node) => node.nameLabel.includes("组织架构")) || nodes[0];
  if (initialNode) window.setTimeout(() => selectNode(initialNode), 420);
})();
