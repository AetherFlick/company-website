/**
 * 服务端 HTML 渲染：文章详情页、sitemap、404 页面。
 * 由 Cloudflare Pages Functions 与本地开发服务器共用，便于搜索引擎抓取。
 */
import { escapeHtml } from './util.js';
import { renderMarkdown } from './markdown.js';
import { getSettings } from './store.js';

const NAV = [
  { href: '/', label: '首页' },
  { href: '/about.html', label: '关于我们' },
  { href: '/services.html', label: '服务项目' },
  { href: '/news.html', label: '新闻中心' },
  { href: '/contact.html', label: '联系我们' },
];

function navHtml(current) {
  return NAV.map(
    (item) =>
      `<a href="${item.href}"${item.href === current ? ' class="active"' : ''}>${item.label}</a>`,
  ).join('');
}

export function layout({ settings = {}, title, description, canonical, content, extraHead = '', current = '' }) {
  const siteName = settings.site_short || settings.site_name || '公司官网';
  const fullTitle = title ? `${title} - ${siteName}` : settings.seo_title || settings.site_name || siteName;
  const desc = description || settings.site_description || '';
  const icp = settings.icp
    ? `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">${escapeHtml(settings.icp)}</a>`
    : '';
  const police = settings.police ? `<span class="footer-police">${escapeHtml(settings.police)}</span>` : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta name="keywords" content="${escapeHtml(settings.site_keywords || '')}">
${canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ''}
<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:type" content="website">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/style.css">
${extraHead}
</head>
<body>
<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="/">
      <span class="brand-mark">${escapeHtml((siteName || 'C').slice(0, 1))}</span>
      <span class="brand-text">${escapeHtml(settings.site_name || siteName)}</span>
    </a>
    <button class="nav-toggle" type="button" aria-label="展开导航">☰</button>
    <nav class="site-nav">${navHtml(current)}</nav>
  </div>
</header>
<main>${content}</main>
<footer class="site-footer">
  <div class="container footer-grid">
    <div>
      <h4>${escapeHtml(settings.site_name || siteName)}</h4>
      <p>${escapeHtml(settings.company_intro || settings.site_description || '')}</p>
    </div>
    <div>
      <h4>联系方式</h4>
      <p>电话：${escapeHtml(settings.phone || '-')}</p>
      <p>邮箱：${escapeHtml(settings.email || '-')}</p>
      <p>地址：${escapeHtml(settings.address || '-')}</p>
    </div>
    <div>
      <h4>快捷入口</h4>
      <p><a href="/news.html">新闻中心</a></p>
      <p><a href="/contact.html">在线留言</a></p>
      <p><a href="/admin/">管理后台</a></p>
    </div>
  </div>
  <div class="container footer-bottom">
    <span>${escapeHtml(settings.copyright || '')}</span>
    <span class="footer-licenses">${icp}${police}</span>
  </div>
</footer>
<script src="/assets/js/site.js" defer></script>
</body>
</html>`;
}

export async function articlePage(env, slug) {
  const settings = await getSettings(env);
  const row = await env.DB.prepare(
    `SELECT a.*, c.name AS category_name, c.slug AS category_slug
       FROM articles a LEFT JOIN categories c ON c.id = a.category_id
      WHERE a.slug = ? AND a.status = 'published'`,
  )
    .bind(slug)
    .first();

  if (!row) {
    return {
      status: 404,
      html: layout({
        settings,
        title: '文章不存在',
        content: `<section class="section"><div class="container prose">
          <h1>文章不存在或已下线</h1>
          <p>您访问的内容可能已被删除，<a href="/news.html">返回新闻中心</a>。</p>
        </div></section>`,
      }),
    };
  }

  const prev = await env.DB.prepare(
    `SELECT title, slug FROM articles WHERE status='published'
       AND (published_at < ? OR (published_at = ? AND id < ?))
      ORDER BY published_at DESC LIMIT 1`,
  )
    .bind(row.published_at, row.published_at, row.id)
    .first();
  const next = await env.DB.prepare(
    `SELECT title, slug FROM articles WHERE status='published'
       AND (published_at > ? OR (published_at = ? AND id > ?))
      ORDER BY published_at ASC LIMIT 1`,
  )
    .bind(row.published_at, row.published_at, row.id)
    .first();

  const date = String(row.published_at || row.created_at || '').slice(0, 10);
  const cover = row.cover_url
    ? `<img class="article-cover" src="${escapeHtml(row.cover_url)}" alt="${escapeHtml(row.title)}">`
    : '';

  const content = `
<section class="section">
  <div class="container article-layout">
    <article class="prose">
      <nav class="breadcrumb"><a href="/">首页</a> / <a href="/news.html">新闻中心</a> / <span>正文</span></nav>
      <h1>${escapeHtml(row.title)}</h1>
      <div class="article-meta">
        <span>${escapeHtml(date)}</span>
        ${row.category_name ? `<span>${escapeHtml(row.category_name)}</span>` : ''}
        <span>阅读 ${Number(row.views || 0)}</span>
      </div>
      ${cover}
      ${renderMarkdown(row.content)}
      <div class="article-nav">
        <div>${prev ? `上一篇：<a href="/news/${encodeURIComponent(prev.slug)}">${escapeHtml(prev.title)}</a>` : '上一篇：没有了'}</div>
        <div>${next ? `下一篇：<a href="/news/${encodeURIComponent(next.slug)}">${escapeHtml(next.title)}</a>` : '下一篇：没有了'}</div>
      </div>
    </article>
    <aside class="article-aside">
      <div class="card">
        <h3>需要方案与报价？</h3>
        <p>我们的工程师会在 1 个工作日内与您联系。</p>
        <p class="aside-contact">${escapeHtml(settings.phone || '')}</p>
        <a class="btn btn-primary" href="/contact.html">在线留言</a>
      </div>
    </aside>
  </div>
</section>`;

  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: row.title,
    datePublished: date,
    description: row.summary || '',
    author: { '@type': 'Organization', name: settings.site_name || '' },
  })}</script>`;

  return {
    status: 200,
    html: layout({
      settings,
      title: row.title,
      description: row.summary || '',
      canonical: `/news/${encodeURIComponent(row.slug)}`,
      content,
      current: '/news.html',
      extraHead: jsonLd,
    }),
  };
}

export async function sitemapXml(env) {
  const settings = await getSettings(env);
  const base = (settings.site_url || env.SITE_URL || '').replace(/\/$/, '');
  const { results } = await env.DB.prepare(
    "SELECT slug, updated_at FROM articles WHERE status = 'published' ORDER BY published_at DESC LIMIT 500",
  ).all();
  const staticPages = ['/', '/about.html', '/services.html', '/news.html', '/contact.html'];
  const urls = [
    ...staticPages.map((p) => ({ loc: `${base}${p}`, lastmod: new Date().toISOString().slice(0, 10) })),
    ...(results || []).map((row) => ({
      loc: `${base}/news/${encodeURIComponent(row.slug)}`,
      lastmod: String(row.updated_at || '').slice(0, 10),
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>`;
}

export async function notFoundPage(env) {
  const settings = await getSettings(env);
  return layout({
    settings,
    title: '页面不存在',
    content: `<section class="section"><div class="container prose">
      <h1>404 · 页面不存在</h1>
      <p>您访问的页面已被移除或从未存在，<a href="/">返回首页</a>。</p>
    </div></section>`,
  });
}
