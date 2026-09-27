# itingyu.github.io

个人博客,部署在 GitHub Pages。访问 <https://itingyu.github.io/>。

## 当前状态

v2 落地(2026-09-26 SDD 评审 5/5 通过 · M6/M7 全套实现 + 199 测试用例全绿)。
权威 spec 见 [`design-v2.md`](./design-v2.md);v1 / v1.2 归档见 [`design-v1-archive.md`](./design-v1-archive.md)。

## 目录

```
index.html                     首页(hero 手写 + 「最新文章」区由 build 自动生成)
about/index.html               关于
posts/<slug>/index.md          单篇文章 · Markdown 源(YAML front matter,build 自动生成 index.html)
posts/<slug>/cover.{svg,...}   文章封面(可选)
posts/index.html               文章列表(自动生成)
archive/index.html             按月归档(自动生成)
tags/<slug>/index.html         单标签页(自动生成)
feeds/rss.xml                  RSS 订阅(自动生成)
sitemap.xml                    站点地图(自动生成)
404.html                       404 页
assets/                        样式 / 主题切换 / 快捷键 / favicon / 搜索索引
scripts/                       写作 + 构建脚本(详见下)
  markdown.js                  MD → HTML 渲染器(17 项语法集,自实现)
  build-index.js               聚合页 / RSS / sitemap / 搜索索引生成(自实现)
  new-post.sh                  一键生成 posts/<slug>/index.md(模板 + YAML 占位 + markers)
  validate-frontmatter.js      frontmatter 校验(纯 Node 内置)
  preview.js                   本地预览服务器 + WS 热重载
  publish.sh                   一键发布 + <slug> 草稿翻转子命令
  publish-finance-brief.sh     金融简报专属发布流(v2 走 .md 链)
  render-finance-brief.js      金融简报 .md 渲染
  toggle-draft.js              draft: true↔false YAML 翻转
  __tests__/                   node:test 套件(199 用例)
.github/workflows/
  build-posts.yml              远程编辑自动 build & 部署
package.json                   npm test / build / check / preview / preview:draft
```

## 写新文章(`.md` 流程,v2)

通过 `scripts/new-post.sh` 一键生成 `posts/<slug>/index.md` 骨架(YAML front matter + MD 占位 + `<!-- build:cover -->` / `<!-- build:related -->` marker),不用手填 SEO meta。

### 用法

```bash
./scripts/new-post.sh <slug> "<title>" [--tag <tag>...] [--date YYYY-MM-DD] [--excerpt "<text>"] [--cover <path>]

# 示例
./scripts/new-post.sh my-first-post "我的第一篇" --tag note --excerpt "占位示例"
```

参数:

- `<slug>` — 文章 URL 段,只允许 `[a-z0-9-]`,违规立即报错
- `<title>` — 文章标题
- `--tag` — 标签,可重复;自动生成 `<meta property="article:tag">` 与 chip 链接
- `--date` — 发布日期 `YYYY-MM-DD`,默认今天
- `--excerpt` — 摘要(`description` / `excerpt` 任一即可,`description` 优先),默认占位文案
- `--cover` — 封面图,会复制到 `posts/<slug>/cover.{svg,jpg,png,webp}`

### Front matter(YAML)

```yaml
---
title: 我的第一篇
date: 2026-09-26                          # 必填
tags: [note, life]                        # 必填
description: 一句话摘要                    # 必填(description / excerpt 二选一)
slug: my-first-post                       # 可省(默认目录名)
author: itingyu                           # 默认 itingyu
cover: cover.svg                          # 可选,相对 posts/<slug>/ 路径
series: 金融市场观察                       # 可选(v1.2 沿用)
pinned: false                             # 可选(v1.2 沿用)
draft: false                              # 可选,v2 新增,默认 false
---
```

完整字段约束见 [`design-v2.md` §3.5](./design-v2.md) 与 `scripts/validate-frontmatter.js`。

### 一键发布

```bash
# 1. 生成骨架
./scripts/new-post.sh my-post "标题" --tag note

# 2. 编辑 posts/my-post/index.md(Markdown + YAML)

# 3. 一键发布:test → build → 白名单 git add → commit → push
./scripts/publish.sh --message "post: my-post"   # v1 行为
./scripts/publish.sh my-post                     # v2 草稿翻转(详见「草稿」)
```

`scripts/publish.sh` 自动跑 `npm test` 兜底 → `npm run build` 重建聚合页 → 仅 add 白名单(`posts/<slug>/index.md` / `posts/<slug>/index.html` / 聚合页等) → 按 message commit → `git push origin master`。GitHub Pages 会自动部署。脚本受 `set -euo pipefail` 保护,任何一步失败立即 abort。

## 远程编辑(v2 新增)

GitHub Web / iPad GitHub App / VSCode Web 直接编辑 `posts/<slug>/index.md` → commit 到 `master` → `.github/workflows/build-posts.yml` 触发:

1. `npm ci` 装依赖
2. `node scripts/validate-frontmatter.js` 校验 frontmatter
3. `npm test`(199 用例全绿)
4. `npm run build` 生成 HTML 产物
5. `npm run check` 再校验不漂移
6. commit `auto-build: <ISO ts>` → `git push origin master`(由 `github-actions[bot]` 发起)

**无需 clone 仓库**,网页改完 60s 内产物上线。

**防自激死循环**(workflow 三重防护):

- `actor == 'github-actions[bot]'` → 跳过(拦截自激 commit)
- 非 `push` / `workflow_dispatch` 事件 → 跳过
- `head_commit.message` 含 `auto-build:` 哨兵 → 跳过

`auto-build` 由 workflow 自身产生的 commit 注入,二次 push 时被第三条过滤掉。

**一次性权限配置**:repo `Settings → Actions → General → Workflow permissions` 必须为 `Read and write`(GitHub 默认 Read-only)。已就绪;若权限未配,commit/push 步骤会 403,master 保留上次稳定版本。

## 预览(v2 新增)

本地预览服务器(`scripts/preview.js`,Node 内置 + `ws@8` devDep,零运行时依赖):

```bash
npm run preview           # 起 127.0.0.1:8080
npm run preview -- --port 9000
npm run preview:draft     # 包含 draft: true 文章(默认严格)
INCLUDE_DRAFT=1 npm run preview
```

要点:

- `/posts/<slug>/`:读 `index.md` → 走 `buildArticlePageFromMd` + `renderMarkdown` + `injectArticlePageEnhancements`,与 `npm run build` 字节级一致
- 其他路径:静态服务(MIME + path-traversal safeJoin 防护 + `.md` 直读 403)
- `fs.watch(rootDir, { recursive: true })` 过滤 `posts/**/*.md` + `scripts/**`,100ms debounce 后通过 WebSocket `/ws` 广播 `{t:'reload', p:<path>}`
- 浏览器 WS 客户端由 `<!-- preview:ws-client -->` marker 注入到所有 HTML 响应(幂等,build 产物无副作用),收到 reload 自动 `location.reload()`
- 默认监听 `127.0.0.1:8080`(无外网暴露)

## 草稿(v2 新增)

`frontmatter` 加 `draft: true` 即为草稿:

- ❌ 不生成 `posts/<slug>/index.html`
- ❌ 不收录到 `posts/index.html` / `archive/` / `tags/<tag>/` / `feeds/rss.xml` / `sitemap.xml`
- ✅ 文件仍 commit 进 git,可远程管理草稿

**`scripts/publish.sh` 草稿翻转子命令**(M6.7):

```bash
./scripts/publish.sh welcome                  # draft: true → false(发布)
./scripts/publish.sh welcome --status publish # 同上,显式
./scripts/publish.sh welcome --status draft   # draft: false → true(撤回)
```

行为:读 `posts/<slug>/index.md` 的 `draft:` 字段 → 替换或追加 → `git commit -m "post(<slug>): 上线|撤回 · draft <old> → <new>"` → push。

草稿合并到 master 后,`.github/workflows/build-posts.yml` 仍会跑 build,但产出的 HTML 不会收录到聚合页(`scanPosts` 单点过滤 `draft: true`)。预览草稿用 `npm run preview:draft` 或 `--include-draft`。

## 自动化构建

文章数 > 30 后手工维护 `posts/index.html` / `archive/index.html` / `tags/` / `feeds/rss.xml` / `sitemap.xml` 不再可行。本仓库用 `scripts/build-index.js`(纯 Node 内置 + 自实现 MD/YAML 解析,**零运行时依赖**)扫所有 `posts/<slug>/index.md`,从 YAML front matter 重生成全部聚合页。

```bash
npm test           # 跑 node:test 套件(199 用例)
npm run build      # 重建所有聚合页 + RSS + sitemap + 首页「最新文章」区
npm run check      # 仅校验,不写文件 —— 检测 drift,drift 时退出码 = 1
npm run preview    # 本地预览服务器,详见「预览」
npm run preview:draft  # 同上 + 含草稿
```

可用 flag(直接调脚本):

```bash
node scripts/build-index.js               # 全量重建
node scripts/build-index.js --check       # 校验 drift
node scripts/build-index.js --only rss    # 只重生成 feeds/rss.xml
node scripts/build-index.js --only home   # 只更新首页「最新文章」区
node scripts/build-index.js --help        # usage
```

支持的 `--only` 目标:`posts` / `archive` / `tags` / `tag-pages` / `rss` / `sitemap` / `home`。

### 渲染管线

```
posts/<slug>/index.md
    │  parseYamlFrontmatter
    ▼  renderMarkdown (scripts/markdown.js · 17 项语法集 · htmlCommentPassthrough)
    │  <!-- build:cover --> / <!-- build:related --> marker 保留
    ▼  pageShell + injectArticlePageEnhancements
    │  cover / related / progress / word-count / JSON-LD BreadcrumbList
    ▼  posts/<slug>/index.html
```

**MD 渲染器支持**:`# H1-6` / 段落 / `**bold**` / `*italic*` / `` `inline` `` / `[link]` / `![img]` / `> quote` / `- list` / `1. list` / `---HR` / ` ```fenced``` ` / 自动外链 / 嵌套列表 / 续行 / escape / HTML 注释透传。**不做**:表格、HTML 嵌入、任务列表、删除线、数学公式(详见 `design-v2.md` §11 与附 A)。

**安全**:`<` `>` `&` `"` 转义后输出;`<script>` / `<style>` 标签拒绝;`<img>` 不允许 `onerror` 等事件属性;图片路径只放白名单(相对路径 / HTTP(S));`javascript:` URL 拒绝。

## 键盘快捷键

`assets/keys.js` 提供全局键盘快捷键(Gmail / GitHub 风格)。`build-index.js` 模板与所有静态 HTML 页面均自动注入 `<script defer src="/assets/keys.js"></script>`。

| 按键 | 行为 |
| --- | --- |
| `j` / `k` | 文章页下一篇 / 上一篇(读 `<link rel="next/prev">`) |
| `g h` / `g p` / `g a` / `g t` | 跳到首页 / 文章 / 归档 / 标签(1.2 秒内连按两键) |
| `s` | focus 到搜索框(若该页有) |
| `Shift+T` | 切换主题 |
| `?` | 弹出 / 隐藏快捷键浮层(`Esc` 关) |

契约:

- 焦点在 `input` / `textarea` / `select` / `[contenteditable]` 时,**全部快捷键跳过**,避免与编辑冲突
- `Ctrl` / `Meta` / `Alt` 同时按下时跳过(留作浏览器 / 系统快捷键)
- 浮层淡入在 `prefers-reduced-motion: reduce` 下自动关闭
- 文章页 `<link rel="prev">` / `<link rel="next">` 由 build-index 注入,缺则不触发跳转

## 金融简报同步

金融小队每日 08:00 (Asia/Shanghai) 输出的简报,由金融小队队长自己跑
`scripts/publish-finance-brief.sh` 一键完成「取 md → 渲染 .md → commit + push → workflow 自动 build HTML」,
技术总监(SDD技术总监)只做最后 PR review + merge。

```bash
# 金融小队队长(每天跑一次)
./scripts/publish-finance-brief.sh --latest
# 写简报评论时务必附 .md 附件(否则 finance-sync.sh 找不到)
```

底层调用 v2 命令链:`render-finance-brief.js` 产 `posts/<slug>/index.md` → `publish.sh <slug>` 草稿翻转 + commit + push → `.github/workflows/build-posts.yml` 自动 build HTML。

## 排版与主题(v1.2 行宽 +20%)

- 双主题(浅 / 深)+ 三段式触发(系统 / 手动 / localStorage)
- WCAG AA 通过
- 文章页 `.container` `max-width: 1104px`(v1.2 +20%,`AIWORK1-44`),中文 ~96 字 / 行
- 首页 / 归档 `.container-wide` `max-width: 1296px`(v1.2 +20%,`AIWORK1-44`)
- 字号尺度 / 行高 / 字体栈 沿用 v1 不变
- 焦点可达性 / `prefers-reduced-motion` / 打印样式 全支持

## 后续

技术栈、写作流程、内容来源由 SDD 开发团队按规格驱动开发方式确定。完整 v2 spec 见 [`design-v2.md`](./design-v2.md);v1 / v1.2 历史归档见 [`design-v1-archive.md`](./design-v1-archive.md)。

金融简报类内容由「金融小队」每日产出,会同步发布到此博客。