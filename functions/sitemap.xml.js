/**
 * Cloudflare Pages Functions：/sitemap.xml
 * 动态输出站点地图，便于搜索引擎收录文章。
 */
import { sitemapXml } from '../lib/render.js';

export const onRequestGet = async ({ env }) => {
  const xml = await sitemapXml(env);
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
