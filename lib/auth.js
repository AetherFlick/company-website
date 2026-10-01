/**
 * 鉴权：密码哈希（PBKDF2-SHA256）、会话管理、Cookie 读写。
 * 说明：Cloudflare Workers 免费版单请求 CPU 时间有限（10ms），
 *       因此迭代次数取 12000，配合登录限流使用；付费版可调高 ITERATIONS。
 */
import {
  sha256Hex,
  randomToken,
  nowSql,
  parseCookies,
  clientIp,
  hashIp,
  timingSafeEqual,
} from './util.js';

const ITERATIONS = 12000;
const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 7;

const encoder = new TextEncoder();

function bytesToB64(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return bytesToB64(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${bytesToB64(salt)}$${hash}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iter, saltB64, hash] = String(stored || '').split('$');
    if (scheme !== 'pbkdf2' || !saltB64 || !hash) return false;
    const candidate = await pbkdf2(password, b64ToBytes(saltB64), Number(iter) || ITERATIONS);
    return timingSafeEqual(candidate, hash);
  } catch {
    return false;
  }
}

/* ------------------------------ 会话管理 ------------------------------ */

export function sessionCookie(token, request, maxAgeSeconds = SESSION_DAYS * 86400) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function createSession(env, userId, request) {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const ua = (request.headers.get('user-agent') || '').slice(0, 200);
  const ipHash = await hashIp(clientIp(request), env.IP_SALT || 'site-salt');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_hash) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, userId, expires, ua, ipHash)
    .run();
  return token;
}

export async function destroySession(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
}

/** 返回当前登录用户，未登录返回 null */
export async function currentUser(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first();
  if (!row) return null;
  if (String(row.expires_at) < nowSql()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
}

/* ------------------------------ 首次引导 ------------------------------ */

/** 若系统尚无任何管理员账号，则用环境变量创建默认管理员 */
export async function ensureBootstrap(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
  if (row && Number(row.c) > 0) return null;
  const username = env.ADMIN_USERNAME || 'admin';
  const password = env.ADMIN_PASSWORD || 'admin123456';
  const hash = await hashPassword(password);
  await env.DB.prepare(
    'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
  )
    .bind(username, hash, '超级管理员', 'admin')
    .run();
  return { username, password };
}

/* ------------------------------ 登录限流 ------------------------------ */

export async function tooManyAttempts(env, request, limit = 10, minutes = 15) {
  const ipHash = await hashIp(clientIp(request), env.IP_SALT || 'site-salt');
  const since = new Date(Date.now() - minutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM login_attempts WHERE ip_hash = ? AND ok = 0 AND created_at >= ?',
  )
    .bind(ipHash, since)
    .first();
  return Number(row?.c || 0) >= limit;
}

export async function recordAttempt(env, request, username, success) {
  const ipHash = await hashIp(clientIp(request), env.IP_SALT || 'site-salt');
  await env.DB.prepare(
    'INSERT INTO login_attempts (ip_hash, username, ok) VALUES (?, ?, ?)',
  )
    .bind(ipHash, String(username || '').slice(0, 60), success ? 1 : 0)
    .run();
  // 顺手清理 7 天前的记录，避免表无限增长
  await env.DB.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', '-7 days')").run();
}
