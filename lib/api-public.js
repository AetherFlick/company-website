/**
 * 前台公开接口：站点配置、文章、分类、服务、单页、留言、访问埋点。
 */
import {
  ok,
  fail,
  readJson,
  clientIp,
  hashIp,
  todaySql,
  parseUserAgent,
  isBot,
  referrerHost,
  truncate,
  toInt,
} from './util.js';
import { getSettings, publicSettings, pagination } from './store.js';
import { renderMarkdown, markdownToText } from './markdown.js';

const MAX_MESSAGE_PER_HOUR = 5;

function articleListItem(row) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    coverUrl: row.cover_url,
    views: row.views,
    isFeatured: !!row.is_featured,
    publishedAt: row.published_at || row.created_at,
    category: row.category_name ? { name: row.category_name, slug: row.category_slug } : null,
  };
}

export function registerPublicRoutes(r) {
  /* ---------------------------- 站点初始化数据 ---------------------------- */
  r.get('public/bootstrap', async ({ env }) => {
    const settings = await getSettings(env);
    const { results: categories } = await env.DB.prepare(
      'SELECT id, name, slug FROM categories ORDER BY sort_order ASC, id ASC',
    ).all();
    const { results: services } = await env.DB.prepare(
      'SELECT id, icon, title, description FROM services WHERE visible = 1 ORDER BY sort_order ASC, id ASC',
    ).all();
    return ok({ settings: publicSettings(settings), categories: categories || [], services: services || [] });
  });

  /* -------------------------------- 文章列表 -------------------------------- */
  r.get('public/articles', async ({ env, query }) => {
    const { page, pageSize, offset } = pagination(query, 6, 50);
    const category = (query.get('category') || '').trim();
    const keyword = (query.get('q') || '').trim();
    const featured = query.get('featured') === '1';
    const like = `%${keyword}%`;

    const where = `WHERE a.status = 'published'
        AND (? = '' OR c.slug = ?)
        AND (? = '' OR a.title LIKE ? OR a.summary LIKE ? OR a.content LIKE ?)
        AND (? = 0 OR a.is_featured = 1)`;
    const params = [category, category, keyword, like, like, like, featured ? 1 : 0];

    const totalRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM articles a LEFT JOIN categories c ON c.id = a.category_id ${where}`,
    )
      .bind(...params)
      .first();

    const { results } = await env.DB.prepare(
      `SELECT a.id, a.title, a.slug, a.summary, a.cover_url, a.views, a.is_featured, a.published_at, a.created_at,
              c.name AS category_name, c.slug AS category_slug
         FROM articles a LEFT JOIN categories c ON c.id = a.category_id
         ${where}
         ORDER BY (a.published_at IS NULL), a.published_at DESC, a.id DESC
         LIMIT ? OFFSET ?`,
    )
      .bind(...params, pageSize, offset)
      .all();

    return ok({
      items: (results || []).map(articleListItem),
      page,
      pageSize,
      total: Number(totalRow?.c || 0),
      totalPages: Math.max(1, Math.ceil(Number(totalRow?.c || 0) / pageSize)),
    });
  });

  /* -------------------------------- 文章详情 -------------------------------- */
  r.get('public/articles/:slug', async ({ env, params }) => {
    const row = await env.DB.prepare(
      `SELECT a.*, c.name AS category_name, c.slug AS category_slug
         FROM articles a LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.slug = ? AND a.status = 'published'`,
    )
      .bind(params.slug)
      .first();
    if (!row) return fail('文章不存在', 404);

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

    return ok({
      article: {
        ...articleListItem(row),
        content: row.content,
        html: renderMarkdown(row.content),
        author: row.author,
        updatedAt: row.updated_at,
      },
      prev: prev || null,
      next: next || null,
    });
  });

  /* --------------------------------- 分类 --------------------------------- */
  r.get('public/categories', async ({ env }) => {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.name, c.slug,
              (SELECT COUNT(*) FROM articles a WHERE a.category_id = c.id AND a.status='published') AS count
         FROM categories c ORDER BY c.sort_order ASC, c.id ASC`,
    ).all();
    return ok({ items: results || [] });
  });

  /* --------------------------------- 服务 --------------------------------- */
  r.get('public/services', async ({ env }) => {
    const { results } = await env.DB.prepare(
      'SELECT id, icon, title, description FROM services WHERE visible = 1 ORDER BY sort_order ASC, id ASC',
    ).all();
    return ok({ items: results || [] });
  });

  /* --------------------------------- 单页 --------------------------------- */
  r.get('public/pages/:slug', async ({ env, params }) => {
    const row = await env.DB.prepare('SELECT slug, title, content, updated_at FROM pages WHERE slug = ?')
      .bind(params.slug)
      .first();
    if (!row) return fail('页面不存在', 404);
    return ok({
      page: {
        slug: row.slug,
        title: row.title,
        content: row.content,
        html: renderMarkdown(row.content),
        updatedAt: row.updated_at,
      },
    });
  });

  /* -------------------------------- 在线留言 -------------------------------- */
  r.post('public/contact', async ({ env, request }) => {
    const body = await readJson(request);
    const name = String(body.name || '').trim().slice(0, 40);
    const email = String(body.email || '').trim().slice(0, 120);
    const phone = String(body.phone || '').trim().slice(0, 40);
    const subject = String(body.subject || '').trim().slice(0, 80);
    const content = String(body.content || '').trim().slice(0, 2000);

    if (!name) return fail('请填写您的姓名');
    if (!content) return fail('请填写留言内容');
    if (!email && !phone) return fail('请至少填写邮箱或联系电话');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('邮箱格式不正确');
    if (phone && !/^[\d+\-()\s]{6,20}$/.test(phone)) return fail('电话号码格式不正确');
    // 简单反机器人：蜜罐字段被填写则直接丢弃
    if (String(body.company || '').trim()) return ok({ received: true });

    const ipHash = await hashIp(clientIp(request), env.IP_SALT || 'site-salt');
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM messages WHERE ip_hash = ? AND created_at >= datetime('now', '-1 hour')",
    )
      .bind(ipHash)
      .first();
    if (Number(recent?.c || 0) >= MAX_MESSAGE_PER_HOUR) {
      return fail('提交过于频繁，请稍后再试', 429);
    }

    await env.DB.prepare(
      'INSERT INTO messages (name, email, phone, subject, content, ip_hash) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(name, email, phone, subject, content, ipHash)
      .run();

    return ok({ received: true });
  });

  /* ------------------------------- 访问埋点 ------------------------------- */
  r.post('track', async ({ env, request }) => {
    const body = await readJson(request);
    const ua = request.headers.get('user-agent') || '';
    const settings = await getSettings(env);
    if (settings.analytics_enabled === '0') return ok({ skipped: 'disabled' });
    if (isBot(ua)) return ok({ skipped: 'bot' });

    let path = String(body.path || '/').slice(0, 200);
    if (!path.startsWith('/')) path = `/${path}`;
    if (path.startsWith('/api') || path.startsWith('/admin')) return ok({ skipped: 'ignored' });

    const referrer = String(body.referrer || '').slice(0, 300);
    const visitorId = String(body.visitorId || '').slice(0, 64) || 'anonymous';
    const sessionId = String(body.sessionId || '').slice(0, 64);
    const { device, os, browser } = parseUserAgent(ua);
    const country = request.headers.get('cf-ipcountry') || request.cf?.country || '';
    const ipHash = await hashIp(clientIp(request), env.IP_SALT || 'site-salt');
    const day = todaySql();

    await env.DB.prepare(
      `INSERT INTO visits (path, referrer, visitor_id, session_id, ua, device, browser, os, country, ip_hash, day)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        path,
        referrerHost(referrer),
        visitorId,
        sessionId,
        ua.slice(0, 300),
        device,
        browser,
        os,
        String(country).slice(0, 8),
        ipHash,
        day,
      )
      .run();

    // 文章页浏览量 +1（同一访客同一天同一篇文章只计一次）
    const matched = path.match(/^\/news\/([^/?#]+)/);
    if (matched) {
      const slug = decodeURIComponent(matched[1]);
      const seen = await env.DB.prepare(
        'SELECT id FROM visits WHERE path = ? AND visitor_id = ? AND day = ? LIMIT 1 OFFSET 1',
      )
        .bind(path, visitorId, day)
        .first();
      if (!seen) {
        await env.DB.prepare(
          "UPDATE articles SET views = views + 1 WHERE slug = ? AND status = 'published'",
        )
          .bind(slug)
          .run();
      }
    }

    // 少量概率清理 180 天前的记录，控制数据量
    if (Math.random() < 0.01) {
      await env.DB.prepare("DELETE FROM visits WHERE created_at < datetime('now', '-180 days')").run();
    }

    return ok({ recorded: true });
  });

  /* --------------------------- 供管理后台预览 Markdown --------------------------- */
  r.post('preview', async ({ request }) => {
    const body = await readJson(request);
    return ok({ html: renderMarkdown(String(body.content || '')) });
  });

  /* ------------------------------ 站点搜索（文章） ------------------------------ */
  r.get('public/search', async ({ env, query }) => {
    const keyword = (query.get('q') || '').trim();
    if (!keyword) return ok({ items: [] });
    const like = `%${keyword}%`;
    const { results } = await env.DB.prepare(
      `SELECT title, slug, summary FROM articles
        WHERE status='published' AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)
        ORDER BY published_at DESC LIMIT 10`,
    )
      .bind(like, like, like)
      .all();
    return ok({
      items: (results || []).map((row) => ({
        title: row.title,
        slug: row.slug,
        summary: truncate(row.summary || markdownToText(row.summary), 80),
      })),
    });
  });
}
