/* ==========================================================================
   管理后台脚本：登录、数据看板、内容管理（原生 JS，无第三方依赖）
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------ 基础工具 ------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (value) =>
    String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const fmtDate = (value) => (value ? String(value).slice(0, 16).replace('T', ' ') : '-');

  const TAB_META = {
    dashboard: ['数据看板', '网站访问与内容概览'],
    articles: ['文章管理', '发布、编辑与下线文章'],
    categories: ['分类管理', '文章分类的增删改'],
    services: ['服务项目', '首页与服务页展示的服务卡片'],
    pages: ['单页内容', '关于我们、联系我们等静态内容'],
    messages: ['留言管理', '客户表单提交记录'],
    visits: ['访问日志', '原始访问明细与数据清理'],
    settings: ['站点设置', '公司信息、首页文案与备案信息'],
    account: ['账号安全', '修改密码与管理管理员账号'],
  };

  const SETTING_GROUPS = [
    {
      title: '基本信息',
      fields: [
        ['site_name', '公司全称'],
        ['site_short', '站点简称'],
        ['site_slogan', '一句话标语'],
        ['site_description', '站点描述（SEO）', 'textarea'],
        ['site_keywords', '关键词（英文逗号分隔）'],
        ['seo_title', '首页 SEO 标题'],
        ['site_url', '站点正式域名', '例如 https://www.example.com，用于生成 sitemap'],
      ],
    },
    {
      title: '首页展示',
      fields: [
        ['hero_title', '首页主标题'],
        ['hero_subtitle', '首页副标题', 'textarea'],
        ['hero_button_text', '主按钮文字'],
        ['company_intro', '公司简介（页脚/关于页）', 'textarea'],
      ],
    },
    {
      title: '数据指标（关于页与首页展示）',
      fields: [
        ['stat_years', '行业经验（年）'],
        ['stat_clients', '服务客户数'],
        ['stat_projects', '交付项目数'],
        ['stat_patents', '专利/软著数量'],
      ],
    },
    {
      title: '联系方式',
      fields: [
        ['phone', '服务热线'],
        ['email', '商务邮箱'],
        ['address', '公司地址'],
        ['work_time', '工作时间'],
        ['wechat', '微信号'],
        ['contact_notice', '留言表提示语', 'textarea'],
      ],
    },
    {
      title: '备案与版权',
      fields: [
        ['icp', 'ICP 备案号'],
        ['police', '公安备案号'],
        ['copyright', '页脚版权信息'],
      ],
    },
    {
      title: '统计开关',
      fields: [['analytics_enabled', '是否开启访问统计', 'select:1=开启,0=关闭']],
    },
  ];

  const state = {
    user: null,
    tab: 'dashboard',
    stats: null,
    statsRange: 30,
    settings: {},
    categories: [],
    pages: [],
    articles: { page: 1, q: '', status: '' },
    messages: { page: 1, status: '' },
    visits: { page: 1, day: '' },
    newMessages: 0,
    // 当前视图的点击路由：#content 是常驻节点，因此只在 boot 时绑定一次监听，
    // 各渲染函数通过给它赋值来响应点击，避免重复绑定导致的事件叠加。
    clickRouter: null,
  };

  /* -------------------------------- Toast -------------------------------- */
  function toast(message, type = '') {
    const root = $('#toast-root');
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  /* -------------------------------- 请求 -------------------------------- */
  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...options,
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (res.status === 401) {
      showLogin();
      throw new Error('登录已过期，请重新登录');
    }
    if (!res.ok || !payload || payload.ok === false) {
      throw new Error((payload && payload.error) || `请求失败（${res.status}）`);
    }
    return payload.data;
  }

  /* -------------------------------- 弹层 -------------------------------- */
  function openModal({ title, body, footer = '', size = '', onMount }) {
    const root = $('#modal-root');
    root.innerHTML = `
      <div class="modal-mask">
        <div class="modal-card ${size}">
          <div class="modal-head">
            <h2>${esc(title)}</h2>
            <button class="modal-close" type="button" data-close>×</button>
          </div>
          <div class="modal-body">${body}</div>
          ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
        </div>
      </div>`;
    const mask = $('.modal-mask', root);
    mask.addEventListener('click', (event) => {
      if (event.target === mask || event.target.closest('[data-close]')) closeModal();
    });
    document.addEventListener('keydown', escClose);
    if (onMount) onMount(root);
    return root;
  }

  function escClose(event) {
    if (event.key === 'Escape') closeModal();
  }

  function closeModal() {
    $('#modal-root').innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }

  /* -------------------------------- 图表 -------------------------------- */
  function drawLineChart(canvas, rows, series) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 760;
    const cssH = canvas.clientHeight || 260;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const pad = { l: 46, r: 16, t: 18, b: 30 };
    const w = Math.max(10, cssW - pad.l - pad.r);
    const h = Math.max(10, cssH - pad.t - pad.b);
    let max = 1;
    rows.forEach((row) => series.forEach((s) => { max = Math.max(max, Number(row[s.key]) || 0); }));
    max = Math.ceil(max * 1.15);

    ctx.font = '11px -apple-system, "PingFang SC", sans-serif';
    ctx.strokeStyle = '#eef2f7';
    ctx.fillStyle = '#94a3b8';
    ctx.lineWidth = 1;
    const steps = 4;
    for (let i = 0; i <= steps; i += 1) {
      const y = pad.t + h - (h * i) / steps;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      ctx.fillText(String(Math.round((max * i) / steps)), 10, y + 4);
    }

    const xAt = (i) => (rows.length <= 1 ? pad.l + w / 2 : pad.l + (w * i) / (rows.length - 1));
    const yAt = (v) => pad.t + h - (h * (Number(v) || 0)) / max;

    const labelStep = Math.max(1, Math.ceil(rows.length / 7));
    rows.forEach((row, i) => {
      if (i % labelStep !== 0 && i !== rows.length - 1) return;
      ctx.fillStyle = '#94a3b8';
      const label = String(row.day || '').slice(5);
      const x = xAt(i);
      ctx.fillText(label, x - 14, cssH - 10);
    });

    series.forEach((s) => {
      if (!rows.length) return;
      ctx.beginPath();
      rows.forEach((row, i) => {
        const x = xAt(i);
        const y = yAt(row[s.key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      if (s.fill) {
        ctx.lineTo(xAt(rows.length - 1), pad.t + h);
        ctx.lineTo(xAt(0), pad.t + h);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
        gradient.addColorStop(0, s.fill);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    });
  }

  function barsHtml(items, labelKey, valueKey, emptyText = '暂无数据') {
    if (!items || !items.length) return `<div class="empty">${esc(emptyText)}</div>`;
    const max = Math.max(1, ...items.map((item) => Number(item[valueKey]) || 0));
    return `<div class="bar-list">${items
      .map((item) => {
        const value = Number(item[valueKey]) || 0;
        return `<div class="bar-row">
          <span class="mono" title="${esc(item[labelKey])}">${esc(String(item[labelKey] || '未知').slice(0, 22))}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.max(3, (value / max) * 100)}%"></span></span>
          <span class="bar-value">${value}</span>
        </div>`;
      })
      .join('')}</div>`;
  }

  function paginationHtml(data, attr) {
    if (!data || data.totalPages <= 1) return '';
    let html = `<button ${attr}="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>上一页</button>`;
    const start = Math.max(1, data.page - 3);
    const end = Math.min(data.totalPages, start + 6);
    for (let i = start; i <= end; i += 1) {
      html += `<button ${attr}="${i}" class="${i === data.page ? 'active' : ''}">${i}</button>`;
    }
    html += `<button ${attr}="${data.page + 1}" ${data.page >= data.totalPages ? 'disabled' : ''}>下一页</button>`;
    return `<div class="pagination">${html}</div>`;
  }

  /* ------------------------------ 登录 / 启动 ------------------------------ */
  function showLogin() {
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    state.user = null;
  }

  function showApp() {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    const display = state.user?.displayName || state.user?.username || '管理员';
    $('[data-user-name]').textContent = display;
    $('[data-user-role]').textContent = `角色：${state.user?.role || 'admin'}`;
    if (state.settings.site_name) $('[data-site-name]').textContent = state.settings.site_name;
  }

  async function boot() {
    $('#login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const button = $('#login-submit');
      button.disabled = true;
      button.textContent = '登录中…';
      $('#login-error').innerHTML = '';
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: form.elements.username.value.trim(), password: form.elements.password.value }),
        });
        state.user = data.user;
        await loadSettings();
        showApp();
        switchTab(location.hash.replace('#', '') || 'dashboard');
        toast(`欢迎回来，${state.user.displayName || state.user.username}`, 'ok');
      } catch (error) {
        $('#login-error').innerHTML = `<div class="alert-err" style="margin-top:12px;padding:10px;border-radius:8px;background:#fef2f2;color:#b91c1c">${esc(error.message)}</div>`;
      } finally {
        button.disabled = false;
        button.textContent = '登录';
      }
    });

    $('[data-logout]').addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch {
        /* 忽略 */
      }
      showLogin();
      toast('已退出登录');
    });

    $('#side-nav').addEventListener('click', (event) => {
      const link = event.target.closest('a[data-tab]');
      if (!link) return;
      event.preventDefault();
      switchTab(link.dataset.tab);
    });

    $('[data-refresh]').addEventListener('click', () => renderTab(state.tab));

    $('#content').addEventListener('click', (event) => {
      if (typeof state.clickRouter === 'function') state.clickRouter(event);
    });

    try {
      const me = await api('/api/auth/me');
      state.user = me.user;
      await loadSettings();
      showApp();
      switchTab(location.hash.replace('#', '') || 'dashboard');
    } catch {
      showLogin();
    }
  }

  async function loadSettings() {
    try {
      const data = await api('/api/admin/settings');
      state.settings = data.settings || {};
      if (state.settings.site_name) $('[data-site-name]').textContent = state.settings.site_name;
    } catch {
      state.settings = {};
    }
  }

  async function refreshMessageBadge() {
    try {
      const data = await api('/api/admin/stats?days=7');
      state.newMessages = data.totals.newMessages;
      const badge = $('[data-new-messages]');
      badge.hidden = state.newMessages === 0;
      badge.textContent = String(state.newMessages);
    } catch {
      /* 忽略 */
    }
  }

  function switchTab(tab) {
    if (!TAB_META[tab]) tab = 'dashboard';
    state.tab = tab;
    location.hash = tab;
    $$('#side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    $('#page-heading').textContent = TAB_META[tab][0];
    $('#page-hint').textContent = TAB_META[tab][1];
    renderTab(tab);
  }

  function renderTab(tab) {
    const content = $('#content');
    state.clickRouter = null;
    content.innerHTML = '<div class="empty">加载中…</div>';
    const render = {
      dashboard: renderDashboard,
      articles: renderArticles,
      categories: renderCategories,
      services: renderServices,
      pages: renderPages,
      messages: renderMessages,
      visits: renderVisits,
      settings: renderSettings,
      account: renderAccount,
    }[tab];
    Promise.resolve(render && render()).catch((error) => {
      content.innerHTML = `<div class="panel"><div class="panel-body"><div class="empty">加载失败：${esc(error.message)}</div></div></div>`;
    });
  }

  /* ------------------------------- 数据看板 ------------------------------- */
  async function renderDashboard() {
    const data = await api(`/api/admin/stats?days=${state.statsRange}`);
    state.stats = data;
    const t = data.totals;
    const content = $('#content');
    content.innerHTML = `
      <div class="stat-cards">
        <div class="stat-card accent"><div class="label">今日访问量 (PV)</div><div class="value">${t.todayPv}</div><div class="extra">今日访客 ${t.todayUv} 人</div></div>
        <div class="stat-card"><div class="label">近 30 天访问量</div><div class="value">${t.monthPv}</div><div class="extra">独立访客 ${t.monthUv}</div></div>
        <div class="stat-card"><div class="label">累计访问量</div><div class="value">${t.pv}</div><div class="extra">累计访客 ${t.uv}</div></div>
        <div class="stat-card"><div class="label">文章</div><div class="value">${t.published}<span class="small muted"> / ${t.articles}</span></div><div class="extra">已发布 / 全部，草稿 ${t.drafts}</div></div>
        <div class="stat-card"><div class="label">文章总阅读</div><div class="value">${t.articleViews}</div><div class="extra">全部文章累计</div></div>
        <div class="stat-card"><div class="label">待处理留言</div><div class="value">${t.newMessages}</div><div class="extra">留言合计 ${t.messages}</div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>访问趋势</h2><div class="sub">按天统计的访问量与独立访客</div></div>
          <div class="tabs" data-range>
            ${[7, 30, 90].map((d) => `<button data-days="${d}" class="${state.statsRange === d ? 'active' : ''}">近 ${d} 天</button>`).join('')}
          </div>
        </div>
        <div class="chart-wrap"><canvas id="trend-chart"></canvas></div>
        <div class="legend">
          <span><i style="background:#1d4ed8"></i>访问量 PV</span>
          <span><i style="background:#06b6d4"></i>独立访客 UV</span>
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h3>热门页面</h3><span class="sub">近 ${data.days} 天</span></div>
          <div class="panel-body tight">
            ${
              data.topPages.length
                ? `<table class="table"><thead><tr><th>页面</th><th>PV</th><th>UV</th></tr></thead><tbody>
                    ${data.topPages.map((row) => `<tr><td class="mono">${esc(row.path)}</td><td>${row.pv}</td><td>${row.uv}</td></tr>`).join('')}
                  </tbody></table>`
                : '<div class="empty">暂无访问数据</div>'
            }
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>访问来源</h3><span class="sub">近 ${data.days} 天</span></div>
          <div class="panel-body">${barsHtml(data.topReferrers, 'referrer', 'pv')}</div>
        </div>
      </div>

      <div class="grid-3">
        <div class="panel"><div class="panel-head"><h3>设备分布</h3></div><div class="panel-body">${barsHtml(data.devices, 'device', 'pv')}</div></div>
        <div class="panel"><div class="panel-head"><h3>浏览器</h3></div><div class="panel-body">${barsHtml(data.browsers, 'browser', 'pv')}</div></div>
        <div class="panel"><div class="panel-head"><h3>地区（Cloudflare 提供）</h3></div><div class="panel-body">${barsHtml(data.countries, 'country', 'pv')}</div></div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h3>今日时段分布</h3><span class="sub">0-23 时</span></div>
          <div class="panel-body">${barsHtml(data.hours.map((h) => ({ hour: `${h.hour} 时`, pv: h.pv })), 'hour', 'pv')}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>文章阅读排行</h3><a class="small" href="#articles">管理文章 →</a></div>
          <div class="panel-body tight">
            ${
              data.topArticles.length
                ? `<table class="table"><thead><tr><th>标题</th><th>阅读</th><th>状态</th></tr></thead><tbody>
                    ${data.topArticles.map((row) => `<tr><td>${esc(row.title)}</td><td>${row.views}</td><td>${badge(row.status)}</td></tr>`).join('')}
                  </tbody></table>`
                : '<div class="empty">暂无文章</div>'
            }
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h3>最近访问</h3><a class="small" href="#visits">全部日志 →</a></div>
          <div class="panel-body tight">
            <table class="table"><thead><tr><th>时间</th><th>页面</th><th>来源</th><th>设备</th></tr></thead><tbody>
              ${data.recentVisits.map((row) => `<tr><td class="mono">${esc(fmtDate(row.created_at))}</td><td class="mono">${esc(row.path)}</td><td>${esc(row.referrer)}</td><td>${esc(row.device)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">暂无数据</td></tr>'}
            </tbody></table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>最新留言</h3><a class="small" href="#messages">查看全部 →</a></div>
          <div class="panel-body tight">
            <table class="table"><thead><tr><th>姓名</th><th>主题</th><th>时间</th><th>状态</th></tr></thead><tbody>
              ${data.recentMessages.map((row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.subject || '-')}</td><td class="mono">${esc(fmtDate(row.created_at))}</td><td>${badge(row.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">暂无留言</td></tr>'}
            </tbody></table>
          </div>
        </div>
      </div>`;

    drawLineChart($('#trend-chart'), data.series, [
      { key: 'pv', color: '#1d4ed8', fill: 'rgba(29,78,216,0.18)' },
      { key: 'uv', color: '#06b6d4' },
    ]);

    $('[data-range]').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-days]');
      if (!btn) return;
      state.statsRange = Number(btn.dataset.days);
      renderDashboard();
    });

    refreshMessageBadge();
  }

  function badge(status) {
    const map = {
      published: ['badge-published', '已发布'],
      draft: ['badge-draft', '草稿'],
      new: ['badge-new', '未读'],
      read: ['badge-read', '已读'],
      archived: ['badge-archived', '已归档'],
    };
    const [cls, label] = map[status] || ['badge-draft', status || '-'];
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  /* ------------------------------- 文章管理 ------------------------------- */
  async function renderArticles() {
    const params = new URLSearchParams({
      page: String(state.articles.page),
      pageSize: '10',
      status: state.articles.status,
      q: state.articles.q,
    });
    const data = await api(`/api/admin/articles?${params.toString()}`);
    const content = $('#content');
    content.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" data-new-article>+ 新建文章</button>
        <select data-status-filter>
          <option value="" ${state.articles.status === '' ? 'selected' : ''}>全部状态</option>
          <option value="published" ${state.articles.status === 'published' ? 'selected' : ''}>已发布</option>
          <option value="draft" ${state.articles.status === 'draft' ? 'selected' : ''}>草稿</option>
        </select>
        <div class="spacer"></div>
        <form data-search>
          <input type="search" name="q" value="${esc(state.articles.q)}" placeholder="搜索标题或摘要…">
        </form>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>文章列表</h2><span class="sub">共 ${data.total} 篇</span></div>
        <div class="panel-body tight">
          ${
            data.items.length
              ? `<table class="table">
                  <thead><tr><th>标题</th><th>分类</th><th>状态</th><th>阅读</th><th>更新时间</th><th></th></tr></thead>
                  <tbody>${data.items
                    .map(
                      (row) => `<tr>
                        <td class="title-cell">${esc(row.title)}${row.is_featured ? ' <span class="badge badge-featured">置顶</span>' : ''}
                          <div class="small muted mono">/news/${esc(row.slug)}</div></td>
                        <td>${esc(row.category_name || '-')}</td>
                        <td>${badge(row.status)}</td>
                        <td>${row.views}</td>
                        <td class="mono">${esc(fmtDate(row.updated_at))}</td>
                        <td class="actions"><div class="row-actions">
                          <button class="btn btn-sm" data-edit-article="${row.id}">编辑</button>
                          <button class="btn btn-sm btn-danger" data-del-article="${row.id}" data-title="${esc(row.title)}">删除</button>
                        </div></td>
                      </tr>`,
                    )
                    .join('')}</tbody>
                </table>`
              : '<div class="empty">还没有文章，点击「新建文章」开始创作。</div>'
          }
        </div>
        ${paginationHtml(data, 'data-article-page')}
      </div>`;

    $('[data-new-article]').addEventListener('click', () => articleEditor(null));
    $('[data-status-filter]').addEventListener('change', (event) => {
      state.articles.status = event.target.value;
      state.articles.page = 1;
      renderArticles();
    });
    $('[data-search]').addEventListener('submit', (event) => {
      event.preventDefault();
      state.articles.q = event.target.elements.q.value.trim();
      state.articles.page = 1;
      renderArticles();
    });
    state.clickRouter = ((event) => {
      const pageBtn = event.target.closest('[data-article-page]');
      if (pageBtn && !pageBtn.disabled) {
        state.articles.page = Number(pageBtn.dataset.articlePage);
        renderArticles();
        return;
      }
      const editBtn = event.target.closest('[data-edit-article]');
      if (editBtn) articleEditor(Number(editBtn.dataset.editArticle));
      const delBtn = event.target.closest('[data-del-article]');
      if (delBtn) {
        if (!window.confirm(`确认删除文章「${delBtn.dataset.title}」？该操作不可恢复。`)) return;
        api(`/api/admin/articles/${delBtn.dataset.delArticle}`, { method: 'DELETE' })
          .then(() => {
            toast('文章已删除', 'ok');
            renderArticles();
          })
          .catch((error) => toast(error.message, 'err'));
      }
    });
  }

  async function articleEditor(id) {
    let article = { title: '', slug: '', summary: '', content: '', cover_url: '', category_id: null, status: 'draft', is_featured: 0 };
    if (id) {
      const data = await api(`/api/admin/articles/${id}`);
      article = data.article;
    }
    if (!state.categories.length) {
      try {
        state.categories = (await api('/api/admin/categories')).items;
      } catch {
        state.categories = [];
      }
    }
    const categoryOptions = ['<option value="">未分类</option>']
      .concat(
        state.categories.map(
          (c) => `<option value="${c.id}" ${Number(article.category_id) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`,
        ),
      )
      .join('');

    openModal({
      title: id ? `编辑文章 #${id}` : '新建文章',
      size: 'wide',
      body: `
        <div class="form-2">
          <label class="field"><span>文章标题 *</span><input name="title" value="${esc(article.title)}" placeholder="请输入标题"></label>
          <label class="field"><span>URL 别名 <span class="tip">留空则自动生成，建议使用英文</span></span><input name="slug" value="${esc(article.slug)}" placeholder="my-first-post"></label>
          <label class="field"><span>分类</span><select name="categoryId">${categoryOptions}</select></label>
          <label class="field"><span>状态</span><select name="status">
            <option value="draft" ${article.status === 'draft' ? 'selected' : ''}>草稿</option>
            <option value="published" ${article.status === 'published' ? 'selected' : ''}>已发布</option>
          </select></label>
          <label class="field"><span>封面图 URL</span><input name="coverUrl" value="${esc(article.cover_url)}" placeholder="https://... 可留空"></label>
          <label class="field"><span>发布时间 <span class="tip">留空则使用当前时间</span></span><input name="publishedAt" value="${esc(article.published_at || '')}" placeholder="YYYY-MM-DD HH:MM:SS"></label>
        </div>
        <label class="field checkbox" style="margin-bottom:14px">
          <input type="checkbox" name="isFeatured" ${article.is_featured ? 'checked' : ''}> <span style="margin:0">设为首页推荐（置顶）</span>
        </label>
        <label class="field"><span>摘要 <span class="tip">留空自动截取正文</span></span><textarea name="summary" rows="2">${esc(article.summary)}</textarea></label>
        <label class="field"><span>正文（支持 Markdown：# 标题、**加粗**、- 列表、&gt; 引用、\`代码\`）</span>
          <textarea name="content" rows="14" class="mono" style="min-height:280px">${esc(article.content)}</textarea>
        </label>
        <div class="panel" style="margin:0">
          <div class="panel-head"><h3>实时预览</h3><button class="btn btn-sm" type="button" data-preview>刷新预览</button></div>
          <div class="modal-body preview-box" data-preview-box style="max-height:320px"><span class="muted">点击「刷新预览」查看渲染效果</span></div>
        </div>`,
      footer: `<button class="btn" data-close type="button">取消</button><button class="btn btn-primary" data-save type="button">保存文章</button>`,
      onMount(root) {
        const preview = async () => {
          const box = $('[data-preview-box]', root);
          box.innerHTML = '<span class="muted">渲染中…</span>';
          try {
            const data = await api('/api/admin/preview', {
              method: 'POST',
              body: JSON.stringify({ content: $('[name="content"]', root).value }),
            });
            box.innerHTML = data.html || '<span class="muted">（正文为空）</span>';
          } catch (error) {
            box.innerHTML = `<span class="muted">预览失败：${esc(error.message)}</span>`;
          }
        };
        $('[data-preview]', root).addEventListener('click', preview);
        $('[data-save]', root).addEventListener('click', async () => {
          const payload = {
            title: $('[name="title"]', root).value.trim(),
            slug: $('[name="slug"]', root).value.trim(),
            summary: $('[name="summary"]', root).value.trim(),
            content: $('[name="content"]', root).value,
            coverUrl: $('[name="coverUrl"]', root).value.trim(),
            categoryId: $('[name="categoryId"]', root).value || null,
            status: $('[name="status"]', root).value,
            isFeatured: $('[name="isFeatured"]', root).checked,
            publishedAt: $('[name="publishedAt"]', root).value.trim() || null,
          };
          if (!payload.title) return toast('请填写文章标题', 'err');
          try {
            if (id) await api(`/api/admin/articles/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            else await api('/api/admin/articles', { method: 'POST', body: JSON.stringify(payload) });
            closeModal();
            toast('保存成功', 'ok');
            renderArticles();
          } catch (error) {
            toast(error.message, 'err');
          }
        });
      },
    });
  }

  /* ------------------------------- 分类管理 ------------------------------- */
  async function renderCategories() {
    const data = await api('/api/admin/categories');
    state.categories = data.items;
    $('#content').innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>新增分类</h2><span class="sub">别名用于前台筛选链接</span></div>
        <div class="panel-body">
          <form class="toolbar" data-cat-form style="margin:0">
            <input name="name" placeholder="分类名称，如 公司新闻" required>
            <input name="slug" placeholder="别名（可留空自动生成）">
            <input name="sortOrder" type="number" value="0" style="max-width:110px" placeholder="排序">
            <button class="btn btn-primary" type="submit">添加</button>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>分类列表</h2><span class="sub">共 ${data.items.length} 个</span></div>
        <div class="panel-body tight">
          <table class="table">
            <thead><tr><th>名称</th><th>别名</th><th>文章数</th><th>排序</th><th></th></tr></thead>
            <tbody>
              ${data.items
                .map(
                  (row) => `<tr>
                    <td class="title-cell">${esc(row.name)}</td>
                    <td class="mono">${esc(row.slug)}</td>
                    <td>${row.article_count}</td>
                    <td>${row.sort_order}</td>
                    <td class="actions"><div class="row-actions">
                      <button class="btn btn-sm" data-edit-cat="${row.id}">编辑</button>
                      <button class="btn btn-sm btn-danger" data-del-cat="${row.id}" data-name="${esc(row.name)}">删除</button>
                    </div></td>
                  </tr>`,
                )
                .join('') || '<tr><td colspan="5" class="empty">暂无分类</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    $('[data-cat-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      try {
        await api('/api/admin/categories', {
          method: 'POST',
          body: JSON.stringify({ name: form.elements.name.value.trim(), slug: form.elements.slug.value.trim(), sortOrder: Number(form.elements.sortOrder.value) || 0 }),
        });
        toast('分类已添加', 'ok');
        renderCategories();
      } catch (error) {
        toast(error.message, 'err');
      }
    });

    state.clickRouter = (async (event) => {
      const editBtn = event.target.closest('[data-edit-cat]');
      if (editBtn) {
        const row = state.categories.find((c) => c.id === Number(editBtn.dataset.editCat));
        openModal({
          title: `编辑分类：${row.name}`,
          size: 'narrow',
          body: `<label class="field"><span>名称</span><input name="name" value="${esc(row.name)}"></label>
                 <label class="field"><span>别名</span><input name="slug" value="${esc(row.slug)}"></label>
                 <label class="field"><span>排序</span><input name="sortOrder" type="number" value="${row.sort_order}"></label>`,
          footer: '<button class="btn" data-close type="button">取消</button><button class="btn btn-primary" data-save type="button">保存</button>',
          onMount(root) {
            $('[data-save]', root).addEventListener('click', async () => {
              try {
                await api(`/api/admin/categories/${row.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    name: $('[name="name"]', root).value.trim(),
                    slug: $('[name="slug"]', root).value.trim(),
                    sortOrder: Number($('[name="sortOrder"]', root).value) || 0,
                  }),
                });
                closeModal();
                toast('已保存', 'ok');
                renderCategories();
              } catch (error) {
                toast(error.message, 'err');
              }
            });
          },
        });
        return;
      }
      const delBtn = event.target.closest('[data-del-cat]');
      if (delBtn) {
        if (!window.confirm(`确认删除分类「${delBtn.dataset.name}」？该分类下的文章会变为未分类。`)) return;
        try {
          await api(`/api/admin/categories/${delBtn.dataset.delCat}`, { method: 'DELETE' });
          toast('已删除', 'ok');
          renderCategories();
        } catch (error) {
          toast(error.message, 'err');
        }
      }
    });
  }

  /* ------------------------------- 服务项目 ------------------------------- */
  async function renderServices() {
    const data = await api('/api/admin/services');
    $('#content').innerHTML = `
      <div class="panel">
        <div class="panel-head"><h2>新增服务</h2><span class="sub">图标可填 Emoji，如 ⚙️ 📊 🤖</span></div>
        <div class="panel-body">
          <form data-service-form>
            <div class="form-2">
              <label class="field"><span>图标</span><input name="icon" value="★" maxlength="4"></label>
              <label class="field"><span>服务名称 *</span><input name="title" placeholder="如 工业自动化集成" required></label>
              <label class="field"><span>排序（小的在前）</span><input name="sortOrder" type="number" value="0"></label>
              <label class="field checkbox" style="align-self:end"><input type="checkbox" name="visible" checked> <span style="margin:0">前台显示</span></label>
            </div>
            <label class="field"><span>服务描述</span><textarea name="description" rows="2" placeholder="一句话说明服务内容"></textarea></label>
            <button class="btn btn-primary" type="submit">添加服务</button>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>服务列表</h2><span class="sub">共 ${data.items.length} 项</span></div>
        <div class="panel-body tight">
          <table class="table">
            <thead><tr><th>图标</th><th>名称</th><th>描述</th><th>排序</th><th>显示</th><th></th></tr></thead>
            <tbody>
              ${data.items
                .map(
                  (row) => `<tr>
                    <td style="font-size:20px">${esc(row.icon)}</td>
                    <td class="title-cell">${esc(row.title)}</td>
                    <td class="muted">${esc(String(row.description || '').slice(0, 50))}</td>
                    <td>${row.sort_order}</td>
                    <td>${row.visible ? '✅' : '—'}</td>
                    <td class="actions"><div class="row-actions">
                      <button class="btn btn-sm" data-edit-service="${row.id}">编辑</button>
                      <button class="btn btn-sm btn-danger" data-del-service="${row.id}" data-name="${esc(row.title)}">删除</button>
                    </div></td>
                  </tr>`,
                )
                .join('') || '<tr><td colspan="6" class="empty">暂无服务项目</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    $('[data-service-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      try {
        await api('/api/admin/services', {
          method: 'POST',
          body: JSON.stringify({
            icon: form.elements.icon.value,
            title: form.elements.title.value.trim(),
            description: form.elements.description.value.trim(),
            sortOrder: Number(form.elements.sortOrder.value) || 0,
            visible: form.elements.visible.checked,
          }),
        });
        toast('已添加', 'ok');
        renderServices();
      } catch (error) {
        toast(error.message, 'err');
      }
    });

    state.clickRouter = (async (event) => {
      const editBtn = event.target.closest('[data-edit-service]');
      if (editBtn) {
        const row = data.items.find((item) => item.id === Number(editBtn.dataset.editService));
        openModal({
          title: `编辑服务：${row.title}`,
          body: `<div class="form-2">
              <label class="field"><span>图标</span><input name="icon" value="${esc(row.icon)}"></label>
              <label class="field"><span>名称</span><input name="title" value="${esc(row.title)}"></label>
              <label class="field"><span>排序</span><input name="sortOrder" type="number" value="${row.sort_order}"></label>
              <label class="field checkbox" style="align-self:end"><input type="checkbox" name="visible" ${row.visible ? 'checked' : ''}> <span style="margin:0">前台显示</span></label>
            </div>
            <label class="field"><span>描述</span><textarea name="description" rows="3">${esc(row.description)}</textarea></label>`,
          footer: '<button class="btn" data-close type="button">取消</button><button class="btn btn-primary" data-save type="button">保存</button>',
          onMount(root) {
            $('[data-save]', root).addEventListener('click', async () => {
              try {
                await api(`/api/admin/services/${row.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    icon: $('[name="icon"]', root).value,
                    title: $('[name="title"]', root).value.trim(),
                    description: $('[name="description"]', root).value,
                    sortOrder: Number($('[name="sortOrder"]', root).value) || 0,
                    visible: $('[name="visible"]', root).checked,
                  }),
                });
                closeModal();
                toast('已保存', 'ok');
                renderServices();
              } catch (error) {
                toast(error.message, 'err');
              }
            });
          },
        });
        return;
      }
      const delBtn = event.target.closest('[data-del-service]');
      if (delBtn) {
        if (!window.confirm(`确认删除服务「${delBtn.dataset.name}」？`)) return;
        try {
          await api(`/api/admin/services/${delBtn.dataset.delService}`, { method: 'DELETE' });
          toast('已删除', 'ok');
          renderServices();
        } catch (error) {
          toast(error.message, 'err');
        }
      }
    });
  }

  /* ------------------------------- 单页内容 ------------------------------- */
  async function renderPages() {
    const data = await api('/api/admin/pages');
    state.pages = data.items;
    $('#content').innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" data-new-page>+ 新建页面</button>
        <span class="muted small">页面可通过 /api/public/pages/别名 获取，前台已内置「关于我们」内容展示。</span>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>页面列表</h2><span class="sub">共 ${data.items.length} 个</span></div>
        <div class="panel-body tight">
          <table class="table">
            <thead><tr><th>标题</th><th>别名</th><th>更新时间</th><th></th></tr></thead>
            <tbody>
              ${data.items
                .map(
                  (row) => `<tr>
                    <td class="title-cell">${esc(row.title)}</td>
                    <td class="mono">${esc(row.slug)}</td>
                    <td class="mono">${esc(fmtDate(row.updated_at))}</td>
                    <td class="actions"><div class="row-actions">
                      <button class="btn btn-sm" data-edit-page="${row.id}">编辑内容</button>
                      <button class="btn btn-sm btn-danger" data-del-page="${row.id}" data-name="${esc(row.title)}">删除</button>
                    </div></td>
                  </tr>`,
                )
                .join('') || '<tr><td colspan="4" class="empty">暂无页面</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    $('[data-new-page]').addEventListener('click', () => pageEditor(null));
    state.clickRouter = (async (event) => {
      const editBtn = event.target.closest('[data-edit-page]');
      if (editBtn) {
        pageEditor(Number(editBtn.dataset.editPage));
        return;
      }
      const delBtn = event.target.closest('[data-del-page]');
      if (delBtn) {
        if (!window.confirm(`确认删除页面「${delBtn.dataset.name}」？`)) return;
        try {
          await api(`/api/admin/pages/${delBtn.dataset.delPage}`, { method: 'DELETE' });
          toast('已删除', 'ok');
          renderPages();
        } catch (error) {
          toast(error.message, 'err');
        }
      }
    });
  }

  async function pageEditor(id) {
    let page = { title: '', slug: '', content: '' };
    if (id) page = (await api(`/api/admin/pages/${id}`)).page;
    openModal({
      title: id ? `编辑页面：${page.title}` : '新建页面',
      body: `
        <div class="form-2">
          <label class="field"><span>页面标题 *</span><input name="title" value="${esc(page.title)}"></label>
          <label class="field"><span>别名（slug）</span><input name="slug" value="${esc(page.slug)}" placeholder="about"></label>
        </div>
        <label class="field"><span>内容（Markdown）</span><textarea name="content" rows="16" class="mono" style="min-height:300px">${esc(page.content)}</textarea></label>
        <div class="panel" style="margin:0">
          <div class="panel-head"><h3>预览</h3><button class="btn btn-sm" type="button" data-preview>刷新预览</button></div>
          <div class="modal-body preview-box" data-preview-box style="max-height:280px"><span class="muted">点击「刷新预览」查看效果</span></div>
        </div>`,
      footer: '<button class="btn" data-close type="button">取消</button><button class="btn btn-primary" data-save type="button">保存</button>',
      onMount(root) {
        $('[data-preview]', root).addEventListener('click', async () => {
          const box = $('[data-preview-box]', root);
          try {
            const data = await api('/api/admin/preview', {
              method: 'POST',
              body: JSON.stringify({ content: $('[name="content"]', root).value }),
            });
            box.innerHTML = data.html || '<span class="muted">（内容为空）</span>';
          } catch (error) {
            box.innerHTML = esc(error.message);
          }
        });
        $('[data-save]', root).addEventListener('click', async () => {
          const payload = {
            title: $('[name="title"]', root).value.trim(),
            slug: $('[name="slug"]', root).value.trim(),
            content: $('[name="content"]', root).value,
          };
          if (!payload.title) return toast('请填写标题', 'err');
          try {
            if (id) await api(`/api/admin/pages/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            else await api('/api/admin/pages', { method: 'POST', body: JSON.stringify(payload) });
            closeModal();
            toast('已保存', 'ok');
            renderPages();
          } catch (error) {
            toast(error.message, 'err');
          }
        });
      },
    });
  }

  /* ------------------------------- 留言管理 ------------------------------- */
  async function renderMessages() {
    const params = new URLSearchParams({ page: String(state.messages.page), pageSize: '20', status: state.messages.status });
    const data = await api(`/api/admin/messages?${params.toString()}`);
    $('#content').innerHTML = `
      <div class="toolbar">
        <div class="tabs" data-msg-filter style="margin:0">
          ${[
            ['', '全部'],
            ['new', '未读'],
            ['read', '已读'],
            ['archived', '已归档'],
          ]
            .map(([value, label]) => `<button data-status="${value}" class="${state.messages.status === value ? 'active' : ''}">${label}</button>`)
            .join('')}
        </div>
        <div class="spacer"></div>
        <span class="muted small">共 ${data.total} 条</span>
      </div>
      <div class="panel">
        <div class="panel-body tight">
          ${
            data.items.length
              ? `<table class="table">
                  <thead><tr><th>姓名</th><th>联系方式</th><th>主题 / 内容</th><th>时间</th><th>状态</th><th></th></tr></thead>
                  <tbody>${data.items
                    .map(
                      (row) => `<tr>
                        <td class="title-cell">${esc(row.name)}</td>
                        <td class="small">${esc(row.phone || '-')}<br>${esc(row.email || '')}</td>
                        <td>${esc(row.subject || '(无主题)')}<div class="small muted">${esc(String(row.content || '').slice(0, 40))}…</div></td>
                        <td class="mono small">${esc(fmtDate(row.created_at))}</td>
                        <td>${badge(row.status)}</td>
                        <td class="actions"><div class="row-actions">
                          <button class="btn btn-sm" data-view-msg="${row.id}">查看</button>
                          <button class="btn btn-sm btn-danger" data-del-msg="${row.id}">删除</button>
                        </div></td>
                      </tr>`,
                    )
                    .join('')}</tbody>
                </table>`
              : '<div class="empty">暂无留言</div>'
          }
        </div>
        ${paginationHtml(data, 'data-msg-page')}
      </div>`;

    $('[data-msg-filter]').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-status]');
      if (!btn) return;
      state.messages.status = btn.dataset.status;
      state.messages.page = 1;
      renderMessages();
    });

    state.clickRouter = (async (event) => {
      const pageBtn = event.target.closest('[data-msg-page]');
      if (pageBtn && !pageBtn.disabled) {
        state.messages.page = Number(pageBtn.dataset.msgPage);
        renderMessages();
        return;
      }
      const viewBtn = event.target.closest('[data-view-msg]');
      if (viewBtn) {
        const row = data.items.find((item) => item.id === Number(viewBtn.dataset.viewMsg));
        openModal({
          title: `留言详情 #${row.id}`,
          body: `<table class="table">
              <tr><th style="width:110px">姓名</th><td>${esc(row.name)}</td></tr>
              <tr><th>电话</th><td>${esc(row.phone || '-')}</td></tr>
              <tr><th>邮箱</th><td>${esc(row.email || '-')}</td></tr>
              <tr><th>主题</th><td>${esc(row.subject || '-')}</td></tr>
              <tr><th>提交时间</th><td class="mono">${esc(fmtDate(row.created_at))}</td></tr>
              <tr><th>来源 IP（哈希）</th><td class="mono small">${esc(row.ip_hash || '-')}</td></tr>
            </table>
            <h3 style="margin-top:16px">留言内容</h3>
            <div class="preview-box" style="white-space:pre-wrap">${esc(row.content)}</div>`,
          footer: `<button class="btn btn-danger" data-archive type="button">标记归档</button>
                   <button class="btn" data-mark-read type="button">标记已读</button>
                   <button class="btn btn-primary" data-close type="button">关闭</button>`,
          onMount(root) {
            const update = async (status) => {
              try {
                await api(`/api/admin/messages/${row.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
                closeModal();
                toast('已更新', 'ok');
                renderMessages();
              } catch (error) {
                toast(error.message, 'err');
              }
            };
            $('[data-mark-read]', root).addEventListener('click', () => update('read'));
            $('[data-archive]', root).addEventListener('click', () => update('archived'));
          },
        });
        if (row.status === 'new') {
          api(`/api/admin/messages/${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'read' }) })
            .then(() => refreshMessageBadge())
            .catch(() => {});
        }
        return;
      }
      const delBtn = event.target.closest('[data-del-msg]');
      if (delBtn) {
        if (!window.confirm('确认删除这条留言？')) return;
        try {
          await api(`/api/admin/messages/${delBtn.dataset.delMsg}`, { method: 'DELETE' });
          toast('已删除', 'ok');
          renderMessages();
        } catch (error) {
          toast(error.message, 'err');
        }
      }
    });
  }

  /* ------------------------------- 访问日志 ------------------------------- */
  async function renderVisits() {
    const params = new URLSearchParams({ page: String(state.visits.page), pageSize: '30', day: state.visits.day });
    const data = await api(`/api/admin/visits?${params.toString()}`);
    $('#content').innerHTML = `
      <div class="toolbar">
        <input type="date" value="${esc(state.visits.day)}" data-day-filter style="width:auto">
        <button class="btn" data-day-clear>全部日期</button>
        <div class="spacer"></div>
        <button class="btn btn-danger" data-clean-visits>清理 180 天前数据</button>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>访问明细</h2><span class="sub">共 ${data.total} 条记录</span></div>
        <div class="panel-body tight">
          ${
            data.items.length
              ? `<table class="table">
                  <thead><tr><th>时间</th><th>页面</th><th>来源</th><th>设备</th><th>浏览器</th><th>系统</th><th>地区</th></tr></thead>
                  <tbody>${data.items
                    .map(
                      (row) => `<tr>
                        <td class="mono small">${esc(fmtDate(row.created_at))}</td>
                        <td class="mono small">${esc(row.path)}</td>
                        <td class="small">${esc(row.referrer)}</td>
                        <td class="small">${esc(row.device)}</td>
                        <td class="small">${esc(row.browser)}</td>
                        <td class="small">${esc(row.os)}</td>
                        <td class="small">${esc(row.country || '-')}</td>
                      </tr>`,
                    )
                    .join('')}</tbody>
                </table>`
              : '<div class="empty">暂无访问数据</div>'
          }
        </div>
        ${paginationHtml(data, 'data-visit-page')}
      </div>`;

    $('[data-day-filter]').addEventListener('change', (event) => {
      state.visits.day = event.target.value;
      state.visits.page = 1;
      renderVisits();
    });
    $('[data-day-clear]').addEventListener('click', () => {
      state.visits.day = '';
      state.visits.page = 1;
      renderVisits();
    });
    $('[data-clean-visits]').addEventListener('click', async () => {
      if (!window.confirm('确认删除 180 天以前的访问记录？该操作不可恢复。')) return;
      const before = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
      try {
        await api('/api/admin/visits', { method: 'DELETE', body: JSON.stringify({ before }) });
        toast('清理完成', 'ok');
        renderVisits();
      } catch (error) {
        toast(error.message, 'err');
      }
    });
    state.clickRouter = ((event) => {
      const pageBtn = event.target.closest('[data-visit-page]');
      if (pageBtn && !pageBtn.disabled) {
        state.visits.page = Number(pageBtn.dataset.visitPage);
        renderVisits();
      }
    });
  }

  /* ------------------------------- 站点设置 ------------------------------- */
  async function renderSettings() {
    const data = await api('/api/admin/settings');
    state.settings = data.settings || {};
    const field = ([key, label, type]) => {
      const value = state.settings[key] ?? '';
      if (type === 'textarea') {
        return `<label class="field"><span>${esc(label)}</span><textarea name="${key}" rows="3">${esc(value)}</textarea></label>`;
      }
      if (type && type.startsWith('select:')) {
        const options = type
          .slice(7)
          .split(',')
          .map((pair) => {
            const [v, t] = pair.split('=');
            return `<option value="${esc(v)}" ${String(value) === v ? 'selected' : ''}>${esc(t)}</option>`;
          })
          .join('');
        return `<label class="field"><span>${esc(label)}</span><select name="${key}">${options}</select></label>`;
      }
      return `<label class="field"><span>${esc(label)}</span><input name="${key}" value="${esc(value)}">${
        type && !type.startsWith('select:') ? `<span class="small muted">${esc(type)}</span>` : ''
      }</label>`;
    };

    $('#content').innerHTML = `
      <form data-settings-form>
        ${SETTING_GROUPS.map(
          (group) => `<div class="panel">
            <div class="panel-head"><h2>${esc(group.title)}</h2></div>
            <div class="panel-body"><div class="form-2">${group.fields.map(field).join('')}</div></div>
          </div>`,
        ).join('')}
        <div class="panel"><div class="panel-body" style="display:flex;gap:12px;align-items:center">
          <button class="btn btn-primary" type="submit">保存全部设置</button>
          <span class="muted small">保存后前台页面刷新即可看到最新内容（静态页面由接口动态填充）。</span>
        </div></div>
      </form>`;

    $('[data-settings-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const payload = {};
      Array.from(form.elements).forEach((el) => {
        if (el.name) payload[el.name] = el.value;
      });
      try {
        await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ settings: payload }) });
        state.settings = { ...state.settings, ...payload };
        $('[data-site-name]').textContent = state.settings.site_name || '公司官网';
        toast('设置已保存', 'ok');
      } catch (error) {
        toast(error.message, 'err');
      }
    });
  }

  /* ------------------------------- 账号安全 ------------------------------- */
  async function renderAccount() {
    const data = await api('/api/admin/users');
    $('#content').innerHTML = `
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h2>修改我的密码</h2></div>
          <div class="panel-body">
            <form data-password-form>
              <label class="field"><span>原密码</span><input type="password" name="oldPassword" required autocomplete="current-password"></label>
              <label class="field"><span>新密码（至少 8 位）</span><input type="password" name="newPassword" required minlength="8" autocomplete="new-password"></label>
              <label class="field"><span>确认新密码</span><input type="password" name="confirmPassword" required minlength="8" autocomplete="new-password"></label>
              <button class="btn btn-primary" type="submit">修改密码</button>
              <p class="small muted" style="margin-top:10px">修改成功后所有会话会失效，需要重新登录。</p>
            </form>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>管理员账号</h2><button class="btn btn-sm btn-primary" data-add-user>+ 新增管理员</button></div>
          <div class="panel-body tight">
            <table class="table">
              <thead><tr><th>用户名</th><th>显示名</th><th>最近登录</th><th></th></tr></thead>
              <tbody>${data.items
                .map(
                  (row) => `<tr>
                    <td class="title-cell">${esc(row.username)}</td>
                    <td>${esc(row.display_name || '-')}</td>
                    <td class="mono small">${esc(fmtDate(row.last_login_at))}</td>
                    <td class="actions"><div class="row-actions">
                      <button class="btn btn-sm" data-reset-user="${row.id}" data-name="${esc(row.username)}">重置密码</button>
                      ${state.user && row.id === state.user.id ? '' : `<button class="btn btn-sm btn-danger" data-del-user="${row.id}" data-name="${esc(row.username)}">删除</button>`}
                    </div></td>
                  </tr>`,
                )
                .join('')}</tbody>
            </table>
          </div>
        </div>
      </div>`;

    $('[data-password-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      if (form.elements.newPassword.value !== form.elements.confirmPassword.value) return toast('两次输入的新密码不一致', 'err');
      try {
        await api('/api/auth/password', {
          method: 'POST',
          body: JSON.stringify({ oldPassword: form.elements.oldPassword.value, newPassword: form.elements.newPassword.value }),
        });
        toast('密码已修改，请重新登录', 'ok');
        setTimeout(() => showLogin(), 800);
      } catch (error) {
        toast(error.message, 'err');
      }
    });

    $('[data-add-user]').addEventListener('click', () => {
      openModal({
        title: '新增管理员',
        size: 'narrow',
        body: `<label class="field"><span>用户名</span><input name="username" placeholder="字母、数字、下划线"></label>
               <label class="field"><span>显示名</span><input name="displayName" placeholder="可选"></label>
               <label class="field"><span>初始密码（至少 8 位）</span><input name="password" type="password"></label>`,
        footer: '<button class="btn" data-close type="button">取消</button><button class="btn btn-primary" data-save type="button">创建</button>',
        onMount(root) {
          $('[data-save]', root).addEventListener('click', async () => {
            try {
              await api('/api/admin/users', {
                method: 'POST',
                body: JSON.stringify({
                  username: $('[name="username"]', root).value.trim(),
                  displayName: $('[name="displayName"]', root).value.trim(),
                  password: $('[name="password"]', root).value,
                }),
              });
              closeModal();
              toast('管理员已创建', 'ok');
              renderAccount();
            } catch (error) {
              toast(error.message, 'err');
            }
          });
        },
      });
    });

    state.clickRouter = (async (event) => {
      const resetBtn = event.target.closest('[data-reset-user]');
      if (resetBtn) {
        openModal({
          title: `重置密码：${resetBtn.dataset.name}`,
          size: 'narrow',
          body: '<label class="field"><span>新密码（至少 8 位）</span><input name="password" type="password"></label>',
          footer: '<button class="btn" data-close type="button">取消</button><button class="btn btn-primary" data-save type="button">重置</button>',
          onMount(root) {
            $('[data-save]', root).addEventListener('click', async () => {
              try {
                await api(`/api/admin/users/${resetBtn.dataset.resetUser}/password`, {
                  method: 'PUT',
                  body: JSON.stringify({ password: $('[name="password"]', root).value }),
                });
                closeModal();
                toast('密码已重置', 'ok');
              } catch (error) {
                toast(error.message, 'err');
              }
            });
          },
        });
        return;
      }
      const delBtn = event.target.closest('[data-del-user]');
      if (delBtn) {
        if (!window.confirm(`确认删除管理员「${delBtn.dataset.name}」？`)) return;
        try {
          await api(`/api/admin/users/${delBtn.dataset.delUser}`, { method: 'DELETE' });
          toast('已删除', 'ok');
          renderAccount();
        } catch (error) {
          toast(error.message, 'err');
        }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
