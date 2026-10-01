/**
 * 零依赖本地开发服务器（Node.js 18+ / 推荐 22+）
 *
 * 作用：在没有安装 wrangler、没有网络的情况下，也能完整跑起整套系统：
 *   - 使用 Node 内置 node:sqlite 建立与 Cloudflare D1 完全一致的 SQLite 数据库
 *   - 自动执行 migrations/*.sql 数据库迁移
 *   - 复用 lib/api.js 处理 /api/*（与线上 Cloudflare Pages Functions 同一份代码）
 *   - 复用 lib/render.js 渲染 /news/:slug 与 /sitemap.xml
 *   - 静态托管 public/ 目录
 *
 * 启动：npm run dev   （默认 http://localhost:8788）
 */
import http from 'node:http';
import { readFile, readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const DATA_DIR = path.join(ROOT, '.data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'local.db');
const PORT = Number(process.env.PORT || 8788);

/* ------------------------- 1. 数据库与 D1 适配层 ------------------------- */

function toPlain(row) {
  if (!row) return row;
  return Object.assign({}, row);
}

class LocalStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new LocalStatement(this.db, this.sql, params);
  }

  async all() {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return { results: rows.map(toPlain), success: true, meta: {} };
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (!row) return null;
    const plain = toPlain(row);
    return column ? plain[column] : plain;
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: Number(info.changes || 0), last_row_id: Number(info.lastInsertRowid || 0) },
    };
  }
}

function createD1(db) {
  return {
    prepare: (sql) => new LocalStatement(db, sql),
    exec: async (sql) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    batch: async (statements) => {
      const out = [];
      db.exec('BEGIN');
      try {
        for (const stmt of statements) out.push(await stmt.run());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return out;
    },
    dump: async () => new Uint8Array(),
  };
}

async function initDatabase() {
  await mkdir(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT)');

  const files = existsSync(MIGRATIONS_DIR)
    ? (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    : [];
  const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      db.exec('BEGIN');
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, datetime(\'now\'))').run(file);
      db.exec('COMMIT');
      console.log(`  ✔ 已应用迁移 ${file}`);
    } catch (error) {
      db.exec('ROLLBACK');
      console.error(`  ✘ 迁移失败 ${file}: ${error.message}`);
      throw error;
    }
  }
  return { db, d1: createD1(db), migrations: files.length, applied: applied.size };
}

/* ---------------------------- 2. 静态文件服务 ---------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function resolveStatic(pathname) {
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('\0')) return null;
  const candidates = [];
  if (decoded.endsWith('/')) candidates.push(path.join(PUBLIC_DIR, decoded, 'index.html'));
  else {
    candidates.push(path.join(PUBLIC_DIR, decoded));
    candidates.push(path.join(PUBLIC_DIR, `${decoded}.html`));
    candidates.push(path.join(PUBLIC_DIR, decoded, 'index.html'));
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(PUBLIC_DIR)) continue; // 防目录穿越
    try {
      const info = await stat(resolved);
      if (info.isFile()) return resolved;
    } catch {
      /* 继续尝试下一个候选 */
    }
  }
  return null;
}

/* ----------------------------- 3. HTTP 服务器 ----------------------------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') continue;
    res.setHeader(key, value);
  }
  if (setCookies.length) res.setHeader('set-cookie', setCookies);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

async function main() {
  console.log('\n=== 公司官网本地开发服务器 ===');
  console.log(`项目目录: ${ROOT}`);
  const { d1, db } = await initDatabase();
  console.log(`数据库:   ${DB_FILE}`);

  const { handleApi } = await import('../lib/api.js');
  const { articlePage, sitemapXml, notFoundPage } = await import('../lib/render.js');

  const env = {
    DB: d1,
    ENVIRONMENT: 'development',
    SITE_URL: `http://localhost:${PORT}`,
    IP_SALT: process.env.IP_SALT || 'dev-salt',
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123456',
  };

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
      const pathname = url.pathname;

      // 1) 后端 API
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
        }
        headers.set('cf-connecting-ip', req.socket.remoteAddress || '127.0.0.1');
        const request = new Request(url.toString(), {
          method: req.method,
          headers,
          body: body && body.length ? body : undefined,
        });
        const response = await handleApi(request, env, {});
        await sendWebResponse(res, response);
        console.log(`${req.method} ${pathname} -> ${response.status} (${Date.now() - started}ms)`);
        return;
      }

      // 2) 文章详情（服务端渲染）
      const articleMatch = pathname.match(/^\/news\/([^/]+)\/?$/);
      if (articleMatch && !pathname.endsWith('.html')) {
        const { status, html } = await articlePage(env, decodeURIComponent(articleMatch[1]));
        res.statusCode = status;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(html);
        console.log(`${req.method} ${pathname} -> ${status} (ssr)`);
        return;
      }

      // 3) sitemap
      if (pathname === '/sitemap.xml') {
        const xml = await sitemapXml(env);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/xml; charset=utf-8');
        res.end(xml);
        return;
      }

      // 4) 静态资源
      const filePath = await resolveStatic(pathname);
      if (filePath) {
        const data = await readFile(filePath);
        res.statusCode = 200;
        res.setHeader('content-type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        res.setHeader('cache-control', 'no-cache');
        if (req.method === 'HEAD') res.end();
        else res.end(data);
        return;
      }

      // 5) 404
      res.statusCode = 404;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(await notFoundPage(env));
    } catch (error) {
      console.error('请求处理失败:', error);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: String(error && error.message) }));
    }
  });

  server.listen(PORT, () => {
    console.log(`\n前台首页:  http://localhost:${PORT}/`);
    console.log(`管理后台:  http://localhost:${PORT}/admin/`);
    console.log(`接口自检:  http://localhost:${PORT}/api/health`);
    console.log(`默认账号:  ${env.ADMIN_USERNAME} / ${env.ADMIN_PASSWORD}（首次登录自动创建，请尽快修改）\n`);
  });

  const shutdown = () => {
    console.log('\n正在关闭开发服务器…');
    server.close(() => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('启动失败:', error);
  process.exit(1);
});
