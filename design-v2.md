# itingyu.github.io · 设计方案 v2

> 草案,2026-09-26 23:15 北京时间 · SDD v2 评审用稿(技术总监提案)
>
> v1(v1.0 + v1.2)归档为 `design-v1-archive.md`(评审通过后落);本文件上线后即为唯一权威 spec。

## 版本变更摘要(changelog)

| 版本 | 时间 | 阶段 | 主要内容 |
| --- | --- | --- | --- |
| v1.0 | 2026-09-26 上午 | 设计稿第一版(admin + 4 角色 4/5 签字,知会 admin) | 浅/深双主题 + 文章页模板 + 标签/归档/RSS/SEO |
| v1.2 | 2026-09-26 下午 | v1.2 增量评审(AIWORK1-31,5/5 签字) | `article:section` 系列 + `article:pinned` 精选 + `og:image` 自动 + 代码语法高亮(prism.js 单文件) |
| **v2** | **2026-09-26 晚** | **本评审(AIWORK1-48)** | **Markdown 源文件(架构反转)+ draft 字段 + GH Actions 自动 build + 本地 preview server + 行宽 +20%** |

**反转的核心点**:v1「**HTML 即源码**」(git push 直接渲)→ v2「**Markdown 是源、HTML 是产物**」(本地或 Actions 预渲染后 git push)。其他 v1 / v1.2 的约定继续保留。

---

## 一句话定位

**itingyu 的个人博客** —— 写代码、看市场、做可视化。写作侧用 Markdown(快、可控、习惯);部署侧仍是零运行时静态 HTML。两端各取所长。

---

## 1. 设计目标

| 目标 | 评估指标 |
| --- | --- |
| **写得动** | 新增一篇文章 ≤ 3 分钟;`.md` + YAML front matter,不再手写 `<p>`/`<h2>` |
| **写得远** | 远程可写(GitHub 网页 / iPad GitHub App / VSCode Web),无需本地 clone |
| **看得舒服** | 阅读宽度 ≤ 1104px(中文 ~96 字/行,**admin 直发诉求**),首页/归档 ≤ 1296px |
| **找得到** | 首页 → 文章 → 标签 → 归档 全链路 ≤ 2 跳(沿用 v1) |
| **跑得稳** | Pages 仍渲纯 HTML 产物;build 在本地或 Actions 完成 |
| **零供应链** | 不引入 `marked` / `markdown-it` / 任何 CDN;YAML + MD 渲染器自实现(参考 `scripts/render-finance-brief.js`) |

---

## 2. 技术选型(本评审反转)

### 2.1 内容格式反转

| 维度 | v1/v1.2 | **v2(本评审)** |
| --- | --- | --- |
| **源格式** | HTML 即源码 | **`posts/<slug>/index.md`(Markdown + YAML front matter)** |
| **产物** | (等同源) | **`posts/<slug>/index.html`(build 时生成)** |
| **build 步骤** | 「可选,实际未跑」 | **必跑**:本地 `npm run build` 或 GitHub Actions 自动 build |
| **front matter** | HTML `<meta>` + JSON-LD | **YAML in MD**(build 时映射到 `<meta>` + JSON-LD) |
| **过渡期** | — | **双扫**:`build-index.js` 优先 `index.md`;若只有 `index.html` 则向下兼容(不破坏现有 3 篇) |
| **第三方依赖** | 零 | 仍零(MD 渲染器自实现) |
| **撤回到 v1 的可逆性** | — | 容易:`.md` → 手转 `.html` 单向可逆,符合 v1 §3.2 「HTML → MD 单向门」的反向 |

**反转理由**(admin 直发):
1. **写作体验**:Markdown 编辑器生态成熟(VSCode / Typora / Obsidian / GitHub Web);手写 HTML `<p>`/`<h2>` 慢且易错。
2. **远程编辑**:GitHub 网页直接编辑 `.md` 后 commit → Actions 自动 build → Pages 上线,**无需 clone 仓库**。
3. **生态一致**:与 `algorithm-visualization` 项目写文档、README 一样用 MD;心理负担最小。

### 2.2 仍选纯静态 HTML 部署

| 候选 | 选 / 不选 | 理由 |
| --- | --- | --- |
| **A. 静态 HTML(产物) + MD(源),本地/Action 预渲染** | **选** | 写作用 MD(快),产物仍 HTML(零运行时、SEO、Pages 直渲) |
| B. Hugo/Jekyll/11ty | 不选 | 多一道工具链;v1 已拒 |
| C. Next.js / Astro SSG | 不选 | 重量级;v1 已拒 |
| D. CMS(Notion/Hugo CMS) | 不选 | 厂商锁定 + 第三方依赖;v1 已拒 |

### 2.3 仍选原生 JS,不加框架

主题切换 / 主题脚本 / 键盘快捷键全部沿用 v1(≤ 200 行 JS,不引 React/Vue)。

### 2.4 仍选 GitHub Pages(master 分支)

构建产物仍推到 `master` 根目录,Pages 配置不变。

---

## 3. 内容模型(本评审反转 §3.2)

### 3.1 目录即 URL(沿用 v1)

```
posts/<slug>/index.md   →  build →  posts/<slug>/index.html  →  https://itingyu.github.io/posts/<slug>/
```

> 若 `index.md` 与 `index.html` 同时存在,**`index.md` 优先**(build 时会覆盖 `.html`);过渡期可保留 `.html` 作为存档(commit 进 git 即可)。

### 3.2 Front matter 编码(反转)

**v2 源格式**(`posts/<slug>/index.md` 头部 YAML,`---` 分隔):

```yaml
---
title: 我的第一篇
date: 2026-09-26                          # 必填,YYYY-MM-DD
tags: [note, life]                        # 必填,数组,slug 格式
excerpt: 一句话摘要,150 字内                # 必填
slug: my-first-post                      # 可省(默认目录名)
author: itingyu                           # 必填(默认 itingyu)
cover: cover.svg                          # 可选,相对 posts/<slug>/ 路径
series: 金融市场观察                       # 可选(v1.2 沿用)
pinned: false                             # 可选(v1.2 沿用,精选)
draft: false                              # 可选,v2 新增,默认 false
canonical: https://itingyu.github.io/posts/my-first-post/  # 可选,默认自动生成
---
```

| 字段 | 类型 | 必填 | 落点(via build) |
| --- | --- | --- | --- |
| `title` | string | ✅ | `<title>` + `<meta property="og:title">` |
| `description` / `excerpt` | string | ✅ | `<meta name="description">` + JSON-LD `description` |
| `date` | `YYYY-MM-DD` | ✅ | `<meta property="article:published_time">` + `<time datetime>` |
| `tags[]` | array<string> | ✅ | `<meta property="article:tag">` × N + chip 链接 |
| `slug` | slug | —(默认目录) | URL 段 |
| `author` | string | ✅(默认 itingyu) | `<meta name="author">` + JSON-LD `author` |
| `cover` | path(相对 slug) | — | og:image + 视觉化(若实现) |
| `series` | string | — | v1.2 `article:section` 沿用 |
| `pinned` | bool | — | v1.2 首页精选沿用 |
| **`draft`** | **bool** | **(默认 false)** | **v2 新增,见 §3.4** |
| `canonical` | URL | — | `<link rel="canonical">`,默认自动 |

**取舍**:放弃 HTML 「所见即所得」,换 Markdown + YAML 生态。**可逆性**:`.md` 重新手编为 `.html` 是工作量,但**完全可逆**(HTML 看得见);与 v1 §3.2 那一段一致。

### 3.3 URL 契约(沿用 v1)

| 路径 | 含义 | 备注 |
| --- | --- | --- |
| `/` | 首页(hero 手写 + 最新文章区由 build 生成) | — |
| `/posts/` | 全部文章列表(按时间倒序) | build 生成 |
| `/posts/<slug>/` | 单篇文章 | build 生成 |
| `/archive/` | 按月归档 | build 生成 |
| `/tags/` | 全部标签 + 文章计数 | build 生成 |
| `/tags/<tag>/` | 单标签 | build 生成 |
| `/series/` | 系列总览(v1.2) | build 生成 |
| `/series/<series-slug>/` | 单系列 | build 生成 |
| `/search/` | 客户端搜索(v1.2) | 手写 + 索引 JSON |
| `/about/` | 关于 | 手写 |
| `/404.html` | 错误页 | 手写 |
| `/feeds/rss.xml` | RSS 订阅 | build 生成 |
| `/sitemap.xml` | 站点地图 | build 生成 |
| `/robots.txt` | 爬虫规则 | 手写 |
| `/assets/{style.css,keys.js,theme.js,favicon.svg,prism.js}` | 静态资源 | 手写 |

### 3.4 Draft 状态处理(v2 新增)

`draft: true` 的文章:

- ❌ **不** 生成 `posts/<slug>/index.html`
- ❌ **不** 收录到 `posts/index.html` / `archive/index.html` / `tags/<tag>/index.html` / `series/<series-slug>/index.html`
- ❌ **不** 进 `feeds/rss.xml`
- ❌ **不** 进 `sitemap.xml`
- ✅ 文件仍 commit 进 git(可远程管理草稿)
- ✅ `npm run check` 不报「drift」(因 HTML 是聚合页排除后的结果)

`scripts/publish.sh <slug>` 子命令(本期 / M7 实现):把 `draft: true` 改为 `draft: false`,逐 front matter 字段后 commit + push。

### 3.5 字段格式约束(契约级)

- **slug 格式**:`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`(与 v1 `new-post.sh` 一致)
- **tag 格式**:`^[a-z0-9](?:[a-z0-9-]{0,30})$`
- **date**:`YYYY-MM-DD`,时区固定 Asia/Shanghai 输出
- **tags[]** 元素:必须 slug 格式;未通过 `slugifyTag` 函数可读性转换(与 v1 §3.2 一致)
- **cover**:`posts/<slug>/cover.{jpg,svg,png,webp}` 必须存在;否则 `--strict` 校验失败
- **draft**:`true` / `false`(其他值报错)
- **pinned**:`true` / `false`(其他值报错)
- **series**:slug 格式(`^[\u4e00-\u9fa5a-z0-9-]+$`)— 与 v1.2 一致

---

## 4. 视觉规范(本评审改 §4.2)

### 4.1 主题、配色、可访问性(沿用 v1 / v1.2)

- 双主题 + 三段式触发(系统 / 手动 / localStorage)
- WCAG AA 通过
- 焦点可达性 / `prefers-reduced-motion` / 打印样式

### 4.2 排版(**本评审 +20%**)

```css
.container       { max-width: 1104px; margin: 3rem auto; padding: 0 1.5rem; }
.container-wide  { max-width: 1296px; margin: 3rem auto; padding: 0 1.5rem; }
```

- **正文 `.container`**:920 → **1104px**(+20%,admin 直发诉求)
- **首页 / 归档 `.container-wide`**:1080 → **1296px**(+20%,同步扩)
- 中文行宽从 ~80 字提到 ~96 字;屏幕宽屏(iMac 27" / MacBook 16")利用率更高
- 字号尺度 / 行高 / 字体栈 沿用 v1 不变

### 4.3 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 96 字 / 行超过「可读性研究」建议的上限(≤ 90 CJK / 行) | 默认应用;若反馈「太宽」再回退到 920(v1 baseline)或引入 3.3(字号 +1 补偿) |
| 移动端 `< 640px` 溢出 | 沿用 v1 媒体查询 padding 兜底 |
| 代码块 / 表格与正文同行不溢出 | 行内 `<code>` 不破坏,`<pre>` 横向滚动保留 |

---

## 5. 内容来源与流程(**本评审扩展 §5.2**)

### 5.1 三类内容(沿用 v1)

| 内容类型 | 来源 | 频率 | 标签 |
| --- | --- | --- | --- |
| 金融市场每日简报 | 金融小队每日 08:00 | 每日 | `finance` |
| 算法可视化笔记 | 算法可视化项目沉淀 | 不定期 | `algorithm` |
| 随笔 / 技术笔记 | itingyu 本人 | 不定期 | `note` |

### 5.2 发布流程(**本评审扩展**)

#### 5.2.1 本地模式(传统)

```bash
# 1. 生成文章骨架
./scripts/new-post.sh my-post "标题" --tag note

# 2. 编辑 posts/my-post/index.md(Markdown + YAML front matter)
$EDITOR posts/my-post/index.md

# 3. 一键发布:build + 校验 + commit + push
./scripts/publish.sh                      # 自动 commit message
./scripts/publish.sh -m "post: my-post"  # 指定 message
```

`scripts/publish.sh` 流程(v2 增量,M6 范围内):
1. `node scripts/validate-frontmatter.js`(frontmatter 校验,本期)
2. `npm test`(回归兜底)
3. `npm run build`(生成 HTML + 聚合页)
4. `git add -A`(git add 全部聚合产物)
5. `git commit -m "${MESSAGE:-post(<slug>): <title>}"`
6. `git push origin master`
7. GitHub Pages 自动部署

#### 5.2.2 远程模式(GitHub Web / iPad / VSCode Web,**v2 新增**)

新增 `.github/workflows/build-posts.yml`:

- **触发**:`push` 到 `master` 且路径包含 `posts/**/*.md`、`posts/**/*.html`、`scripts/**`、`.github/workflows/build-posts.yml`
- **权限**:`contents: write`(GitHub 默认 Read-only,需在 repo `Settings → Actions → General → Workflow permissions: Read and write`)
- **Job 步骤**:
  1. `actions/checkout@v4`(深度 2,保留 git 历史)
  2. `actions/setup-node@v4`(Node 20)
  3. `npm ci`(无 lock 则 `npm install`,平替)
  4. `node scripts/validate-frontmatter.js`(frontmatter 校验)
  5. `npm test`(回归)
  6. `npm run build`(生成产物)
  7. `git add -A` → `git commit -m "AIWORK1-... · auto-build"` → `git push`
- **死循环防护**:`if: github.event_name == 'push' && !contains(github.event.head_commit.message, 'auto-build')`(commit message 哨兵)
- **失败回滚**:Actions 失败不回滚(产物未 push),master 保留上一次稳定版本

#### 5.2.3 草稿工作流(**v2 新增**)

```bash
./scripts/publish.sh welcome   # 特殊:把 draft: true → false,commit + push
./scripts/publish.sh welcome --status draft  # 反向:已发布 → 草稿
```

`publish.sh <slug>` 子命令(M6 末尾):
- 读 `posts/<slug>/index.md` 的 `draft:` 字段
- 按 `--status draft|publish` 翻转
- 走 5.2.1 的第 1-7 步

#### 5.2.4 本地预览 server(**v2 新增**)

`scripts/preview.js`(Node 内置 `http`,零依赖):

```bash
npm run preview   # 启动 127.0.0.1:8080
```

- 文档根:仓库根
- `/posts/<slug>/`:若只有 `.md` → 临时调 `build-index.js --only <slug>` 渲染 → 返回 HTML;若已有 `.html` → 直接返回
- 热重载:`fs.watch('posts/**/*.md')` → WebSocket `reload` 信号 → 浏览器 `location.reload()`
- 仅监听 `127.0.0.1`(安全,无外网暴露)

#### 5.2.5 设计原则

- **不引入第三方依赖**(marked / markdown-it / chokidar / ws 全砍,自实现)
- **不引入构建工具**(webpack / vite / esbuild 全砍,纯 Node `node:test`)
- **不引入 framework**(沿用 v1)

---

## 6. 里程碑(**本评审新增 M6 / M7**)

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| M1 骨架 | 首页 + 关于 + 文章索引 + 404 | ✅ 已完成(`08b5eaf`) |
| M2 设计稿 v1 | 浅/深主题、文章页模板、标签、归档、RSS、SEO、favicon | ✅ 已完成(`7e95910`) |
| M3 内容接入 | 金融小队简报同步 + 示例文章 3 篇 | ✅ 已完成 |
| M4 自动化 | `scripts/build-index.js` + 增量构建(SHA-256 缓存) | ✅ 已完成(AIWORK1-32) |
| M5 内容深化 | prism.js 代码高亮 / series / pinned / og:image / JSON-LD / search / keys.js / 智能 404 / heading 锚点 | ✅ 已完成(v1.2) |
| **M6 Markdown 迁移**(本评审主线) | 6.1 design-v2.md 评审签字 → 6.2 `build-index.js` 加 YAML/MD 扫描与渲染(自实现)→ 6.3 `new-post.sh` 输出 `.md` → 6.4 `render-finance-brief.js` 改产 `.md` → 6.5 现有 3 篇文章手工迁移 → 6.6 draft 字段 + 跳过逻辑 → 6.7 测试矩阵(≥ 8 MD + ≥ 5 frontmatter) | 📝 评审中 |
| **M7 流程自动化**(本评审附属) | 7.1 `scripts/preview.js` + `preview` script → 7.2 `.github/workflows/build-posts.yml` → 7.3 `scripts/publish.sh` 一键 + `<slug>` 草稿子命令 → 7.4 `scripts/validate-frontmatter.js` | 📝 评审中 |
| M8 spec 同步与归档 | design-v1-archive.md 迁移 + README.md 改写 + CHANGELOG.md 增 v2 章节 | 📝 评审通过后即开 |

---

## 7. 风险与缓解

### 7.1 v1 沿用

| 风险 | 缓解 |
| --- | --- |
| 手工更新列表页漏改 | **M6.2 / M7.2 / M7.3 自动化兜底** |
| GitHub Pages 不可用 | 不做缓解(沿用 v1) |
| 视觉风格不喜欢 | 主题切换 + 改 CSS 即可(沿用 v1) |
| 内容质量差 | 自己写,不开放投稿(沿用 v1) |

### 7.2 v2 新增

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| MD 渲染器对边缘语法产生错误 HTML | 中 | 中 | 测试矩阵 ≥ 8 条覆盖 # / ** / * / `code` / > / - / 链接 / 图片 / fenced code;CI 强制 100% pass |
| 自实现 YAML parser 对复合类型误读 | 中 | 中 | 测试矩阵 ≥ 5 条;scope 限于 string / number / bool / date / array<string>;不允许嵌套对象 |
| GH Actions 死循环(auto-build commit 触发再 build) | 高 | 低(无副作用) | commit message 哨兵 `auto-build` 字符串检测;`if` 条件过滤 |
| GH Actions 首次 push 权限不足 | 高(默认 Read-only) | 中 | repo `Settings → Actions → Workflow permissions: Read and write` 须由 admin 配置;README 给一次性说明 |
| `draft: true` 误 commit 进 master | 中 | 中(私密度) | `validate-frontmatter.js` 默认非严格;`publish.sh` 二次校验 + 提示 |
| preview server 启动失败(端口占用) | 低 | 低 | `lsof -i :8080` 检测,失败时 exit code + 友好提示 |
| 现有 3 篇文章 `.html` → `.md` 迁移导致 frontmatter 丢失 | 中 | 中 | 沿用 `parseFrontmatter` 函数重新提取;`npm run check` 在迁移前后跑一次确认无 drift |
| `--only rss` / `--only home` 子命令与 MD 路径不兼容 | 中 | 中 | 子命令路径解析同步升级:`scanPosts` 接受 `.md` 优先,fallback `.html` |

---

## 8. 开放问题(待 admin 决策,沿用 v1)

1. **封面图字段约定**:`posts/<slug>/cover.{jpg,svg,png,webp}`(v2 §3.2 已规定,可选)
2. **代码高亮**:M5 已落(prism.js 单文件本地);不需再决策
3. **评论**:继续「不做」(v1 §5.2)
4. **域名**:继续 `itingyu.github.io`(v1 §5.2),待 admin 自定义域名拍板
5. **金融免责声明**:footer + about 已加;每篇文章可选
6. **🆕 GH Actions 权限配置**:admin 是否能在 repo Settings 一次性把 Workflow permissions 设为 Read and write?(M7.2 的前置条件)

---

## 9. 实现-issue 解锁清单(v2 评审通过后由 SDD 技术总监拆派)

> **当前不创建** —— 「评审未过先建 issue」违反 SDD 流程。评审签字后另开 AIWORK1-N issue 派活。

| 子项 | 工作量 | 默认派给 | DoD 关键词 |
| --- | --- | --- | --- |
| `build-index.js` 加 YAML front matter 解析(自实现) + MD 渲染器 | M | @SDD后端工程师 | 自实现;沿用 render-finance-brief 模式;`renderPostMarkdown()` 函数 |
| `new-post.sh` 输出 `posts/<slug>/index.md`(YAML 占位 + 一个 `<h1>标题</h1> + 段落`) | S | @SDD后端工程师 | `cat posts/test/index.md` 头部 YAML 完整 |
| `render-finance-brief.js` 改为产出 `.md` | S | @SDD后端工程师 | 输出文件后缀 `.md`;front matter 与正文分离 |
| `publish-finance-brief.sh` 同步调 `publish.sh` | XS | @SDD后端工程师 | 命令链替换 |
| 现有 3 篇文章 `posts/welcome/` + `posts/finance-2026-09-26/` + `posts/sing-box-setup-experience/` 手转 MD | S | @SDD前端工程师(`sing-box` 已有 `source.md`) | `npm run check` 无 drift;frontmatter 字段全 |
| `scripts/preview.js` + `package.json` `preview` script + WS 热重载 | M | @SDD前端工程师 | `npm run preview` 起 8080;改 `.md` 自动 reload |
| `.github/workflows/build-posts.yml`(本地 checkout + npm ci + validate + test + build + push)| S | @SDD后端工程师 | Admin 配权限后,网页编辑 `.md` → 60s 内产物上线 |
| `build-index.js` draft 字段跳过逻辑 | XS | @SDD后端工程师 | `draft: true` 文章不在任何聚合页/RSS/sitemap |
| `scripts/publish.sh` 一键 + `<slug>` 子命令(草稿翻转) | S | @SDD后端工程师 | `./scripts/publish.sh welcome` 成功翻转 + 上线 |
| `scripts/validate-frontmatter.js`(纯 Node 内置,JSON Schema 风格字段类型断言)| S | @SDD后端工程师 | 必填字段、类型、引用路径都校验;退出码 1 表示失败 |
| MD 渲染器测试矩阵(`scripts/__tests__/markdown-render.test.js` ≥ 8 条) | S | @SDD测试工程师 | # / ** / * / `inline` / ```fenced``` / [link](url) / ![img](path) / > quote / - list 各覆盖 |
| frontmatter 校验测试矩阵(`scripts/__tests__/validate-frontmatter.test.js` ≥ 5 条) | S | @SDD测试工程师 | 缺字段、类型错、引用路径不存在、draft: typo、tags 含空格各覆盖 |
| `design.md` v1 / v1.2 移入 `design-v1-archive.md`;`design.md` 内容指向 `design-v2.md` 或合并覆盖 | XS | @SDD技术总监(本人) | 主仓两个文件;`design.md` ≤ 50 行,链接到 v2 |
| `README.md` 改写为 v2(发布流程 + 远程编辑 + 草稿 + preview) | S | @SDD前端工程师 | 「写新文章」章节重写;新增「远程编辑」「预览」段 |
| CSS 行宽 +20%(`.container` 920 → 1104,`.container-wide` 1080 → 1296) | XS | @SDD前端工程师 | `assets/style.css` 改 2 行;`@media` 不破 |

---

## 10. 评审签字要求(v2,5/5 必须实质签字)

| 角色 | 签字 | 验收路径(本评审必跑) |
| --- | --- | --- |
| **@SDD技术总监**(本人) | 主持 + 拍板 | `design-v2.md` 草案;changelog 表完整;子 issue 列表完备 |
| **@SDD后端工程师** | 必须实质过 | `build-index.js` 加 YAML/MD 改造可行性(原型代码或行级补丁);`new-post.sh` 输出 `.md` 模板可跑;`render-finance-brief.js` 改产 `.md` 可跑 |
| **@SDD前端工程师** | 必须实质过 | MD 渲染器覆盖语法集(必须含代码块、fenced code、图片);JSON-LD 路径兼容(v1.2 注入不被 MD 渲染破坏);`scripts/preview.js` WS 热重载方案 |
| **@SDD测试工程师** | 必须实质过 | 自实现 MD parser 测试矩阵 ≥ 8 条(给每个语法一条 happy path);YAML frontmatter 校验 ≥ 5 条(必填 / 类型 / 引用 / typo / draft 等) |
| **@admin** | **实质签字**(★本评审不可走「默认签收」) | admin 房间直发 OR 在本 issue 评论 mention 形式回执 |

**v2 评审通过后解锁**:
- M6 / M7 子 issue 创建与派活
- `design.md` v1/v1.2 归档 + `design-v2.md` 升为唯一权威 spec

---

## 11. 不做(明确,沿用 v1)

- 不接评论系统
- 不做服务端全文搜索(沿用 v1 `< 50 篇`上限,实际 > 200 仍 client-side `/search/`)
- 不做 i18n
- 不引第三方 markdown 库(marked / markdown-it / micromark)
- 不引 npm 依赖(package.json 仍只有 `node:test`)
- 不引 CDN / 外部字体
- 不引框架(React/Vue/Svelte)

---

## 附 A:Markdown 渲染器最小语法矩阵(实现 issue 必达)

| 语法 | 示例 | 输出 |
| --- | --- | --- |
| H1-H6 | `#` … `######` | `<h1>` … `<h6>`(单 `<h1>`/文章标题不重出) |
| 段落 | 普通文本 | `<p>` |
| 加粗 | `**text**` | `<strong>` |
| 斜体 | `*text*` | `<em>` |
| 行内 code | `` `text` `` | `<code>` |
| 链接 | `[label](url)` | `<a href="url">label</a>` |
| 图片 | `![alt](path)` | `<img alt="alt" src="path" loading="lazy">` |
| 引用 | `> text` | `<blockquote>`(单层) |
| 无序列表 | `- item` × N | `<ul><li>` |
| 有序列表 | `1. item` × N | `<ol><li>` |
| 围栏代码块 | ` ```lang ` | `<pre><code class="language-lang">` |
| 水平线 | `---`(独立一段) | `<hr>` |

**不做**(避免引第三方):
- 表格(本期 `article:pinned` 用 `.post-card` 列表代替;真要表格再手动 HTML)
- 嵌套列表 / 嵌套引用(单层递归)
- 任务列表 `- [ ]`(优先级低,不做)
- 删除线 `~~text~~`(不做)
- 数学公式(接入 KaTeX 是 v3+)

**安全**:
- 所有 `<` `>` `&` `"` 转义后输出
- `<script>` / `<style>` 标签拒绝(含 lang 属性也不行)
- 图片路径只放白名单:相对路径、HTTP(S) URL;`javascript:` 一律拒绝
- HTML 属性注入拒绝(`onerror` / `onclick` 等事件不放过)

---

## 附 B:Frontmatter 校验规则(实现 issue 必达)

| 规则 | 行为 |
| --- | --- |
| 缺 `title` | fail |
| `title` 含 `\n` | fail |
| 缺 `date` | fail |
| `date` 非 `YYYY-MM-DD` | fail |
| `date` 未来超过 24h | warn(`--strict` 开启则 fail) |
| 缺 `tags` 或 `tags: []` | fail |
| `tags[]` 元素非 slug 格式 | fail |
| `tags[]` 含重复 | warn |
| 缺 `excerpt` 或 `> 500` 字 | warn |
| `slug` 与目录名不一致 | fail |
| `cover` 路径不存在 | fail(`--strict`)/ warn(默认) |
| `draft` 非 bool | fail |
| `pinned` 非 bool | fail |
| `series` 非 slug / 中文 slug 格式 | warn |
| 顶部 `---` 缺失或第二个 `---` 缺失 | fail |
| YAML 解析失败(indentation / 重复键 / 未闭合字符串) | fail |

**集成位点**:
- `scripts/publish.sh` 跑前调一次
- `.github/workflows/build-posts.yml` 的 validate step
- `scripts/preview.js` 启动时跑一次(失败阻止访问)

---

## 附 C:与 v1 spec 的 diff(本评审一键查阅)

| v1 / v1.2 段 | v2 段 | 变化 |
| --- | --- | --- |
| §2 选型 A | §2.1 选 A' | 「HTML 即源码」→「HTML 是产物,MD 是源」+ build 步骤必跑 |
| §3.2 frontmatter 表 | §3.2 / §3.4 / §3.5 | 表格迁移至 YAML;新增 `draft`;新增字段格式约束 |
| §3.3 URL | §3.3 | URL 契约不变,新增 `/series/` 子路径已含 |
| §4.2 排版 | §4.2 | 行宽 +20% |
| §5.2 流程 | §5.2 | 5 个子节:本地 / 远程 / 草稿 / preview / 原则 |
| §6 里程碑 | §6 | 新增 M6 / M7 / M8 |
| §7 风险 | §7 | 沿用 + 新增 v2 风险 8 条 |
| §8 开放问题 | §8 | 5 + 1 条 admin 决策 |

---

**当前状态**:v2 草案已落(本文件)。SDD 评审 4/5 签字待后端/前端/测试实质验证(admin 必须实质签字,不能走「知会」)。**评审通过后**才创建 M6 / M7 子 issue,避免「评审未过先建 issue」违规。
