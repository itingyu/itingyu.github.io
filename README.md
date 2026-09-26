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
  build-index.js        自动重生成全部聚合页(零依赖)
scripts/__tests__/      node:test 套件(59 条用例,含增量缓存)
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

### 贡献流程(三步走)

```bash
# 1. 生成文章页
./scripts/new-post.sh my-post "标题" --tag note

# 2. 编辑正文、提交并推到自己分支
$EDITOR posts/my-post/index.html
git add posts/my-post/
git commit -m "post: my-post"
git push -u origin <your-branch>
```

3. 在 GitHub 上开 PR → CI(`.github/workflows/ci.yml`)自动跑 `npm test` + `npm run check`,
   `verify` job 全部绿后才能合并;合入 `master` 后 `pages-build` 自动重建,GitHub Pages 30 秒内可访问。

> **PR 必跑 CI**:`verify` job 没绿就不合并 —— 这把「漏改聚合页」「RSS 漂移」「测试回归」挡在 `master` 之前。

GitHub Pages 会自动部署。首页 / 归档 / 标签 / RSS 的增量更新由 `scripts/build-index.js` 自动接管。

## 自动化构建

文章数 > 30 后手工维护 `posts/index.html` / `archive/index.html` / `tags/` / `feeds/rss.xml` /
`sitemap.xml` 不再可行。本仓库用 `scripts/build-index.js`(纯 Node 内置,**零依赖**)
扫所有 `posts/<slug>/index.html`,从 `<head>` meta 读 front matter 后重生成全部聚合页。

```bash
npm test       # 跑 node:test 套件(17 条用例)
npm run build  # 增量重建聚合页 + RSS + sitemap + 首页「最新文章」区(SHA-256 缓存)
npm run check  # 仅校验,不写文件 —— 检测 drift,drift 时退出码 = 1
```

可用 flag(直接调脚本):

```bash
node scripts/build-index.js               # 增量(默认,使用 scripts/.cache/build-index/index.json)
node scripts/build-index.js --no-cache    # 强制全量重建,绕过 SHA-256 缓存
node scripts/build-index.js --check       # 校验 drift(不受缓存影响)
node scripts/build-index.js --only rss    # 只重生成 feeds/rss.xml
node scripts/build-index.js --only home   # 只更新首页「最新文章」区
node scripts/build-index.js --help        # usage

# npm 包装
npm run build       # 增量
npm run build:full  # 强制全量(同 --no-cache)
npm run check       # drift 检测
```

支持的 `--only` 目标:`posts` / `archive` / `tags` / `tag-pages` / `rss` / `sitemap` / `home` / `article-pages`。

### 增量构建与缓存失效策略

`npm run build` 默认走增量路径:

1. 扫描 `posts/<slug>/index.html`,对每篇算 `SHA-256(content)`,与缓存 (`scripts/.cache/build-index/index.json`) 的 `postShas[slug]` 比对,得到 `changed` / `added` / `removed` 集合。
2. 决定「受影响」文件集:任何 post 改动 → 7 个聚合页 (`posts/index.html` / `archive/` / `tags/index.html` / `feeds/rss.xml` / `sitemap.xml` / `assets/search-index.json` / 首页 `index.html`) 必重算;`tags/<slug>/index.html` 与 `posts/<slug>/index.html` 同理保守覆盖(related 列表跨页聚合安全起见一并重算)。
3. 受影响文件用 `computeBuild` 拿期望内容,再与磁盘内容比对,**SHA 一致则跳过写盘**(避免 `git diff` 噪声)。
4. 已无任何 post 引用的 tag 页会被自动删除。
5. 缓存目录 `scripts/.cache/` 已加入 `.gitignore`,不要提交。

> **何时需要 `--no-cache` / 删除 `scripts/.cache/`**:
>
> - 改了 `scripts/build-index.js` 的 front matter 解析规则(`parseFrontmatter` / `slugifyTag` / `parseArgs` 等)
> - 改了 `scripts/templates/post.html` 或 `pageShell` / `HEAD_PRE_META` 等渲染模板
> - 改了聚合页算法(`renderPostsIndex` / `renderArchive` / `renderTagsIndex` / `renderRSS` / `renderSitemap` / `renderHomePostsSection` 等)
> - 手工 `rm -rf scripts/.cache/` 后下次 build 会自动重建缓存
>
> 这些情况下缓存 SHA 还停留在旧规则下的输出,继续走增量会输出陈旧内容。安全做法:`rm -rf scripts/.cache/build-index && npm run build`,或直接 `npm run build -- --no-cache`。

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

## 后续

技术栈、写作流程、内容来源由 SDD 开发团队按规格驱动开发方式确定。

金融简报类内容由「金融小队」每日产出，会同步发布到此博客。