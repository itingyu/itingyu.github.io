# itingyu.github.io

个人博客，部署在 GitHub Pages。访问 <https://itingyu.github.io/>。

## 设计 spec

- [`design.md`](./design.md) — 当前唯一权威 spec（**v3**，架构反转版）
- [`design-v1-archive.md`](./design-v1-archive.md) — v1 历史归档（HTML 即源码）
- [`design-v2-archive.md`](./design-v2-archive.md) — v2 历史归档（MD 源 + Actions build）
- [`CHANGELOG.md`](./CHANGELOG.md) — 版本变更与里程碑记录

## v3 架构一句话

**内容源只有 Markdown，渲染交给 GitHub Pages 内置的 Jekyll。**

仓库里**没有 HTML 产物**，**没有 CI build**，**没有 npm 渲染链**。
`git push` 一个 `.md` 就完成「写作 → 上线」。

| 维度 | v3 决策 |
| --- | --- |
| 渲染器 | Jekyll（GitHub Pages 内置） |
| 版本真源 | `Gemfile` 锁 `github-pages` gem，本地与线上同版本 |
| 插件矩阵 | `jekyll-paginate` / `jekyll-seo-tag` / `jekyll-optional-front-matter`（**恰好 3 个**） |
| Markdown | kramdown（`input: GFM`）+ Rouge 高亮 |
| 部署 | `git push origin master` → Pages 自动构建 → 上线（**零 CI**） |
| 内容源 | `_posts/<YYYY-MM-DD>-<slug>.md`（**唯一**源） |
| 聚合页 | Jekyll 渲染，不入仓库 |
| 草稿 | `_drafts/`（Jekyll 内置，**不渲染**） |
| 专栏 / 标签 | `_series/` / `_tags/` collections |

## 写新文章

v3 的「写作 → 上线」链路**只有 push 一步**：把 `.md` 提交到 `_posts/`，GitHub Pages 渲好就上线。

### 用法

```bash
# 1. 新建 _posts/<date>-<slug>.md（slug 只能 [a-z0-9-]，违规立即报错）
./scripts/new-post.sh my-first-post "我的第一篇" --tag note

# 2. 编辑正文（front matter 见 §5.1 of design.md）

# 3. 一键发布（validate → 白名单 add → commit → push）
./scripts/publish.sh

# 4. 等待 GitHub Pages 完成构建（通常 < 60s）→ https://itingyu.github.io/posts/my-first-post/
```

`scripts/publish.sh` 受 `set -euo pipefail` 保护，任一步失败立即 abort。

### Front matter 契约（`_posts/<date>-<slug>.md`）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | ✅ | 文章标题 |
| `date` | ISO8601 | ✅ | 发布时间（无时区时按 `timezone: Asia/Shanghai` 解释） |
| `tags` | string[] | ✅ | 标签 slug，必须存在于 `_tags/<slug>.md` |
| `excerpt` | string | ✅ | ≤ 500 字摘要 |
| `description` | string | — | `excerpt` 别名（迁移期兼容） |
| `series` | string | — | 专栏名，必须存在于 `_series/*.md` 的 `title` |
| `draft` | bool | — | 仅作 schema 占位；**draft 文章必须放 `_drafts/`，不放 `_posts/`** |
| `pinned` | bool | — | 首页置顶 |
| `cover` | string | — | 封面图相对路径 |

文件名 slug 必须等于 v1 目录名（如 `welcome.md` 对应旧 `posts/welcome/index.html`），
否则 URL 漂移、`validate-frontmatter.js --strict` 失败。

完整校验规则见 `design.md` 附录 B。

## 本地预览

```bash
# 安装依赖（macOS: brew install ruby; Ubuntu: apt install ruby-full）
bundle install
# 启动本地服务器（默认 http://127.0.0.1:4000）
bundle exec jekyll serve
# 包含草稿（默认不渲染 _drafts/）
bundle exec jekyll serve --drafts
# 监听所有地址（手机/平板扫码预览）
bundle exec jekyll serve --host 0.0.0.0
```

热重载：`--watch` 是 Jekyll 默认行为，文件保存自动重建。

如果只想 build 到目录（不启服务）：

```bash
bundle exec jekyll build --destination /tmp/blog-site
```

## 目录结构

```
itingyu.github.io/
├── _config.yml                ← Jekyll 唯一配置（plugins / permalink / collections / exclude）
├── Gemfile                    ← 锁 github-pages gem
├── index.md                   ← 首页（layout: home；hero 手写 + 最新 10 篇自动）
├── 404.html                   ← 404 页（front matter: layout: notfound）
├── about/index.md             ← 关于（layout: page）
├── archive/index.md           ← 按月归档（layout: archive）
├── tags/index.md              ← 标签总览（layout: tags）
├── series/index.md            ← 专栏总览（layout: series）
├── posts/index.html           ← 文章分页列表（jekyll-paginate 必须 .html）
├── search/index.md            ← 搜索页
├── search/index.json          ← Liquid 生成的搜索索引（前端 /assets/search.js 消费）
├── feeds/rss.xml              ← 全站 RSS
├── feeds/series-厨房学.xml    ← 厨房学专栏 RSS
├── feeds/series-金融市场观察.xml ← 金融市场观察专栏 RSS
├── sitemap.xml                ← 站点地图
├── robots.txt                 ← 爬虫规则（静态，不走 Liquid）
├── _posts/                    ← 文章源（**唯一**内容源；Jekyll 内置 collection）
├── _drafts/                   ← 草稿（Jekyll 内置，不渲染）
├── _series/                   ← 专栏 collection（output: true → 产出 /series/<name>/）
├── _tags/                     ← 标签 collection（脚本生成；产出 /tags/<slug>/）
├── _layouts/                  ← 11 个布局（default / home / posts / post / archive …）
├── _includes/                 ← 12 个片段（head / header / footer / post-card / jsonld-* …）
├── assets/                    ← 静态资产（style.css / theme.js / keys.js / search.js / favicon.svg）
├── scripts/
│   ├── new-post.sh            ← 产出 _posts/<date>-<slug>.md
│   ├── publish.sh             ← validate → 白名单 add → commit → push
│   ├── sync-tags.js           ← 幂等生成 _tags/<slug>.md
│   ├── sync-series.js         ← 幂等生成 feeds/series-<name>.xml
│   ├── validate-frontmatter.js← front matter schema 校验（--strict 强约束）
│   ├── finance-sync.sh        ← 拉 Multica 金融小队简报 → 落 _posts/
│   ├── publish-finance-brief.sh ← 金融小队专属一键发布
│   ├── install-hooks.sh       ← 装 .githooks/pre-push
│   └── __tests__/             ← node:test 套件（npm test）
├── .githooks/pre-push         ← pre-push 草稿门禁 + front matter 校验
├── package.json               ← 只承载 npm test（已删除 build / check / build:home / build:rss）
├── design.md                  ← 当前唯一权威 spec（v3）
├── design-v1-archive.md       ← v1 历史归档
├── design-v2-archive.md       ← v2 历史归档
├── CHANGELOG.md               ← 版本变更与里程碑
└── README.md                  ← 本文件
```

## `_config.yml` 契约（关键项）

| 键 | 值 |
| --- | --- |
| `title` | `itingyu · 博客` |
| `lang` | `zh-CN` |
| `url` / `baseurl` | `https://itingyu.github.io` / `""` |
| `timezone` | `Asia/Shanghai` |
| `permalink` | `/posts/:slug/`（**不是 `:name`**——实测 `:name` 对 `_posts` 是静默错误） |
| `paginate` / `paginate_path` | `12` / `/posts/page:num/` |
| `markdown` / `highlighter` | `kramdown` / `rouge` |
| `kramdown.input` | `GFM` |
| `safe` | `true` |
| `plugins` | `[jekyll-paginate, jekyll-seo-tag, jekyll-optional-front-matter]` |
| `collections.series` | `{output: true, permalink: /series/:name/}` |
| `collections.tags` | `{output: true, permalink: /tags/:name/}` |
| `exclude` | `node_modules/ package.json scripts/ README.md design*.md .githooks/ Gemfile* vendor/` |

完整契约与历史决策见 `design.md` §6.1。

## URL 契约

| 路径 | 说明 |
| --- | --- |
| `/` | 首页 |
| `/posts/` | 文章列表第 1 页（12 篇/页） |
| `/posts/page2/` | 文章列表第 2 页 |
| `/posts/<slug>/` | 单篇文章（22 篇 slug 见 `design.md` §3.1） |
| `/archive/` | 按月归档（倒序） |
| `/tags/` | 标签总览 |
| `/tags/<slug>/` | 单标签 |
| `/series/` | 专栏总览 |
| `/series/<显示名>/` | 单专栏（CJK 原字符，不 percent-encode） |
| `/search/` | 搜索页 |
| `/about/` | 关于 |
| `/feeds/rss.xml` | 全站 RSS |
| `/feeds/series-<name>.xml` | per-series RSS |
| `/sitemap.xml` | 站点地图 |
| `/robots.txt` | 爬虫规则 |
| `/404.html` | 404 页 |

## 键盘快捷键

`assets/keys.js` 提供全局键盘快捷键（Gmail / GitHub 风格）。

| 按键 | 行为 |
| --- | --- |
| `j` / `k` | 文章页下一篇 / 上一篇 |
| `g h` / `g p` / `g a` / `g t` | 跳到首页 / 文章 / 归档 / 标签 |
| `s` | focus 到搜索框 |
| `Shift+T` | 切换主题 |
| `?` | 弹出 / 隐藏快捷键浮层 |

焦点在输入控件时全部快捷键跳过；`prefers-reduced-motion: reduce` 下浮层淡入自动关闭。

## 主题与视觉

- 双主题（浅 / 深）：系统跟随 + 手动切换 + `localStorage` 持久化（`assets/theme.js`）
- `<head>` 内联 FOUC 防护脚本，主题闪烁 < 1 帧
- `.container` 1104px / `.container-wide` 1296px；正文行高 1.7
- 字号 `clamp()` 流体排版（`--step--1 … --step-5`）
- 配色 WCAG AA 全部通过
- `assets/style.css` 设计 token **冻结**（v3 不改）

## 金融简报同步

金融小队每日产出简报，由金融小队队长自己跑 `scripts/publish-finance-brief.sh`
一键完成「取 md → 落 `_posts/` → 白名单 add → push 分支」，技术总监只做最后 PR review + merge。

```bash
./scripts/publish-finance-brief.sh --latest
```

落库路径已从 v1 的 `posts/<slug>/index.html` 改为 v3 的 `_posts/<date>-<slug>.md`，
front matter 透传 `tags` / `description`（见 `scripts/finance-sync.sh`）。

## 测试

```bash
npm test    # node --test scripts/__tests__/*.test.js
```

v3 测试覆盖 22 条 AC（见 `design.md` §9）：`_config.yml` 契约 / URL 兼容 /
DOM 契约 / RSS / sitemap / 搜索索引 / JSON-LD / front matter schema / 草稿门禁 / 脚本幂等。

CI 状态：**无**（v3 明确不引入 GitHub Actions，Pages 自身的构建即验收）。

## Phase A–H 实施历史（v3 落地路径）

| Phase | 范围 | 状态 |
| --- | --- | --- |
| **A** | `_config.yml` + `Gemfile` + `.gitignore` + `_layouts/default.html` + 头/尾 include + 最小 `index.md` | 由 §10 拆分后由 AIWORK1-87 等子 issue 推进 |
| **B** | `_posts/` 22 篇 MD 迁移 + front matter schema + `_series/` 2 篇 + `_tags/` 24 篇（脚本生成）+ **v1 顺序基线快照** | 同上 |
| **C** | `_layouts/` 全部 11 个 + `_includes/` 全部 12 个 + 聚合页切 MD + **删 22 个旧 HTML** | 同上 |
| **D** | RSS / per-series RSS / sitemap / JSON-LD | 同上 |
| **E** | `/search/index.json` + `assets/search.js` 适配 | 同上 |
| **F** | 契约测试全量（22 条 AC）+ `github-pages` 锁定版本复跑 | 同上 |
| **G** | 脚本瘦身 + `package.json` 收口 + `.githooks/pre-push` + 删 `build-index.js` | 同上 |
| **H** | spec 归档（**本 issue**） + README v3 重写 + CHANGELOG | 本 issue |

依赖关系：A → B → C → {D, E} → F → G → H。

## 不做（明确）

- 不接评论系统
- 不做服务端搜索（客户端搜索 ≤ 50 篇够用）
- 不做 i18n（主中文）
- 不引第三方主题 / npm 渲染库 / CDN / Web 字体 / 前端框架
- **不引 GitHub Actions build**（v3 的核心就是把它删掉）
- 不改 `assets/style.css` 的设计 token
- 不改 `robots.txt`
- 不做流量灰度 / 双版本并行部署

## 后续

- spec 增改：先更新 `design.md`，评审通过后实现
- 新增脚本：放在 `scripts/`，同步在 `scripts/__tests__/` 加测试
- 模板改动：先在 `_layouts/` / `_includes/` 改，再在测试里加 DOM 契约