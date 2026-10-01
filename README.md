# 公司官网系统（前端展示 + 后台管理 + D1 数据库）

一套可以直接部署到 **GitHub → Cloudflare Pages** 的完整企业官网系统：

- **前台**：首页、关于我们、服务项目、新闻中心（列表 + 服务端渲染详情页）、联系我们（在线留言），全部响应式、SEO 友好。
- **后台**：登录鉴权、**网站数据监控看板**（PV/UV 趋势、热门页面、来源、设备、地区、时段分布、最近访问）、**文章管理**（Markdown 编辑 + 实时预览 + 草稿/发布）、分类管理、服务项目管理、单页内容管理、留言管理、访问日志与清理、站点设置（公司信息 / 首页文案 / 备案号，全部可视化编辑）、账号安全。
- **数据库**：Cloudflare **D1**（SQLite），带迁移脚本与演示数据。
- **零第三方依赖**：没有 React/Vue、没有 UI 框架、没有 npm 运行时依赖，前端是原生 HTML/CSS/JS，后端是 Cloudflare Pages Functions。**无需构建步骤**，推送即部署。

---

## 1. 技术架构

```
浏览器
  ├── 静态页面 (public/*.html + assets)          ← Cloudflare Pages 静态托管
  ├── 服务端渲染 /news/:slug、/sitemap.xml        ← Pages Functions（SEO 友好）
  └── /api/*                                     ← Pages Functions（同一个 Worker）
                                                     └── Cloudflare D1 (SQLite)
本地开发：node server/dev-server.mjs
  ├── 用 Node 内置 node:sqlite 复刻 D1 接口
  ├── 复用同一份 lib/api.js 与 lib/render.js
  └── 自动执行 migrations/*.sql，无需 wrangler、无需联网
```

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 前端 | 原生 HTML/CSS/JS | 无构建、无依赖，加载快，易改 |
| 后端 | Cloudflare Pages Functions（`functions/`） | 与静态站点同源部署，不需要单独 Worker |
| 数据库 | Cloudflare D1 (SQLite) | 通过 `env.DB` 绑定，支持迁移 |
| 鉴权 | 自研 PBKDF2 + 服务端 Session + HttpOnly Cookie | 无第三方登录服务 |
| 统计 | 自研轻量埋点（`POST /api/track`） | 不依赖 Google Analytics，数据在自己库里 |

## 2. 目录结构

```
.
├── public/                     # 静态站点（Pages 的构建输出目录）
│   ├── index.html              # 首页
│   ├── about.html              # 关于我们（内容来自数据库单页）
│   ├── services.html           # 服务项目
│   ├── news.html               # 新闻中心（列表/分类/搜索/分页）
│   ├── contact.html            # 联系我们 + 留言表单
│   ├── admin/index.html        # 管理后台
│   ├── assets/css|js|img/      # 样式、脚本、图标
│   ├── _headers _redirects robots.txt
├── functions/                  # Cloudflare Pages Functions（后端）
│   ├── api/[[path]].js         # /api/* 全部接口入口
│   ├── news/[slug].js          # 文章详情服务端渲染
│   └── sitemap.xml.js          # 动态站点地图
├── lib/                        # 前后端共用的业务代码
│   ├── api.js                  # 路由装配 + 鉴权 + 错误处理
│   ├── api-public.js           # 前台接口
│   ├── api-admin.js            # 后台接口 + 看板统计
│   ├── auth.js                 # 密码哈希 / 会话 / 登录限流
│   ├── store.js                # 站点配置读写
│   ├── markdown.js             # Markdown 渲染（自研）
│   ├── render.js               # 服务端 HTML 渲染
│   ├── router.js  util.js
├── migrations/                 # D1 数据库迁移
│   ├── 0001_init.sql           # 表结构
│   └── 0002_seed.sql           # 演示数据（站点配置/分类/服务/文章/单页）
├── server/dev-server.mjs       # 零依赖本地开发服务器
├── wrangler.toml               # Pages + D1 绑定配置
├── .github/workflows/deploy.yml# 可选：GitHub Actions 自动部署
├── README.md                   # 本文档
└── DEPLOY.md                   # 部署到 GitHub + Cloudflare 的详细步骤
```

## 3. 本地运行（30 秒）

要求：Node.js **≥ 22.5**（使用内置 `node:sqlite`）。无需 `npm install`，无需 wrangler，无需联网。

```bash
npm run dev          # 等价于 node server/dev-server.mjs
```

- 前台：http://localhost:8788/
- 后台：http://localhost:8788/admin/
- 接口自检：http://localhost:8788/api/health
- 默认账号：`admin` / `admin123456`（首次登录时自动创建，**请立即修改**）
- 本地数据库文件：`.data/local.db`（首次启动自动建表 + 写入演示数据）

删除 `.data/local.db` 即可重置本地数据。

### 使用 wrangler（真实 D1 本地模拟，可选）

```bash
npm install
npm run db:migrate:local   # 应用迁移到本地 D1
npm run dev:cf             # wrangler pages dev
```

## 4. 部署到 Cloudflare（概要）

完整步骤见 **[DEPLOY.md](DEPLOY.md)**，核心只有四步：

1. 把代码推送到 GitHub 仓库。
2. 创建 D1 数据库：`npx wrangler d1 create company-site-db`，把返回的 `database_id` 填入 `wrangler.toml`。
3. 在 Cloudflare 控制台 → **Workers & Pages → Create → Pages → Connect to Git**，选择该仓库：
   - Build command：留空（本项目无需构建）
   - Build output directory：`public`
   - 环境变量/密钥：`IP_SALT`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`
   - D1 绑定：变量名 `DB` → 数据库 `company-site-db`
4. 应用数据库迁移：`npx wrangler d1 migrations apply company-site-db --remote`
   （或使用仓库内置的 GitHub Actions 工作流自动完成）

部署完成后访问 `https://你的项目.pages.dev/admin/` 登录后台。

## 5. 环境变量

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `DB` | ✅ | D1 数据库绑定（在 Pages 设置或 wrangler.toml 中配置，非文本变量） |
| `IP_SALT` | 建议 | 访客 IP 哈希盐值，提高统计数据的匿名安全性 |
| `ADMIN_USERNAME` | 建议 | 首次初始化管理员用户名（默认 `admin`） |
| `ADMIN_PASSWORD` | 建议 | 首次初始化管理员密码（默认 `admin123456`，**务必修改**） |
| `SITE_URL` | 可选 | 站点域名，用于生成 sitemap（也可在后台「站点设置」里填 `site_url`） |
| `ENVIRONMENT` | 可选 | `production` / `preview` |

> 只有数据库中**不存在任何管理员**时才会用 `ADMIN_*` 创建账号；之后修改环境变量不会再改密码，请在后台「账号安全」中修改。

## 6. 数据库结构

| 表 | 用途 |
| --- | --- |
| `users` | 管理员账号（PBKDF2 哈希密码） |
| `sessions` | 登录会话（只存 token 的 SHA-256） |
| `login_attempts` | 登录失败限流记录 |
| `settings` | 站点配置键值对（后台可视化编辑） |
| `categories` | 文章分类 |
| `articles` | 文章（Markdown 正文、草稿/发布、置顶、浏览量） |
| `pages` | 单页内容（关于我们、联系我们、隐私政策…） |
| `services` | 服务项目卡片 |
| `messages` | 在线留言 |
| `visits` | 访问明细（路径、来源、设备、地区、匿名访客 ID） |

## 7. 常用命令

```bash
npm run dev                # 本地开发（node:sqlite）
npm run dev:cf             # 本地开发（wrangler + 本地 D1）
npm run db:migrate:local   # 本地 D1 应用迁移
npm run db:migrate:remote  # 线上 D1 应用迁移
npm run db:seed:remote     # 单独写入演示数据（迁移已含，通常不需要）
npm run deploy             # wrangler pages deploy（需先登录）
```

## 8. 二次开发提示

- **改颜色/风格**：编辑 `public/assets/css/style.css` 顶部的 CSS 变量（`--brand`、`--accent` 等）。
- **加接口**：在 `lib/api-public.js`（公开）或 `lib/api-admin.js`（需登录）里加一行 `r.get/post/put/del`，前后端都不需要重新构建。
- **加数据表**：在 `migrations/` 下新增 `0003_xxx.sql`，本地重启自动应用；线上执行 `npm run db:migrate:remote`。
- **换公司信息**：登录后台 → 站点设置，改完刷新前台即可看到。
- **接图床/对象存储**：文章封面目前用图片 URL，可接 R2 或任意图床；如需上传功能，可在 Pages 中绑定 R2 存储桶后按 `lib/api-admin.js` 的模式加一个上传接口。

## 9. 安全说明

- 密码使用 PBKDF2-SHA256（12000 次迭代，兼顾 Workers 免费版 CPU 限制）加盐哈希存储，代码中不保存明文。
- 会话 Cookie 为 `HttpOnly` + `SameSite=Lax`，HTTPS 下自动加 `Secure`；修改密码后所有会话失效。
- 登录失败 15 分钟内超过 10 次会被临时限制；留言 1 小时内超过 5 条会被限流。
- 后台写操作校验 `Origin` 同源，防止 CSRF。
- 访问统计只保存 IP 的加盐哈希，不保存明文 IP；UA 解析仅用于设备/浏览器分布。
- Markdown 渲染前整体转义 HTML，避免 XSS。

## 10. 常见问题

**Q：后台打开是 404 或接口报「数据库未绑定」？**
A：说明 Pages 项目里没有名称为 `DB` 的 D1 绑定。到 Pages → Settings → Functions → D1 database bindings 添加（变量名必须是 `DB`），或确认 `wrangler.toml` 中的 `database_id` 已改为真实值后重新部署。

**Q：部署成功但文章/配置是空的？**
A：还没有执行数据库迁移。运行 `npx wrangler d1 migrations apply company-site-db --remote`，或在 GitHub Actions 工作流中查看迁移步骤是否成功。

**Q：忘记后台密码？**
A：在 Cloudflare D1 控制台执行 `DELETE FROM users;`，然后重新访问后台用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录（会重新创建账号）。

**Q：本地 `npm run dev` 报 `node:sqlite` 相关错误？**
A：Node 版本过低，需要 ≥ 22.5；或改用 `npm run dev:cf`（wrangler 方式）。
