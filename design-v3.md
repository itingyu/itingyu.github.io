# itingyu.github.io · 设计方案 v3

> 草案 · 2026-10-08 · AIWORK1-84 · SDD 后端工程师起草（待技术总监组织 5/5 评审）
>
> 上游 spec：`design-v2.md`（评审通过后归档为 `design-v2-archive.md`）、`design.md`（v1 / v1.2 归档为 `design-v1-archive.md`）。
> 本文件通过评审后即为**唯一权威 spec**；v1 / v2 只作为历史归档保留。
>
> 本草案的每一条技术结论均在本机 Jekyll 4.4.1 上以最小 fixture 实测过（证据见 §附录 C），**不是纸面推演**。

---

## 版本变更摘要（changelog）

| 版本 | 时间 | 阶段 | 主要内容 |
| --- | --- | --- | --- |
| v1.0 | 2026-09-26 上午 | 设计稿第一版 | 浅/深双主题 + 文章页模板 + 标签/归档/RSS/SEO |
| v1.2 | 2026-09-26 下午 | v1.2 增量 | `article:section` + `article:pinned` + `og:image` + 代码高亮 |
| v2 | 2026-09-26 晚 | AIWORK1-48 | Markdown 源文件 + draft 字段 + GH Actions 自动 build + 行宽 +20% |
| **v2.1** | 2026-10-07 | AIWORK1-75 | per-series RSS + sitemap `<series>` + nav 增「专栏」+ BlogPosting `hasPart` |
| **v3** | **2026-10-08** | **AIWORK1-84（本文件）** | **架构再反转：MD 为唯一源、GitHub Pages 内置 Jekyll 原生直渲、仓库零 HTML 产物、零 CI build** |

**编号勘误（必须在评审时确认）**：`design-v2.md` 的 changelog 把专栏增量标成了「v3」。本文件把架构版本占用为 v3，故专栏增量在本 spec 中重编号为 **v2.1**。§5 / §7 仍按 v2.1 的契约（per-series RSS / sitemap `<series>` / nav 专栏 / `hasPart`）实现，编号差异只影响 changelog 文案。

**反转的核心点**：v1「HTML 即源码」→ v2「MD 是源、HTML 是产物（Actions build）」→ **v3「MD 是源、Jekyll 渲 HTML、产物只活在 GitHub Pages 构建容器里」**。仓库里不再有任何需要人工/CI 生成的 HTML 产物；`git push` 一个 `.md` 就完成「写作 → 上线」。

### 与 issue 描述的事实校正（评审必读）

起草时对 `origin/master@cc96465` 做了逐项核对，本 spec 以下面这些**实测事实**为准：

| issue 描述的假设 | 实测事实 | 本 spec 的处理 |
| --- | --- | --- |
| 现有 **19 篇** `posts/<slug>/index.html` | 实为 **22 篇**（5 金融 + 15 厨房 + sing-box + welcome）；`posts/*/index.html` 实测 22 个 | §3 / §5.5 / §8 / §9 按 22 篇写 |
| 需删除 `.github/workflows/build-posts.yml` | 仓库**没有** `.github/` 目录（v2 的 M7 从未实施） | 影响面矩阵按「无 workflow」写，不做删除动作 |
| 需删 `preview.js` / `markdown.js` / `toggle-draft.js` | 三者**都不存在**；现有脚本只有 `build-index.js` / `validate-frontmatter.js` / `render-cooking-docs.js` / `render-finance-brief.js` / `finance-sync.sh` / `new-post.sh` / `publish.sh` / `publish-finance-brief.sh` | §8 按真实清单写 |
| `permalink: /posts/:name/` | **`:name` 对 `_posts` 无效**：实测静默产出字面量 `/posts/2026-10-07-kitchen/`（日期前缀不剥离） | §D1 改为 `/posts/:slug/`，实测 `/posts/welcome/` |
| 插件用 `jekyll-feed` + `jekyll-sitemap` | 两者会写 `/feed.xml` 与 `/sitemap.xml`，与 v2.1 的 per-series RSS / sitemap `<series>` / `changefreq` / `priority` 契约**不兼容且目的地冲突** | §D9 不启用，改 Liquid 自渲染 `.xml`（实测可行） |
| 首页用 `jekyll-paginate` | 实测 `jekyll-paginate` **只认 `index.html` 模板**，`index.md` 会静默跳过并告警 | §D3 锁 `posts/index.html` 为分页模板 |
| 标签用 `_data/tags.yml` 自生成 | Jekyll 内置 `site.tags` 本就是 tag→posts 哈希；若把 collection 命名为 `tags` 会**覆盖**该哈希（实测 `TypeError: 0 is not a symbol nor a string`） | §D10 明确代价与替代计数方案，不引 `_data/tags.yml` |
| 19 篇测试基线 | 现有测试为 `node --test` 6 个文件（`build-index` / `frontmatter` / `keys` / `validate-frontmatter` / `render-finance-brief` / `finance-sync-attachments`） | §8 逐文件标注保留 / 重写 |

---

## 一句话定位（§1）

**itingyu 的个人博客** —— 内容源只有 Markdown，渲染交给 GitHub Pages 内置的 Jekyll：仓库里没有 HTML 产物，没有 CI build，没有 npm 渲染链，`git push` 一个 `.md` 就上线。

---

## 1. 设计目标

| 目标 | 评估指标 | 与 v2 的差别 |
| --- | --- | --- |
| **零运行时 build** | 仓库内 HTML 产物数 = 0（聚合页由 Jekyll 渲，不落库）；`.github/workflows/` 不存在 | v2 靠 Actions build + 提交产物 |
| **写得动** | 新增一篇 ≤ 3 分钟：`scripts/new-post.sh` 产出 `_posts/<date>-<slug>.md` | 路径从 `posts/<slug>/index.md` 变为 `_posts/` |
| **写得远** | GitHub 网页直接编辑 `_posts/*.md` → commit → Pages 自动上线，无需 clone | v2 需要 Actions 接力 |
| **看得舒服** | 正文 `.container` 1104px（≈96 CJK 字/行）；首页/归档 `.container-wide` 1296px | 不变 |
| **找得到** | 首页 → 文章 → 标签 → 归档 / 专栏 → 搜索，全链路 ≤ 2 跳 | 不变（`/series/` 已在 nav 内） |
| **跑得稳** | Jekyll 渲染失败时 Pages 保留上一次成功版本（GitHub Pages 语义），不会带病上线 | v2 是 Actions 失败即无产物 |
| **零供应链** | 不引第三方主题 / 不引 CDN / 不引 npm 渲染库；只用 Pages 白名单内的 Jekyll + 3 个插件 | v2 是「自研 MD 渲染器」 |
| **可回归** | 22 篇文章 URL 全保留；RSS / sitemap / 搜索索引 / JSON-LD 有契约测试 | v2 是 byte-equal 目标（难测，见 §D8） |

---

## 2. 技术选型（§2）

### 2.1 渲染器与版本真源

| 项 | 决策 |
| --- | --- |
| 渲染器 | **Jekyll**，由 GitHub Pages 内置构建容器执行 |
| 版本真源 | `Gemfile` 只写 `gem "github-pages", group: :jekyll_plugins`——**Pages 构建环境加载的正是同一个 gem**，本地 `bundle install` 与线上自动同版本 |
| 版本说明 | issue 写的「Jekyll 4.3.x」作废：Pages 的构建环境由 `github-pages` gem 锁死（Jekyll 3.10.x 系列），不是 4.x。以 gem 为准，本 spec 不写死小版本号 |
| 校验口径 | 本草案的实测在 **Jekyll 4.4.1** 上完成（§附录 C）。所用能力（collection `permalink`、`where_exp`、`group_by_exp`、`sort`、`jsonify`、`strip_html`、jekyll-paginate、jekyll-seo-tag）在 3.10 与 4.x 语义一致；Phase F 的契约测试必须在 `github-pages` 锁定版本下再跑一遍（清单见 §9 AC-16） |

`Gemfile`：

```ruby
source "https://rubygems.org"
gem "github-pages", group: :jekyll_plugins
```

### 2.2 插件矩阵（逐项给出「启用 / 不启用」与理由）

| 插件 | 决策 | 理由 |
| --- | --- | --- |
| `jekyll-paginate` | **启用** | `/posts/` 列表分页（22 篇 → 每页 12 篇）。实测**必须** `index.html` 作为模板 |
| `jekyll-seo-tag` | **启用（受限使用）** | 只在**非文章页**输出 `{% seo %}`；文章页关闭（实测 seo-tag 会自己产出 `BlogPosting` JSON-LD，与我们的契约字段重复 → §D4） |
| `jekyll-optional-front-matter` | **启用（显式声明）** | Pages 默认已在用；显式列出避免本地与线上差异 |
| `jekyll-feed` | **不启用** | 产物固定在 `/feed.xml`（与 `/feeds/rss.xml` 并存会造成双 RSS 混淆），且模板产不出 v2.1 契约要求的 per-series `atom:link rel="related"` 与 `content:encoded` |
| `jekyll-sitemap` | **不启用** | 产物固定写 `/sitemap.xml`，与本 spec 自渲染的 `/sitemap.xml` **目的地冲突**（同 URL 两个产物，谁胜出取决于构建顺序，不可测）；且模板只有 `<loc>` / `<lastmod>`，丢失 `changefreq` / `priority` / `<series>` 子元素 |
| `jekyll-archives` | **不引入** | 不在 Pages 白名单 |
| `jekyll-lunr-search` 等搜索插件 | **不引入** | 不在白名单；搜索自建（§D5） |
| 第三方主题（Minimal Mistakes / chirpy / minima） | **不引入** | 保留 design-v2 的自定义主题能力（自定义 `_layouts` + 既有 `assets/style.css`） |

RSS / sitemap / 搜索索引 / per-series feed 全部由「带 front matter 的 `.xml` / `.json` 页 + Liquid」自渲染——**实测可行**（§附录 C V6）。

### 2.3 Markdown 与高亮

| 项 | 值 |
| --- | --- |
| Markdown 引擎 | `kramdown`，`kramdown.input: GFM`（`kramdown-parser-gfm` 是 `jekyll` 自带依赖，Pages 环境具备） |
| 高亮 | `highlighter: rouge`（构建期渲染成 `<div class="highlighter-rouge">`，无前端 JS） |
| 回归说明 | design-v1/v2 提到过 `prism.js`，但 `assets/` 实测**没有** `prism.js`，故切 Rouge **无视觉回归**；`assets/style.css` 里若有 `.token-*` 规则会在 Phase C 一并清理（可选项，不阻塞） |
| `auto_ids` | 保持默认 `true`（v1 依赖标题 `id` 做锚点，§4.5 DOM 契约要求保留） |
| 表格 / 脚注 / 定义列表 | kramdown 原生支持（GFM 表格亦支持），沿用 22 篇文章里已有的表格语法 |

### 2.4 主题与前端

| 项 | 决策 |
| --- | --- |
| 主题 | 自定义模板（`_layouts/` + `_includes/`），**DOM/class 与 v1 产物保持一致**（§4.5），因此 `assets/style.css` 无需改动即可继续生效 |
| 字体栈 | 不变、**零 CDN**：`Inter → -apple-system → system-ui`；正文衬线 `ui-serif → Charter → Iowan Old Style → Apple Garamond`；等宽 `ui-monospace → SFMono-Regular → JetBrains Mono` |
| 行宽 | `.container` 1104px / `.container-wide` 1296px（v2 起生效，v3 不动） |
| 字号尺度 | 沿用 `assets/style.css` 的 `--step--1 … --step-5` `clamp()` 尺度与 `--line: 1.7` |
| 前端 JS | `assets/theme.js`（主题切换 + 阅读时长 / 字数）、`assets/keys.js`（快捷键）、`assets/search.js`（搜索）**保留不改逻辑**；仅 `search.js` 的索引 URL 改一行（§D5） |
| 不引入 | React / Vue / Svelte / 任意 CDN 资源 / 任意 npm 运行时依赖 |

### 2.5 包与脚本

- `package.json` **保留**，但只承载契约测试入口（`npm test` → `node --test`）；删除 `build` / `check` / `build:home` / `build:rss`（v1 渲染链退役）。`package.json` 不新增任何 dependency。
- 本地预览 = `bundle exec jekyll serve`（无需自研 `preview.js`）。

---

## 3. URL 契约（§3）

**总原则**：现存 URL **一个都不能变**；新 URL 只能**新增**（`/posts/page2/`）。

`baseurl: ""`（项目根域，`https://itingyu.github.io/`），`url: "https://itingyu.github.io"`。

| 路径 | 含义 | v1 现状 | v3 实现方式 | 校验 |
| --- | --- | --- | --- | --- |
| `/` | 首页 | `index.html`（手写壳 + build 注入列表） | `index.md`（`layout: home`） | AC-03 |
| `/posts/` | 全部文章（第 1 页） | `posts/index.html` | `posts/index.html`（`paginator: jekyll-paginate`，`layout: posts`） | AC-04 |
| `/posts/page2/` | 全部文章（第 2 页） | 无（**新增**） | jekyll-paginate 生成 | AC-04 |
| `/posts/<slug>/` | 单篇文章（22 个） | `posts/<slug>/index.html` | `_posts/<date>-<slug>.md` + `permalink: /posts/:slug/` | AC-02 |
| `/archive/` | 按月归档 | `archive/index.html` | `archive/index.md`（`layout: archive`） | AC-05 |
| `/tags/` | 全部标签 + 计数 | `tags/index.html` | `tags/index.md`（`layout: tags`） | AC-06 |
| `/tags/<slug>/` | 单标签（23 个） | `tags/<slug>/index.html` | `_tags/<slug>.md`（collection `tags`） | AC-06 |
| `/series/` | 专栏总览 | `series/index.html` | `series/index.md`（`layout: series`） | AC-07 |
| `/series/厨房学/` | 单专栏 | `series/厨房学/index.html` | `_series/厨房学.md`（collection `series`，`:name` → CJK 原样） | AC-07 |
| `/series/金融市场观察/` | 单专栏 | `series/金融市场观察/index.html` | `_series/金融市场观察.md` | AC-07 |
| `/search/` | 搜索页 | `search/index.html` | `search/index.md` | AC-09 |
| `/search/index.json` | 搜索索引 | 无（旧路径 `assets/search-index.json`） | `search/index.json`（带 front matter 的 Liquid 页） | AC-09 |
| `/about/` | 关于 | `about/index.html` | `about/index.md` | AC-10 |
| `/404.html` | 错误页 | `404.html` | `404.html`（带 front matter，`layout: notfound`） | AC-11 |
| `/feeds/rss.xml` | 全站 RSS | `feeds/rss.xml` | `feeds/rss.xml`（Liquid 自渲染） | AC-12 |
| `/feeds/series-厨房学.xml` | 专栏 RSS | `feeds/series-厨房学.xml` | 同路径文件，由 `scripts/sync-series.js` 生成骨架 | AC-13 |
| `/feeds/series-金融市场观察.xml` | 专栏 RSS | `feeds/series-金融市场观察.xml` | 同上 | AC-13 |
| `/sitemap.xml` | 站点地图（含 `<series>` 子元素） | `sitemap.xml` | `sitemap.xml`（Liquid 自渲染） | AC-14 |
| `/robots.txt` | 爬虫规则 | `robots.txt` | 原样保留（无 front matter，静态透传） | AC-11 |
| `/assets/{style.css,theme.js,keys.js,search.js,favicon.svg}` | 静态资源 | 同名 | 原样保留 | AC-15 |
| `~~/assets/search-index.json~~` | 旧搜索索引 | 存在 | **删除**，索引改由 `/search/index.json` 生成 | AC-09 |

### 3.1 22 个文章 slug（URL 兼容清单，逐条比对用）

```
finance-2026-09-26   finance-2026-09-27   finance-2026-09-28
finance-2026-09-29   finance-2026-09-30
kitchen-01-principles
kitchen-02-ingredient-selection   kitchen-02b-prep-washing   kitchen-02c-raw-food
kitchen-03-seasoning   kitchen-04-knife-skills   kitchen-05-heat-control
kitchen-06-cooking-methods   kitchen-07-classic-recipes   kitchen-08-advanced
kitchen-09-management   kitchen-10-nutrition   kitchen-11-taboos
kitchen-12-eight-cuisines   kitchen-13-cuisine-dishes
sing-box-setup-experience   welcome
```

### 3.2 编码与尾斜杠

- 专栏 URL 路径**保持 CJK 原始字符**（`/series/厨房学/`），不 percent-encode；文件名即显示名，`permalink: /series/:name/` 直接产出该 URL（实测）。
- 所有页面 URL **带尾斜杠**（Jekyll `pretty` 语义 + `permalink` 显式书写）。
- 禁止任何 301 / 302 / 重定向层；迁移后旧 URL 直接 200。

### 3.3 404 行为

- GitHub Pages 对未命中路径回落到 `/404.html`；v3 保持该机制，不引入自定义 404 路由。
- `/404.html` 保留 v1 的 `class="container fourofour"` 结构（§4.5）。
- **soft 404 禁令**：任何 `_posts` 中 `draft: true` 的文章**不产生产物 URL**（§D6），因此不会出现「点进去是 404」的软 404。

---

## 4. 视觉与可访问性规范（§4）

> 判定标准：**`assets/style.css` 不改**即可让 v3 页面与 v1 页面视觉等价；模板必须复用 v1 的 DOM/class 契约（§4.5）。

### 4.1 设计 token（冻结）

| 组 | 契约 |
| --- | --- |
| 字号尺度 | `--step--1 … --step-5` 全部 `clamp()` 表达式原样保留（0.85rem → 4.80rem） |
| 行高 | `--line: 1.7` |
| 字栈 | `--font-sans` / `--font-serif` / `--font-mono` 三组原样保留，**不引入网络字体** |
| 色板 | `--fg/--bg/--bg-elev/--bg-soft/--border/--accent(#6d28d9)/--accent-2(#db2777)/--code-* /--selection` 等 30+ 变量原样保留 |
| 圆角/阴影 | `--r-sm/--r-md`、`--shadow-sm/md/lg` 原样保留 |
| 语义色 | `--tag-finance` / `--tag-algorithm` / `--tag-note` 及其 `-bg` 原样保留 |

### 4.2 主题机制（双主题 + FOUC 防护）

1. **三段式**：系统默认（`prefers-color-scheme`）→ 用户手动切换（`.theme-toggle`）→ `localStorage['itingyu-theme']` 持久化。
2. **选择器契约**：`:root[data-theme="dark"]` 与 `:root:not([data-theme="light"])` 双写，保留现有 `@media (prefers-color-scheme: dark)` 兜底。
3. **FOUC 防护**：`_includes/head.html` 中的内联脚本**字节级沿用** v1 的 `FOUC_SCRIPT`（见 `scripts/build-index.js:54-68`），位置在 `<link rel="stylesheet">` **之前**，同步设置 `document.documentElement.setAttribute('data-theme', t)`。
4. **切换按钮**：`_includes/theme-switcher.html` 输出 `<button class="theme-toggle" data-theme-toggle>` + `svg.icon-moon` + `svg.icon-sun`（与 v1 DOM 完全一致）。
5. **主题 JS**：`assets/theme.js` 不改；它顺带负责 `[data-reading-time]` / `[data-word-count]` 的客户端填充，模板只需保留这两个 `data-*` 钩子。

### 4.3 WCAG AA 与减少动画

| 项 | 要求 |
| --- | --- |
| 对比度 | 正文 / 背景 ≥ 4.5:1，大字 ≥ 3:1；浅深两套均达标（沿用 v1 已验收色板，Phase C 只做回归核对） |
| 焦点 | 所有可交互元素有 `:focus-visible` 可见焦点环；`.skip-link` 跳 `#main` |
| 语义与朗读 | `<main id="main">`、`<nav aria-label="主导航">`、`aria-current="page"`、装饰性 SVG `aria-hidden="true"` |
| 减少动画 | `@media (prefers-reduced-motion: reduce)` 下关闭过渡与平滑滚动 |
| 打印 | 打印样式（隐藏 nav / 展开文章正文）保留 |
| 缩放 | 320px 宽视口无横向滚动；`.container` 的 `padding: 0 1.5rem` 兜底保留 |

### 4.4 内容宽度

| 选择器 | 值 | 适用 |
| --- | --- | --- |
| `.container` | `max-width: 1104px`（v1 的 920px → v2 起 1104px，v3 保持） | 文章页 / about / search / 404 |
| `.container-wide` | `max-width: 1296px` | 首页 / 归档 / 标签 / 专栏列表 |

### 4.5 DOM / class 契约表（视觉等价的可测依据）

Phase C 的模板**必须**产出下表节点；AC-03/05/06/07/10/11 按此断言。

| 页面 | 必需节点 / class | v1 对照文件 |
| --- | --- | --- |
| 整站壳（所有页） | `div.reading-progress[data-reading-progress]`、`a.skip-link[href="#main"]`、`header.site-header`（`a.site-brand > span.site-brand-mark` + `span`）、`nav.site-nav[aria-label="主导航"]`（7 个 `<a>`：`/` `/posts/` `/archive/` `/tags/` `/series/` `/search/` `/about/` + `button.theme-toggle[data-theme-toggle]`）、`main#main.container`、`footer.site-footer > div.links`（9 个链接，含 `/feeds/rss.xml` 与 GitHub）+ `p`（版权 + 免责） | `scripts/build-index.js:47-121` |
| 首页 | `h2.section-title`（最新文章）、`ul.post-list > li > h3.post-title > a`、`div.post-meta > time[datetime]` / `span.dot` / `a.chip[data-tag]`、`p.post-excerpt`、`<a href="/posts/">查看全部文章 →</a>`；「查看全部文章」链接必须存在 | `index.html` |
| 文章页 | `article > header.article-header > h1`、`div.post-meta`（`time` / `span.dot` / `a.chip[data-tag]` / 有专栏时 `a.chip[data-series]` / `span[data-reading-time]` / `span.word-count[data-word-count]`）、`p.post-excerpt`、正文首行为 `blockquote`（摘要引用块）、正文 `h2/h3` 带 `id` 锚点、`footer.article-footer`（末次更新 + 「在 GitHub 上编辑」链接，**href 改指 `_posts/<file>.md`**）、`<link rel="prev">` / `<link rel="next">` | `posts/kitchen-07-classic-recipes/index.html` |
| 归档 | `div.archive-group`（按月，月份倒序） | `archive/index.html` |
| 标签总览 | `div.tag-cloud` + `a.chip` + `span.tag-count` | `tags/index.html` |
| 单标签 / 单专栏 | 复用 `ul.post-list` 卡片结构 | `tags/note/index.html`、`series/厨房学/index.html` |
| 专栏总览 | `div.series-grid > div.series-card`（`h3.series-card-title` / `p.series-card-desc` / `div.series-card-meta` / `span.series-card-count`）+ `p.series-hint` | `series/index.html` |
| 搜索 | `div.search-box > input[data-search-input]`、`p.search-hint`、`div.search-status[data-search-status]`、`div.search-results[data-search-results]` | `search/index.html` |
| 404 | `main#main.container.fourofour` | `404.html` |

### 4.6 唯一允许的 markup 增量

| # | 增量 | 理由 |
| --- | --- | --- |
| 1 | `<nav>` 当前项加 `aria-current="page"` | 无障碍；v1 的 `pageShell` 里 `.replace('data-nav=…')` 因 `SITE_HEADER` 字符串不含 `data-nav` 而实际是死代码，v1 页面无 `aria-current` |
| 2 | 文章页补 `data-nav-*` 属性（v1 `SITE_HEADER` 有、页面产物里没有） | 与整站壳一致，便于前端定位 |
| 3 | `article-footer` 的「在 GitHub 上编辑」URL 由 `posts/<slug>/index.html` 改为 `_posts/<date>-<slug>.md` | 迁移后源文件位置变了 |

除以上 3 条外，v3 页面 DOM 与 v1 保持结构等价（属性顺序 / 空白不要求字节一致）。

---

## 5. 内容模型（§5）

### 5.1 `_posts/<YYYY-MM-DD>-<slug>.md` front matter

```yaml
---
layout: post
title: "经典菜谱精讲"                          # 必填，单行，禁 \n
date: 2026-10-07 08:00:00 +0800                # 必填，YYYY-MM-DD 或带时间（见 §D14）
tags: [cooking, kitchen, recipes]              # 必填，slug 数组（可含中文显示名？不 —— 只放 slug）
excerpt: "一道菜做\"会\"比做\"多\"重要。"         # 必填，≤ 500 字
series: 厨房学                                 # 可选，值为 _series/<file> 的显示名
pinned: false                                  # 可选，默认 false
cover: null                                    # 可选，站内相对路径或外链 URL，默认 null
draft: false                                   # 可选，默认 false
---
```

| 字段 | 类型 | 必填 | 默认 | 格式约束 | 落点 |
| --- | --- | --- | --- | --- | --- |
| `layout` | string | 否 | `_posts` defaults 里的 `post` | 固定 `post` | 布局选择 |
| `title` | string | ✅ | — | 单行，禁换行 | `<title>` / `og:title` / JSON-LD `headline` / `<h1>` |
| `date` | date | ✅ | — | `YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM:SS +0800` | `article:published_time`（**输出 date-only**）/ `<time datetime>` / JSON-LD `datePublished` / `dateModified` / 排序键 |
| `tags` | array\<string\> | ✅ | — | 元素必须是 `tags/<slug>/` 里存在的 slug | `article:tag` × N / chip / JSON-LD `keywords` / `/tags/<slug>/` 归属 |
| `excerpt` | string | ✅ | — | ≤ 500 字 | `meta description` / `og:description` / JSON-LD `description` / 文章页 `p.post-excerpt` |
| `series` | string\|null | — | `null` | 必须是 `_series/<file>.md` 的 `title` | `article:section` / `a.chip[data-series]` / JSON-LD `articleSection` / `/series/<name>/` 归属 / `hasPart` |
| `pinned` | bool | — | `false` | 仅 `true`/`false` | 首页精选位 |
| `cover` | string\|null | — | `null` | 站内 `/assets/...` 或 `https://...` | `og:image` / `twitter:image` |
| `draft` | bool | — | `false` | 仅 `true`/`false` | `true` → 不产出任何产物 URL（§D6） |

> **slug 从哪来**：Jekyll 从文件名去掉日期前缀得到 slug（`2026-10-07-kitchen-13-cuisine-dishes.md` → `kitchen-13-cuisine-dishes`），配合 `permalink: /posts/:slug/` 产出 `/posts/kitchen-13-cuisine-dishes/`（实测）。因此**文件名 slug 必须等于 v1 目录名**（§5.5 的硬约束）。

### 5.2 `_series/<显示名>.md`（collection `series`）

```yaml
---
layout: series-detail
title: 厨房学                    # 必填，显示名；文件名词干必须与之一致
description: 从厨房原理到八大菜系家常做法的系统学习路径,业余到家庭厨房实战   # 必填
order: 2                        # 可选，总览页排序（缺省按 title 升序）
---
```

- 文件名 = 显示名（允许 CJK），`permalink: /series/:name/` 直接产出 `/series/<显示名>/`。
- 一篇文章的 `series:` 值必须与某个 `_series/<file>.md` 的 `title` **完全相等**（测试 AC-17 断言引用完整）。
- 专栏内 prev/next、成员计数、JSON-LD `hasPart` 全部由 Liquid 实时计算（`where_exp: "p", "p.series == page.title"`），文档正文只放人类可读简介。

### 5.3 `_tags/<slug>.md`（collection `tags`）

```yaml
---
layout: tag
title: 金融                # 必填，显示名（如 CJK）
tag: finance               # 必填，slug，必须等于文件名
---
```

- 计数**不写进文件**（由 `/tags/` 与 tag 页在渲染时扫 `site.posts` 计算，§D10）。
- 文件由 `scripts/sync-tags.js` 从 `_posts` 的 `tags:` 幂等生成（§D11），显示名映射见 §5.5 第 8 行。

### 5.4 页面 front matter（聚合页）

| 文件 | 关键 front matter |
| --- | --- |
| `index.md` | `layout: home` |
| `posts/index.html` | `layout: posts`、`paginator: jekyll-paginate`（**必须是 `.html`**，§D3） |
| `archive/index.md` | `layout: archive` |
| `tags/index.md` | `layout: tags` |
| `series/index.md` | `layout: series` |
| `search/index.md` | `layout: page`、`title: 搜索` |
| `search/index.json` | `layout: null`、`permalink: /search/index.json`、`sitemap: false` |
| `feeds/rss.xml` | `layout: null`、`permalink: /feeds/rss.xml`、`sitemap: false` |
| `feeds/series-<name>.xml` | `layout: null`、`permalink: /feeds/series-<name>.xml`、`sitemap: false`、`series: <显示名>` |
| `sitemap.xml` | `layout: null`、`permalink: /sitemap.xml`、`sitemap: false` |
| `404.html` | `layout: notfound`、`permalink: /404.html` |
| `about/index.md` | `layout: page`、`title: 关于` |

### 5.5 迁移矩阵（v1 HTML → v3 front matter）

| # | v1 HTML 位置 | v3 front matter | 22 篇实测取值说明 |
| --- | --- | --- | --- |
| 1 | `<title>X · itingyu</title>` | `title: X` | 去掉 ` · itingyu` 后缀 |
| 2 | `<meta name="description" content="X">` | `excerpt: X` | 优先用 `og:description`（更短，是 v1 的「一句话摘要」）；两者不一致时以 `og:description` 为准并记入迁移 PR 描述 |
| 3 | `<meta property="article:published_time" content="YYYY-MM-DD">` | `date: YYYY-MM-DD HH:MM:SS +0800` | 同日多篇按 §D14 分配时间；对外仍渲染 date-only |
| 4 | `<meta property="article:tag" content="X">` × N | `tags: [slug…]` | `金融→finance`、`随笔→note`（v1 已 slugify，chip 实测：`href="/tags/finance/" data-tag="finance">金融`）；其余已是 ASCII slug |
| 5 | `<meta property="article:section" content="金融市场观察">` | `series: 金融市场观察` | 仅 5 篇金融 + 15 篇厨房有；sing-box / welcome 无 |
| 6 | `<meta name="series:description" content="X">` | `_series/<显示名>.md` 的 `description` | 从文章上移到专栏定义（文章侧不再重复） |
| 7 | `<meta property="article:pinned" content="true">` | `pinned: true` | 22 篇实测均无 pinned → 一律 `pinned: false` |
| 8 | `<meta property="og:image" content="X">` | `cover: X` | 22 篇实测均无 `og:image` / 无 `cover.svg` → 一律 `cover: null` |
| 9 | `<!-- series -->` 注释 / `<a class="chip" data-series>` | `series:`（与 #5 同源） | 二者冲突时以 `<meta article:section>` 为准 |
| 10 | `posts/<slug>/index.html` | `_posts/<date>-<slug>.md` | **文件名 slug 必须 == 目录名**（`scripts/validate-frontmatter.js` 断言） |
| 11 | 正文 HTML（22 篇） | Markdown body | 16 篇已有 `posts/<slug>/source.md` 可直接复用（15 厨房 + sing-box）；6 篇 HTML-only（5 金融 + welcome）需从 HTML 反转成 MD |
| 12 | `<time datetime>` / `dateModified` | 无独立字段 | `dateModified` 恒等于 `datePublished`（v1 语义） |

### 5.6 迁移后的文件与 URL 对照（抽样 3 条 + 全量规则）

| v1 | v3 | 产物 URL |
| --- | --- | --- |
| `posts/welcome/index.html` | `_posts/2026-09-26-welcome.md` | `/posts/welcome/` |
| `posts/finance-2026-09-30/index.html` | `_posts/2026-09-30-finance-2026-09-30.md` | `/posts/finance-2026-09-30/` |
| `posts/kitchen-07-classic-recipes/index.html`（+ 同名 `source.md`） | `_posts/2026-10-07-kitchen-07-classic-recipes.md` | `/posts/kitchen-07-classic-recipes/` |

### 5.7 字段格式约束（契约级）

| 字段 | 正则 / 规则 |
| --- | --- |
| slug（文件名与目录名） | `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$` |
| tag slug | `^[a-z0-9](?:[a-z0-9-]{0,30})$` |
| series 显示名 | `^[一-龥a-z0-9-]{1,32}$`（允许 CJK；CJK 字符仅此一处在 URL 路径中出现） |
| `date` | `YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM:SS +0800`；**未来日期 > 24h 报错** |
| `excerpt` | 非空、≤ 500 字、禁换行 |
| `draft` / `pinned` | 仅 `true` / `false` |
| `cover` | `null` / `/assets/...` / `https://...`；非空时文件须存在（外链不校验） |
| `tags[]` | 非空数组、元素合法、无重复 |

---

## 6. 目录结构（§6）

```
itingyu.github.io/
├── _config.yml                     ← 新增：Jekyll 唯一配置（§2 / §3）
├── Gemfile                         ← 新增：仅 github-pages gem
├── .gitignore                      ← 追加 _site/ / .jekyll-cache/ / .jekyll-metadata
├── index.md                        ← 取代 index.html（首页，layout: home）
├── 404.html                        ← 改造：加 front matter（layout: notfound）
├── about/index.md                  ← 取代 about/index.html
├── archive/index.md                ← 取代 archive/index.html
├── tags/index.md                   ← 取代 tags/index.html
├── series/index.md                 ← 取代 series/index.html
├── posts/
│   └── index.html                  ← 重写：分页模板（jekyll-paginate 要求 .html）
├── search/
│   ├── index.md                    ← 取代 search/index.html
│   └── index.json                  ← 新增：Liquid 生成搜索索引
├── feeds/
│   ├── rss.xml                     ← 重写：Liquid 自渲染
│   ├── series-厨房学.xml            ← 重写（骨架由 scripts/sync-series.js 生成）
│   └── series-金融市场观察.xml
├── sitemap.xml                     ← 重写：Liquid 自渲染
├── robots.txt                      ← 原样保留（静态）
├── _posts/                         ← 新增：22 篇 MD（唯一内容源）
│   ├── 2026-09-26-welcome.md
│   ├── 2026-09-26-finance-2026-09-26.md
│   ├── 2026-09-26-sing-box-setup-experience.md
│   ├── 2026-09-27-finance-2026-09-27.md
│   ├── 2026-09-28-finance-2026-09-28.md
│   ├── 2026-09-29-finance-2026-09-29.md
│   ├── 2026-09-30-finance-2026-09-30.md
│   └── 2026-10-07-kitchen-01-principles.md … 2026-10-07-kitchen-13-cuisine-dishes.md（15 篇）
├── _drafts/                        ← 新增：草稿区（Jekyll 内置，不渲染）
├── _series/                        ← 新增：专栏 collection（output: true）
│   ├── 金融市场观察.md
│   └── 厨房学.md
├── _tags/                          ← 新增：标签 collection（output: true，脚本生成）
│   ├── a-share.md … sing-box.md（23 个）
├── _layouts/                       ← 新增：11 个布局
│   ├── default.html                整站壳（head + header + main + footer）
│   ├── home.html                   首页（pinned + 最新 10 篇）
│   ├── posts.html                  文章分页列表
│   ├── post.html                   单篇文章
│   ├── archive.html                按月归档
│   ├── tags.html                   标签总览
│   ├── tag.html                    单标签
│   ├── series.html                 专栏总览
│   ├── series-detail.html          单专栏
│   ├── page.html                   通用页（支持 page.main_class 覆写）
│   └── notfound.html               404
├── _includes/                      ← 新增：12 个 include
│   ├── head.html                   doctype/head/meta + FOUC 内联脚本 + 条件 seo
│   ├── header.html                 header.site-header + nav（aria-current 计算）
│   ├── footer.html                 footer.site-footer
│   ├── theme-switcher.html         button.theme-toggle
│   ├── post-card.html              li 卡片（首页/归档/标签/专栏复用）
│   ├── post-header.html            article-header（h1 + post-meta + excerpt）
│   ├── post-meta.html              文章页 <meta> 全集（article:* / og:* / twitter:*）
│   ├── jsonld-blogposting.html     BlogPosting（含 articleSection/keywords/hasPart）
│   ├── jsonld-breadcrumb.html      BreadcrumbList
│   ├── jsonld-person.html          Person / Blog（首页 + about）
│   ├── series-nav.html             专栏内 prev/next
│   └── search-ui.html              搜索框 + 结果容器
├── assets/                         ← 保留（style.css / theme.js / keys.js / search.js / favicon.svg）
│   └── （删除 search-index.json，改由 /search/index.json 生成）
├── scripts/                        ← 大幅瘦身（§8）
│   ├── new-post.sh                 改：产出 _posts/<date>-<slug>.md
│   ├── publish.sh                  改：校验 + 白名单 add + commit + push
│   ├── sync-tags.js                新增：_tags/<slug>.md 幂等生成
│   ├── sync-series.js              新增：feeds/series-<name>.xml 幂等生成
│   ├── validate-frontmatter.js     保留：迁移到 _posts 路径与新 schema
│   ├── finance-sync.sh             保留（简报同步 → 改产 _posts）
│   ├── publish-finance-brief.sh    保留（改产 _posts）
│   ├── install-hooks.sh            新增：装 .githooks/pre-push
│   └── __tests__/                  测试重写（§8）
├── .githooks/pre-push              新增：草稿门禁 + front matter 校验
├── design.md                       保留（后续归档为 design-v1-archive.md）
├── design-v2.md                    → 评审通过后归档为 design-v2-archive.md
├── design-v3.md                    ← 本文件
├── README.md                       评审通过 + Phase H 重写（本期不改）
├── package.json                    改为只承载 npm test
└── posts/                          ← **过渡期共存 → 迁移完成后只剩 index.html**
    ├── <slug>/index.html × 22      ← Phase B 全部删除
    └── index.html                  ← Phase C 重写为分页模板
```

### 6.1 `_config.yml` 契约（关键项）

| 键 | 值 | 说明 |
| --- | --- | --- |
| `title` / `description` / `lang` | `itingyu · 博客` / 站点描述 / `zh-CN` | `lang` 同时驱动 `<html lang>` |
| `url` / `baseurl` | `https://itingyu.github.io` / `""` | CJK 路径不编码（§3.2） |
| `timezone` | `Asia/Shanghai` | `date` 无时区时的解释时区 |
| `permalink` | `/posts/:slug/` | **不是 `:name`**（§D1，实测） |
| `paginate` / `paginate_path` | `12` / `/posts/page:num/` | `/posts/` + `/posts/page2/` |
| `markdown` / `highlighter` / `kramdown` | `kramdown` / `rouge` / `{input: GFM, auto_ids: true}` | §2.3 |
| `plugins` | `[jekyll-paginate, jekyll-seo-tag, jekyll-optional-front-matter]` | **恰好 3 个**（§2.2，AC-01 断言不多不少） |
| `collections` | `series: {output: true, permalink: /series/:name/}`；`tags: {output: true, permalink: /tags/:name/}` | CJK 文件名 → CJK URL（实测） |
| `defaults` | `_posts` → `layout: post`；`path: ""`（index/about/archive/tags/series/search）→ `layout: page` | — |
| `exclude` | `[node_modules/, package.json, package-lock.json, scripts/, README.md, design*.md, .githooks/, Gemfile, Gemfile.lock, vendor/]` | 避免把 spec / 脚本 / 测试渲进产物 |
| `include` | 不使用 | 过渡期靠「旧 HTML 先迁完再删」，不靠 `include` 透传（避免 `:name`/URL 冲突，§D8） |

---

## 7. 设计决策 §D1–§D14（本 spec 的落定项，无开放问题）

### §D1 permalink 策略 —— 锁定 `/posts/:slug/`

| 项 | 内容 |
| --- | --- |
| 决策 | `_config.yml` 用 `permalink: /posts/:slug/`；`:slug` 是 `:title` 的别名，Jekyll 会从 `YYYY-MM-DD-slug.md` 中**剥离日期前缀**再取 slug |
| 实测 | `_posts/2026-09-26-welcome.md` → `https://itingyu.github.io/posts/welcome/` |
| 否决项 | issue 写的 `/posts/:name/` —— **实测 `:name` 对 `_posts` 不是合法占位符**，会**静默**产出字面量 `/posts/2026-10-07-kitchen/`（日期前缀没剥离，22 个 URL 全部变更 = 直接违约）。`:name` 只在 **collection** 上有效（`_series` / `_tags` 就靠它，§D2 / §D10） |
| 约束 | 迁移时文件名 slug 必须等于 v1 目录名，否则 URL 变更（`validate-frontmatter.js` fail） |

### §D2 series 实现 —— `_series` collection + CJK 文件名

| 项 | 内容 |
| --- | --- |
| 决策 | `_series/<显示名>.md`，`collections.series.output: true`、`permalink: /series/:name/`；文章的 `series:` 值等于专栏 `title` |
| 实测 | `_series/厨房学.md` → `/series/厨房学/`（CJK 原样，与 v1 URL **完全一致**） |
| 否决项 | (a) `jekyll-archives` 不在白名单；(c) `_data/series.yml` + 循环 → 专栏详情页仍需每专栏一个文件，collection 已是一等公民且能拿到 `page` 上下文 |
| 归属 / prev-next / hasPart | 全部 Liquid 实时计算：`site.posts | where_exp: "p", "p.series == page.title"`（实测可用） |

### §D3 聚合页实现

| 页 | 实现 | 实测要点 |
| --- | --- | --- |
| 首页 | `index.md` + `layout: home`：`site.posts` 里 `pinned` 优先 + 最新 10 篇；**不用 jekyll-paginate** | — |
| `/posts/` | **`posts/index.html`**（保留 `.html` 后缀）+ `paginator: jekyll-paginate` | 实测：`index.md` 模板 → jekyll-paginate 打印告警并**静默跳过**（不报错、只出 1 页）；改 `.html` 后正常产出 `/posts/` 与 `/posts/page2/` |
| 归档 | `group_by_exp: "item", "item.date | date: '%Y-%m'"` + `{% for g in groups reversed %}` | 实测：`group_by: "date | date: '%Y-%m'"` **不支持过滤器链**，分组名会变空（`=3`），必须用 `group_by_exp` |
| `/tags/` | 遍历 `site.tags`（collection）+ Liquid 扫描 `site.posts` 算计数 | 见 §D10 |
| 单标签 | `_tags/<slug>.md` + `layout: tag` | — |
| 专栏 | 见 §D2 | — |
| 404 | `404.html` + `layout: notfound` | — |
| 排序 | 统一用 `site.posts`（Jekyll 默认 date desc）；同日文章的稳定序见 §D14 | — |

### §D4 JSON-LD —— 手写契约 + seo-tag 只管非文章页

| 页 | v3 产出 |
| --- | --- |
| 首页 / about | `_includes/jsonld-person.html`：`Person`（`name` / `url` / `sameAs`）+ `Blog`（`name` / `description` / `url` / `blogPosting[]`，**数组长度 = 已发布文章数**，修正 v1 首页 `blogPosting` 只列了 2 篇的历史漂移） |
| 文章页 | `_includes/jsonld-blogposting.html`：`BlogPosting`（`headline` / `datePublished` / `dateModified` / `author` / `url` / `description` / `articleSection`（有专栏时）/ `keywords`（tags + 系列名）/ `hasPart`（v2.1 契约））+ `_includes/jsonld-breadcrumb.html`：`BreadcrumbList`（首页 → 主标签 → 本文） |
| 非文章页 | `{% seo %}`（`jekyll-seo-tag`） |

**关键约束（实测）**：`{% seo %}` 在文章页会**自己产出一份 `BlogPosting` + `WebPage` JSON-LD**，与我们的契约字段重复（`hasPart` / `keywords` / `articleSection` 全丢）。因此 `_includes/head.html` 必须写成：

```liquid
{% unless page.layout == 'post' %}{% seo %}{% endunless %}
```

`hasPart` 沿用 v2.1 §5.2.8 契约：文章有 `series:` 且同专栏**除自身外 ≥ 1 篇非草稿**时才出现，元素为 `{"@type":"BlogPosting","headline":…,"url":…}`，排除自身。

### §D5 search 实现 —— `/search/index.json` + 现有 search.js

| 项 | 内容 |
| --- | --- |
| 决策 | `search/index.json` 为「带 front matter 的 Liquid 页」，渲染期遍历 `site.posts` 生成 JSON；`assets/search.js` 仅改索引 URL 一行 |
| 索引 schema | `{"generated":"<build date>","posts":[{"id","url","title","description","tags","date","excerpt","content"}]}`，`id` = slug；`description` / `excerpt` = front matter 摘要；`content` = **全文纯文本**（`{{ p.content | strip_html | normalize_whitespace }}`，作为搜索正文） |
| 理由 | v1 把「全文」塞在 `excerpt` 键里（实测 `assets/search-index.json`），命名误导；v3 拆成 `excerpt`（摘要）+ `content`（全文），同步改 `search.js` 的正文打分字段（Phase E），`assets/search-index.json` 删除 |
| 否决项 | (b) `jekyll-lunr-search` 不在白名单；(c) GH Action 跑一次 build 生成索引 = 违背「零运行时 build」 |
| 边界 | 索引只含 `draft: false` 的文章；篇数 == `/posts/` 可翻到的总篇数（AC-09） |

### §D6 draft 门禁 —— 三层

| 层 | 机制 |
| --- | --- |
| 结构层（强） | `_drafts/` 是 Jekyll 内置目录，默认**不渲染**；`_drafts/` 不进 `include`/`collections`，因此草稿永远不会产出 URL、不会进 RSS / sitemap / 标签 / 专栏 / 搜索索引 |
| 工具层 | `scripts/validate-frontmatter.js --strict`：`publish.sh` 与 `install-hooks.sh` 装好的 `.githooks/pre-push` 都会跑；`draft: true` 的文件必须位于 `_drafts/`（放在 `_posts/` 里 **fail**，避免「以为在草稿其实已上线」） |
| 流程层 | `pre-push` 拒绝把 `_drafts/**` 新增/改动混入推送，并打印「先 `new-post.sh --draft`」提示。GitHub 网页编辑绕过 hook —— 这是**已知残余风险**（§11 R7），由 review 与 §9 AC-18（`_posts` 中不得有 `draft: true`）兜底 |

**不引入 CI workflow**（保持零运行时 build）。

### §D7 主题切换器兼容

`assets/theme.js` / `assets/keys.js` **不改**；`_includes/head.html` 内联 FOUC 脚本与 `<button class="theme-toggle">` 标记原样保留（§4.2）。`assets/style.css` 不改。

### §D8 22 篇文章处置 —— 方案 P2（全转 MD + 删旧 HTML）

| 项 | 内容 |
| --- | --- |
| 决策 | 22 篇全部迁到 `_posts/<date>-<slug>.md` → Jekyll 渲 → **删除 `posts/<slug>/index.html`（22 个目录）**；`posts/` 目录只保留重写后的 `posts/index.html`（分页模板） |
| 否决 P1 | 保留旧 HTML 并 `include: [posts/]` 会让同一 URL 出现两个产物（谁胜出不可测）；且 Jekyll 会把 `posts/<slug>/index.html` 当页面渲出 `/posts/<slug>/` 与 MD 冲突 |
| 过渡顺序 | Phase A 先建骨架（**不动旧 HTML**）→ Phase B 迁 22 篇 MD → Phase C 切模板到 MD → **验收通过后** Phase C 末删旧 HTML（同一个 PR 内「新增 MD + 切模板 + 删 HTML」三步同 PR，Pages 只看到终态） |
| 回归口径 | **不是 byte-equal**。v3 验收标准 = ① 22 个 URL 全 200（AC-02）② §4.5 DOM 关键节点全在（AC-03/05/06/07/10/11）③ JSON-LD 字段齐全（AC-08）④ **RSS / sitemap / per-series RSS 在「归一化后结构等价」意义上等价**（AC-12/13/14） |
| 「byte-equal」的口径校正 | issue §D8 写的「RSS/sitemap byte-equal」在 Jekyll 下不可测（缩进、`lastBuildDate` 时区格式、属性顺序）。本 spec 把 AC-12/13/14 定义为：**XML 归一化器**（去 XML 声明差异 + 折叠标签间空白 + `lastBuildDate` 固定值）之后**逐元素逐属性比对**。原始字节一致列为 stretch goal，不作为门禁 |
| 视觉等价 | 抽样 3 篇（`welcome` / `finance-2026-09-30` / `kitchen-07-classic-recipes`）人工截图对照；这是人工验收项，由前端角色执行并回贴 |

### §D9 RSS / sitemap —— 不启用 jekyll-feed / jekyll-sitemap，Liquid 自渲染

| 项 | 内容 |
| --- | --- |
| 决策 | `feeds/rss.xml`、`feeds/series-*.xml`、`sitemap.xml` 三个路径由带 front matter 的 Liquid 页自渲染（实测 `.xml` + front matter 输出可行） |
| 否决理由 1 | `jekyll-sitemap` 固定写 `/sitemap.xml`，与我们的同名产物**目的地冲突**（构建顺序决定胜出，无法测试） |
| 否决理由 2 | 两个插件的模板都产不出 v2.1 契约字段：sitemap 需要 `<changefreq>` / `<priority>` / `<series>` 子元素；RSS 需要 per-series `atom:link rel="related"` 与 `content:encoded` |
| 否决理由 3 | `jekyll-feed` 会额外产出 `/feed.xml`，造成两个「全站 RSS」并存，读者与爬虫都无法判断哪个是权威 |
| 代价 | 自己维护两个 XML 模板（Phase D，约 80 行 Liquid），换来**字段级可控 + 可回归** |

### §D10 标签 collection 的代价 —— 不引 `_data/tags.yml`

| 项 | 内容 |
| --- | --- |
| 决策 | collection label 就叫 `tags`（目录 `_tags/`，permalink `/tags/:name/`），**接受** `site.tags` 内置哈希被覆盖这一代价 |
| 实测代价 | 定义 `collections.tags` 后，`site.tags` 从「tag→posts 哈希」变成「collection 文档数组」；若沿用哈希写法（`{% for t in site.tags %}{{ t[0] }}`）构建**直接抛** `TypeError: 0 is not a symbol nor a string` |
| 应对 | `/tags/` 与 tag 页一律用文档字段（`t.tag` / `t.title` / `t.url`）；计数改为 Liquid 扫描 `site.posts`（`{% if p.tags contains t.tag %}`），23 个 tag × 22 篇 = 506 次比较，渲染开销可忽略 |
| 为何不引 `_data/tags.yml` | 有了 collection 后再放一份 `_data/tags.yml` 就是**第二份需同步的真源**，必然漂移；Jekyll 自带 `site.posts` 已经是真源 |
| 为何不用 label `tag` | label 决定目录名（`_tag/`），与 issue §6 要求的 `_tags/` 不符；且 `site.tags` 被覆盖后在 Liquid 里「数组 / 哈希」两种写法的报错方式完全不同，统一为 collection 数组更可控 |

### §D11 tag 页与 per-series RSS 的生成 —— 脚本生成骨架，不是 build

| 项 | 内容 |
| --- | --- |
| 决策 | `scripts/sync-tags.js` 扫描 `_posts/*.md` 的 `tags:` → 幂等生成/更新 `_tags/<slug>.md`（新增缺的、删掉无引用的、保留已有 `title` 显示名）；`scripts/sync-series.js` 扫描 `_series/*.md` → 幂等生成 `feeds/series-<显示名>.xml` 骨架 |
| 性质 | 这是**源文件维护工具**（等价于 `new-post.sh`），产物提交进 git；**不是** Pages build 步骤，Pages 上什么也不跑 |
| 幂等性 | 同一份 `_posts` 跑两次，git diff 必须为空（测试 AC-19） |
| 显示名 | 中文显示名（`金融` / `随笔`）在 `sync-tags.js` 的映射表里维护；新标签默认显示名 = slug，编辑 `_tags/<slug>.md` 的 `title` 即可，脚本不会覆盖 |
| 门禁 | `publish.sh` 在 `git add` 前调用两个 sync 脚本；契约测试断言「`_posts` 的 tag 集合 == `_tags/*.md` 集合」且「`_series` 集合 == `feeds/series-*.xml` 集合」 |

### §D12 语法高亮 —— Rouge

`highlighter: rouge` 构建期渲染，无前端 JS；仓库当前**没有** prism.js，故无视觉回归（§2.3）。若 `assets/style.css` 中残留 `.token-*` 规则，Phase C 可选清理。

### §D13 切换与回滚策略

| 项 | 内容 |
| --- | --- |
| 切换 | Phase A–C 各自独立 PR；Phase C 是「大 PR」（22 篇 MD + 模板切换 + 删旧 HTML），评审重点在 URL 清单与回归报告 |
| 回滚 | 单点回滚：revert Phase C 提交 → 仓库回到「手写 HTML 产物」状态 → Pages 自动重渲旧版，**不需要改 Pages 设置**（始终是「分支根目录」部署，无 Actions artifact 参与） |
| 双跑窗口 | Phase C 合并后保留一个发布窗口，观察 `/posts/`、`/tags/`、`/series/`、`/feeds/`、`/sitemap.xml`、`/search/` 六个入口；出现 404 即 revert |
| 不做灰度 | Pages 单站点无流量切分能力，不引入额外分支部署（会同时发布两份内容，SEO 重复） |

### §D14 同日多篇文章的稳定序（本次实测发现的风险项）

**问题**：15 篇厨房文章 `article:published_time` 全是 `2026-10-07`。v1 的排序在同日时用 `slug.localeCompare` **升序**兜底（`scripts/build-index.js:277-289`）；Jekyll 的 `site.posts` 对同一时间戳的兜底规则是「文件路径比较后再整体 reverse」，与 v1 顺序不一致 → 首页 / `/posts/` / 专栏 / RSS 的列表顺序会变（视觉回归）。

**决策**：迁移时给同日文章分配**互不相同的时间戳**，且**按专栏阅读顺序倒序分配**（`kitchen-01-principles` 时间最晚），使 Jekyll 默认的 date-desc 排序结果与 v1 的「slug 升序」完全一致。

| 组 | v1 slug 顺序（date 相同） | v3 `date` 分配 |
| --- | --- | --- |
| 厨房 15 篇（2026-10-07） | 01 → 02 → 02b → 02c → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 | `2026-10-07 22:00` → `08:00`，按 slug 升序每小时一档递减 |
| 金融 5 篇（日期互不相同） | 无并列 | `YYYY-MM-DD 00:00:00 +0800` |
| `welcome` / `sing-box-setup-experience`（同为 2026-09-26） | slug 升序：`sing-box-setup-experience` < `welcome` | `sing-box` = `12:00`，`welcome` = `00:00`（date desc → sing-box 在前，与 v1 一致） |

**约束**：对外**一律渲染 date-only**（`{{ page.date | date: "%Y-%m-%d" }}` + `<time datetime="2026-10-07">` + `article:published_time` date-only），时间戳只用于排序。Phase B 必须先落地一份「v1 顺序基线快照」JSON，Phase F 断言 v3 渲染顺序与之逐条相等（AC-20）。

---

## 8. 影响面矩阵（§8）

### 8.1 spec 层

| 文件 | 变更 | 阶段 | 风险 |
| --- | --- | --- | --- |
| `design-v3.md` | **新增**（本文件） | 本 issue | — |
| `design-v2.md` | 评审通过后 → `design-v2-archive.md` | Phase H | 低（纯重命名） |
| `design.md` | 归档为 `design-v1-archive.md` | Phase H | 低 |
| `README.md` | 重写为 v3（本地预览 / 写作流程 / 插件说明） | Phase H | 低 |

### 8.2 仓库结构层

| 路径 | 变更 | 阶段 | 风险 |
| --- | --- | --- | --- |
| `_config.yml` `Gemfile` `.gitignore` | 新增 | A | **高**（配错 = 全站 404） |
| `_layouts/*.html` × 11 | 新增 | A / C | 中（模板 bug 会牵连多页） |
| `_includes/*.html` × 12 | 新增 | A / C | 中 |
| `_posts/*.md` × 22 | 新增 | B | 高（内容丢失不可逆） |
| `_drafts/` | 新增（空目录 + `.gitkeep`） | A | 低 |
| `_series/*.md` × 2 | 新增 | B | 中（CJK 文件名/URL） |
| `_tags/*.md` × 23 | 新增（脚本生成） | B | 中 |
| `posts/<slug>/index.html` × 22 | **删除** | C（末） | **高**（删错 = URL 404） |
| `posts/index.html` | 重写（分页模板） | C | 中 |
| `index.html` → `index.md` | 替换 | C | 中 |
| `about/` `archive/` `tags/` `series/` `search/` `404.html` | 替换为 `.md` + layout / 加 front matter | C | 中 |
| `feeds/*.xml`（3 个） `sitemap.xml` | 重写为 Liquid | D | 中（契约字段易漏） |
| `assets/search-index.json` | **删除**（改 `/search/index.json`） | E | 低 |
| `assets/search.js` | 改 1 行索引 URL + 正文打分字段（`excerpt`→`content`） | E | 低 |
| `assets/style.css` / `theme.js` / `keys.js` / `favicon.svg` | **不动** | — | 无 |
| `robots.txt` | 不动 | — | 无 |

### 8.3 脚本层

| 文件 | 变更 | 阶段 |
| --- | --- | --- |
| `scripts/build-index.js`（1531 行） | **删除**（v1 渲染链退役） | G |
| `scripts/render-cooking-docs.js` | 删除（MD 直接进 `_posts/`） | G |
| `scripts/render-finance-brief.js` | 删除（同上；简报改为直接写 `_posts/*.md`） | G |
| `scripts/validate-frontmatter.js` | 重写：扫 `_posts/**/*.md` + `_series` + `_tags`，套 §5.7 规则 | G |
| `scripts/new-post.sh` | 改：输出 `_posts/<date>-<slug>.md`，加 `--draft` 出 `_drafts/` | G |
| `scripts/publish.sh` | 瘦身：validate → sync-tags/sync-series → 白名单 `git add` → commit → push | G |
| `scripts/finance-sync.sh` | 改：目标从 `posts/<slug>/index.html` 改为 `_posts/<date>-<slug>.md` | G |
| `scripts/publish-finance-brief.sh` | 同上 | G |
| `scripts/sync-tags.js` / `sync-series.js` / `install-hooks.sh` | 新增 | G |
| `.githooks/pre-push` | 新增 | G |
| `package.json` | 删 `build` / `check` / `build:home` / `build:rss`；留 `test` | G |
| `.github/workflows/*` | **无需删除**（实测仓库无 `.github/`） | — |

### 8.4 工作流 / CI 层

| 项 | v2 | v3 |
| --- | --- | --- |
| GitHub Actions build | v2 spec 计划有（仓库实测没有） | **不存在，且明确不再引入** |
| Pages 设置 | `Deploy from a branch` / `master` / root | **不变**（无需 admin 改设置） |
| 本地预览 | `npm run preview`（`preview.js` 未实现） | `bundle exec jekyll serve` |
| 发布动作 | commit MD → Actions build → 提交 HTML | commit MD（**结束**） |
| 草稿门禁 | pre-push hook 方案 | 同（`.githooks/pre-push`，§D6） |

### 8.5 测试层（重写清单）

| 现有文件 | 处置 | 说明 |
| --- | --- | --- |
| `scripts/__tests__/build-index.test.js` | **删除** | 测的是要退役的渲染器 |
| `scripts/__tests__/frontmatter.test.js` | 重写 → `frontmatter-migrate.test.js` | 扫 `_posts/**/*.md` + `_series` + `_tags` |
| `scripts/__tests__/keys.test.js` | **保留** | `assets/keys.js` 不动 |
| `scripts/__tests__/validate-frontmatter.test.js` | 重写 | 新 schema + 新路径 |
| `scripts/__tests__/render-finance-brief.test.js` | **删除** | 对应脚本退役；简报迁移改由 AC-21 覆盖 |
| `scripts/__tests__/finance-sync-attachments.test.sh` | 保留（若 `finance-sync.sh` 仍保留则需适配新产物路径） | — |
| 新增 `config-contract.test.js` | §9 AC-01 | `_config.yml` 契约 |
| 新增 `build-site.test.js`（前置：跑 `jekyll build` 到临时 `_site`） | 所有渲染类 AC 的公共前置 | 一次性 build，测试复用产物 |
| 新增 `url-compat.test.js` | AC-02 | 22 个 URL |
| 新增 `templates.test.js` | AC-03/05/06/07/10/11 | DOM/class 契约 |
| 新增 `jsonld.test.js` | AC-08 | JSON-LD 字段 |
| 新增 `feed-sitemap.test.js` | AC-12/13/14 | RSS / sitemap 归一化等价 |
| 新增 `search-index.test.js` | AC-09 | 索引 schema + 篇数 + 客户端 URL |
| 新增 `sync-scripts.test.js` | AC-19 | 幂等性 |

测试运行方式：`npm test`（`node --test`），前置依赖 `bundle exec jekyll build --destination <tmp>`；CI 无（本项目无 Actions），由本地 / 评审人执行。

---

## 9. 验收用例（§9）

前置：`_config.yml` + 模板齐备后执行一次 `bundle exec jekyll build --destination "$TMP/site"`；下文 `<site>` 指该产物目录。

| AC | 需求点 | 断言（可执行） |
| --- | --- | --- |
| **AC-01** | §2.2 / §6.1 配置契约 | `plugins` **恰好等于** `[jekyll-paginate, jekyll-seo-tag, jekyll-optional-front-matter]`；`permalink == "/posts/:slug/"`；`timezone == "Asia/Shanghai"`；`lang == "zh-CN"`；`baseurl == ""`；`url == "https://itingyu.github.io"`；`paginate == 12`；`paginate_path == "/posts/page:num/"`；`markdown == "kramdown"`；`highlighter == "rouge"`；`kramdown.input == "GFM"`；`collections.series.permalink == "/series/:name/"` 且 `output == true`；`collections.tags.permalink == "/tags/:name/"` 且 `output == true`；`exclude` 覆盖 `node_modules/` `scripts/` `package.json` `design*.md` |
| **AC-02** | §3 URL 兼容 | §3.1 的 22 个 slug 对应 `<site>/posts/<slug>/index.html` **全部存在**；且 `<site>` 下**不存在**形如 `posts/<date>-*` 的产物（证明日期前缀已被剥离） |
| **AC-03** | §4.5 整站壳 / 首页 | 每个页面类型（首页 / 文章 / 归档 / 标签 / 标签详情 / 专栏 / 专栏详情 / 搜索 / about / 404）都含：`div.reading-progress`、`a.skip-link[href="#main"]`、`header.site-header`、`nav.site-nav` 内 7 个 href、`button.theme-toggle[data-theme-toggle]`、`main#main.container`、`footer.site-footer > div.links` 内 9 个链接 |
| **AC-04** | §3 / §D3 分页 | `<site>/posts/index.html` 与 `<site>/posts/page2/index.html` 都存在；两页 `h3.post-title a` 的 href 集合**不相交**且并集 == 22 个 slug |
| **AC-05** | §3 归档 | `<site>/archive/index.html` 含 `div.archive-group`；月份分组集合 == `[2026-10, 2026-09]` 且**首组是 2026-10**（倒序） |
| **AC-06** | §3 / §D10 标签 | `<site>/tags/index.html` 的 `a.chip` 数 == `<site>/_tags` 文档数 == 23；每个 chip 的 `href` 对应文件存在；`finance` 的计数 == 5、`kitchen` == 15、`note` == 2（对照 v1 `tags/<slug>/index.html` 计数） |
| **AC-07** | §3 / §D2 专栏 | `<site>/series/index.html` 含 `div.series-grid > div.series-card` × 2；`<site>/series/厨房学/index.html` 与 `<site>/series/金融市场观察/index.html` 存在（**路径含 CJK 原字符**，URL 不得被 percent-encode）；厨房学页 `h3.post-title` 数 == 15、顺序 == v1 基线快照顺序 |
| **AC-08** | §D4 JSON-LD | 首页含 `Person`（`sameAs` 含 GitHub）与 `Blog`，且 `Blog.blogPosting` 长度 == 22；文章页含 `BlogPosting` 且 `headline` / `datePublished` / `dateModified` / `author` / `url` / `description` / `keywords` 齐全、有专栏时 `articleSection == 厨房学` / `金融市场观察`；**文章页 JSON-LD 中 `BlogPosting` 恰好 1 个**（验证 seo-tag 未重复注入）；`kitchen-07` 的 `hasPart` 长度 == 14 且不含自身 URL；`welcome`（无专栏）无 `hasPart`；文章页含 `BreadcrumbList` |
| **AC-09** | §D5 搜索 | `<site>/search/index.json` 是合法 JSON，`posts` 长度 == 22，每项含 `id/url/title/description/tags/date/excerpt/content`；`content` 非空且不含 `<`；`assets/search.js` 中的索引 URL 字面量 == `/search/index.json`；`<site>/assets/search-index.json` **不存在** |
| **AC-10** | §3 about | `<site>/about/index.html` 含 `Person` JSON-LD 与 v1 相同的 `div.callout` 节点 |
| **AC-11** | §3 / §4.5 404 + robots | `<site>/404.html` 存在且 `main` 的 class 含 `fourofour`；`<site>/robots.txt` 与 v1 **字节相同** |
| **AC-12** | §D9 RSS | `<site>/feeds/rss.xml` 归一化后：channel `title` / `link` / `description` / `language` / `atom:link[self]` 与 v1 等值；`atom:link[related]` 恰好 2 条且 href == 两个 per-series feed；`<item>` 集合 == 22 且**顺序 == v1 基线快照顺序** |
| **AC-13** | §D2 / §D11 per-series RSS | `<site>/feeds/series-厨房学.xml` 的 item 集合 == 15 篇厨房文；`<site>/feeds/series-金融市场观察.xml` 的 item 集合 == 5 篇金融文；两者 `<channel><link>` 指向各自专栏 URL |
| **AC-14** | §D9 sitemap | `<site>/sitemap.xml` 的 `<loc>` 集合 == `{/, /posts/, /archive/, /tags/, /series/, /search/, /about/, 404.html?, 22 篇文章 URL, 23 标签 URL, 2 专栏 URL, feeds}` 与 v1 集合一致（`/404.html` 是否入表以 v1 现状为准）；**有专栏的 URL 带 `<series>`（显示名原值）**，无专栏的不带；`changefreq` / `priority` 逐条与 v1 等值 |
| **AC-15** | §2.4 前端资产 | `assets/{style.css,theme.js,keys.js,search.js,favicon.svg}` 五个文件 **与 v1 字节相同**（除 `search.js` 的索引 URL 一行改动，按 AC-09 断言）；`_site/assets/style.css` 与仓库内一致 |
| **AC-16** | §2.1 版本真源 | `bundle exec jekyll build` 在 **`github-pages` gem 锁定版本**下成功（不是本机 4.4.1），且 22 个 URL 全部产出 |
| **AC-17** | §5.7 schema | 22 篇 front matter：`title` / `date` / `tags`(非空) / `excerpt` 齐全且合法；文件名 slug == v1 目录名；`series` 值都存在于 `_series/*.md` 的 `title`；`tags` 元素都存在于 `_tags/*.md` 的 `tag`；`draft` / `pinned` 仅布尔；`_posts/` 中**无** `draft: true`（AC-18 同源） |
| **AC-18** | §D6 草稿 | `<site>` 下无任何 `/posts/<draft-slug>/`；RSS / sitemap / 搜索索引均不含草稿；`.githooks/pre-push` 存在且含 `_drafts` 拒绝逻辑 |
| **AC-19** | §D11 幂等 | `node scripts/sync-tags.js && node scripts/sync-series.js` 连跑两次后 `git status --porcelain` **为空** |
| **AC-20** | §D14 同日序 | 厨房学专栏页、`/posts/` 两页、`feeds/rss.xml`、归档的厨房条目顺序**逐条等于** Phase B 落地的 v1 基线快照 |
| **AC-21** | §8.3 简报链路 | 用 `finance-sync.sh` 的 fixtures 跑一次，产物落在 `_posts/<date>-<slug>.md` 且 front matter 通过 `validate-frontmatter.js --strict` |
| **AC-22** | §4.3 可访问性 | 每个页面：`<html lang="zh-CN">`；当前 nav 项带 `aria-current="page"`（首页 / `/posts/` / `/posts/<slug>/` / `/tags/` / `/tags/<slug>/` / `/series/` / `/series/<name>/` 各抽查 1 页）；装饰 SVG 带 `aria-hidden="true"`；`<link rel="stylesheet">` 之前存在内联 FOUC 脚本 |

**验收门槛**：AC-01 ~ AC-22 全绿。其中 AC-01/02/04/07/08/09/12/13/14/17/19/20 为**硬门禁**（任一红则 Phase C 不得合并）；其余为建议门禁，由测试角色判定。

---

## 10. 里程碑（Phase A–H，spec 签字后由技术总监拆子 issue）

| Phase | 范围 | 角色 | 完成判定 |
| --- | --- | --- | --- |
| **A** | `_config.yml` + `Gemfile` + `Gemfile.lock` + `.gitignore` + `_layouts/default.html` + `_includes/{head,header,footer,theme-switcher}.html` + 最小 `index.md` | 后端 | Pages 跑通基本骨架，`/` 200 |
| **B** | `_posts/` 22 篇 MD 迁移 + front matter schema 映射 + `_series/` 2 篇 + `_tags/` 23 篇（脚本生成）+ **v1 顺序基线快照** | 后端 | AC-17 / AC-20 基线快照落地；旧 HTML 尚在（线上零风险） |
| **C** | `_layouts/{home,posts,post,archive,tags,tag,series,series-detail,page,notfound}.html` + `_includes/{post-card,post-header,post-meta,jsonld-*,series-nav,search-ui}.html` + 聚合页切 MD + **删 22 个旧 HTML** | 前端（+ 后端配合） | AC-02/03/04/05/06/07/10/11/22 全绿 + 3 篇截图对照 |
| **D** | RSS / per-series RSS / sitemap / JSON-LD | 后端 | AC-08/12/13/14 全绿 |
| **E** | `/search/index.json` + `assets/search.js` 适配 | 后端 | AC-09 全绿 |
| **F** | 契约测试全量（§9）+ `github-pages` 锁定版本复跑 | 测试 | AC-01~AC-22 全绿 |
| **G** | 脚本瘦身 + `package.json` + `.githooks/pre-push` + 删 `build-index.js` 等 | 后端 | AC-18/19/21 全绿 |
| **H** | `design-v2.md → design-v2-archive.md`、v1 归档、`README.md` v3 重写 | 后端 | spec 归档 + README 与实际流程一致 |

依赖：A → B → C → {D, E} → F → G → H。

---

## 11. 风险与缓解

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | Pages 白名单 / 版本与本地不一致（Pages 锁 Jekyll 3.10，本机可能 4.x） | 本地过、线上挂 | `Gemfile` 只用 `github-pages` gem；AC-16 强制在锁定版本下复跑 |
| R2 | `_config.yml` 配错（`permalink` / `include` / `exclude`） | 全站 URL 崩塌 | AC-01 配置契约测试；Phase A 先单独上线验证 |
| R3 | `:name` 占位符误用（issue 原文写法） | 22 个 URL 全变 | §D1 已用实测纠正；AC-02 显式断言「无 `posts/<date>-*` 产物」 |
| R4 | `site.tags` 被 collection 覆盖 | 标签页构建失败 | §D10 已定应对；AC-06 覆盖 |
| R5 | jekyll-paginate 静默跳过（模板写成 `.md`） | `/posts/` 只有 1 页或分页失效 | §D3 锁 `.html`；AC-04 断言两页并集 == 22 |
| R6 | seo-tag 与手写 JSON-LD 重复注入 | JSON-LD 校验失败 | §D4 条件输出；AC-08 断言 `BlogPosting` 恰好 1 个 |
| R7 | 草稿经 GitHub 网页直编 `_posts/` 泄漏上线 | 未完成内容公开 | `_drafts/` 结构层 + pre-push 工具层 + AC-17/18 流程层；残余风险明示（无法完全消除，Pages 侧无服务端门禁） |
| R8 | CJK URL 被编码 / 某些客户端不接受 | 专栏链接失效 | §3.2 锁「原样输出」；AC-07 断言产物路径含 CJK 原字符 |
| R9 | 22 篇 HTML → MD 反转丢内容（6 篇 HTML-only 无 `source.md`） | 内容缺失 | Phase B 逐篇 diff 校验（段落数 / 标题数 / 代码块数）+ 抽样截图；`git` 历史可回滚 |
| R10 | 同日文章排序漂移 | 视觉回归 | §D14 时间戳方案 + AC-20 顺序快照 |
| R11 | Rouge 与 v1「无高亮」观感差异 | 视觉回归 | v1 无 prism.js → 无既有高亮观感；CSS 新增 `.highlighter-rouge` 样式即可（Phase C 可选项） |
| R12 | 大 PR（Phase C）合并后出问题 | 站点受损 | §D13 单点回滚 + 六入口巡检窗口 |
| R13 | 自渲染 RSS / sitemap 字段漏写 | 订阅 / 收录退化 | AC-12/13/14 归一化逐字段比对 |

---

## 12. 不做（明确）

- 不接评论系统 / 不做服务端搜索（沿用 v1 客户端搜索，`≤ 50 篇` 上限）。
- 不做 i18n（单语 zh-CN）。
- 不引第三方 markdown 库 / npm 渲染库 / CDN / Web 字体 / 前端框架。
- **不引 GitHub Actions build**（本架构的核心就是把它删掉）。
- 不引入第三方 Jekyll 主题（保留自定义主题能力）。
- 不做流量灰度 / 双版本并行部署。
- 不改 `assets/style.css` 的设计 token（视觉冻结）。
- 不改 `robots.txt`。
- 不在本 issue（spec 评审）内实施任何 Phase A–H 代码。

---

## 13. 评审签字要求（5/5，必须实质）

| 角色 | 签字内容（本评审必给实质结论，不接受「默认签收」） |
| --- | --- |
| **SDD 技术总监** | §7 D1–D14 是否闭合无开放项；§3 URL 表是否完整；§10 拆分是否可并行 |
| **SDD 后端工程师**（起草人） | §附录 C 的 14 条实测证据是否足以支撑 §2.2 / §D1 / §D3 / §D4 / §D9 / §D10 的选型；**重点复核 R1（Pages 锁 3.10）与实测版本 4.4.1 的差异** |
| **SDD 前端工程师** | §4.5 DOM/class 契约是否足以保证视觉等价；§4.6 的 3 条 markup 增量是否可接受；`assets/style.css` 零改动的可行性 |
| **SDD 测试工程师** | §9 的 22 条 AC 是否可执行、是否覆盖 DoD 九条（§1–§9）；归一化等价口径是否可接受（对 §D8「byte-equal」的口径校正） |
| **admin（知会）** | 知会即可（不阻塞）；若对「Pages 内置 Jekyll 3.10 而非 4.x」「放弃 jekyll-feed/sitemap 插件」有异议，请直接在本 issue 回执 |

---

## 附录 A: 模板能力白名单（Jekyll 4.x / 3.10 通用，已实测）

| 能力 | 用法 | 备注 |
| --- | --- | --- |
| `site.posts` | 已发布文章，date desc | 同日顺序靠 §D14 消歧 |
| `site.tags` | collection 文档数组（**非**哈希） | §D10 |
| `site.series` | collection 文档数组 | — |
| `where_exp` | `{% assign ss = site.posts | where_exp: "p", "p.series == page.title" %}` | 专栏成员 |
| `group_by_exp` | `{% assign g = site.posts | group_by_exp: "item", "item.date | date: '%Y-%m'" %}` | 归档分组；**`group_by` 不支持过滤器链** |
| `sort` | `site.series | sort: "title"` / `sort: "order"` | 单键 |
| `limit` / `slice` | 首页取最新 | — |
| `jsonify` / `strip_html` / `normalize_whitespace` | 搜索索引 | — |
| `xml_escape` | RSS / sitemap | — |
| `absolute_url` / `relative_url` | `baseurl == ""` 时二者等价 | — |
| `date` filter | `{{ page.date | date: "%Y-%m-%d" }}` | date-only 渲染 |
| 禁用 | `group_by: "a | b"`（失效）、`:name` 用在 `_posts` permalink（静默错误）、在 `_posts`/`_tags` 里写 `where`（性能与语义不稳，优先 `where_exp`） | — |

## 附录 B: front matter 校验规则（`validate-frontmatter.js --strict`）

| 规则 | 行为 |
| --- | --- |
| 缺 `title` / 含 `\n` | fail |
| 缺 `date` / 非 ISO / 未来 > 24h | fail |
| 缺 `tags` 或 `tags: []` | fail |
| `tags[]` 元素不在 `_tags/<slug>.md` 中 | fail |
| `tags[]` 有重复 | warn |
| 缺 `excerpt` 或 > 500 字 | warn（`--strict` 下 fail） |
| 文件名 slug 与 v1 目录名不一致 | fail |
| `series` 值在 `_series/*.md` 中不存在 | fail |
| `cover` 非空且本地路径不存在 | `--strict` fail / 默认 warn |
| `draft` / `pinned` 非布尔 | fail |
| `draft: true` 出现在 `_posts/`（应在 `_drafts/`） | fail |
| YAML 解析失败 / 重复键 | fail |
| 顶部 `---` 或第二个 `---` 缺失 | fail |
| 集成位点 | `scripts/publish.sh` 前置、`.githooks/pre-push`、本地 `npm run validate`（Phase G 加） |

## 附录 C: 实测证据（Jekyll 4.4.1 + jekyll-paginate 1.1.0 + jekyll-seo-tag 2.9.1，最小 fixture，2026-10-08）

| # | 验证点 | 结论 |
| --- | --- | --- |
| V1 | `_posts/2026-09-26-welcome.md` + `permalink: /posts/:slug/` | ✅ `https://itingyu.github.io/posts/welcome/` |
| V2 | 文章级 `permalink: /posts/:name/` | ❌ 静默产出 `https://itingyu.github.io/posts/2026-10-07-kitchen/`（**无占位符替换**，日期前缀未剥离） |
| V3 | `_series/厨房学.md` + collection `permalink: /series/:name/` | ✅ `/series/厨房学/`（CJK 原样） |
| V4 | `_series/金融市场观察.md` 同上 | ✅ `/series/金融市场观察/` |
| V5 | collection label 命名为 `tags` 后遍历 `site.tags` 的键值对 | ❌ `Liquid Exception: 0 is not a symbol nor a string`（内置 tag 哈希被覆盖） |
| V6 | 带 front matter 的 `search/index.json` / `feeds/rss.xml` / `sitemap.xml` | ✅ 分别产出 `/search/index.json` / `/feeds/rss.xml` / `/sitemap.xml`，`jsonify` / `absolute_url` 正常 |
| V7 | `paginate: 2` + 模板 `posts/index.md` | ❌ 告警「couldn't find an index.html page to use as the pagination template. Skipping pagination.」→ 只出 1 页 |
| V8 | `paginate: 2` + 模板 `posts/index.html` | ✅ `/posts/`（2 篇）+ `/posts/page2/`（1 篇），`paginator.total_pages == 2` |
| V9 | `{% seo %}` 渲染文章页 | ⚠️ 产出 `BlogPosting` + `WebPage` 两段 JSON-LD（与手写契约重复） |
| V10 | `group_by: "date | date: '%Y-%m'"` | ❌ 分组名为空（输出 `=3`） |
| V11 | `group_by_exp: "item", "item.date | date: '%Y-%m'"` + `reversed` | ✅ `[2026-09=2][2026-10=1]` |
| V12 | `where_exp: "p", "p.series == page.title"` | ✅ 命中同专栏文章并给出 `url` |
| V13 | `date: 2026-10-07 22:00:00 +0800` 配 `timezone: Asia/Shanghai` | ✅ 解析正常，`site.posts` 按时间 desc（22:00 在 08:00 之前） |
| V14 | `_tags/` 普通目录（未声明为 collection） | ⚠️ 不产出任何文件（下划线目录默认忽略）→ 必须声明为 collection 或改 `include`（`include` 只会原样拷贝，不走 Liquid，不可取） |

**复现方式**（Phase A 起可复跑）：

```bash
gem install jekyll jekyll-paginate jekyll-seo-tag --no-document
# 用 §附录 A 的能力白名单搭最小 fixture，跑 jekyll build 后核对上述 URL 列表
```

## 附录 D: 与 v2 的 diff（一键查阅）

| v2 段 | v3 段 | 变化 |
| --- | --- | --- |
| §2.2 纯静态 HTML 产物 | §2.1–2.2 Jekyll + 3 插件 | **架构反转**：MD 是唯一源、产物不入库、零 CI |
| §2.2 「B. Hugo/Jekyll/11ty 不选」 | §2.1 选 Jekyll | 反转 v2 的否决项（理由变了：不再需要自研 MD 渲染器） |
| §3.1 `posts/<slug>/index.{md,html}` | §3 `_posts/<date>-<slug>.md` | 目录换成 Jekyll 内置 `_posts/` |
| §3.3 URL 契约 | §3 URL 契约（+22 slug 清单 + `/posts/page2/`） | 表不变、增补可测清单；CJK 编码规则明确 |
| §5.2.3 前置发布流程（build + 校验 + commit + push） | §10 Phase G（push 即结束） | 发布链路少两步 |
| §6 M6 / M7 里程碑 | §10 Phase A–H | M6/M7 未实施即作废，重排 |
| 附 A 自研 MD 渲染器 17 项语法 | §2.3 kramdown GFM + Rouge | 语法由 Jekyll 提供，不再自研 |
| 附 B front matter 校验 | 附录 B | 迁到 `_posts/` + 新增 series/tag 引用校验 |
| §5.2.7 / §5.2.8（v2.1 专栏增量） | §D2 / §D4 / AC-08 / AC-12~14 | 契约保留，实现换成 Liquid |
| §8 开放问题（5 + 1） | 无 | 本 spec 已闭合（§7 D1–D14） |
