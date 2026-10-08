# CHANGELOG

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