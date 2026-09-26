# itingyu.github.io

个人博客，部署在 GitHub Pages。访问 <https://itingyu.github.io/>。

## 当前状态

骨架已搭建，2026-09-26 由 Multica 上的 `SDD开发团队` 接手续做。

## 目录

```
index.html              首页(hero 手写,「最新文章」区由 build-index 自动生成)
about/index.html        关于
posts/<slug>/index.html 单篇文章(由 scripts/new-post.sh 生成)
posts/index.html        文章列表(自动生成)
archive/index.html      按月归档(自动生成)
tags/index.html         标签总览(自动生成)
tags/<slug>/index.html  单标签页(自动生成)
feeds/rss.xml           RSS 订阅(自动生成)
sitemap.xml             站点地图(自动生成)
404.html                404 页
assets/                 样式 / 主题切换 / favicon
scripts/                写作 + 构建脚本
  new-post.sh           一键生成新文章页
  templates/post.html   文章模板
  render-finance-brief.js   金融简报 Markdown → HTML
  finance-sync.sh       拉 Multica 金融小队简报 → 渲染 → 提示 commit
  publish.sh            一键发布:test + build + 白名单 git add + commit + push
  publish-finance-brief.sh  金融简报专属流程(末尾委托 publish.sh 推送特性分支)
  build-index.js        自动重生成全部聚合页(零依赖)
scripts/__tests__/      node:test 套件(134 条用例)
package.json            npm test / build / check
```

## 写新文章

通过 `scripts/new-post.sh` 一键生成文章页骨架,无需复制模板、不用手填 SEO meta。

### 用法

```bash
./scripts/new-post.sh <slug> "<title>" [--tag <tag>...] [--date YYYY-MM-DD] [--excerpt "<text>"]

# 示例
./scripts/new-post.sh my-first-post "我的第一篇" --tag note --excerpt "占位示例"
```

参数:

- `<slug>` — 文章 URL 段,只允许 `[a-z0-9-]`,违规立即报错
- `<title>` — 文章标题
- `--tag` — 标签,可重复;自动生成 `<meta property="article:tag">` 与 chip 链接
- `--date` — 发布日期,默认今天
- `--excerpt` — 摘要,默认占位文案

### 发布一篇就一行命令

```bash
# 1. 生成文章页(可省 —— 也可直接编辑或用 finance-sync.sh 渲染)
./scripts/new-post.sh my-post "标题" --tag note

# 2. 编辑正文

# 3. 一键发布:test → build → 白名单 git add → commit → push
./scripts/publish.sh                # 默认 master;commit message 自动从新文章推断
./scripts/publish.sh --message "post(my-post): 标题"
```

`scripts/publish.sh` 自动跑 `npm test` 兜底 → `npm run build` 重建聚合页 → 仅 add 白名单
`posts/ index.html posts/index.html archive/ tags/ feeds/ sitemap.xml scripts/templates/`
→ 按新增的 `posts/<slug>/index.html` 推断 `post(<slug>): <标题>` 写 commit → `git push origin master`。

脚本受 `set -euo pipefail` 保护,任何一步失败立即 abort、退出码 ≠ 0;`--message` 缺失时从改动文件推断 slug,带 `<title>...</title>` 提取标题。GitHub Pages 会自动部署。

## 自动化构建

文章数 > 30 后手工维护 `posts/index.html` / `archive/index.html` / `tags/` / `feeds/rss.xml` /
`sitemap.xml` 不再可行。本仓库用 `scripts/build-index.js`(纯 Node 内置,**零依赖**)
扫所有 `posts/<slug>/index.html`,从 `<head>` meta 读 front matter 后重生成全部聚合页。

```bash
npm test       # 跑 node:test 套件(134 条用例)
npm run build  # 重建所有聚合页 + RSS + sitemap + 首页「最新文章」区
npm run check  # 仅校验,不写文件 —— 检测 drift,drift 时退出码 = 1
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

### Front matter 约定

每个 `posts/<slug>/index.html` 的 `<head>` 必须含:

| 字段 | 来源 |
| --- | --- |
| `title` | `<title>` |
| `description` | `<meta name="description">` |
| `date` | `<meta property="article:published_time">` 或 `<time datetime>` |
| `tags[]` | `<meta property="article:tag">` × N(显示名)+ 文章体内 `<a class="chip" data-tag="<slug>">` 提供 URL slug |

`index.html` 的「最新文章」区被 `<!-- build:posts-start -->` … `<!-- build:posts-end -->`
标记包住,build-index 只替换这段,hero 等手写区保持不变。

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

- 焦点在 `input` / `textarea` / `select` / `[contenteditable]` 时,**全部快捷键跳过**,避免与编辑冲突
- `Ctrl` / `Meta` / `Alt` 同时按下时跳过(留作浏览器 / 系统快捷键)
- 浮层淡入在 `prefers-reduced-motion: reduce` 下自动关闭
- 文章页 `<link rel="prev">` / `<link rel="next">` 由 build-index 注入,缺则不触发跳转

## 金融简报同步

金融小队每日 08:00 (Asia/Shanghai) 输出的简报,由金融小队队长自己跑
`scripts/publish-finance-brief.sh` 一键完成「取 md → 渲染 → build → push 分支 → 开 PR」,
技术总监(SDD技术总监)只做最后 PR review + merge。

```bash
# 金融小队队长(每天跑一次)
./scripts/publish-finance-brief.sh --latest
# 写简报评论时务必附 .md 附件(否则 finance-sync.sh 找不到)
```

底层调用:`finance-sync.sh` → `render-finance-brief.js` → `npm run build` → `git push` 分支。

## 远程自动 build(`.github/workflows/build-posts.yml`)

网页编辑器 / iPad Safari / VSCode Web 改 `posts/*.md` → push master →
`.github/workflows/build-posts.yml` 自动跑 `npm ci → validate-frontmatter → npm test → npm run build` →
产物 commit `auto-build: <ts>` → push 回 master → GitHub Pages 60s 内上线。

防死循环三重防护(写在 `jobs.build.if`,见 `design-v2.md §5.2.2`):

| guard | 拦截场景 |
| --- | --- |
| `event_name in {push, workflow_dispatch}` | 拦截 PR / schedule 等事件 |
| `actor != 'github-actions[bot]'` | 拦截 bot 自己 push 引发的二次触发 |
| `!contains(head_commit.message, 'auto-build:')`(workflow_dispatch 时短路) | 拦截产物 commit 触发的自激 |

### ⚠️ 改 `.github/workflows/build-posts.yml` 必跑 `npm test`

`scripts/__tests__/build-posts-workflow.test.js` 把上述契约固化为 PR-CI 红线(YAML schema +
`if:` 表达式按 顶层 `&&` 切 3 段、3 种 guard 全到位、`push` / `workflow_dispatch` 都在)——
任何人「顺手简化」`if:`(漏条件、`&&` 误改 `||`、删 actor 检查)本地 `npm test` 立刻红,PR 拒合。
**提交 workflow 改动前必跑 `npm test`**。

## 后续

技术栈、写作流程、内容来源由 SDD 开发团队按规格驱动开发方式确定。

金融简报类内容由「金融小队」每日产出，会同步发布到此博客。