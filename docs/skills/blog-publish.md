# 博客发布 Skill（归档副本）

> 本文是 Minis skill `blog-publish` 的归档副本，权威源在 `/var/minis/skills/blog-publish/SKILL.md`。
> 目的：让仓库本身自带操作手册，不依赖外部 skill 也能照着发文章。

---

## 原 skill 定义

```yaml
name: blog-publish
description: "发布 / 修改 / 下架 itingyu.github.io 博客文章。仓库 https://github.com/itingyu/itingyu.github.io，Jekyll + GitHub Pages，发布链是 Python 3 标准库脚本 scripts/post.py（publish/set/body/remove/list/show）。裸 md 直接发布，自动补 front matter、校验、提交、推送。触发词：发篇文章、写博客、发布文章、更新文章、修改文章、改标题、改正文、下架文章、删除文章、撤下文章、发到博客、博客发布、blog publish、new post、update post、remove post。"
version: 1.0.0
```

# 博客文章发布（itingyu.github.io）

GitHub Pages 博客的发布/修改/下架。**所有操作都通过仓库里的 Python 脚本完成，不要手写 front matter、不要手改 HTML、不要手 `git add` 文章目录。**

## 0. 准备

```bash
REPO=/var/minis/workspace/ghblog
cd $REPO && git pull --ff-only      # 首次则 git clone git@github.com:itingyu/itingyu.github.io.git
```

SSH 走 443 端口（沙盒里 22 端口不通）。`~/.ssh/config` 需要：

```
Host github.com
    HostName ssh.github.com
    Port 443
    User git
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

环境要求：**Python 3.9+ 标准库**，无第三方依赖，不需要 Node。

## 1. 三条命令覆盖全部场景

| 需求 | 命令 |
|:--|:--|
| 发布新文章 | `python3 scripts/post.py publish <md文件> --column <专栏> --series <子专栏> --tags a,b [--push]` |
| 改标题/专栏/标签 | `python3 scripts/post.py set <slug> --title "新标题" --tags 随笔 --column life [--push]` |
| 换正文 | `python3 scripts/post.py body <slug> <新正文.md> [--push]` |
| 下架文章 | `python3 scripts/post.py remove <slug> [更多slug...] [--push]` |
| 查文章 | `python3 scripts/post.py list [--column finance] [--search 关键词] [--limit N]` |
| 看某篇 | `python3 scripts/post.py show <slug>` |

### 关键选项

- `--push`：**校验通过后自动 commit + push 到 master**，Pages 约 1 分钟完成部署。
- `--dry-run`：只预览生成的 front matter / 要删的文件，不落盘。**拿不准就先 dry-run。**
- `--force`（仅 publish）：覆盖同名文章。
- `--pinned` / `--unpinned`（仅 set）：首页置顶开关。

### 专栏与子专栏取值

| `--column` | `--series` 可选值 | 站上显示名 |
|:--|:--|:--|
| `prog` | `prog-eng` / `prog-lang` | 编程工程 → 工程实践 / 编程语言精进 |
| `ai` | `ai-basics` / `ai-llm` | AI 与算法 → 学习笔记 / 大模型工程 |
| `finance` | `fin-stock` | 金融投资 → 股票 |
| `life` | `life-kitchen` / `life-work` / `life-driving` | 生活 → 厨房 / 职场 / 考驾照 |
| `misc` | 不填 | 杂记 |

`--series` 省略时落到 `misc` 专栏下的兜底位置。改 `column`/`series`/`slug` 时 **permalink 自动重算**（如 `/notes/ai/ai-llm/xxx/`）。

## 2. 发布：裸 md 就行

md 文件不需要写 front matter，脚本自动补齐：

- **标题** 取正文第一个 `# H1`，没有就用文件名
- **日期** 取今天（`--date` 可覆盖）
- **slug** 自动转写（纯中文文件名会退化成 `post-<hash>`，用 `--slug` 指定更稳）
- **摘要** 取首段（自动跳过标题行）
- **标签** 默认取专栏名，`--tags` 覆盖

```bash
cd $REPO
cat > /tmp/new-post.md <<'EOF'
# 我的新文章

这是第一段，会被当作摘要。

正文继续写。
EOF
python3 scripts/post.py publish /tmp/new-post.md --column ai --series ai-llm --tags 大模型,推理 --push
```

批量发布整目录：`python3 scripts/post.py publish inbox/ --column finance --push`

## 3. 标准流程（推荐）

```bash
cd $REPO
# 1. 写稿到 inbox/ 或 /tmp
# 2. 预览
python3 scripts/post.py publish inbox/我的文章.md --column prog --series prog-eng --dry-run
# 3. 落盘 + 提交 + 推送
python3 scripts/post.py publish inbox/我的文章.md --column prog --series prog-eng --push
# 4. 自查
python3 scripts/validate_frontmatter.py     # 应为 0 error 0 warning
python3 -m unittest discover scripts/tests   # 应为 OK
```

任何一步校验不过，脚本都会中止提交（文件已写入，需人工修正后重跑）。

## 4. 硬规矩

1. **推一次等一分钟**。连续推送会让 GitHub Pages 部署互相撞车，报 `due to in progress deployment`，必须逐个取消卡住的 deployment（仓库 Settings → Pages → Pending deployments）。推完等部署完成再推下一次。
2. **改完必须校验**。`python3 scripts/validate_frontmatter.py` 要 0 error。
3. **改模板先跑 Liquid 检查**：`ruby scripts/lint-liquid.rb .`（GitHub 构建失败时日志需登录才能看详情，本地先查能省一轮往返）。
4. **不动历史文章的 permalink**。26 篇早期文章 URL 里保留了旧的 `prog` 段（如 `/notes/prog/ai-llm/...`），`column` 字段已修正但 URL 冻结，避免断链。
5. **下架是不可逆的线上失效**。`remove` 会删文件、提交，原 URL 立刻 404。执行前先 `show` 确认 slug。
6. **不手写 front matter、不手改 `_posts` 外的 HTML**。所有文章改动走 `post.py`。

## 5. 常见问题

| 现象 | 原因 | 处理 |
|:--|:--|:--|
| `校验未通过，已中止提交` | front matter 缺字段 / 格式不对 | 看报错里指出的 slug，按 README 的 Front matter 契约补 |
| `推送后页面没变` | Pages 部署未完成或撞车 | 等 1 分钟；仍失败就看 Actions 里最新 run 的 deploy 步骤报错 |
| `skipped(已存在)` | 同名文章已存在 | 加 `--force` 覆盖，或换 `--slug` |
| `找不到文章` | slug 不对 | `list` 搜一下；历史文章 slug 是"文件名去日期前缀" |
| 部署报 `in progress deployment` | 上一次部署卡住 | Settings → Pages → 取消 Pending deployments，再推一次 |

## 6. 仓库结构速查

```
_posts/         文章源文件（YAML front matter + Markdown 正文）
_columns/       专栏定义        _series/   子专栏定义
_layouts/       页面布局        _includes/ 公共片段
assets/         样式与前端 JS   scripts/    发布链脚本（Python）
docs/archive/   历史设计文档（不参与构建）
```

站点：首页 `/`、文章列表 `/posts/`、按月归档 `/archive/`、专栏 `/series/`、搜索 `/search/`、工具 `/tools/a-stock-pnl/`。
无标签页、无词云、无评论、无服务端搜索。
