/**
 * Cloudflare Pages Functions：/news/:slug
 * 服务端渲染文章详情，保证 SEO 与首屏速度。
 */
import { articlePage } from '../../lib/render.js';

export const onRequestGet = async ({ env, params }) => {
  const { status, html } = await articlePage(env, String(params.slug || ''));
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=60' : 'no-store',
    },
  });
};
