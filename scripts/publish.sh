#!/usr/bin/env bash
# publish.sh —— 一键发布到 itingyu.github.io(v1 + v2 草稿翻转子命令)。
#
# 用法:
#   ./scripts/publish.sh [--message "..."] [--branch <name>]         # v1 行为(无子命令)
#   ./scripts/publish.sh <slug> [--status publish|draft]             # v2 草稿翻转
#
# v1 行为(无参数 / 只带 --message / --branch,源码 commit f07c9d6 起):
#   1. npm test             测试失败即 abort
#   2. npm run build        重建聚合页(index/posts/archive/tags/feed/sitemap/home)
#   3. git add <白名单>     只 add 真实存在的:posts/ index.html posts/index.html
#                                        archive/ tags/ feeds/ sitemap.xml
#                                        scripts/templates/
#   4. git commit -m ...    默认从新增的 posts/<slug>/index.html 推断 slug+标题
#                           可用 --message 覆盖
#   5. git push origin <branch>
#                           分支默认 master,--branch 可指定特性分支
#
# v2 草稿翻转子命令(新增,M6.7 / design-v2.md §5.2.3):
#   ./scripts/publish.sh welcome               # draft: true → false(默认 --status publish)
#   ./scripts/publish.sh welcome --status publish   # 同上,显式
#   ./scripts/publish.sh welcome --status draft     # draft: false → true(撤回)
#
#   行为:
#     1. 校验 posts/<slug>/index.md 存在(不存在 exit 2)
#     2. 读 YAML frontmatter,翻转 draft: true↔false:
#        - 已有 draft: 替换值
#        - 缺 draft:   在 frontmatter 末尾追加 draft: <new>
#     3. git add posts/<slug>/index.md
#     4. git commit -m "post(<slug>): 上线 · draft true → false"
#                    或
#                    "post(<slug>): 撤回 · draft false → true"
#     5. git push origin <branch>(沿用 v1 --branch / PUBLISH_BRANCH)
#
# 环境变量:
#   PUBLISH_BRANCH          指定默认分支(等同 --branch,优先级低于命令行参数)
#   PUBLISH_DRY_RUN=1       只跑 draft 翻转 + git add,不 commit / 不 push
#                           (供本仓 scripts/__tests__ 跑回归用;生产置空)
#
# 依赖:node/npm/git;必须在此 worktree 内运行。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 允许测试或嵌套脚本显式覆盖 REPO_ROOT(默认 = 脚本的父目录)
REPO_ROOT="${PUBLISH_REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

usage() {
  cat <<'EOF'
publish.sh —— 一键发布到 itingyu.github.io。

用法:
  # v1 行为(默认):白名单文件 add → commit → push
  ./scripts/publish.sh [--message "..."] [--branch <name>]

  # v2 草稿翻转子命令
  ./scripts/publish.sh <slug> [--status publish|draft]

行为:
  v1(无子命令):
    1. npm test
    2. npm run build
    3. git add 白名单(posts/ index.html posts/index.html archive/ tags/ feeds/
                    sitemap.xml scripts/templates/)
    4. git commit -m ...        默认从新增 posts/<slug>/index.html 推断
    5. git push origin <branch>

  v2 <slug> 子命令:
    1. 校验 posts/<slug>/index.md 存在
    2. 翻转 draft: true↔false(无则追加)
    3. git add posts/<slug>/index.md
    4. git commit -m "post(<slug>): 上线|撤回 · draft <old> → <new>"
    5. git push origin <branch>

环境变量:
  PUBLISH_BRANCH          指定默认分支(等同 --branch)
  PUBLISH_DRY_RUN=1       跳过 commit + push(测试用)
EOF
}

die()  { echo "publish: $*" >&2; exit 1; }
ok()   { echo "publish: $*"; }

# ---------- 0. 全局解析(分支 / dry-run) ----------

MESSAGE=""
BRANCH="${PUBLISH_BRANCH:-master}"
DRY_RUN="${PUBLISH_DRY_RUN:-}"

# 第一个非选项参数 = 子命令 / slug 候选
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --message)         MESSAGE="${2:-}"; shift 2 || { echo "缺少 --message 参数" >&2; exit 2; } ;;
    --branch)          BRANCH="${2:-}";   shift 2 || { echo "缺少 --branch 参数"  >&2; exit 2; } ;;
    --status)          POSITIONAL+=("--status" "${2:-}"); shift 2 || { echo "缺少 --status 参数" >&2; exit 2; } ;;
    -h|--help)         usage; exit 0 ;;
    --dry-run)         DRY_RUN=1; shift ;;
    --*)
      echo "未知参数: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      POSITIONAL+=("$1"); shift
      ;;
  esac
done

cd "$REPO_ROOT"
[ -f package.json ] || die "未在仓库根运行:缺 package.json"

# =====================================================================
# v2 子命令:publish.sh <slug> [--status publish|draft]
# =====================================================================
if [ "${#POSITIONAL[@]}" -ge 1 ]; then
  SLUG="${POSITIONAL[0]}"
  STATUS="publish"
  # 解析 POSITIONAL 里的 --status
  i=1
  while [ "$i" -lt "${#POSITIONAL[@]}" ]; do
    case "${POSITIONAL[$i]}" in
      --status) STATUS="${POSITIONAL[$((i+1))]:-publish}"; i=$((i+2)) ;;
      *)        echo "未知参数: ${POSITIONAL[$i]}" >&2; usage >&2; exit 2 ;;
    esac
  done

  # slug 格式校验(与 v1 new-post.sh / design-v2.md §3.5 一致)
  if [ -z "$SLUG" ]; then
    die "slug 不能为空"
  fi
  case "$SLUG" in
    *[!a-z0-9-]*)
      die "slug 不合法(只允许 [a-z0-9-]): $SLUG"
      ;;
    -*)
      die "slug 不能以连字符开头: $SLUG"
      ;;
    *-)
      die "slug 不能以连字符结尾: $SLUG"
      ;;
  esac

  case "$STATUS" in
    publish|draft) ;;
    *) die "--status 只接受 publish|draft,当前: $STATUS" ;;
  esac

  # toggle-draft.js 只懂 YAML 字面值 true/false,publish.sh 接口是 publish/draft,这里翻译
  WANTED="false"
  [ "$STATUS" = "draft" ] && WANTED="true"

  MD_FILE="posts/$SLUG/index.md"
  [ -f "$MD_FILE" ] || die "找不到 $MD_FILE(请先 new-post.sh / 落 MD)"

  ok "② 翻转 draft 字段:$MD_FILE($STATUS)"
  OLD="$(node "$SCRIPT_DIR/toggle-draft.js" "$MD_FILE" "$WANTED")" || die "draft 翻转失败"

  # toggle-draft.js 已做 no-op 短路:OLD == WANTED → 文件未改 → stdout 旧值
  # 这里只需翻译回 publish/draft 命名空间用于提示
  case "$OLD" in
    "<none>")    OLD_LABEL="<none>" ;;
    true)        OLD_LABEL="true (≡ draft)" ;;
    false)       OLD_LABEL="false (≡ publish)" ;;
    *)           OLD_LABEL="$OLD" ;;
  esac

  if [ "$OLD" = "$WANTED" ]; then
    ok "  → draft 已是 $OLD_LABEL,无需翻转($STATUS,no-op)"
    ok "完成 ✅ no-op"
    exit 0
  fi

  ok "  → draft $OLD_LABEL → $STATUS"

  ok "③ git add $MD_FILE"
  git add "$MD_FILE"

  if git diff --cached --quiet; then
    ok "无 staged 改动,publish 中止(啥都没改)"
    exit 0
  fi

  case "$STATUS" in
    publish) VERB="上线" ;;
    draft)   VERB="撤回" ;;
  esac
  COMMIT_MSG="post($SLUG): $VERB · draft $OLD_LABEL → $STATUS"

  if [ -n "$DRY_RUN" ]; then
    ok "④ git commit[DRY-RUN]:$COMMIT_MSG"
    ok "⑤ git push[SKIP]:DRY_RUN=$DRY_RUN"
    ok "完成 ✅ dry-run,文件已翻转,未推送"
    exit 0
  fi

  ok "④ git commit"
  git commit -m "$COMMIT_MSG"

  ok "⑤ git push origin $BRANCH"
  git push origin "$BRANCH"

  ok "完成 ✅ commit=$(git rev-parse --short HEAD) → origin/$BRANCH"
  exit 0
fi

# =====================================================================
# v1 行为(无子命令)—— 与 commit f07c9d6 兼容,白名单 + commit + push
# =====================================================================

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