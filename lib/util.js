/**
 * 通用工具函数：HTTP 响应、时间、哈希、Cookie、UA 解析。
 * 该文件同时运行在 Cloudflare Workers(Pages Functions) 与 Node.js 中，
 * 只使用标准 Web API，不依赖任何第三方库。
 */

const encoder = new TextEncoder();

/* ----------------------------- HTTP 响应 ----------------------------- */

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function ok(data = null, headers = {}) {
  return json({ ok: true, data }, 200, headers);
}

export function fail(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

export function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

export function noContent(headers = {}) {
  return new Response(null, { status: 204, headers });
}

/* ------------------------------ 字符串 ------------------------------ */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

/** 生成 URL slug：保留中英文与数字，空格转连字符 */
export function slugify(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  const cleaned = raw
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned) return cleaned.slice(0, 120);
  return `post-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function truncate(text, length = 120) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > length ? `${s.slice(0, length)}…` : s;
}

export function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

/* ------------------------------- 时间 ------------------------------- */

/** SQLite 友好的 UTC 时间字符串：YYYY-MM-DD HH:MM:SS */
export function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function todaySql(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** 最近 n 天的日期数组（含今天），升序 */
export function recentDays(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) out.push(todaySql(addDays(now, -i)));
  return out;
}

/* ------------------------------- 加密 ------------------------------- */

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(text)));
  return bytesToHex(digest);
}

export function randomToken(bytes = 32) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 对 IP 做加盐哈希，只用于去重统计与限流，不保存明文 IP */
export async function hashIp(ip, salt = 'site-salt') {
  return (await sha256Hex(`${salt}:${ip || 'unknown'}`)).slice(0, 32);
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------ 请求解析 ------------------------------ */

export function clientIp(request) {
  const h = request.headers;
  return (
    h.get('cf-connecting-ip') ||
    (h.get('x-forwarded-for') || '').split(',')[0].trim() ||
    h.get('x-real-ip') ||
    '0.0.0.0'
  );
}

export function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  try {
    if (type.includes('application/json')) return (await request.json()) || {};
  } catch {
    return {};
  }
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/* ------------------------------- UA 解析 ------------------------------- */

export function parseUserAgent(ua = '') {
  const s = String(ua);
  let device = 'desktop';
  if (/iPad|Tablet|PlayBook|Silk/i.test(s)) device = 'tablet';
  else if (/Mobile|Android|iPhone|iPod|Windows Phone/i.test(s)) device = 'mobile';

  let os = 'Other';
  if (/Windows NT/i.test(s)) os = 'Windows';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Mac OS X/i.test(s)) os = 'macOS';
  else if (/Linux/i.test(s)) os = 'Linux';

  let browser = 'Other';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Chrome\//i.test(s)) browser = 'Chrome';
  else if (/Safari\//i.test(s)) browser = 'Safari';

  return { device, os, browser };
}

export function isBot(ua = '') {
  return /bot|spider|crawl|slurp|bingpreview|facebookexternalhit|headless|monitor|curl|wget|python-requests/i.test(
    String(ua),
  );
}

/** 从 referrer 提取域名，便于统计来源 */
export function referrerHost(referrer = '') {
  if (!referrer) return '直接访问';
  try {
    const host = new URL(referrer).hostname;
    return host || '直接访问';
  } catch {
    return '直接访问';
  }
}
