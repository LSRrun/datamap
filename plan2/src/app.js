(function () {
  const catalog = window.DATA_MAP || { domains: [], tables: [] };
  const PAGE_SIZE = 18;
  const colors = ['#5a61f3','#2e8de5','#13a89a','#8a5ed3','#e58a35','#d75d82','#4d75c8','#18a66e','#8c70df','#cf6d4d','#4b99ad','#7b85b6','#b77b2d','#6d8960'];
  const state = { domain: '全部主题域', subdomain: '全部', status: 'all', query: '', visible: PAGE_SIZE, view: 'grid' };

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    domainNav: $('#domainNav'), domainTotal: $('#domainTotal'), statGrid: $('#statGrid'),
    heroTotal: $('#heroTableTotal'), orbitDots: $('#orbitDots'), catalogTitle: $('#catalogTitle'),
    resultTotal: $('#resultTotal'), description: $('#catalogDescription'), search: $('#searchInput'),
    statusFilters: $('#statusFilters'), subdomains: $('#subdomainNav'), grid: $('#tableGrid'),
    empty: $('#emptyState'), loadMore: $('#loadMore'), drawer: $('#drawer'), mask: $('#drawerMask'),
    drawerTitle: $('#drawerTitle'), drawerBody: $('#drawerBody')
  };

  const strip = (value) => String(value || '').replace(/^L[1-4]\s*/, '').trim();
  const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const domainColor = (name) => colors[Math.max(0, catalog.domains.findIndex((item) => item.name === name)) % colors.length];
  const domainCode = (name) => {
    const plain = strip(name).replace(/[（）()]/g, '');
    const latin = plain.match(/^[A-Z]+/);
    return latin ? latin[0].slice(0, 3) : plain.slice(0, 2);
  };

  function renderDomains() {
    ui.domainTotal.textContent = catalog.domains.length;
    const domains = [{ name: '全部主题域', count: catalog.tables.length }, ...catalog.domains];
    ui.domainNav.innerHTML = domains.map((domain, index) => `
      <button class="domain-item ${state.domain === domain.name ? 'active' : ''} ${index && !domain.count ? 'empty' : ''}" data-domain="${escape(domain.name)}" type="button">
        <span class="domain-icon">${index ? escape(domainCode(domain.name)) : 'ALL'}</span>
        <span class="domain-name">${escape(strip(domain.name))}</span>
        <span class="domain-count">${domain.count}</span>
      </button>`).join('');
  }

  function renderOverview() {
    const tables = catalog.tables;
    const online = tables.filter((table) => table.online === '是').length;
    const lake = tables.filter((table) => table.inLake === '是').length;
    const owners = new Set(tables.map((table) => table.owner).filter(Boolean)).size;
    ui.heroTotal.textContent = tables.length;
    const stats = [
      [tables.length, '数据表总数', '全量目录', '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>'],
      [catalog.domains.length, '一级主题域', `${catalog.domains.filter(d => d.count).length} 个已有数据`, '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.5 7.5h11M6.5 16.5h11"/>'],
      [online, '已线上化', `${Math.round(online / tables.length * 100)}%`, '<path d="M5 12l4 4L19 6"/><circle cx="12" cy="12" r="9"/>'],
      [lake, '已入湖', `${owners} 位负责人`, '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>']
    ];
    ui.statGrid.innerHTML = stats.map(([value, label, hint, icon]) => `
      <article class="stat-card"><span class="stat-icon"><svg viewBox="0 0 24 24">${icon}</svg></span>
      <span class="stat-copy"><strong>${value}</strong><span>${label}</span></span><small class="stat-hint">${hint}</small></article>`).join('');

    const points = [[15,18,30],[74,12,24],[82,55,34],[17,66,22],[62,78,19],[37,8,15],[88,28,14],[7,44,15],[39,82,14],[63,18,12],[74,73,12],[28,50,11]];
    ui.orbitDots.innerHTML = catalog.domains.slice(0, points.length).map((domain, index) => {
      const [left, top, size] = points[index];
      return `<span class="orbit-dot" style="left:${left}%;top:${top}%;width:${size}px;height:${size}px">${domain.count || ''}</span>`;
    }).join('');
  }

  function subdomainCounts() {
    const source = state.domain === '全部主题域' ? catalog.tables : catalog.tables.filter((table) => table.domain === state.domain);
    return Object.entries(source.reduce((result, table) => {
      result[table.subdomain] = (result[table.subdomain] || 0) + 1;
      return result;
    }, {})).sort((a, b) => b[1] - a[1]);
  }

  function renderSubdomains() {
    const items = subdomainCounts();
    if (state.subdomain !== '全部' && !items.some(([name]) => name === state.subdomain)) state.subdomain = '全部';
    ui.subdomains.innerHTML = [
      `<button class="${state.subdomain === '全部' ? 'active' : ''}" data-subdomain="全部" type="button">全部分类</button>`,
      ...items.map(([name, count]) => `<button class="${state.subdomain === name ? 'active' : ''}" data-subdomain="${escape(name)}" type="button">${escape(strip(name))} · ${count}</button>`)
    ].join('');
  }

  function filteredTables() {
    const query = state.query.trim().toLowerCase();
    return catalog.tables.filter((table) => {
      if (state.domain !== '全部主题域' && table.domain !== state.domain) return false;
      if (state.subdomain !== '全部' && table.subdomain !== state.subdomain) return false;
      if (state.status === 'online' && table.online !== '是') return false;
      if (state.status === 'lake' && table.inLake !== '是') return false;
      if (state.status === 'pending' && table.englishName && table.owner) return false;
      if (!query) return true;
      return [table.name, table.englishName, table.domain, table.subdomain, table.object, table.owner]
        .filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }

  function card(table, index) {
    const color = domainColor(table.domain);
    const statusClass = table.online === '是' ? 'online' : table.online === '否' ? 'offline' : 'unknown';
    const statusText = table.online === '是' ? '已线上化' : table.online === '否' ? '未线上化' : '状态未知';
    const owner = table.owner || '待维护';
    return `
      <article class="table-card" style="--accent:${color}" data-index="${index}" tabindex="0" role="button" aria-label="查看 ${escape(strip(table.name))} 详情">
        <div>
          <div class="card-top">
            <span class="table-icon"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg></span>
            <span class="card-name"><h3>${escape(strip(table.name))}</h3><p>${escape(table.englishName || '英文表名待维护')}</p></span>
            <span class="badge ${statusClass}">${statusText}</span>
          </div>
          <div class="breadcrumb"><span>${escape(strip(table.subdomain))}</span><i>/</i><span>${escape(strip(table.object))}</span></div>
        </div>
        <div class="card-foot">
          <span class="owner"><i class="owner-avatar">${escape(owner.slice(0,1))}</i>${escape(owner)}</span>
          <span class="lake ${table.inLake === '是' ? 'yes' : ''}"><i></i>${table.inLake === '是' ? '已入湖' : '未入湖'}</span>
          <span class="arrow">›</span>
        </div>
      </article>`;
  }

  function renderTables() {
    const tables = filteredTables();
    const visible = tables.slice(0, state.visible);
    ui.catalogTitle.textContent = state.domain === '全部主题域' ? '全部数据表' : strip(state.domain);
    ui.resultTotal.textContent = `${tables.length} 张`;
    ui.description.textContent = state.subdomain === '全部'
      ? `浏览${state.domain === '全部主题域' ? '全部主题域' : strip(state.domain)}下的数据表`
      : `${strip(state.subdomain)}分类下的数据表`;
    ui.grid.classList.toggle('list', state.view === 'list');
    ui.grid.innerHTML = visible.map(card).join('');
    ui.grid.hidden = !tables.length;
    ui.empty.hidden = Boolean(tables.length);
    ui.loadMore.parentElement.hidden = !tables.length || visible.length >= tables.length;
    ui.loadMore.textContent = `加载更多（剩余 ${Math.max(0, tables.length - visible.length)} 张）`;
  }

  function render() { renderDomains(); renderSubdomains(); renderTables(); }

  function reset() {
    Object.assign(state, { domain: '全部主题域', subdomain: '全部', status: 'all', query: '', visible: PAGE_SIZE });
    ui.search.value = '';
    ui.statusFilters.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.status === 'all'));
    render();
  }

  function openDrawer(table) {
    const onlineClass = table.online === '是' ? 'online' : table.online === '否' ? 'offline' : 'unknown';
    ui.drawerTitle.textContent = strip(table.name);
    ui.drawerBody.innerHTML = `
      <div class="detail-code">${escape(table.englishName || '英文表名待维护')}</div>
      <div class="detail-badges"><span class="badge ${onlineClass}">${table.online === '是' ? '已线上化' : table.online === '否' ? '未线上化' : '状态未知'}</span><span class="badge ${table.inLake === '是' ? 'online' : 'unknown'}">${table.inLake === '是' ? '已入湖' : '未入湖'}</span></div>
      <section class="detail-section"><h3>所属数据目录</h3><div class="path-stack">
        <div class="path-item"><b>L1</b>${escape(strip(table.domain))}</div><div class="path-item"><b>L2</b>${escape(strip(table.subdomain))}</div>
        <div class="path-item"><b>L3</b>${escape(strip(table.object))}</div><div class="path-item"><b>L4</b>${escape(strip(table.name))}</div>
      </div></section>
      <section class="detail-section"><h3>基础信息</h3><div class="detail-list">
        ${detailRow('模型负责人', table.owner, '待维护')}${detailRow('上线时间', table.launchDate, '待维护')}
        ${detailRow('是否线上化', table.online, '待确认')}${detailRow('是否入湖', table.inLake, '待确认')}${detailRow('说明', table.note, '暂无说明')}
      </div></section>`;
    ui.mask.hidden = false;
    requestAnimationFrame(() => ui.drawer.classList.add('open'));
    ui.drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function detailRow(label, value, fallback) {
    return `<div class="detail-row"><span>${label}</span><span class="${value ? '' : 'missing'}">${escape(value || fallback)}</span></div>`;
  }

  function closeDrawer() {
    ui.drawer.classList.remove('open');
    ui.drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    window.setTimeout(() => { ui.mask.hidden = true; }, 270);
  }

  ui.domainNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-domain]'); if (!button) return;
    state.domain = button.dataset.domain; state.subdomain = '全部'; state.visible = PAGE_SIZE; render();
  });
  ui.subdomains.addEventListener('click', (event) => {
    const button = event.target.closest('[data-subdomain]'); if (!button) return;
    state.subdomain = button.dataset.subdomain; state.visible = PAGE_SIZE; render();
  });
  ui.statusFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]'); if (!button) return;
    state.status = button.dataset.status; state.visible = PAGE_SIZE;
    ui.statusFilters.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button)); renderTables();
  });
  ui.search.addEventListener('input', () => { state.query = ui.search.value; state.visible = PAGE_SIZE; renderTables(); });
  $('.view-toggle').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]'); if (!button) return;
    state.view = button.dataset.view;
    document.querySelectorAll('.view-toggle button').forEach((item) => item.classList.toggle('active', item === button)); renderTables();
  });
  ui.grid.addEventListener('click', (event) => {
    const item = event.target.closest('.table-card'); if (item) openDrawer(filteredTables()[Number(item.dataset.index)]);
  });
  ui.grid.addEventListener('keydown', (event) => {
    if (!['Enter',' '].includes(event.key)) return;
    const item = event.target.closest('.table-card'); if (!item) return;
    event.preventDefault(); openDrawer(filteredTables()[Number(item.dataset.index)]);
  });
  ui.loadMore.addEventListener('click', () => { state.visible += PAGE_SIZE; renderTables(); });
  $('#resetButton').addEventListener('click', reset); $('#emptyReset').addEventListener('click', reset);
  $('#drawerClose').addEventListener('click', closeDrawer); ui.mask.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); ui.search.focus(); }
    if (event.key === 'Escape') closeDrawer();
  });

  $('#snapshotDate').textContent = new Date().toLocaleDateString('zh-CN');
  renderOverview(); render();
})();
