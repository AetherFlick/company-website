/**
 * 数据访问公共层：站点配置读写、分页参数等。
 */
import { toInt } from './util.js';

/** 读取全部站点配置为对象 */
export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const row of results || []) map[row.key] = row.value;
  return map;
}

/** 批量写入配置（UPSERT） */
export async function saveSettings(env, entries) {
  const pairs = Object.entries(entries || {}).filter(([k]) => k && k.length <= 60);
  if (!pairs.length) return 0;
  const stmts = pairs.map(([key, value]) =>
    env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).bind(key, String(value ?? '').slice(0, 20000)),
  );
  if (typeof env.DB.batch === 'function') {
    await env.DB.batch(stmts);
  } else {
    for (const s of stmts) await s.run();
  }
  return pairs.length;
}

/** 对外暴露的配置白名单（不含任何敏感键） */
export function publicSettings(map) {
  const allow = [
    'site_name',
    'site_short',
    'site_slogan',
    'site_description',
    'site_keywords',
    'seo_title',
    'hero_title',
    'hero_subtitle',
    'hero_button_text',
    'company_intro',
    'phone',
    'email',
    'address',
    'work_time',
    'wechat',
    'icp',
    'police',
    'copyright',
    'stat_years',
    'stat_clients',
    'stat_projects',
    'stat_patents',
    'contact_notice',
    'analytics_enabled',
  ];
  const out = {};
  for (const key of allow) out[key] = map[key] ?? '';
  return out;
}

export function pagination(query, defaultSize = 10, maxSize = 50) {
  const page = Math.max(1, toInt(query.get('page'), 1));
  const pageSize = Math.min(maxSize, Math.max(1, toInt(query.get('pageSize'), defaultSize)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
