/**
 * Cloudflare Pages Functions 入口：/api/*
 * 所有后端接口都由此函数分发（同源部署，无需额外 Worker）。
 */
import { handleApi } from '../../lib/api.js';

export const onRequest = ({ request, env, ctx }) => handleApi(request, env, ctx);
