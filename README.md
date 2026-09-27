# itingyu.github.io

个人博客,部署在 GitHub Pages。访问 <https://itingyu.github.io/>。

**v2**(2026-09-26 起):**Markdown 为源**(`.md` + YAML frontmatter)、**GitHub Actions 自动 build**、
**WS 热重载预览**、**草稿工作流**。规范详见 [`design-v2.md`](./design-v2.md);
旧版 [`design-v1-archive.md`](./design-v1-archive.md) 备查。

## 目录

```
index.html              首页(hero 手写,「最新文章」区由 build 自动生成)
about/index.html        关于
posts/<slug>/index.md   单篇文章源(写这里;v2 唯一权威源)
posts/<slug>/index.html 单篇文章产物(build 自动产出,提交时随产物一起入仓)
posts/index.html        文章列表(build 产物)
archive/index.html      按月归档(build 产物)
tags/index.html         标签总览(build 产物)
tags/<slug>/index.html  单标签页(build 产物)
feeds/rss.xml           RSS 订阅(build 产物)
sitemap.xml             站点地图(build 产物)
search/index.html       搜索页(build 产物)
assets/search-index.json  搜索索引(build 产物)
404.html                404 页
assets/                 样式 / 主题切换 / 搜索 / favicon
scripts/                写作 + 构建 + 测试脚本
  new-post.sh           一键生成 posts/<slug>/index.md(模板含 YAML + MD body)
  publish.sh            一键发布(test + build + 白名单 commit + push)
                        └─ v2 子命令:./scripts/publish.sh <slug> --status {publish|draft}
  preview.js            本地预览服务(127.0.0.1:8080,WS 热重载)
  build-index.js        自动重生成全部聚合页(MD → HTML,零 npm 依赖)
  markdown.js           自实现 MD 渲染器(17 项语法,见 design-v2 附 A)
  validate-frontmatter.js  YAML frontmatter 字段类型 + 引用路径校验
  render-finance-brief.js  金融简报 JSON → posts/<slug>/index.md
  finance-sync.sh       拉 Multica 金融小队简报 → 渲染
  publish-finance-brief.sh  金融小队队长专用流程
  toggle-draft.js       draft:true↔false 翻转辅助
  templates/post.html   文章模板(被 new-post.sh 套用)
scripts/__tests__/      node:test 套件(195 条用例)
package.json            npm test / build / check / preview
.github/workflows/build-posts.yml  GitHub Actions 自动 build(master push 触发)
```

## 写新文章(Markdown 流程)

通过 `scripts/new-post.sh` 一键生成 `posts/<slug>/index.md`,**默认源是 `.md`**(不是 `.html`)。

### 用法

```bash
./scripts/new-post.sh <slug> "<title>" [--tag <tag>...] [--date YYYY-MM-DD] \
                       [--excerpt "<text>"] [--cover <path>]

# 示例
./scripts/new-post.sh my-first-post "我的第一篇" --tag note --excerpt "占位示例"
./scripts/new-post.sh hello "Hello" --tag note --cover /tmp/cover.svg
```

参数:

- `<slug>` — 文章 slug,只允许 `[a-z0-9-]`,作为目录名与 URL 段(违规立即报错)
- `<title>` — 文章标题
- `--tag` — 标签,可重复;生成 YAML `tags: [a, b]` 与对应 `tags/<slug>/` 页
- `--date` — 发布日期 YYYY-MM-DD,默认今天
- `--excerpt` — 摘要;同时落到 `description` 字段(SEO / RSS)
- `--cover` — 封面图路径(`.svg` / `.jpg` / `.png` / `.webp`),复制到 `posts/<slug>/`

模板会自动写入 11 个 YAML 字段(`title` / `slug` / `date` / `description` / `tags` /
`cover` / `draft` / `author` / `pinned` / `canonical` / `series`)与 MD body 占位段。

### YAML frontmatter 必填

```yaml
---
title: 你的标题           # 必填,缺则 build 报错退出
slug: your-slug           # 默认 = 目录名
date: 2026-09-26          # 必填,ISO 格式
description: 摘要         # 落到 meta description + RSS
tags: [note, finance]     # 数组;slug = 显示名(v2 共用)
cover: posts/<slug>/cover.svg
draft: false              # true = 草稿,不收录到列表/RSS/sitemap
author: itingyu
---
```

完整字段约定与校验见 `node scripts/validate-frontmatter.js`。

### 发布一篇

```bash
# 1. 生成文章源
./scripts/new-post.sh my-post "标题" --tag note

# 2. 编辑 posts/my-post/index.md(Markdown 正文)

# 3. 一键发布:test → build → 白名单 commit → push
./scripts/publish.sh                                    # v1:全量 commit + push(master)
./scripts/publish.sh --message "post(my-post): 标题"    # 自定义 commit message
```

`.github/workflows/build-posts.yml` 在 `.md` push 到 master 后自动跑
`npm test` + `npm run build` + `npm run check` + commit HTML 产物 + push 回 master。
GitHub Pages 60 秒内上线。

## 远程编辑(GitHub 网页改 `.md` → 60s 上线)

不需要本地 clone:

1. 打开 <https://github.com/itingyu/itingyu.github.io/edit/master/posts/<slug>/index.md>
2. 在网页编辑器里改 Markdown + YAML frontmatter
3. **Commit changes** → master
4. 60 秒内 `.github/workflows/build-posts.yml` 自动 build 并把 HTML 产物 push 回 master
5. <https://itingyu.github.io/posts/<slug>/> 即时更新

> 自激防护:workflow 检测 `github-actions[bot]` actor 与 `auto-build:` commit
> message 哨兵,不会无限循环。详见 `.github/workflows/build-posts.yml`。

## 预览(`npm run preview` + WS 热重载)

```bash
npm run preview           # 127.0.0.1:8080,strict(草稿 404)
npm run preview:draft     # 含草稿(--include-draft)
PORT=9000 npm run preview # 换端口
```

特性:

- 监听 `127.0.0.1` 而非 `0.0.0.0`(不暴露到 LAN)
- WS 热重载:编辑 `.md` / `.html` / 任意静态文件,浏览器自动 reload
- 仅 `ws@8` 一个 devDep;无 chokidar / marked / markdown-it
- `Ctrl+C` 干净退出

## 草稿(`draft: true` + `--status draft`)

`posts/<slug>/index.md` YAML 加 `draft: true` 即为草稿 ——
build 时一律不收录(列表 / 聚合 / RSS / sitemap / 搜索索引),文章页直接 404。

### 翻转流程

```bash
# 草稿 → 公开(默认 --status publish)
./scripts/publish.sh my-post                       # 翻转 draft: true → false + commit + push
./scripts/publish.sh my-post --status publish

# 公开 → 撤回
./scripts/publish.sh my-post --status draft        # 翻转 draft: false → true + commit + push
```

`publish.sh <slug>` 自动调 `toggle-draft.js` 改 YAML,然后照常 commit + push。

### 草稿预览

```bash
npm run preview:draft   # 含 draft:true 的文章可访问
```

## v1.2 行宽 +20%(AIWORK1-44)

正文与表格容器宽度比 v1 宽 **20%**:

- `.container` `920px` → `1104px`
- `.container-wide` `1080px` → `1296px`

更适合 Markdown 长行阅读与代码块展示。深色模式不受影响。

## 自动化构建

```bash
npm test       # 跑 node:test 套件(195 条用例,9 个 .test.js)
npm run build  # 从 posts/**/*.md 重建所有聚合页 + RSS + sitemap + 首页「最新文章」
npm run check  # 仅校验,不写文件 —— 无 drift 则退出码 0
```

`npm run check` 默认 no drift(`sitemap.xml` lastmod + `search-index.json` `generated` 都
锁定到「最新 post 日期」,非 today(),跨日不漂)。

支持的 `--only` 目标:

```bash
node scripts/build-index.js --only home     # 只更新首页「最新文章」区
node scripts/build-build.js --only rss      # 只重生成 feeds/rss.xml
node scripts/build-index.js --only sitemap
node scripts/build-index.js --only posts
```

## 键盘快捷键

`assets/keys.js` 提供全局键盘快捷键(Gmail / GitHub 风格)。`build-index.js` 模板与
所有静态 HTML 页面均自动注入 `<script defer src="/assets/keys.js"></script>`。

| 按键 | 行为 |
| --- | --- |
| `j` / `k` | 文章页下一篇 / 上一篇(读 `<link rel="next/prev">`) |
| `g h` / `g p` / `g a` / `g t` | 跳到首页 / 文章 / 归档 / 标签(1.2 秒内连按两键) |
| `s` | focus 到搜索框(若该页有) |
| `Shift+T` | 切换主题 |
| `?` | 弹出 / 隐藏快捷键浮层(`Esc` 关) |

契约:

- 焦点在 `input` / `textarea` / `select` / `[contenteditable]` 时,**全部快捷键跳过**
- `Ctrl` / `Meta` / `Alt` 同时按下时跳过(留作浏览器 / 系统快捷键)
- 浮层淡入在 `prefers-reduced-motion: reduce` 下自动关闭
- 文章页 `<link rel="prev">` / `<link rel="next">` 由 build 注入,缺则不触发跳转

## 金融简报同步

金融小队每日 08:00 (Asia/Shanghai) 输出的简报,由金融小队队长自己跑
`scripts/publish-finance-brief.sh` 一键完成「取 md → 渲染 .md → publish → workflow 自动 build HTML」,
技术总监(SDD技术总监)只做最后 PR review + merge。

```bash
# 金融小队队长(每天跑一次)
./scripts/publish-finance-brief.sh --latest
# 写简报评论时务必附 .md 附件(否则 finance-sync.sh 找不到)
```

底层调用:`finance-sync.sh` → `render-finance-brief.js`(产 `posts/<slug>/index.md`)
→ `publish.sh <slug>` → `.github/workflows/build-posts.yml` 监听 push 后自动
`npm test` + `npm run build` + commit HTML + push 回 master。

## 不做清单(`design-v2.md` §11)

- 不接评论系统
- 不做服务端全文搜索(沿用 v1 `< 50 篇`上限,实际 > 200 仍 client-side `/search/`)
- 不做 i18n
- **不引第三方 markdown 库**(marked / markdown-it / micromark,全自实现)
- **不引 npm 依赖**(package.json 只 `node:test` + ws@8 devDep)
- 不引 CDN / 外部字体
- 不引框架(React/Vue/Svelte)

## 后续

写作流程、规格演进由 SDD 开发团队以 spec-driven 方式维护,所有契约变更先写
`design-v2.md` 再同步实现。

金融简报类内容由「金融小队」每日产出,会同步发布到此博客。