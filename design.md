# itingyu.github.io · 设计方案 v1

> 草案,2026-09-26（北京时间） · 待 admin 拍板

## 一句话定位

**itingyu 的个人博客** —— 写代码、看市场、做可视化。技术债最低的纯静态站点,内容驱动而非框架驱动。

## 1. 设计目标

| 目标 | 评估指标 |
| --- | --- |
| 写得动 | 新增一篇文章 ≤ 5 分钟,不需要查文档 |
| 看得舒服 | 阅读宽度 ≤ 920px(中文 ~80 字/行,可读),首页 / 归档 ≤ 1080px,字号随屏宽自适应,浅 / 深主题可切换 |
| 找得到 | 首页 → 文章 → 标签 → 归档 全链路 ≤ 2 跳 |
| 装得下 | 至少能撑到 200 篇文章不重构 |
| 跑得稳 | GitHub Pages 直接渲染,无构建步骤 |
| 看得出是谁 | 视觉风格统一,不「看起来像 Jekyll 默认主题」 |

## 2. 技术选型

### 选 **纯静态 HTML + CSS + 一点点原生 JS**

候选：
- **A. 纯静态 HTML + CSS（推荐）**
- B. Hugo / Jekyll / Hexo（静态站点生成器）
- C. Next.js / Astro SSG（现代 SSG）
- D. Notion / Hugo CMS + 主题

| 维度 | A 静态 | B 经典 SSG | C 现代 SSG | D CMS |
| --- | --- | --- | --- | --- |
| 部署成本 | git push 即上线 | 需要构建 | 需要构建 + Node | 第三方依赖 |
| 学习成本 | 0 | 中（模板语法） | 中-高 | 低 |
| 内容迁移 | 改 HTML | 改 Markdown + front matter | 改 MD/MDX | UI 操作 |
| 写新文章速度 | 复制模板改 | 较慢（构建） | 中 | 最快 |
| 可读性 | 高 | 中 | 低 | — |
| 长期可维护 | 高（10 年后仍能维护） | 中（依赖工具链） | 中（依赖版本） | 低（厂商锁定） |
| 自定义能力 | 100% | 受主题约束 | 受主题约束 | 极受限 |

**结论：选 A。** 一篇博客不需要框架。一篇文章 = 一个完整的 HTML 文件,front matter 信息全部塞进 `<head>` 的 `<meta>` + JSON-LD 里。代价是写新文章要复制一份模板,收益是：

- 仓库可以直接 git push 部署,GitHub Pages 原生支持
- 零构建、零运行时依赖、零供应链风险
- HTML 即源码,可读性极高,十年后仍能维护
- 与现有 `algorithm-visualization` 项目技术债哲学一致(也是「不引入不必要的依赖」)

### 选 **原生 JS,不加框架**

主题切换器 ≈ 15 行 JS。增加 React/Vue 等价于杀鸡用牛刀。

### 选 **GitHub Pages 继续托管**

理由：admin 已经在用,免费,稳定,与 repo 同源。

## 3. 内容模型

### 3.1 目录即 URL

```
posts/<slug>/index.html  →  https://itingyu.github.io/posts/<slug>/
```

每篇文章一个目录,主文件 `index.html`,后续可放 `assets/` 存图。

### 3.2 Front matter 编码到 `<head>`

不在文件里写 YAML front matter,所有元信息进 `<meta>` 与 JSON-LD：

| 字段 | 落点 |
| --- | --- |
| `title` | `<title>` + `<meta property="og:title">` |
| `description` | `<meta name="description">` |
| `date` | `<meta property="article:published_time">` + `<time datetime>` |
| `dateModified` | `<meta property="article:modified_time">` + `<time datetime>`(v1.2 新增;**可选**,缺省回退 `date`,用于 `article:pinned` 精选置顶排序) |
| `tags[]` | `<meta property="article:tag">` × N |
| `article:section` | `<meta property="article:section">`(v1.2 新增;系列归属,单值;**显示文本与 slug 同源,即 `content` 原文**,中文保留,不另设 `series-name` 字段) |
| `article:pinned` | `<meta property="article:pinned" content="true">`(v1.2 新增;首页精选置顶标记,**仅当 `pinned=true` 时输出 meta**,缺省不输出;排序键 `dateModified` desc,缺 `dateModified` 时回退 `date`,上限 `HOME_LIMIT=3`) |
| `og:image` | `<meta property="og:image">`(v1.2 新增;封面图复用,有 `cover.{jpg,svg,png,webp}` 用之,否则回退到 `assets/og-default.svg`;**绝对 URL**,首页同样注入) |
| `slug` | URL 段,本身就是 |
| `author` | `<meta name="author">` |
| `canonical` | `<link rel="canonical">` |
| 全文结构化 | JSON-LD `BlogPosting` |

**取舍**：放弃 Markdown 简洁性,换 HTML 可读性与可移植性。如果将来后悔,迁移到 SSG 是单向门（HTML → MD 易,MD → HTML 难）。

### 3.3 URL 契约

| 路径 | 含义 |
| --- | --- |
| `/` | 首页（最新文章 + 个人简介） |
| `/posts/` | 全部文章列表（按时间倒序） |
| `/posts/<slug>/` | 单篇文章 |
| `/archive/` | 按月归档（紧凑列表） |
| `/tags/` | 全部标签 + 文章计数 |
| `/tags/<tag>/` | 单标签下的文章 |
| `/series/` | 全部系列总览(v1.2 新增;首页 / 文章页入口;同 `/tags/` 视觉但语义分层) |
| `/series/<slug>/` | 单系列下的文章(v1.2 新增;`<slug>` = `article:section` 原文,中文等非 ASCII 由浏览器 / GitHub Pages percent-encode 如 `/series/%E9%87%91%E8%9E%8D%E5%B8%82%E5%9C%BA%E8%A7%82%E5%AF%9F/`,目录名按 UTF-8 落盘;与 `tags/<tag>/` 平行但语义为「系列/合集」) |
| `/about/` | 关于 |
| `/404.html` | 错误页 |
| `/feeds/rss.xml` | RSS 订阅 |
| `/sitemap.xml` | 站点地图 |
| `/robots.txt` | 爬虫规则 |
| `/assets/style.css` / `/assets/theme.js` / `/assets/favicon.svg` / `/assets/og-default.svg` | 静态资源 |

## 4. 视觉规范

### 4.1 主题

- **双主题**：浅（默认）/ 深
- **三段式触发**：① 跟随系统 `prefers-color-scheme` ② 用户点切换按钮 ③ 写入 `localStorage`
- **主题应用时机**：`<head>` 内联 script 在 CSS 加载前先设 `data-theme` 属性,避免 FOUC

### 4.2 排版

- **字号尺度**：clamp() 流体排版,step 1.125 (major second)
- **正文行宽**：≤ 920px(中文 ~80 字/行,可读上限),首页 / 归档 1080px
- **行高**：1.65（正文）,1.25（标题）
- **字体**：system stack,中英文分别适配苹方 / 微软雅黑 / SF Pro
- **代码字体**：ui-monospace stack

### 4.3 配色（WCAG AA 验证通过）

| Token | 浅 | 深 | 备注 |
| --- | --- | --- | --- |
| `--fg` | `#1a1d24` | `#ece9e1` | 正文 |
| `--bg` | `#fbfaf7` | `#0d1117` | 页面底色(暖米白 / GitHub Dim) |
| `--bg-elev` | `#ffffff` | `#1c2030` | 卡片 / 浮层(暗色提亮以拉开层级) |
| `--bg-soft` | `#f1efe9` | `#1a1f2c` | 次级容器 / 表头 |
| `--border` / `--border-soft` | `#e6e3da` / `#efece4` | `#2a2e3a` / `#232634` | 边框双层 |
| `--accent` | `#6d28d9` | `#a78bfa` | 主交互色(紫罗兰) |
| `--accent-2` | `#db2777` | `#f472b6` | 渐变 / hover |
| `--accent-bg` | `#f5edff` | `#2e1065` | chip 浅底 |
| `--code-bg` / `--code-fg` | `#1a1d24` / `#e6e3da` | `#0a0c12` / `#ece9e1` | `<pre>` 夜码风 |
| `--code-inline-bg` / `--code-inline-fg` | `#f1efe9` / `#6d28d9` | `#1c2030` / `#c4b5fd` | 行内 `<code>`(与 accent 解耦,避免暗色混淆) |
| `--fg-muted` | `#5b6370` | `#a4a8b0` | 次要文字,≥ 4.5:1 |
| `--scrollbar` | `#c7c2b3` | `#3a3e4a` | 自适应浅深主题 |
| `--selection` | `#fde68a` | `#facc15` | 文本选中底色 |

> 暗色 `--bg-elev` 从 `#161922` 提到 `#1c2030`(v5.1):让卡片 / TOC / 浮层真正"浮起来",避免和页面底色贴在一起。

### 4.4 交互组件

- `.site-header` 粘性,带 backdrop-filter 毛玻璃
- `.chip` 圆角标签,可选中态用 `--accent-bg`
- `.theme-toggle` 24×24 图标按钮,SVG 图标随主题切换
- skip-link 焦点可达性

### 4.5 可访问性

- 全部图片需 `alt`（当前没有图,但若加需强制）
- 标题层级严格,无跳级
- 焦点环可见（`:focus-visible`）
- `prefers-reduced-motion` 全局统一切换:`animation-duration` / `transition-duration` / `scroll-behavior` 都关
- `prefers-color-scheme: dark` 跟随系统,`<html data-theme>` 手动覆盖优先
- 滚动条:`scrollbar-color: var(--scrollbar) transparent` + `::-webkit-scrollbar-thumb` 双主题
- 打印样式:去掉导航 / 主题按钮 / TOC / 阅读进度条,黑白友好,链接保留下划线

## 5. 内容来源与流程

### 5.1 三类内容

| 内容类型 | 来源 | 频率 | 标签 |
| --- | --- | --- | --- |
| 金融市场每日简报 | 金融小队每日 08:00（Asia/Shanghai）输出 | 每日 | `finance` |
| 算法可视化笔记 | 算法可视化项目开发过程沉淀 | 不定期 | `algorithm` |
| 随笔 / 技术笔记 | itingyu 本人 | 不定期 | `note` |

### 5.2 发布流程

```
1. ./scripts/new-post.sh <slug> "<title>" [--tag ...] [--date ...] [--excerpt ...]
   → 生成 posts/<slug>/index.html（含完整 head meta / JSON-LD / 占位正文）
2. 编辑 posts/<slug>/index.html 正文
3. 由 scripts/build-index.js（AIWORK1-28）增量重生成以下页面：
   - index.html（首页最新文章）
   - posts/index.html（文章列表）
   - archive/index.html（归档）
   - tags/index.html（标签总览）
   - tags/<tag>/index.html（如该标签下有变化）
   - feeds/rss.xml
   - sitemap.xml
4. git add . && git commit && git push
5. GitHub Pages 自动部署
```

`scripts/new-post.sh` 是纯 POSIX Bash,无依赖;模板在 `scripts/templates/post.html`,占位符 `{{TITLE}}` / `{{DESCRIPTION}}` / `{{SLUG}}` / `{{DATE}}` / `{{AUTHOR}}` / `{{TAGS_HTML}}` / `{{POSTMETA_TAGS}}`。新增 / 改模板时改一处即可生效。

**不做**：
- 评论区（社交噪音 + 隐私风险;真要交互用 GitHub Issues）
- 站内全文搜索（< 50 篇索引页够用;`/search/` 客户端 JSON 搜索不计）
- i18n（主中文,少量英文术语保留）
- CDN（GitHub Pages 自带;所有第三方 JS / CSS 必须本地化单文件,不得引入 `<script src="https://cdn...">`）
- 第三方 npm 依赖(本地内嵌单文件可接受,完整包拒绝;`prism.js` 单文件本地引入是允许的)

## 6. 里程碑（建议）

| 阶段 | 范围 | 工时 |
| --- | --- | --- |
| M1 骨架（已完成） | 首页 + 关于 + 文章索引 + 404 | 1 commit |
| **M2 设计稿（当前）** | 浅 / 深主题、文章页模板、标签、归档、RSS、SEO、favicon | 1 commit |
| M3 内容接入 | 金融小队简报同步脚本 + 示例文章 3 篇 | 2 commits |
| M4 自动化 | `scripts/build-index.js` 自动重生成列表 + RSS + sitemap | 1 commit |
| M5 暗色主题微调 + 长期优化 | 用户反馈驱动 | 持续 |

## 7. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| 手工更新列表页漏改 | 高 | 低 | M4 加脚本;短期在 PR review 兜底 |
| GitHub Pages 不可用 | 极低 | 高 | 不做缓解,接受单点依赖 |
| 视觉风格不喜欢 | 中 | 中 | 主题切换器托底;若要换设计,改 `assets/style.css` 即可 |
| 内容质量差 | 中 | 低 | 自己写,不开放投稿 |

## 8. 开放问题（待 admin 决策）

1. **是否需要「文章封面图」字段？** 已落地:`posts/<slug>/cover.{jpg,svg,png,webp}` 由 `new-post.sh --cover` 注入,`build-index.js` 复用为 `og:image` 与文章头封面图(v1.1+)
2. **代码高亮**：当前 `<pre>` 是裸文本。v1.2 决议:**允许 `prism.js` 单文件本地引入(零 CDN,零 npm)**,由 `build-index.js` 注入 `<pre><code class="language-xxx">`;具体落地在后续实现 issue。
3. ~~评论~~：见 §5.2 「不做」,已签字接受(v1.0)
4. **域名**：继续 `itingyu.github.io`,还是要绑自定义域名？(v1.2 不动)
5. **金融内容合规**：简报里有具体标的代码 / 价格,要否加免责声明脚注（已经加在 footer + callout,但每篇可选加）

## 9. 变更日志(changelog)

### v1.2 — 2026-09-26(北京时间)— AIWORK1-31

4 项 spec 增量,均来自产品Idea顾问调研的 Top 候选;未触动 M1/M2/M3/M4 既有章节。

| # | 变更 | spec 落点 | 来源 idea | 工作量 |
| - | --- | --- | --- | --- |
| 1 | 代码语法高亮:从「默认不上」翻转为「**允许 `prism.js` 单文件本地引入(零 CDN,零 npm)**」 | §5.2 「不做」补一行 / §8.2 翻转为允许 | idea 2.1 | S |
| 2 | 新增 front matter `article:section` + URL 契约 `/series/`、`/series/<slug>/`(slug = 原文,中文 percent-encode) | §3.2 字段表 / §3.3 URL 契约 | idea 2.3 | S |
| 3 | 新增 front matter `article:pinned` 用于首页精选置顶(仅 `true` 时输出 meta;排序 `dateModified` desc,回退 `date`;上限 `HOME_LIMIT=3`) | §3.2 字段表 / §3.2 `dateModified` 字段 | idea 3.5 | S |
| 4 | 新增 `<meta property="og:image">` 字段(绝对 URL);封面图复用 + 默认 `assets/og-default.svg` 回退;首页同样注入 | §3.2 字段表 | idea 4.1 | M |

**评审拍板(本人主持 + 三方签字到位)**:

| 拍板项 | 决议 | 签字来源 |
| --- | --- | --- |
| `article:pinned` 排序键 | `dateModified` 主,缺省回退 `date`;为此新增 `dateModified` 字段(可选) | 后端提问 #1 / 前端赞同 |
| `article:section` slug 规则 | 沿用 `slugifyTag` 风格(中文保留,percent-encode);显示文本与 slug 同源,**不另设 `series-name` 字段** | 后端提问 #2 / 前端关闭原条件 |
| `article:pinned` meta 输出策略 | 仅 `true` 时输出 head meta,缺省不输出(节省 head 字节) | 前端验收口径 #1 |
| `og:image` URL 形态 | 强制绝对 URL(含 `https://itingyu.github.io/`),首页同样策略 | 后端建议 #4 / 前端验收口径 #5 / 测试契约 #4-3 |

**约束**:
- 4 项均**不引入** CDN / npm 依赖,严格符合 design.md §2「零供应链风险」哲学
- 4 项均为**纯新增字段 / URL / 行为**,不修改任何既有 front matter 字段或 URL 契约
- 4 项实现拆 issue 后各自走 SDD 评审签字

**解锁的实现 issue**(本评审不创建,签字后由 SDD 技术总监另起 issue 派活):
- `prism.js` 本地化集成(@SDD后端工程师)
- `article:section` + `/series/` 端到端(@SDD后端工程师)
- `article:pinned` 首页精选区(@SDD后端工程师)
- `og:image` 自动注入(含 `og-default.svg` 默认图)(@SDD后端工程师)

---

**当前状态**：骨架（M1）+ 设计稿（M2）已落到 worktree 的 `agent/sdd/93cdebf17e81` 分支,**未 commit、未 push**。admin 确认后我再走 SDD 流程：开 issue 评审 → 签字 → commit → push → PR。
