/**
 * 管理后台接口：登录鉴权、数据看板、文章 / 分类 / 服务 / 单页 / 留言 / 站点配置管理。
 */
import {
  ok,
  fail,
  readJson,
  json,
  slugify,
  toInt,
  bool,
  nowSql,
  todaySql,
  recentDays,
  truncate,
  clientIp,
  hashIp,
} from './util.js';
import { renderMarkdown, markdownToText } from './markdown.js';
import { getSettings, saveSettings, pagination } from './store.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  currentUser,
  ensureBootstrap,
  tooManyAttempts,
  recordAttempt,
  sessionCookie,
  clearSessionCookie,
} from './auth.js';

/* ------------------------------ 小工具 ------------------------------ */

async function uniqueSlug(env, table, base, excludeId = 0) {
  let slug = slugify(base);
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const row = await env.DB.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`)
      .bind(candidate, excludeId)
      .first();
    if (!row) return candidate;
  }
  return `${slug}-${Date.now().toString(36)}`;
}

function normaliseArticle(body, existing = null) {
  const title = String(body.title ?? existing?.title ?? '').trim().slice(0, 200);
  const content = String(body.content ?? existing?.content ?? '').slice(0, 200000);
  let summary = String(body.summary ?? existing?.summary ?? '').trim().slice(0, 500);
  if (!summary) summary = markdownToText(content, 140);
  const status = body.status === 'published' ? 'published' : 'draft';
  let publishedAt = body.publishedAt ?? existing?.published_at ?? null;
  if (status === 'published' && !publishedAt) publishedAt = nowSql();
  if (status === 'draft') publishedAt = body.publishedAt || existing?.published_at || null;
  return {
    title,
    slugInput: String(body.slug ?? existing?.slug ?? '').trim(),
    summary,
    content,
    coverUrl: String(body.coverUrl ?? existing?.cover_url ?? '').trim().slice(0, 500),
    categoryId: body.categoryId === undefined || body.categoryId === null || body.categoryId === ''
      ? existing?.category_id ?? null
      : toInt(body.categoryId, 0) || null,
    status,
    isFeatured: body.isFeatured === undefined ? existing?.is_featured ?? 0 : bool(body.isFeatured),
    publishedAt,
  };
}

/* ------------------------------ 登录相关 ------------------------------ */

export function registerAuthRoutes(r) {
  r.post('auth/login', async ({ env, request }) => {
    const bootstrap = await ensureBootstrap(env);
    const body = await readJson(request);
    const username = String(body.username || '').trim().slice(0, 60);
    const password = String(body.password || '');

    if (!username || !password) return fail('请输入用户名和密码');
    if (await tooManyAttempts(env, request)) {
      return fail('失败次数过多，请 15 分钟后再试', 429);
    }

    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    await recordAttempt(env, request, username, valid);
    if (!valid) return fail('用户名或密码错误', 401);

    const token = await createSession(env, user.id, request);
    await env.DB.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?')
      .bind(user.id)
      .run();

    return json(
      {
        ok: true,
        data: {
          user: { id: user.id, username: user.username, displayName: user.display_name },
          bootstrap: bootstrap ? { createdDefaultAdmin: true, username: bootstrap.username } : null,
        },
      },
      200,
      { 'set-cookie': sessionCookie(token, request) },
    );
  });

  r.post('auth/logout', async ({ env, request }) => {
    await destroySession(env, request);
    return json({ ok: true, data: null }, 200, { 'set-cookie': clearSessionCookie(request) });
  });

  r.get('auth/me', async ({ env, request }) => {
    const user = await currentUser(env, request);
    if (!user) return fail('未登录', 401);
    return ok({ user });
  });

  r.post('auth/password', async ({ env, request }) => {
    const user = await currentUser(env, request);
    if (!user) return fail('未登录', 401);
    const body = await readJson(request);
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 8) return fail('新密码至少 8 位');
    const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
    if (!row || !(await verifyPassword(oldPassword, row.password_hash))) return fail('原密码不正确');
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(newPassword), user.id)
      .run();
    // 改密后使其它会话失效
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
    return json({ ok: true, data: { changed: true } }, 200, { 'set-cookie': clearSessionCookie(request) });
  });
}

/* ------------------------------ 数据看板 ------------------------------ */

async function buildStats(env, days) {
  const range = recentDays(days);
  const from = range[0];
  const monthStart = recentDays(30)[0];
  const today = todaySql();

  const totals = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM visits) AS pv,
       (SELECT COUNT(DISTINCT visitor_id) FROM visits) AS uv,
       (SELECT COUNT(*) FROM visits WHERE day = ?) AS today_pv,
       (SELECT COUNT(DISTINCT visitor_id) FROM visits WHERE day = ?) AS today_uv,
       (SELECT COUNT(*) FROM visits WHERE day >= ?) AS month_pv,
       (SELECT COUNT(DISTINCT visitor_id) FROM visits WHERE day >= ?) AS month_uv,
       (SELECT COUNT(*) FROM articles) AS articles,
       (SELECT COUNT(*) FROM articles WHERE status = 'published') AS published,
       (SELECT COUNT(*) FROM articles WHERE status = 'draft') AS drafts,
       (SELECT COUNT(*) FROM messages) AS messages,
       (SELECT COUNT(*) FROM messages WHERE status = 'new') AS new_messages,
       (SELECT COALESCE(SUM(views), 0) FROM articles) AS article_views`,
  )
    .bind(today, today, monthStart, monthStart)
    .first();

  const seriesRows = (
    await env.DB.prepare(
      `SELECT day, COUNT(*) AS pv, COUNT(DISTINCT visitor_id) AS uv
         FROM visits WHERE day >= ? GROUP BY day`,
    )
      .bind(from)
      .all()
  ).results || [];
  const seriesMap = new Map(seriesRows.map((row) => [row.day, row]));
  const series = range.map((day) => ({
    day,
    pv: Number(seriesMap.get(day)?.pv || 0),
    uv: Number(seriesMap.get(day)?.uv || 0),
  }));

  const topPages = (
    await env.DB.prepare(
      `SELECT path, COUNT(*) AS pv, COUNT(DISTINCT visitor_id) AS uv
         FROM visits WHERE day >= ? GROUP BY path ORDER BY pv DESC LIMIT 10`,
    )
      .bind(from)
      .all()
  ).results || [];

  const topReferrers = (
    await env.DB.prepare(
      `SELECT referrer, COUNT(*) AS pv FROM visits WHERE day >= ?
        GROUP BY referrer ORDER BY pv DESC LIMIT 8`,
    )
      .bind(from)
      .all()
  ).results || [];

  const devices = (
    await env.DB.prepare(
      `SELECT device, COUNT(*) AS pv FROM visits WHERE day >= ? GROUP BY device ORDER BY pv DESC`,
    )
      .bind(from)
      .all()
  ).results || [];

  const browsers = (
    await env.DB.prepare(
      `SELECT browser, COUNT(*) AS pv FROM visits WHERE day >= ? GROUP BY browser ORDER BY pv DESC LIMIT 6`,
    )
      .bind(from)
      .all()
  ).results || [];

  const countries = (
    await env.DB.prepare(
      `SELECT COALESCE(NULLIF(country, ''), '未知') AS country, COUNT(*) AS pv
         FROM visits WHERE day >= ? GROUP BY country ORDER BY pv DESC LIMIT 8`,
    )
      .bind(from)
      .all()
  ).results || [];

  const hours = (
    await env.DB.prepare(
      `SELECT substr(created_at, 12, 2) AS hour, COUNT(*) AS pv
         FROM visits WHERE day = ? GROUP BY hour ORDER BY hour`,
    )
      .bind(today)
      .all()
  ).results || [];

  const recentVisits = (
    await env.DB.prepare(
      `SELECT path, referrer, device, browser, os, country, created_at
         FROM visits ORDER BY id DESC LIMIT 20`,
    ).all()
  ).results || [];

  const topArticles = (
    await env.DB.prepare(
      `SELECT id, title, slug, views, status FROM articles ORDER BY views DESC LIMIT 8`,
    ).all()
  ).results || [];

  const recentMessages = (
    await env.DB.prepare(
      `SELECT id, name, subject, status, created_at FROM messages ORDER BY id DESC LIMIT 6`,
    ).all()
  ).results || [];

  return {
    days,
    totals: {
      pv: Number(totals?.pv || 0),
      uv: Number(totals?.uv || 0),
      todayPv: Number(totals?.today_pv || 0),
      todayUv: Number(totals?.today_uv || 0),
      monthPv: Number(totals?.month_pv || 0),
      monthUv: Number(totals?.month_uv || 0),
      articles: Number(totals?.articles || 0),
      published: Number(totals?.published || 0),
      drafts: Number(totals?.drafts || 0),
      messages: Number(totals?.messages || 0),
      newMessages: Number(totals?.new_messages || 0),
      articleViews: Number(totals?.article_views || 0),
    },
    series,
    topPages,
    topReferrers,
    devices,
    browsers,
    countries,
    hours,
    recentVisits,
    topArticles,
    recentMessages,
  };
}

/* ------------------------------ 管理接口 ------------------------------ */

export function registerAdminRoutes(r) {
  /* 看板 */
  r.get('admin/stats', async ({ env, query }) => {
    const days = Math.min(90, Math.max(7, toInt(query.get('days'), 30)));
    return ok(await buildStats(env, days));
  });

  /* 文章列表 */
  r.get('admin/articles', async ({ env, query }) => {
    const { page, pageSize, offset } = pagination(query, 10, 100);
    const status = (query.get('status') || '').trim();
    const keyword = (query.get('q') || '').trim();
    const like = `%${keyword}%`;
    const where = `WHERE (? = '' OR a.status = ?) AND (? = '' OR a.title LIKE ? OR a.summary LIKE ?)`;
    const params = [status, status, keyword, like, like];

    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM articles a ${where}`)
      .bind(...params)
      .first();
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.title, a.slug, a.summary, a.status, a.is_featured, a.views, a.cover_url,
              a.published_at, a.updated_at, a.created_at,
              c.name AS category_name, c.id AS category_id
         FROM articles a LEFT JOIN categories c ON c.id = a.category_id
         ${where}
         ORDER BY a.updated_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, pageSize, offset)
      .all();

    return ok({
      items: results || [],
      page,
      pageSize,
      total: Number(totalRow?.c || 0),
      totalPages: Math.max(1, Math.ceil(Number(totalRow?.c || 0) / pageSize)),
    });
  });

  r.get('admin/articles/:id', async ({ env, params }) => {
    const row = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(toInt(params.id)).first();
    if (!row) return fail('文章不存在', 404);
    return ok({ article: row });
  });

  r.post('admin/articles', async ({ env, request }) => {
    const body = await readJson(request);
    const data = normaliseArticle(body);
    if (!data.title) return fail('请填写文章标题');
    const slug = await uniqueSlug(env, 'articles', data.slugInput || data.title);
    const inserted = await env.DB.prepare(
      `INSERT INTO articles (title, slug, summary, content, cover_url, category_id, status, is_featured, author, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(
        data.title,
        slug,
        data.summary,
        data.content,
        data.coverUrl,
        data.categoryId,
        data.status,
        data.isFeatured,
        String(body.author || 'admin').slice(0, 40),
        data.publishedAt,
      )
      .first();
    return ok({ id: inserted?.id, slug });
  });

  r.put('admin/articles/:id', async ({ env, params, request }) => {
    const id = toInt(params.id);
    const existing = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
    if (!existing) return fail('文章不存在', 404);
    const body = await readJson(request);
    const data = normaliseArticle(body, existing);
    if (!data.title) return fail('请填写文章标题');
    const slug = await uniqueSlug(env, 'articles', data.slugInput || data.title, id);
    await env.DB.prepare(
      `UPDATE articles SET title = ?, slug = ?, summary = ?, content = ?, cover_url = ?,
              category_id = ?, status = ?, is_featured = ?, published_at = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(
        data.title,
        slug,
        data.summary,
        data.content,
        data.coverUrl,
        data.categoryId,
        data.status,
        data.isFeatured,
        data.publishedAt,
        id,
      )
      .run();
    return ok({ id, slug, updated: true });
  });

  r.del('admin/articles/:id', async ({ env, params }) => {
    await env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(toInt(params.id)).run();
    return ok({ deleted: true });
  });

  /* 分类 */
  r.get('admin/categories', async ({ env }) => {
    const { results } = await env.DB.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM articles a WHERE a.category_id = c.id) AS article_count
         FROM categories c ORDER BY c.sort_order ASC, c.id ASC`,
    ).all();
    return ok({ items: results || [] });
  });

  r.post('admin/categories', async ({ env, request }) => {
    const body = await readJson(request);
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return fail('请填写分类名称');
    const slug = await uniqueSlug(env, 'categories', body.slug || name);
    const row = await env.DB.prepare(
      'INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?) RETURNING id',
    )
      .bind(name, slug, toInt(body.sortOrder, 0))
      .first();
    return ok({ id: row?.id, slug });
  });

  r.put('admin/categories/:id', async ({ env, params, request }) => {
    const id = toInt(params.id);
    const existing = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
    if (!existing) return fail('分类不存在', 404);
    const body = await readJson(request);
    const name = String(body.name ?? existing.name).trim().slice(0, 60);
    const slug = await uniqueSlug(env, 'categories', body.slug || existing.slug, id);
    await env.DB.prepare('UPDATE categories SET name = ?, slug = ?, sort_order = ? WHERE id = ?')
      .bind(name, slug, toInt(body.sortOrder, existing.sort_order), id)
      .run();
    return ok({ updated: true, slug });
  });

  r.del('admin/categories/:id', async ({ env, params }) => {
    await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(toInt(params.id)).run();
    return ok({ deleted: true });
  });

  /* 服务项目 */
  r.get('admin/services', async ({ env }) => {
    const { results } = await env.DB.prepare(
      'SELECT * FROM services ORDER BY sort_order ASC, id ASC',
    ).all();
    return ok({ items: results || [] });
  });

  r.post('admin/services', async ({ env, request }) => {
    const body = await readJson(request);
    const title = String(body.title || '').trim().slice(0, 80);
    if (!title) return fail('请填写服务名称');
    const row = await env.DB.prepare(
      'INSERT INTO services (icon, title, description, sort_order, visible) VALUES (?, ?, ?, ?, ?) RETURNING id',
    )
      .bind(
        String(body.icon || '★').slice(0, 8),
        title,
        String(body.description || '').slice(0, 600),
        toInt(body.sortOrder, 0),
        body.visible === undefined ? 1 : bool(body.visible),
      )
      .first();
    return ok({ id: row?.id });
  });

  r.put('admin/services/:id', async ({ env, params, request }) => {
    const id = toInt(params.id);
    const existing = await env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(id).first();
    if (!existing) return fail('服务不存在', 404);
    const body = await readJson(request);
    await env.DB.prepare(
      'UPDATE services SET icon = ?, title = ?, description = ?, sort_order = ?, visible = ? WHERE id = ?',
    )
      .bind(
        String(body.icon ?? existing.icon).slice(0, 8),
        String(body.title ?? existing.title).slice(0, 80),
        String(body.description ?? existing.description).slice(0, 600),
        toInt(body.sortOrder, existing.sort_order),
        body.visible === undefined ? existing.visible : bool(body.visible),
        id,
      )
      .run();
    return ok({ updated: true });
  });

  r.del('admin/services/:id', async ({ env, params }) => {
    await env.DB.prepare('DELETE FROM services WHERE id = ?').bind(toInt(params.id)).run();
    return ok({ deleted: true });
  });

  /* 单页内容 */
  r.get('admin/pages', async ({ env }) => {
    const { results } = await env.DB.prepare(
      'SELECT id, slug, title, updated_at FROM pages ORDER BY id ASC',
    ).all();
    return ok({ items: results || [] });
  });

  r.get('admin/pages/:id', async ({ env, params }) => {
    const row = await env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(toInt(params.id)).first();
    if (!row) return fail('页面不存在', 404);
    return ok({ page: row });
  });

  r.post('admin/pages', async ({ env, request }) => {
    const body = await readJson(request);
    const title = String(body.title || '').trim().slice(0, 80);
    if (!title) return fail('请填写页面标题');
    const slug = await uniqueSlug(env, 'pages', body.slug || title);
    const row = await env.DB.prepare(
      'INSERT INTO pages (slug, title, content) VALUES (?, ?, ?) RETURNING id',
    )
      .bind(slug, title, String(body.content || ''))
      .first();
    return ok({ id: row?.id, slug });
  });

  r.put('admin/pages/:id', async ({ env, params, request }) => {
    const id = toInt(params.id);
    const existing = await env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first();
    if (!existing) return fail('页面不存在', 404);
    const body = await readJson(request);
    const slug = await uniqueSlug(env, 'pages', body.slug || existing.slug, id);
    await env.DB.prepare(
      "UPDATE pages SET slug = ?, title = ?, content = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(slug, String(body.title ?? existing.title).slice(0, 80), String(body.content ?? existing.content), id)
      .run();
    return ok({ updated: true, slug });
  });

  r.del('admin/pages/:id', async ({ env, params }) => {
    await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(toInt(params.id)).run();
    return ok({ deleted: true });
  });

  /* 留言 */
  r.get('admin/messages', async ({ env, query }) => {
    const { page, pageSize, offset } = pagination(query, 20, 100);
    const status = (query.get('status') || '').trim();
    const totalRow = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM messages WHERE (? = '' OR status = ?)",
    )
      .bind(status, status)
      .first();
    const { results } = await env.DB.prepare(
      `SELECT * FROM messages WHERE (? = '' OR status = ?) ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
      .bind(status, status, pageSize, offset)
      .all();
    return ok({
      items: results || [],
      page,
      pageSize,
      total: Number(totalRow?.c || 0),
      totalPages: Math.max(1, Math.ceil(Number(totalRow?.c || 0) / pageSize)),
    });
  });

  r.patch('admin/messages/:id', async ({ env, params, request }) => {
    const body = await readJson(request);
    const status = ['new', 'read', 'archived'].includes(body.status) ? body.status : 'read';
    await env.DB.prepare('UPDATE messages SET status = ? WHERE id = ?')
      .bind(status, toInt(params.id))
      .run();
    return ok({ updated: true });
  });

  r.del('admin/messages/:id', async ({ env, params }) => {
    await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(toInt(params.id)).run();
    return ok({ deleted: true });
  });

  /* 访问明细 */
  r.get('admin/visits', async ({ env, query }) => {
    const { page, pageSize, offset } = pagination(query, 30, 200);
    const day = (query.get('day') || '').trim();
    const totalRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM visits WHERE (? = '' OR day = ?)")
      .bind(day, day)
      .first();
    const { results } = await env.DB.prepare(
      `SELECT id, path, referrer, device, browser, os, country, created_at
         FROM visits WHERE (? = '' OR day = ?) ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
      .bind(day, day, pageSize, offset)
      .all();
    return ok({
      items: results || [],
      page,
      pageSize,
      total: Number(totalRow?.c || 0),
      totalPages: Math.max(1, Math.ceil(Number(totalRow?.c || 0) / pageSize)),
    });
  });

  r.del('admin/visits', async ({ env, request }) => {
    const body = await readJson(request);
    const before = String(body.before || '').trim();
    if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) {
      const res = await env.DB.prepare('DELETE FROM visits WHERE day < ?').bind(before).run();
      return ok({ deleted: true, before, changes: res?.meta?.changes ?? null });
    }
    await env.DB.prepare('DELETE FROM visits').run();
    return ok({ deleted: true, all: true });
  });

  /* 站点配置 */
  r.get('admin/settings', async ({ env }) => ok({ settings: await getSettings(env) }));

  r.put('admin/settings', async ({ env, request }) => {
    const body = await readJson(request);
    const entries = body.settings && typeof body.settings === 'object' ? body.settings : body;
    const count = await saveSettings(env, entries);
    return ok({ saved: count });
  });

  /* 管理员账号 */
  r.get('admin/users', async ({ env }) => {
    const { results } = await env.DB.prepare(
      'SELECT id, username, display_name, role, created_at, last_login_at FROM users ORDER BY id ASC',
    ).all();
    return ok({ items: results || [] });
  });

  r.post('admin/users', async ({ env, request }) => {
    const body = await readJson(request);
    const username = String(body.username || '').trim().slice(0, 60);
    const password = String(body.password || '');
    if (!/^[A-Za-z0-9_.-]{3,60}$/.test(username)) return fail('用户名需为 3-60 位字母、数字、下划线');
    if (password.length < 8) return fail('密码至少 8 位');
    const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (exists) return fail('用户名已存在');
    const row = await env.DB.prepare(
      'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?) RETURNING id',
    )
      .bind(username, await hashPassword(password), String(body.displayName || username).slice(0, 40), 'admin')
      .first();
    return ok({ id: row?.id });
  });

  r.put('admin/users/:id/password', async ({ env, params, request }) => {
    const id = toInt(params.id);
    const body = await readJson(request);
    const password = String(body.password || '');
    if (password.length < 8) return fail('密码至少 8 位');
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(password), id)
      .run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    return ok({ updated: true });
  });

  r.del('admin/users/:id', async ({ env, params, request }) => {
    const id = toInt(params.id);
    const me = await currentUser(env, request);
    if (me && me.id === id) return fail('不能删除当前登录账号');
    const countRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
    if (Number(countRow?.c || 0) <= 1) return fail('至少保留一个管理员账号');
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    return ok({ deleted: true });
  });

  /* Markdown 预览（后台编辑器） */
  r.post('admin/preview', async ({ request }) => {
    const body = await readJson(request);
    return ok({ html: renderMarkdown(String(body.content || '')) });
  });
}

export { buildStats };
