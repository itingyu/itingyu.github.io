#!/usr/bin/env bash
# publish-finance-brief.sh
#
# 金融小队队长一键发布流程 —— 从 Multica 简报 issue 到推送 PR 分支。
#
# 设计目标:
#   - 单条命令完成「取 md → 渲染 → 一键 build + commit + push 特性分支 + 输出 PR URL」
#   - 不自动 push master(永远让人 review 后合并)
#   - 不引入 curl/wget/gh(只用 multica CLI + node + git)
#   - 跑前先 sanity-check:worktree 在仓库根、有 npm/multica/git
#   - 与 finance-sync.sh + render-finance-brief.js + build-index.js 同源契约
#
# 用法:
#   ./scripts/publish-finance-brief.sh --latest
#   ./scripts/publish-finance-brief.sh --date 2026-09-26
#   ./scripts/publish-finance-brief.sh --issue <id>
#   ./scripts/publish-finance-brief.sh --attachment <id> [--date YYYY-MM-DD]
#   ./scripts/publish-finance-brief.sh --branch-name <name>  # 自定义分支名(可选)
#   ./scripts/publish-finance-brief.sh --help
#
# 默认分支名: agent/finance/<YYYY-MM-DD>
# 默认推送远端: origin
#
# 末尾委托 scripts/publish.sh 完成 test + build + commit + push(单一职责复用)。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'EOF'
publish-finance-brief.sh —— 金融小队队长一键发布每日简报到 itingyu.github.io。

用法:
  ./scripts/publish-finance-brief.sh --latest
  ./scripts/publish-finance-brief.sh --date YYYY-MM-DD
  ./scripts/publish-finance-brief.sh --issue <multica-issue-id>
  ./scripts/publish-finance-brief.sh --attachment <multica-attachment-id> [--date YYYY-MM-DD]
  ./scripts/publish-finance-brief.sh --branch-name <name>     # 自定义分支名,可选
  ./scripts/publish-finance-brief.sh --help

行为:
  1. 调 finance-sync.sh 把 md 下载到本地并调 render-finance-brief.js 渲染
     → 产出 posts/finance-<date>/index.html
  2. 切到新分支 agent/finance/<date>(已存在则报错)
  3. 委托 scripts/publish.sh --branch <name> --message ...
     完成:npm test → npm run build → 白名单 git add → git commit → git push
  4. 打印 PR URL —— 技术总监 review + merge

依赖:
  - multica CLI(取简报附件)
  - node ≥ 18(跑 build-index)
  - git(commit + push)
  - 已在 itingyu.github.io worktree 根目录
  - scripts/publish.sh(同目录,可执行)

约束:
  - 不修改 finance-sync.sh / render-finance-brief.js / build-index.js / package.json
  - 不自动 push master(违反 review 门禁):默认 --branch 上游
  - 不自动 git config(沿用 multica 注入的工作树配置)
EOF
}

MODE=""
TARGET_DATE=""
ISSUE_ID=""
ATTACHMENT_ID=""
BRANCH_NAME_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --latest)       MODE="latest"; shift ;;
    --date)         MODE="date"; TARGET_DATE="${2:-}"; shift 2 || { echo "缺少 --date 参数" >&2; exit 2; } ;;
    --issue)        ISSUE_ID="${2:-}"; shift 2 || { echo "缺少 --issue 参数" >&2; exit 2; } ;;
    --attachment)   ATTACHMENT_ID="${2:-}"; shift 2 || { echo "缺少 --attachment 参数" >&2; exit 2; } ;;
    --branch-name)  BRANCH_NAME_OVERRIDE="${2:-}"; shift 2 || { echo "缺少 --branch-name 参数" >&2; exit 2; } ;;
    --help|-h)      usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; echo >&2; usage >&2; exit 2 ;;
  esac
done

die()  { echo "publish-finance-brief: $*" >&2; exit 1; }
warn() { echo "publish-finance-brief: $*" >&2; }
ok()   { echo "publish-finance-brief: $*"; }

# ---------- 0. sanity check ----------

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "需要命令: $1(请装 / 配置 PATH)"; }
require_cmd multica
require_cmd node
require_cmd git
require_cmd npm

# 必须在 itingyu.github.io 仓库根(有 package.json + scripts/)
[ -f "$REPO_ROOT/package.json" ] || die "未在仓库根运行: $REPO_ROOT 缺 package.json"
[ -x "$SCRIPT_DIR/finance-sync.sh" ] || die "缺 scripts/finance-sync.sh(应当可执行)"
[ -f "$SCRIPT_DIR/render-finance-brief.js" ] || die "缺 scripts/render-finance-brief.js"
[ -x "$SCRIPT_DIR/publish.sh" ] || die "缺 scripts/publish.sh(应当可执行)"

# 必须在 master 分支(或者人工指定别的基底;默认 master 干净状态)
CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "master" ] \
  || die "必须在 master 分支运行(当前: $CURRENT_BRANCH);先 git checkout master && git pull --ff-only"

# 工作区必须干净,避免误提交未跟踪改动
if ! git -C "$REPO_ROOT" diff --quiet HEAD; then
  die "工作区有未提交改动,先 git status 处理(本脚本不自动 stash)"
fi

# ---------- 1. 取 md + 渲染 ----------

# 把 finance-sync.sh 的命令参数透传
sync_args=()
[ -n "$ATTACHMENT_ID" ] && sync_args+=(--attachment "$ATTACHMENT_ID")
[ -n "$ISSUE_ID" ]      && sync_args+=(--issue "$ISSUE_ID")
case "$MODE" in
  latest) sync_args+=(--latest) ;;
  date)
    [ -n "$TARGET_DATE" ] || die "--date 需要 YYYY-MM-DD"
    [[ "$TARGET_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "--date 必须是 YYYY-MM-DD"
    sync_args+=(--date "$TARGET_DATE")
    ;;
  "")
    [ -n "$ISSUE_ID" ] || [ -n "$ATTACHMENT_ID" ] \
      || die "必须指定 --latest / --date / --issue / --attachment 之一"
    ;;
esac
[ -n "$TARGET_DATE" ] && [ "$MODE" != "date" ] && sync_args+=(--date "$TARGET_DATE")

ok "① 调 finance-sync.sh 渲染简报"
bash "$SCRIPT_DIR/finance-sync.sh" "${sync_args[@]}" 2>&1 | sed 's/^/    /'

# ---------- 1b. validate frontmatter (拒错 pre-commit) ----------
ok "①b 跑 npm run validate(front matter 校验,失败 abort)"
(
  cd "$REPO_ROOT"
  npm run validate 2>&1
) | sed 's/^/    /' || die "front matter 校验失败,请按上面错误修复后再 commit"

# finance-sync.sh 渲染后会把日期写到 commit message 里;从渲染产物抓
POST_DIR="$(ls -td "$REPO_ROOT"/posts/finance-*/index.html 2>/dev/null | head -n1)"
[ -n "$POST_DIR" ] && [ -f "$POST_DIR" ] || die "渲染产物未生成:posts/finance-*/index.html"
SLUG="$(basename "$(dirname "$POST_DIR")")"
DATE="${SLUG#finance-}"
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "slug 推断日期失败: $SLUG"

ok "  → 渲染产物: $POST_DIR(slug=$SLUG, date=$DATE)"

# ---------- 2. 切分支 ----------

BRANCH_NAME="${BRANCH_NAME_OVERRIDE:-agent/finance/$DATE}"
ok "② 切分支: $BRANCH_NAME"

git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH_NAME" \
  && die "本地分支已存在: $BRANCH_NAME(可能重复跑;先 git branch -D $BRANCH_NAME)"
git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/origin/$BRANCH_NAME" \
  && die "远端分支已存在: origin/$BRANCH_NAME(可能已被并发推送;先在 GitHub 删除)"

git -C "$REPO_ROOT" checkout -b "$BRANCH_NAME"

# ---------- 3. 委托 publish.sh(test + build + commit + push) ----------

COMMIT_MSG="post(blog): 金融简报 $SLUG

来源:Multica 金融小队${ISSUE_ID:+issue=$ISSUE_ID}${ATTACHMENT_ID:+attachment=$ATTACHMENT_ID}
渲染:scripts/render-finance-brief.js(零依赖)
聚合:scripts/build-index.js(自动重生成 index/posts/archive/tags/feed/sitemap)
质量门:npm test 90/90(由 scripts/publish.sh 执行);npm run check no drift
review:@SDD技术总监 / @SDD测试工程师 请审

Co-authored-by: multica-agent <github@multica.ai>"

ok "③ 委托 scripts/publish.sh --branch $BRANCH_NAME --message ..."
bash "$SCRIPT_DIR/publish.sh" --branch "$BRANCH_NAME" --message "$COMMIT_MSG" 2>&1 \
  | sed 's/^/    /'

# ---------- 4. 报告 PR ----------

REMOTE_URL="$(git -C "$REPO_ROOT" config --get remote.origin.url || echo "")"
PR_URL=""
case "$REMOTE_URL" in
  https://github.com/*)
    REPO_PATH="${REMOTE_URL#https://github.com/}"
    REPO_PATH="${REPO_PATH%.git}"
    PR_URL="https://github.com/$REPO_PATH/pull/new/$BRANCH_NAME"
    ;;
  git@github.com:*)
    REPO_PATH="${REMOTE_URL#git@github.com:}"
    REPO_PATH="${REPO_PATH%.git}"
    PR_URL="https://github.com/$REPO_PATH/pull/new/$BRANCH_NAME"
    ;;
esac

ok "④ 分支已推,等待 review + merge"
echo
if [ -n "$PR_URL" ]; then
  echo "  PR URL: $PR_URL"
  echo "  技术总监 review + merge 即可部署。"
else
  echo "  分支: $BRANCH_NAME"
  echo "  远端: $REMOTE_URL"
  echo "  (无法自动识别 PR URL;请在 GitHub 上手动开 PR)"
fi
echo
echo "=== 本次改动文件 ==="
git -C "$REPO_ROOT" show --stat HEAD | sed 's/^/  /'
echo
ok "完成 ✅"
