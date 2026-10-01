/**
 * API 总入口：装配路由 + 后台鉴权 + 统一错误处理。
 * Cloudflare Pages Functions 与本地 Node 开发服务器共用此文件。
 */
import { createRouter } from './router.js';
import { registerPublicRoutes } from './api-public.js';
import { registerAuthRoutes, registerAdminRoutes } from './api-admin.js';
import { currentUser } from './auth.js';
import { fail } from './util.js';

const router = createRouter();
registerPublicRoutes(router);
registerAuthRoutes(router);
registerAdminRoutes(router);

const dispatch = router.handle.bind(router);

export async function handleApi(request, env, ctx) {
  try {
    if (!env || !env.DB) {
      return fail('数据库未绑定：请在 Cloudflare Pages 中配置 D1 绑定 DB', 500);
    }

    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === '/api/health') {
      const row = await env.DB.prepare('SELECT 1 AS ok').first();
      return new Response(
        JSON.stringify({ ok: true, data: { database: row?.ok === 1, time: new Date().toISOString() } }),
        { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
      );
    }

    // 后台接口鉴权 + 简易 CSRF 校验
    if (url.pathname.startsWith('/api/admin')) {
      const user = await currentUser(env, request);
      if (!user) return fail('未登录或登录已过期', 401);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const origin = request.headers.get('origin');
        if (origin) {
          try {
            if (new URL(origin).host !== url.host) return fail('非法请求来源', 403);
          } catch {
            return fail('非法请求来源', 403);
          }
        }
      }
    }

    const response = await dispatch(request, env, ctx);
    const headers = new Headers(response.headers);
    if (request.method === 'GET' && !headers.has('cache-control')) {
      headers.set('cache-control', 'no-store');
    }
    headers.set('x-content-type-options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error('[api] 未捕获异常:', error && error.stack ? error.stack : error);
    return fail(`服务器内部错误：${error?.message || error}`, 500);
  }
}
