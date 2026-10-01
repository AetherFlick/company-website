/* ==========================================================================
   前台脚本：站点配置注入、访问统计、文章列表与留言表单
   无第三方依赖，全部使用原生 API
   ========================================================================== */
(function () {
  'use strict';

  const page = document.body.dataset.page || 'home';
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* 忽略隐私模式下的异常 */
      }
    },
    session(key, fallback) {
      try {
        const v = sessionStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    setSession(key, value) {
      try {
        sessionStorage.setItem(key, value);
      } catch {
        /* ignore */
      }
    },
  };

  const escapeHtml = (value) =>
    String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  async function api(path, options) {
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
    if (!res.ok || !payload || payload.ok === false) {
      throw new Error((payload && payload.error) || `请求失败(${res.status})`);
    }
    return payload.data;
  }

  /* ----------------------------- 站点配置注入 ----------------------------- */
  function applySettings(settings) {
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const key = el.dataset.setting;
      if (settings[key]) el.textContent = settings[key];
    });
    const initial = document.querySelector('[data-setting-initial]');
    if (initial && settings.site_short) initial.textContent = settings.site_short.slice(0, 1);
    const tel = document.querySelector('[data-setting-href="tel"]');
    if (tel && settings.phone) {
      tel.textContent = settings.phone;
      tel.setAttribute('href', `tel:${settings.phone.replace(/[^\d+]/g, '')}`);
    }
    if (settings.seo_title) document.title = document.title.includes(' - ') ? document.title : settings.seo_title;
  }

  function renderServices(services) {
    const box = document.querySelector('[data-services]');
    if (!box || !services.length) return;
    box.innerHTML = services
      .map(
        (s) => `<div class="card service-card">
        <div class="service-icon">${escapeHtml(s.icon || '★')}</div>
        <h3>${escapeHtml(s.title)}</h3>
        <p>${escapeHtml(s.description || '')}</p>
      </div>`,
      )
      .join('');
  }

  function newsCard(item) {
    const thumb = item.coverUrl
      ? `<img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)}" loading="lazy">`
      : `<span>${escapeHtml((item.category && item.category.name) || '资讯')}</span>`;
    const date = String(item.publishedAt || '').slice(0, 10);
    return `<article class="news-item">
      <a class="news-thumb" href="/news/${encodeURIComponent(item.slug)}" aria-hidden="true">${thumb}</a>
      <div class="news-body">
        <h3><a href="/news/${encodeURIComponent(item.slug)}">${escapeHtml(item.title)}</a></h3>
        <p class="news-summary">${escapeHtml(item.summary || '')}</p>
        <div class="news-meta">
          ${item.category ? `<span class="tag">${escapeHtml(item.category.name)}</span>` : ''}
          <span>${escapeHtml(date)}</span>
          <span>阅读 ${Number(item.views || 0)}</span>
        </div>
      </div>
    </article>`;
  }

  async function renderLatestNews() {
    const box = document.querySelector('[data-latest-news]');
    if (!box) return;
    try {
      const data = await api('/api/public/articles?pageSize=3');
      box.innerHTML = data.items.length
        ? data.items.map(newsCard).join('')
        : '<div class="card">暂无文章，请登录后台发布。</div>';
    } catch (error) {
      box.innerHTML = `<div class="card">文章加载失败：${escapeHtml(error.message)}</div>`;
    }
  }

  /* ------------------------------ 新闻列表页 ------------------------------ */
  const newsState = { page: 1, category: '', q: '' };

  async function renderNewsPage() {
    const list = document.querySelector('[data-news-list]');
    if (!list) return;
    const params = new URLSearchParams({ page: String(newsState.page), pageSize: '6' });
    if (newsState.category) params.set('category', newsState.category);
    if (newsState.q) params.set('q', newsState.q);

    list.innerHTML = '<div class="card">正在加载文章…</div>';
    try {
      const [data, cats] = await Promise.all([
        api(`/api/public/articles?${params.toString()}`),
        api('/api/public/categories'),
      ]);

      list.innerHTML = data.items.length
        ? data.items.map(newsCard).join('')
        : '<div class="card">没有找到匹配的文章，试试其它关键词。</div>';

      const chips = document.querySelector('[data-category-chips]');
      if (chips) {
        chips.innerHTML = ['']
          .concat(cats.items.map((c) => c.slug))
          .map((slug, index) => {
            const label = index === 0 ? '全部' : cats.items[index - 1].name;
            const count = index === 0 ? '' : ` (${cats.items[index - 1].count})`;
            return `<a class="chip${newsState.category === slug ? ' active' : ''}" href="#" data-category="${escapeHtml(slug)}">${escapeHtml(label)}${count}</a>`;
          })
          .join('');
      }

      const pager = document.querySelector('[data-pagination]');
      if (pager) {
        if (data.totalPages <= 1) {
          pager.innerHTML = '';
        } else {
          let html = `<button data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>上一页</button>`;
          for (let i = 1; i <= data.totalPages; i += 1) {
            html += `<button data-page="${i}" class="${i === data.page ? 'active' : ''}">${i}</button>`;
          }
          html += `<button data-page="${data.page + 1}" ${data.page >= data.totalPages ? 'disabled' : ''}>下一页</button>`;
          pager.innerHTML = html;
        }
      }
    } catch (error) {
      list.innerHTML = `<div class="card">加载失败：${escapeHtml(error.message)}</div>`;
    }
  }

  function bindNewsPage() {
    const chips = document.querySelector('[data-category-chips]');
    if (chips) {
      chips.addEventListener('click', (event) => {
        const target = event.target.closest('[data-category]');
        if (!target) return;
        event.preventDefault();
        newsState.category = target.dataset.category;
        newsState.page = 1;
        renderNewsPage();
      });
    }
    const pager = document.querySelector('[data-pagination]');
    if (pager) {
      pager.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-page]');
        if (!btn || btn.disabled) return;
        newsState.page = Number(btn.dataset.page) || 1;
        renderNewsPage();
        window.scrollTo({ top: 220, behavior: 'smooth' });
      });
    }
    const form = document.querySelector('[data-search-form]');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        newsState.q = form.elements.q.value.trim();
        newsState.page = 1;
        renderNewsPage();
      });
    }
    const initialQ = new URLSearchParams(location.search).get('q');
    if (initialQ) {
      newsState.q = initialQ;
      if (form) form.elements.q.value = initialQ;
    }
    renderNewsPage();
  }

  /* ------------------------------- 单页内容 ------------------------------- */
  async function renderPageContent(slug) {
    const box = document.querySelector('[data-page-content]');
    if (!box) return;
    try {
      const data = await api(`/api/public/pages/${encodeURIComponent(slug)}`);
      box.innerHTML = data.page.html;
      const title = document.querySelector('[data-page-title]');
      if (title && data.page.title) title.textContent = data.page.title;
    } catch (error) {
      box.innerHTML = `<p>内容加载失败：${escapeHtml(error.message)}</p>`;
    }
  }

  /* ------------------------------- 留言表单 ------------------------------- */
  function bindContactForm() {
    const form = document.querySelector('[data-contact-form]');
    if (!form) return;
    const result = document.querySelector('[data-form-result]');
    const button = form.querySelector('[data-submit]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        name: form.elements.name.value.trim(),
        phone: form.elements.phone.value.trim(),
        email: form.elements.email.value.trim(),
        subject: form.elements.subject.value.trim(),
        content: form.elements.content.value.trim(),
        company: form.elements.company.value,
      };
      if (!payload.name) return showResult('请填写您的姓名', false);
      if (!payload.content) return showResult('请填写需求描述', false);
      if (!payload.email && !payload.phone) return showResult('请至少填写邮箱或联系电话', false);

      button.disabled = true;
      button.textContent = '提交中…';
      try {
        await api('/api/public/contact', { method: 'POST', body: JSON.stringify(payload) });
        form.reset();
        showResult('提交成功！我们会尽快与您联系。', true);
      } catch (error) {
        showResult(error.message, false);
      } finally {
        button.disabled = false;
        button.textContent = '提交留言';
      }
    });

    function showResult(message, success) {
      if (!result) return;
      result.innerHTML = `<div class="alert ${success ? 'alert-ok' : 'alert-err'}">${escapeHtml(message)}</div>`;
    }
  }

  /* ------------------------------- 访问统计 ------------------------------- */
  function trackPageview(settings) {
    if (settings && settings.analytics_enabled === '0') return;
    let visitorId = store.get('sc_visitor_id', '');
    if (!visitorId) {
      visitorId = `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      store.set('sc_visitor_id', visitorId);
    }
    let sessionId = store.session('sc_session_id', '');
    if (!sessionId) {
      sessionId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      store.setSession('sc_session_id', sessionId);
    }
    const payload = JSON.stringify({
      path: location.pathname + (location.pathname === '/news.html' ? location.search : ''),
      referrer: document.referrer || '',
      visitorId,
      sessionId,
    });
    const send = () => {
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true });
        }
      } catch {
        /* 统计失败不影响页面 */
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(send, { timeout: 2000 });
    else setTimeout(send, 400);
  }

  /* --------------------------------- 启动 --------------------------------- */
  function bindNav() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.querySelector('.site-nav');
    if (toggle && nav) {
      toggle.addEventListener('click', () => nav.classList.toggle('open'));
    }
  }

  async function boot() {
    bindNav();
    bindContactForm();
    if (page === 'news') bindNewsPage();

    let settings = null;
    try {
      const data = await api('/api/public/bootstrap');
      settings = data.settings;
      applySettings(settings);
      renderServices(data.services || []);
    } catch (error) {
      console.warn('站点配置加载失败：', error.message);
    }

    if (page === 'home') renderLatestNews();
    if (page === 'about') renderPageContent('about');
    trackPageview(settings);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
