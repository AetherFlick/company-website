/**
 * 极简路由：支持 :param 占位符，匹配 /api/ 之后的路径。
 */
import { fail } from './util.js';

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    routes.push({
      method,
      segments: pattern.split('/').filter(Boolean),
      handler,
    });
  }

  function matchSegments(routeSegments, pathSegments) {
    if (routeSegments.length !== pathSegments.length) return null;
    const params = {};
    for (let i = 0; i < routeSegments.length; i += 1) {
      const seg = routeSegments[i];
      if (seg.startsWith(':')) params[seg.slice(1)] = pathSegments[i];
      else if (seg !== pathSegments[i]) return null;
    }
    return params;
  }

  async function handle(request, env, ctx) {
    const url = new URL(request.url);
    const raw = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
    const pathSegments = raw
      ? raw.split('/').filter(Boolean).map((s) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        })
      : [];

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }

    for (const route of routes) {
      if (route.method !== request.method) continue;
      const params = matchSegments(route.segments, pathSegments);
      if (params) {
        return route.handler({ request, env, ctx, url, params, query: url.searchParams });
      }
    }
    return fail(`接口不存在: ${request.method} ${url.pathname}`, 404);
  }

  return {
    handle,
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    patch: (p, h) => add('PATCH', p, h),
    del: (p, h) => add('DELETE', p, h),
  };
}
