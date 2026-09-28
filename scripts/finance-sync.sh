#!/usr/bin/env bash
# finance-sync.sh
#
# 从 Multica 「金融简报」项目的某篇 issue 评论里下载金融小队上传的 Markdown 简报,
# 调用 render-finance-brief.js 渲染成博客文章,提示用户 git add/commit/push。
#
# 设计目标:
#   - 取附件只用 multica attachment download(不引入 curl/wget)。
#   - 默认行为:提示但不自动 git commit / push(让人 review)。
#
# 用法:
#   ./scripts/finance-sync.sh --latest
#   ./scripts/finance-sync.sh --date 2026-09-26
#   ./scripts/finance-sync.sh --issue <issue-id>
#   ./scripts/finance-sync.sh --attachment <attachment-id> [--date YYYY-MM-DD]
#   ./scripts/finance-sync.sh --help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOWNLOAD_DIR="$REPO_ROOT/.multica-downloads"
mkdir -p "$DOWNLOAD_DIR"

FINANCE_PROJECT_ID="${FINANCE_PROJECT_ID:-f5a4a713-d133-4bcd-bf17-321fb0451343}"

usage() {
  cat <<'EOF'
finance-sync.sh — 把金融小队产出的 Markdown 简报渲染成博客文章。

用法:
  ./scripts/finance-sync.sh --latest
  ./scripts/finance-sync.sh --date YYYY-MM-DD
  ./scripts/finance-sync.sh --issue <issue-id>
  ./scripts/finance-sync.sh --attachment <attachment-id> [--date YYYY-MM-DD]
  ./scripts/finance-sync.sh --help

参数:
  --latest              取金融简报项目最新一篇 issue(优先含 .md 附件)
  --date YYYY-MM-DD     取标题含该日期的 issue
  --issue <id>          直接指定 Multica issue id(覆盖 --latest / --date)
  --attachment <id>     直接指定附件 id(跳过 issue 查询)
  --help / -h           输出本帮助

依赖:
  - multica CLI(>= 0.x)
  - node >= 18
  - scripts/render-finance-brief.js(同目录)

环境变量:
  FINANCE_PROJECT_ID    金融简报项目 id(默认 f5a4a713-d133-4bcd-bf17-321fb0451343)
EOF
}

MODE=""
TARGET_DATE=""
ISSUE_ID=""
ATTACHMENT_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --latest)    MODE="latest"; shift ;;
    --date)      MODE="date"; TARGET_DATE="${2:-}"; shift 2 || { echo "缺少 --date 参数" >&2; exit 2; } ;;
    --issue)     ISSUE_ID="${2:-}"; shift 2 || { echo "缺少 --issue 参数" >&2; exit 2; } ;;
    --attachment) ATTACHMENT_ID="${2:-}"; shift 2 || { echo "缺少 --attachment 参数" >&2; exit 2; } ;;
    --help|-h)   usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; echo >&2; usage >&2; exit 2 ;;
  esac
done

die() { echo "finance-sync: $*" >&2; exit 1; }
warn() { echo "finance-sync: $*" >&2; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "需要命令: $1"
}
require_cmd multica
require_cmd node

slug_for() { echo "finance-$1"; }

# jq 是 issue list / comment list 的解析助手;优先用 jq,否则退回 python3 或 node。
json_get() {
  # 用法: json_get '<json 字符串>' '<jq 表达式>' [extra args for python/node]
  local json="$1" jq_expr="$2"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r "$jq_expr"
    return $?
  fi
  # python / node 兜底:对结果统一输出到 stdout,失败 exit 2
  if command -v python3 >/dev/null 2>&1; then
    PYCODE=$(cat <<PYEOF
import json, sys, re
data = json.loads(sys.stdin.read())
${3}
PYEOF
)
    printf '%s' "$json" | python3 -c "$PYCODE"
    return $?
  fi
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$json" | node -e "
const data = JSON.parse(require('fs').readFileSync(0,'utf8'));
${3}
"
    return $?
  fi
  die "需要 jq / python3 / node 之一来解析 JSON"
}

# 从 issue 列表里挑一条 issue id,按 created_at 倒序第一条。
latest_issue_id() {
  local json
  json="$(multica issue list --project "$FINANCE_PROJECT_ID" --sort created_at --direction desc --limit 20 --output json)"
  json_get "$json" '.issues[0].id // empty' \
    'hit = (data.get("issues") or [None])[0]; print(hit["id"] if hit else "")'
}

# 按日期筛 issue:遍历最近若干条,标题含 YYYY-MM-DD 就返回。
issue_id_for_date() {
  local target="$1"
  local json
  json="$(multica issue list --project "$FINANCE_PROJECT_ID" --sort created_at --direction desc --limit 50 --output json)"
  json_get "$json" \
    ".issues // [] | map(select(.title // \"\" | test(\"$target\"))) | .[0].id // empty" \
    "
list = data.get('issues') or []
hit = next((it for it in list if target in (it.get('title') or '')), None)
print(hit['id'] if hit else '')
"
}

# 找某 issue 评论里的 markdown 附件(优先 .md 后缀,否则最新一个)。
# 容忍 attachments 字段的多种形态:
#   - 数组 [] / [{...}]  → 正常解析
#   - 字符串 "[object]" / "[object Object]" / "[]"  → 序列化层退化的空 attachments,视为无附件
#   - null / 缺失  → 视为无附件
# 任何形态都不应让 jq/python 抛 "Cannot iterate over string" / "AttributeError: 'str' object has no attribute 'get'"。
attachment_id_from_issue() {
  local issue="$1"
  local json
  json="$(multica issue comment list "$issue" --output json)"
  json_get "$json" \
    '
    ([.[] | .attachments // [] | select(type == "array") | .[]]) as $all
    | ($all | map(select((.name // .filename // "") | test("\\.(md|markdown)$"))) | .[0].id // null) as $md
    | ($all | .[-1].id // null) as $any
    | ($md // $any) // empty
    ' \
    '
import json
try:
    cs = data
except NameError:
    cs = []
chosen = None
for c in cs:
    atts = c.get("attachments")
    if not isinstance(atts, list):
        continue
    for a in atts:
        name = (a.get("name") or a.get("filename") or "").lower()
        if name.endswith(".md") or name.endswith(".markdown"):
            chosen = a
            break
    if chosen: break
    if not chosen and atts:
        chosen = atts[-1]
print(chosen["id"] if chosen else "")
'
}

download_attachment() {
  local id="$1"
  ( cd "$DOWNLOAD_DIR" && multica attachment download "$id" -o "$DOWNLOAD_DIR" )
}

extract_date() {
  # 优先从文件名里抓 YYYY-MM-DD
  local base="$1"
  if [[ "$base" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

render_and_print() {
  local md="$1" date="$2"
  local slug
  slug="$(slug_for "$date")"
  node "$SCRIPT_DIR/render-finance-brief.js" \
    --input "$md" \
    --slug "$slug" \
    --date "$date"
  echo
  echo "产物:"
  echo "  posts/$slug/index.html"
  echo
  echo "下一步(review 后再 push):"
  echo "  git add posts/$slug/index.html posts/index.html archive/index.html"
  echo "  git commit -m \"AIWORK1-27 · 新增金融简报 $slug\""
  echo "  git push"
}

resolve_issue() {
  case "$MODE" in
    latest)
      latest_issue_id
      ;;
    date)
      [ -n "$TARGET_DATE" ] || die "--date 需要 YYYY-MM-DD"
      [[ "$TARGET_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "--date 必须是 YYYY-MM-DD"
      issue_id_for_date "$TARGET_DATE"
      ;;
    "")
      [ -n "$ISSUE_ID" ] || die "必须指定 --latest / --date / --issue / --attachment 之一"
      echo "$ISSUE_ID"
      ;;
  esac
}

main() {
  local md date issue resolved_issue att_id
  if [ -n "$ATTACHMENT_ID" ]; then
    # 显式附件:跳过 issue / comment 查询
    local md_candidate
    md_candidate="$(download_attachment "$ATTACHMENT_ID" || true)"
    [ -n "$md_candidate" ] && [ -f "$md_candidate" ] || die "附件下载失败: $ATTACHMENT_ID"
    if [ -n "$TARGET_DATE" ]; then
      date="$TARGET_DATE"
    else
      date="$(extract_date "$(basename "$md_candidate")")" \
        || die "无法从文件名 $(basename "$md_candidate") 推断日期,请同时传 --date YYYY-MM-DD"
    fi
    render_and_print "$md_candidate" "$date"
    return
  fi

  if [ -z "$ISSUE_ID" ] && [ -z "$MODE" ]; then
    echo "必须指定 --latest / --date / --issue / --attachment 之一" >&2
    echo >&2
    usage >&2
    exit 2
  fi

  resolved_issue="$(resolve_issue)"
  [ -n "$resolved_issue" ] || die "未找到匹配的 issue"

  # 取标题里的日期
  local title_json date_from_title
  title_json="$(multica issue get "$resolved_issue" --output json)"
  date_from_title="$(json_get "$title_json" \
    '.title // "" | match("(\\d{4}-\\d{2}-\\d{2})").captures[0].string // empty' \
    '
import re
m = re.search(r"(\d{4}-\d{2}-\d{2})", data.get("title") or "")
print(m.group(1) if m else "")
')"

  att_id="$(attachment_id_from_issue "$resolved_issue")"
  [ -n "$att_id" ] && [ "$att_id" != "null" ] && [ "$att_id" != "empty" ] \
    || die "issue $resolved_issue 的评论里没有可下载的 .md/.markdown 附件"

  md="$(download_attachment "$att_id")"
  [ -f "$md" ] || die "附件下载失败: $att_id"

  if [ -n "$TARGET_DATE" ]; then
    date="$TARGET_DATE"
  elif [ -n "$date_from_title" ]; then
    date="$date_from_title"
  else
    date="$(extract_date "$(basename "$md")")" \
      || die "无法推断日期,请传 --date YYYY-MM-DD"
  fi

  render_and_print "$md" "$date"
}

main "$@"
