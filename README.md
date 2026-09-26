# itingyu.github.io

个人博客，部署在 GitHub Pages。访问 <https://itingyu.github.io/>。

## 当前状态

骨架已搭建，2026-09-26 由 Multica 上的 `SDD开发团队` 接手续做。

## 目录

```
index.html              首页（含「最新文章」区，由 build-index 自动生成）
about/index.html        关于
posts/<slug>/index.html 单篇文章
posts/index.html        文章列表（自动生成）
archive/index.html      按月归档（自动生成）
tags/index.html         标签总览（自动生成）
tags/<slug>/index.html  单标签页（自动生成）
feeds/rss.xml           RSS 订阅（自动生成）
sitemap.xml             站点地图（自动生成）
404.html                404 页
assets/                 样式 / 主题切换 / favicon
scripts/                自动化构建脚本
scripts/__tests__/      node:test 套件
```

## 自动化构建

文章数 > 30 后手工维护 `posts/index.html` / `archive/index.html` / `tags/` / `feeds/rss.xml` /
`sitemap.xml` 不再可行。本仓库用 `scripts/build-index.js`（纯 Node 内置，**零依赖**）
扫所有 `posts/<slug>/index.html`，从 `<head>` meta 读 front matter 后重生成全部聚合页。

```bash
npm test       # 跑 node:test 套件（≥ 17 条用例）
npm run build  # 重建所有聚合页 + RSS + sitemap + 首页「最新文章」区
npm run check  # 仅校验，不写文件 —— 检测 drift，drift 时退出码 = 1
```

可用 flag（直接调脚本）：

```bash
node scripts/build-index.js               # 全量重建
node scripts/build-index.js --check       # 校验 drift
node scripts/build-index.js --only rss    # 只重生成 feeds/rss.xml
node scripts/build-index.js --only home   # 只更新首页「最新文章」区
node scripts/build-index.js --help        # usage
```

支持的 `--only` 目标：`posts` / `archive` / `tags` / `tag-pages` / `rss` / `sitemap` / `home`。

### Front matter 约定

每个 `posts/<slug>/index.html` 的 `<head>` 必须含：

| 字段 | 来源 |
| --- | --- |
| `title` | `<title>` |
| `description` | `<meta name="description">` |
| `date` | `<meta property="article:published_time">` 或 `<time datetime>` |
| `tags[]` | `<meta property="article:tag">` × N（显示名）+ 文章体内 `<a class="chip" data-tag="<slug>">` 提供 URL slug |

`index.html` 的「最新文章」区被 `<!-- build:posts-start -->` … `<!-- build:posts-end -->`
标记包住，build-index 只替换这段，hero 等手写区保持不变。

## 后续

技术栈、写作流程、内容来源由 SDD 开发团队按规格驱动开发方式确定。

金融简报类内容由「金融小队」每日产出，会同步发布到此博客。