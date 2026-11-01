# CHANGELOG

## 2026-11-01 · 导航调整

- 顶栏补上"专栏"（`/series/`）与"工具"（`/tools/a-stock-pnl/`）入口，此前只存在于页脚。
- 页脚去掉 RSS 与 GitHub 外链，只留站内 6 个链接；RSS 文件本身仍生成，订阅不受影响。

## 2026-11-01 · 列表页与文档

- `/posts/` 由"最新一篇阅读页"改为文章列表页（最近 30 篇 + 归档入口），补页面标题。
- 关于页专栏篇数改为按 frontmatter 动态统计，与首页卡片口径一致（此前是修复前的硬编码数字）。
- README 页面职责表同步更新。

## 2026-11-01 · 布局与内容改版

- **首页**：重写 hero 文案（编程 / AI / 金融 / 生活），新增站点概览行（篇数 / 专栏 / 系列 / 最后更新）与专栏入口网格（篇数动态统计），最新文章取 3 篇。
- **关于页**：按实际内容重写，修正三处过时信息——原稿写"零构建、零运行时依赖"（实际是 Jekyll 构建 + 4 个 JS 模块）、只列了三类内容（实际 5 个专栏）、篇数缺失。
- **下线词云**：删除 `/tags/` 页面、`_layouts/tags.html`、词云样式与 sitemap 条目；页脚"标签"入口移除；快捷键 `t` 改为跳转 `/series/`。
- 标签仍以纯文本 chip 显示在卡片与文章页，不提供标签页与筛选。

## 2026-11-01 · 收尾

- 删除死文件 `_layouts/posts.html`（无引用）与 `jekyll-paginate` 依赖：`/posts/` 一直由 `posts/index.html` 直接渲染最新一篇，配置里的 paginate 从未生效。
- 移除失效的 `paginate` / `paginate_path` 配置与分页导航块。
- README 补充 `/posts/`、`/archive/` 的真实职责。

## 2026-11-01 · 标签回补

- 文章卡片与文章页头部恢复标签展示（纯文本 chip，不可点，不接标签页/标签筛选）。
- 词云门槛从「≥2 次」提高到「≥4 次」：784 个标签中 15 个入云（ai-basics 29、cooking/kitchen 各 15、Python/A股 各 8 …）。
- 历史文章数据不再清洗。

## 2026-11-01 · 第二轮清理

- **归档页**：`/archive/` 原先挂的是分页列表布局，改为真正的按月归档（`_layouts/archive.html`，5 个分组）。
- **标签收口**：列表卡片与文章页不再显示标签，全站只有 `/tags/` 词云；词云只渲染出现 ≥2 次的标签（784 → 88 条入云）。
- **数据补全**：79 篇空 `excerpt`、32 篇空 `tags`、2 篇空 `series` 字段已补，`validate-frontmatter` 首次 0 error 0 warning。
- **RSS**：去掉 `content:encoded` 全文，`/feeds/rss.xml` 从 11MB 降到 123KB；删除两个早已失效的 per-series feed（series 名对不上，输出 0 条）。
- **文档**：v1–v3 设计文档移入 `docs/archive/` 并从构建排除；README 按现状重写。
- **分支**：删除剩余 5 个历史分支（finance 简报、m6 baseline、phase-e-search、source），远程只剩 `master`，总数 60 → 1。

## 2026-11-01 · 仓库维护

- **发布链**：新增 `scripts/import-md.js`（任意 md → 自动补 front matter → 校验 → 落 `_posts/`，失败回滚）与 `scripts/frontmatter.js`（解析/序列化唯一实现）；README 按现状重写。
- **瘦身**：删除 v2 HTML 渲染链（`lib.js` / `render-*.js` / `new-post.sh` / 金融脚本）与 8 个零引用迁移脚本，833 个文件、约 1.1 万行删除；远程清理 51 个 `agent/sdd/*` 废弃分支。
- **标签**：不再有标签页与标签筛选，`_tags/` collection、`tag.html`、`sync-tags.js` 全部移除，只保留 `/tags/` 纯词云（Jekyll 内置 `site.tags`）。sitemap 从 994 条降到 211 条。
- **搜索**：索引改为构建时生成，覆盖全部 196 篇（原静态文件仅 22 篇）；修掉搜索结果指向 `/posts/<slug>/` 的 404 链接。
- **数据**：26 篇文章的 `column` 与 `series` 错配已修正（permalink 冻结，不断链）；`validate-frontmatter.js` 接受 `series` 用 slug 写法，假警告 307 → 113。


## 版本变更摘要

| 版本 | 时间 | 主要内容 |
| --- | --- | --- |
| **v3** | 2026-10-08（spec 落地） | 架构再反转：MD 唯一源 + GitHub Pages 内置 Jekyll 原生直渲 + 仓库零 HTML 产物 + 零 CI build |
| v2.1 | 2026-10-07 | per-series RSS + sitemap `<series>` + nav 增「专栏」+ BlogPosting `hasPart`（设计文档见 `design-v2-archive.md`） |
| v2 | 2026-09-26 | Markdown 源 + Actions build + 行宽 +20%（设计文档见 `design-v2-archive.md`） |
| v1.2 | 2026-09-26 下午 | v1.2 增量：`article:section` + `article:pinned` + `og:image` + 代码高亮 |
| v1.0 | 2026-09-26 上午 | 设计稿第一版：浅/深双主题 + 文章页模板 + 标签/归档/RSS/SEO（设计文档见 `design-v1-archive.md`） |

> **编号勘误**：`design-v2-archive.md` 的 changelog 把专栏增量标成了「v3」。
> v3 spec（`design.md`）把架构版本占用为 v3，故专栏增量在本仓库重编号为 **v2.1**。

---

## v3 · 2026-10-08 · AIWORK1-84 + AIWORK1-94

### 一句话

**内容源只有 Markdown，渲染交给 GitHub Pages 内置的 Jekyll。**
仓库里**没有 HTML 产物**，**没有 CI build**，**没有 npm 渲染链**。
`git push` 一个 `.md` 就完成「写作 → 上线」。

### 架构反转

| 维度 | v1 | v2 | v3（当前） |
| --- | --- | --- | --- |
| 内容源 | 完整 HTML（手写 `<meta>` front matter） | Markdown + Actions build 渲 HTML | **Markdown（唯一源）** |
| HTML 产物 | 入库（手写） | 入库（Actions 渲） | **不入库**（Pages 容器里活） |
| 渲染器 | 无（HTML 即产物） | 自研 `scripts/build-index.js` | **Jekyll（Pages 内置）** |
| CI build | 无 | **GitHub Actions build** | **不引入（明确）** |
| 发布动作 | `commit HTML → push` | `commit MD → Actions build → 提交产物` | **`commit MD → push`（结束）** |
| 主题能力 | 自写 CSS | 自写 CSS + 自研 MD 渲染器 | 自写 CSS + Jekyll 模板 |

### 选型落定

| 项 | 决策 | 依据 |
| --- | --- | --- |
| 渲染器 | Jekyll（Pages 内置构建容器执行） | 零供应链；Pages 自身的构建即验收 |
| 版本真源 | `Gemfile` 锁 `github-pages` gem | 本地 `bundle install` 与 Pages 自动同版本 |
| 插件矩阵 | `jekyll-paginate` + `jekyll-seo-tag` + `jekyll-optional-front-matter` | **恰好 3 个**（§2.2 / AC-01） |
| Markdown | kramdown + `input: GFM` | Pages 环境具备 `kramdown-parser-gfm` |
| 高亮 | Rouge | v1 无 prism.js，无视觉回归 |
| permalink | `/posts/:slug/` | 实测 `:name` 对 `_posts` 是静默错误（日期前缀不剥离） |
| 部署 | `git push origin master` | 不改 Pages 设置（`Deploy from a branch` / `master` / root） |
| 不引入 | jekyll-feed / jekyll-sitemap / 第三方主题 / npm 渲染库 / CDN / Actions build | 与 v2.1 契约字段冲突或供应链膨胀 |

### 落地路径（Phase A–H）

| Phase | 范围 | issue | 状态 |
| --- | --- | --- | --- |
| **A** | `_config.yml` + `Gemfile` + `.gitignore` + `_layouts/default.html` + 头/尾 include + 最小 `index.md` | AIWORK1-87（spec 拆分后由技术总监派活） | 规划 |
| **B** | `_posts/` 22 篇 MD 迁移 + front matter schema + `_series/` 2 篇 + `_tags/` 24 篇（脚本生成）+ **v1 顺序基线快照** | AIWORK1-88 | 规划 |
| **C** | `_layouts/` 全部 11 个 + `_includes/` 全部 12 个 + 聚合页切 MD + **删 22 个旧 HTML** | AIWORK1-89 | 规划 |
| **D** | RSS / per-series RSS / sitemap / JSON-LD | AIWORK1-90 | 规划 |
| **E** | `/search/index.json` + `assets/search.js` 适配 | AIWORK1-91 | 规划 |
| **F** | 契约测试全量（22 条 AC）+ `github-pages` 锁定版本复跑 | AIWORK1-92 | 规划 |
| **G** | 脚本瘦身 + `package.json` 收口 + `.githooks/pre-push` + 删 `build-index.js` | AIWORK1-93 | 规划 |
| **H** | **spec 归档（design-v1/v2 → -archive，design-v3 → design.md）+ README v3 重写 + 本 CHANGELOG** | **AIWORK1-94（本 issue）** | **完成** |

依赖关系：A → B → C → {D, E} → F → G → H。

### Phase H · 触动文件（AIWORK1-94）

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `design-v2.md` → `design-v2-archive.md` | git mv | v2 spec 归档（评审通过的历史版本） |
| `design.md` → `design-v1-archive.md` | git mv | v1 / v1.2 spec 归档 |
| `design-v3.md` → `design.md` | git mv | v3 升为唯一权威 spec |
| `README.md` | 重写 | v3 一致性：Jekyll 工作流 / `_config.yml` 契约 / `_posts/` + `_series/` + `_tags/` 目录 / `bundle exec jekyll serve` 本地预览 / Phase A–H 历史链接 |
| `CHANGELOG.md` | 新增 | 本文件，记录架构反转 + Phase A–H 实施 |

### 不做（明确）

- 不删 v1 / v2 归档（保留历史）
- 不动 `_config.yml`（已稳定）
- 不引 GitHub Actions / 第三方主题 / CDN / npm 渲染库
- 不做流量灰度 / 双版本并行部署
- 不改 `assets/style.css` 设计 token（视觉冻结）

### 验收

- ✅ spec 归档完成（v1 / v2 移入 `*-archive.md`，v3 升为 `design.md`）
- ✅ README v3 重写完成
- ✅ CHANGELOG 完成
- ✅ commit 提交 master
- ⏳ AC 全绿：待 Phase A–G 落地后由 Phase F 测试覆盖（22 条 AC，见 `design.md` §9）

---

## 历史版本

详细历史（v1 / v1.2 / v2 / v2.1）见各自归档 spec：

- [`design-v1-archive.md`](./design-v1-archive.md)
- [`design-v2-archive.md`](./design-v2-archive.md)