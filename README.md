# itingyu.github.io

个人博客：<https://itingyu.github.io/> · Jekyll + GitHub Pages，内容源只有 Markdown，`git push` 即上线。

- 文章：`_posts/<YYYY-MM-DD>-<slug>.md`（196 篇）
- URL：`/notes/<column>/<series>/<slug>/`
- 构建：GitHub Pages 内置 Jekyll，**无 CI、无 npm 渲染链**

## 三种发布方式

### 1. 直接上传 md（推荐）

任意 md（带不带 front matter 都行）丢进 `inbox/`，一条命令补齐 front matter、落库、校验：

```bash
./scripts/import-md.sh inbox/我的文章.md --column prog --series prog-eng --tags jekyll,ssg
# 或整目录批量
./scripts/import-md.sh inbox/ --column ai
# 只看会写成什么，不落盘
./scripts/import-md.sh inbox/x.md --column finance --dry-run
# 校验通过后直接提交并推送
./scripts/import-md.sh inbox/x.md --column life --push
```

脚本会：生成 `title`（取 `# H1` 或文件名）、`date`（今天）、`slug`（文件名转写，纯中文名退化为 `post-<hash>`）、`excerpt`（首段自动截断）、`permalink`；写入 `_posts/` 后跑 `validate-frontmatter.js`，**校验不过自动回滚**。

需要指定自定义 slug 时用 `--slug my-post`。

### 2. 手写 front matter 后提交

```bash
git add _posts/<date>-<slug>.md && ./scripts/publish.sh --push
```

### 3. 校验

```bash
npm run validate        # 全量 front matter 校验，0 error 才算过
npm test                # 51 条契约测试
```

## Front matter 契约

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | ✅ | 单行，禁止换行 |
| `date` | ✅ | `YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM:SS +0800` |
| `tags` | ✅ | 数组，非空、无重复；仅用于卡片/文章页展示 |
| `excerpt` | ✅ | ≤ 500 字，单行 |
| `column` | ✅ | `prog` / `finance` / `ai` / `life` / `misc` |
| `series` | — | 必须对应 `_series/<slug>.md`（也可写该文件的 title） |
| `permalink` | — | 缺省为 `/notes/<column>/<series|column>/<slug>/` |
| `pinned` / `cover` / `draft` | — | 布尔 / 图片路径 / 布尔 |

`slug` 只允许 `[a-z0-9-]`，长度 ≤ 64。

## 目录结构

```
├── _posts/           196 篇文章（唯一内容源）
├── _drafts/          草稿，不渲染
├── _columns/         5 个顶层栏目
├── _series/          8 个专栏
├── _layouts/         11 个布局（posts / post / archive / column / series / tags …）
├── _includes/        12 个片段
├── assets/           style.css / theme.js / keys.js / search.js / search-index.json（构建时生成）
├── scripts/
│   ├── import-md.js          ← 任意 md → 规范文章（新增，主入口）
│   ├── frontmatter.js        ← front matter 解析/序列化，唯一实现
│   ├── validate-frontmatter.js ← schema 校验
│   ├── publish.sh            ← 校验 → 暂存 → 提交 → 推送
│   └── __tests__/            ← node:test（51 条）
├── inbox/             md 投放区（导入后可清空）
├── docs/archive/      v1–v3 设计文档存档，不参与构建
├── _config.yml        Jekyll 唯一配置
└── Gemfile            锁 github-pages gem
```

## 标签策略

**没有标签页，也没有词云。** 标签只在文章卡片与文章页头部以纯文本 chip 出现，不可点、不参与搜索与筛选。标签数据完整保存在 front matter 里。

## 页面与订阅

- `/`：首页（hero + 概览 + 最近更新 + 专栏入口）。
- `/posts/`：文章列表页（`posts/index.html`），最近 30 篇按时间倒序，更早的去 `/archive/`。
- `/series/`：专栏（系列）索引；`/tools/a-stock-pnl/`：A 股净盈亏速算。
- 顶栏入口：首页 / 文章 / 归档 / 专栏 / 工具 / 搜索；页脚只保留站内链接（不再放 RSS 与 GitHub）。
- `/archive/`：按月分组（layout `archive`），一次列全 196 篇。
- `/feeds/rss.xml`：全部文章的摘要级 RSS（约 120KB）。不输出全文 `content:encoded`——曾因此单次抓取 11MB。

## 本地预览

```bash
bundle install
bundle exec jekyll serve --livereload   # http://127.0.0.1:4000
```

## 已知约定

- **permalink 冻结**：26 篇早期文章 URL 里保留旧的 `prog` 段（例如 `/notes/prog/ai-llm/...`），但 `column` 字段已修正为正确栏目，避免断链。
- 前端设计规范见 `docs/archive/design-v3-spec.md`（v1/v2 见同目录）；变更记录见 `CHANGELOG.md`。
- 不接评论、不做服务端搜索、不引 CI。
