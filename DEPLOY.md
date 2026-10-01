# 部署指南：GitHub → Cloudflare Pages + D1

本文是从零把本项目部署到公网的完整步骤，照着做即可。全程免费额度足够一个小型企业官网使用。

- 预计耗时：20 ～ 30 分钟
- 需要：GitHub 账号、Cloudflare 账号（免费注册）、本机 Node.js ≥ 22.5 与 Git

---

## 第 0 步：本地确认系统可运行

```bash
cd 项目目录
npm run dev
```

打开 http://localhost:8788/ 看到首页、http://localhost:8788/admin/ 能用 `admin / admin123456` 登录，说明一切正常。
（在后台发一篇文章、刷新前台首页能看到它，就是完整闭环了。）

---

## 第 1 步：推送到 GitHub

### 1.1 安装 Git（如果还没装）

Windows：https://git-scm.com/download/win ，安装后在 PowerShell 里 `git --version` 能输出版本即可。

### 1.2 创建仓库并推送

在 GitHub 网页上新建一个**空仓库**（不要勾选 README/gitignore），例如 `company-website`，然后在本项目目录执行：

```bash
git init
git add .
git commit -m "feat: 公司官网系统（前台 + 管理后台 + D1 数据库）"
git branch -M main
git remote add origin https://github.com/你的用户名/company-website.git
git push -u origin main
```

> 如果误把 `.dev.vars`、`.data/` 提交了，说明 `.gitignore` 没生效，执行 `git rm -r --cached .data .dev.vars` 后再提交。

---

## 第 2 步：创建 D1 数据库

在项目目录执行（首次会要求浏览器登录 Cloudflare 授权）：

```bash
npx wrangler login
npx wrangler d1 create company-site-db
```

命令会输出类似：

```
✅ Successfully created DB 'company-site-db'
database_id = "1234abcd-56ef-7890-abcd-ef1234567890"
```

把 `database_id` 填入 **`wrangler.toml`**：

```toml
[[d1_databases]]
binding = "DB"                                  # 代码里用 env.DB，不要改
database_name = "company-site-db"
database_id = "1234abcd-56ef-7890-abcd-ef1234567890"   # ← 替换成你的
migrations_dir = "migrations"
```

提交这次修改：

```bash
git add wrangler.toml
git commit -m "chore: 绑定 D1 数据库"
git push
```

### 2.1 应用数据库迁移（建表 + 演示数据）

```bash
npx wrangler d1 migrations apply company-site-db --remote
```

看到 `0001_init.sql`、`0002_seed.sql` 依次应用即成功。
（如果你配置了第 4 步的 GitHub Actions，之后的迁移会自动执行。）

---

## 第 3 步（推荐）：Cloudflare Pages 连接 GitHub 自动部署

1. 打开 Cloudflare 控制台 → 左侧 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
2. 授权并选择刚推送的仓库 `company-website`。
3. 构建设置：
   - **Framework preset**：`None`
   - **Build command**：留空（本项目是纯静态 + Functions，无需构建）
   - **Build output directory**：`public`
   - **Root directory**：留空
4. 展开 **Environment variables (advanced)**，添加：

   | 变量名 | 值 |
   | --- | --- |
   | `IP_SALT` | 随机字符串，例如 `s8Fk2pQz9Lm4Xw7` |
   | `ADMIN_USERNAME` | `admin`（可自定义） |
   | `ADMIN_PASSWORD` | 一个强密码（≥ 8 位） |
   | `SITE_URL` | `https://你的项目.pages.dev`（绑定自定义域名后改成正式域名） |

5. 点击 **Save and Deploy**，等待 1 ～ 2 分钟。
6. 部署完成后打开 `https://<项目名>.pages.dev/`，再访问 `/admin/` 用上面的账号登录。

> **关于 D1 绑定**：本仓库的 `wrangler.toml` 已经声明了 `DB` 绑定与 `pages_build_output_dir`，Cloudflare Pages 在构建时会读取它，通常无需在控制台重复配置。如果控制台构建日志提示找不到数据库，再到 **Settings → Functions → D1 database bindings** 手动添加一条：变量名 `DB`，选择 `company-site-db`（注意不要在控制台和 wrangler.toml 里同时重复绑定同名变量）。

---

## 第 3 步（备选）：用 GitHub Actions 部署

适合想完全用命令行/CI 控制部署的场景。仓库已内置 `.github/workflows/deploy.yml`。

1. 创建 Cloudflare API Token：控制台右上角头像 → **My Profile → API Tokens → Create Token** → 使用模板 **Edit Cloudflare Workers**，再补上权限：

   - Account → **Cloudflare Pages** → Edit
   - Account → **D1** → Edit
   - Account → **Account Settings** → Read

2. 在 GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret** 添加：

   | Secret | 值 |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | 上一步的 Token |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 控制台右下角 / URL 中的 Account ID |

3. 推送到 `main` 分支即自动执行：应用 D1 迁移 → `wrangler pages deploy`。

> 若使用这种方式，建议在 Pages 项目里把 Git 集成关掉（或不要同时创建），避免一次提交触发两次部署。
> 另外 `wrangler pages deploy` 首次运行会自动创建名为 `company-site`（取自 `wrangler.toml` 的 `name`）的 Pages 项目。

---

## 第 4 步：绑定自定义域名（可选但推荐）

1. Pages 项目 → **Custom domains** → **Set up a custom domain**，输入 `www.你的域名.com`。
2. 按提示在 DNS 添加 CNAME（域名也在 Cloudflare 托管时可一键完成）。
3. 绑定成功后回到 **Settings → Environment variables**，把 `SITE_URL` 改成正式域名；或登录后台 → **站点设置 → 站点正式域名** 填一次（用于生成 sitemap）。
4. 打开 `https://你的域名/sitemap.xml` 确认能访问，再把 `public/robots.txt` 里的 Sitemap 地址改成正式域名并重新部署。

---

## 第 5 步：上线检查清单

- [ ] 后台 → **账号安全** 修改默认密码（改完需重新登录）
- [ ] 后台 → **站点设置**：公司名称、电话、邮箱、地址、ICP 备案号、版权信息全部替换为真实内容
- [ ] 后台 → **文章管理** 删除演示文章，发布自己的内容
- [ ] 后台 → **分类管理 / 服务项目** 改成自己的业务分类与服务
- [ ] 后台 → **单页内容**：更新「关于我们」「联系我们」正文
- [ ] 访问前台首页，确认公司名称/电话/页脚已更新（前台由接口动态填充）
- [ ] 手机浏览器打开站点，确认导航折叠与排版正常
- [ ] `/admin/` 已在 `public/_headers` 中设置为 `noindex`，确认不会被搜索引擎收录
- [ ] 需要时在「站点设置 → 统计开关」关闭访问统计

---

## 第 6 步：日常维护

```bash
# 查看线上日志（调试接口问题）
npm run tail

# 修改表结构后：新增 migrations/0003_xxx.sql，然后
npm run db:migrate:remote

# 备份线上数据库到本地 SQL 文件
npx wrangler d1 export company-site-db --remote --output backup-$(date +%F).sql

# 手动清理访问日志（也可在后台「访问日志」里点清理）
npx wrangler d1 execute company-site-db --remote --command "DELETE FROM visits WHERE day < date('now','-180 day')"
```

内容更新（发文章、改设置、看数据）全部在 `https://你的域名/admin/` 完成，不需要再动代码。

---

## 常见问题排查

| 现象 | 原因与解决 |
| --- | --- |
| 页面正常但接口 500，提示「数据库未绑定」 | Pages 缺少名为 `DB` 的 D1 绑定；检查 `wrangler.toml` 的 `database_id` 是否为真实值并重新部署 |
| 后台能登录但列表全空 | 没有执行迁移：`npx wrangler d1 migrations apply company-site-db --remote` |
| 部署成功但 `/api/...` 返回 404 | 确认 `functions/` 目录已提交到仓库（未被 .gitignore 排除），且 `pages_build_output_dir = "public"` |
| 登录提示「失败次数过多」 | 触发了登录限流，等 15 分钟；或在 D1 控制台执行 `DELETE FROM login_attempts;` |
| 忘记后台密码 | D1 控制台执行 `DELETE FROM users;`，再用 `ADMIN_USERNAME`/`ADMIN_PASSWORD` 登录即可重建账号 |
| 修改了 CSS 但线上没变化 | 浏览器/边缘缓存，强制刷新（Ctrl+F5）；`/assets/*` 缓存 1 小时，可在 `public/_headers` 调整 |
| 免费版报 CPU 时间超限 | 登录接口的 PBKDF2 迭代次数偏高时可能发生；可把 `lib/auth.js` 中 `ITERATIONS` 调低（如 8000），或升级 Workers 付费版 |
| GitHub Actions 部署失败：`pages_build_output_dir` 冲突 | 不要把目录再作为参数传给 `pages deploy`，工作流里已使用无参数形式 |

---

## 数据与成本说明

- Cloudflare Pages：免费额度内（每月 500 次构建、无限带宽）。
- D1：免费额度 5 GB 存储、每天 500 万行读取，企业官网远远够用。
- 访问统计表 `visits` 是唯一会持续增长的表，内置「180 天自动清理」逻辑（约 1% 请求触发），也可在后台手动清理或在第 6 步用 SQL 清理。
