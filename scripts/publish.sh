#!/usr/bin/env bash
# publish.sh — 一键发布:test → build → 白名单 git add → commit → push
#
# 用法:
#   ./scripts/publish.sh [--message "..."] [--branch <name>]
#
# 设计目标:
#   - 单条命令完成「测试 + 重建聚合页 + 提交白名单内的文件 + 推送」
#   - 默认只 add 白名单目录/文件(防误提交 .env / 临时草稿)
#   - 默认 commit message 从新增的 posts/<slug>/index.html 推断:post(<slug>): <title>
#   - 默认 push 到 origin master;--branch 可切到特性分支(供 publish-finance-brief 复用)
#
# 依赖:node/npm/git;必须在此 worktree 内运行

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'EOF'
publish.sh —— 一键发布到 itingyu.github.io。

用法:
  ./scripts/publish.sh [--message "..."] [--branch <name>]

行为:
  1. npm test             测试失败即 abort(退出码 ≠ 0)
  2. npm run build        重建聚合页(index/posts/archive/tags/feed/sitemap/home)
  3. git add <白名单>     只 add 真实存在的:posts/ index.html posts/index.html
                                       archive/ tags/ feeds/ sitemap.xml
                                       scripts/templates/
  4. git commit -m ...    默认从新增的 posts/<slug>/index.html 推断 slug+标题
                          可用 --message 覆盖
  5. git push origin <branch>
                          分支默认 master,--branch 可指定特性分支

环境变量:
  PUBLISH_BRANCH          指定默认分支(等同 --branch,优先级低于命令行参数)
EOF
}

die()  { echo "publish: $*" >&2; exit 1; }
ok()   { echo "publish: $*"; }

MESSAGE=""
BRANCH="${PUBLISH_BRANCH:-master}"

while [ $# -gt 0 ]; do
  case "$1" in
    --message)  MESSAGE="${2:-}"; shift 2 || { echo "缺少 --message 参数" >&2; exit 2; } ;;
    --branch)   BRANCH="${2:-}";   shift 2 || { echo "缺少 --branch 参数"  >&2; exit 2; } ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$REPO_ROOT"
[ -f package.json ] || die "未在仓库根运行:缺 package.json"

# ---------- 1. 质量门 ----------
ok "① npm test"
npm test 2>&1 | sed 's/^/    /'

# ---------- 2. 重建聚合页 ----------
ok "② npm run build"
npm run build 2>&1 | sed 's/^/    /'

# ---------- 3. 白名单 git add ----------
WHITELIST=(posts/ index.html posts/index.html archive/ tags/ feeds/ sitemap.xml scripts/templates/)
ADD=()
for p in "${WHITELIST[@]}"; do
  [ -e "$p" ] && ADD+=("$p")
done
[ "${#ADD[@]}" -gt 0 ] || die "白名单内无任何文件,abort"

ok "③ git add(白名单)"
git add "${ADD[@]}"

if git diff --cached --quiet; then
  ok "无 staged 改动,publish 中止(啥都没改)"
  exit 0
fi

# ---------- 4. 推断 commit message ----------
if [ -z "$MESSAGE" ]; then
  SLUG="$(git diff --cached --name-only | grep -E '^posts/[^/]+/index\.html$' | head -n1 | sed -E 's|^posts/([^/]+)/index\.html$|\1|')"
  if [ -n "$SLUG" ] && [ -f "posts/$SLUG/index.html" ]; then
    TITLE="$(grep -oE '<title>[^·<]+' "posts/$SLUG/index.html" | head -n1 | sed 's|<title>||')"
    TITLE="${TITLE:-new post}"
    MESSAGE="post($SLUG): $TITLE"
  else
    MESSAGE="post: 更新"
  fi
fi

ok "④ git commit"
git commit -m "$MESSAGE"

# ---------- 5. push ----------
ok "⑤ git push origin $BRANCH"
git push origin "$BRANCH"

ok "完成 ✅ commit=$(git rev-parse --short HEAD) → origin/$BRANCH"
