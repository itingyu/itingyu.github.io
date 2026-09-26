#!/usr/bin/env bash
# publish-finance-brief.sh —— 金融小队队长一键发布每日简报到 itingyu.github.io(v2)。
#
# 设计目标(design-v2.md §5.2.3 + §9 M7.3):
#   - 单条命令完成「取 md → 渲染 → 推送 .md」,HTML 产物交给 M7.2 workflow 自动 build
#   - 不再 push `posts/finance-*/index.html`(只 push `.md`),HTML 由 build-posts.yml 出
#   - 不再切特性分支 / 开 PR:直接 master 推送(沿用 publish.sh <slug> 单一职责)
#   - 不引入 curl/wget/gh(只用 multica CLI + node + git)
#   - 跑前先 sanity-check:worktree 在仓库根、有 multica/node/git、依赖脚本齐全
#   - 与 finance-sync.sh + render-finance-brief.js + publish.sh + build-posts.yml 同源契约
#
# 用法:
#   ./scripts/publish-finance-brief.sh --latest
#   ./scripts/publish-finance-brief.sh --date 2026-09-26
#   ./scripts/publish-finance-brief.sh --issue <multica-issue-id>
#   ./scripts/publish-finance-brief.sh --attachment <multica-attachment-id> [--date YYYY-MM-DD]
#   ./scripts/publish-finance-brief.sh --input <local-md-file> [--date YYYY-MM-DD]
#   ./scripts/publish-finance-brief.sh --help
#
# 默认 slug: finance-<YYYY-MM-DD>
# 默认推送远端: origin master(沿用 publish.sh <slug>)
#
# 末尾委托 scripts/publish.sh <slug> 完成 draft 翻转 + commit + push(单一职责复用)。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'EOF'
publish-finance-brief.sh —— 金融小队队长一键发布每日简报到 itingyu.github.io(v2)。

用法:
  ./scripts/publish-finance-brief.sh --latest
  ./scripts/publish-finance-brief.sh --date YYYY-MM-DD
  ./scripts/publish-finance-brief.sh --issue <multica-issue-id>
  ./scripts/publish-finance-brief.sh --attachment <multica-attachment-id> [--date YYYY-MM-DD]
  ./scripts/publish-finance-brief.sh --input <local-md-file> [--date YYYY-MM-DD]
  ./scripts/publish-finance-brief.sh --help

行为(v2 命令链,M7.3 收尾):
  1. 取 md:
     - multica attachment download <id> 到 .multica-downloads/(或 --input 本地文件)
     - 通过 issue title / md 文件名推断日期 YYYY-MM-DD
  2. 渲染:node scripts/render-finance-brief.js --input <md> --slug finance-<date> --date <date>
     → 产物 posts/finance-<date>/index.md(YAML frontmatter + MD body + build:cover/related markers)
     → **不再** 生成 posts/finance-*/index.html(M6.4 / AIWORK1-51 责任)
  3. 委托 scripts/publish.sh finance-<date>(M6.7 / AIWORK1-55 <slug> 子命令)
     → 翻转 draft: true → false(默认 --status publish)
     → git add posts/finance-<date>/index.md(只 add .md,**不** add .html)
     → git commit -m "post(finance-<date>): 上线 · draft ..."
     → git push origin master
  4. M7.2 / AIWORK1-56 .github/workflows/build-posts.yml 监听 master push
     → npm ci + validate-frontmatter + npm test + npm run build
     → 产物 commit auto-build → push master
     → Pages 60s 内上线(无需开 PR / 无需 review)

v2 vs v1 关键差异(本脚本 M7.3 收尾点):
  - v1:finance-sync.sh → 切 agent/finance/<date> 分支 → publish.sh --branch → 开 PR → review → merge
  - v2:render-finance-brief.js(产 .md)→ publish.sh finance-<date>(推 .md)→ workflow build HTML
  - 删除旧 git add posts/finance-*/index.html 逻辑(本脚本只 add .md;HTML 由 workflow 出)
  - 不再输出 PR URL(report 段改为「workflow 自动 build」提示)

依赖(均需在仓根同 worktree):
  - multica CLI(取简报附件;--input 可绕开)
  - node ≥ 18(跑 render-finance-brief.js + publish.sh)
  - git(commit + push)
  - scripts/render-finance-brief.js(v2:产 .md,见 design-v2.md §9 M6.4 / AIWORK1-51)
  - scripts/publish.sh(v2:<slug> 子命令,见 design-v2.md §9 M6.7 / AIWORK1-55)
  - .github/workflows/build-posts.yml(v2:M7.2 自动 build,见 §9 / AIWORK1-56)

约束:
  - 不修改 render-finance-brief.js / publish.sh / build-index.js / build-posts.yml
  - 不自动 git config(沿用 multica 注入的工作树配置)
  - 默认 master 推送(由 publish.sh <slug> 决定);PUBLISH_BRANCH / --branch 留给人工 override
EOF
}

MODE=""
TARGET_DATE=""
ISSUE_ID=""
ATTACHMENT_ID=""
INPUT_MD=""

while [ $# -gt 0 ]; do
  case "$1" in
    --latest)       MODE="latest"; shift ;;
    --date)         MODE="date"; TARGET_DATE="${2:-}"; shift 2 || { echo "缺少 --date 参数" >&2; exit 2; } ;;
    --issue)        ISSUE_ID="${2:-}"; shift 2 || { echo "缺少 --issue 参数" >&2; exit 2; } ;;
    --attachment)   ATTACHMENT_ID="${2:-}"; shift 2 || { echo "缺少 --attachment 参数" >&2; exit 2; } ;;
    --input)        INPUT_MD="${2:-}"; shift 2 || { echo "缺少 --input 参数" >&2; exit 2; } ;;
    --help|-h)      usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; echo >&2; usage >&2; exit 2 ;;
  esac
done

die()  { echo "publish-finance-brief: $*" >&2; exit 1; }
warn() { echo "publish-finance-brief: $*" >&2; }
ok()   { echo "publish-finance-brief: $*"; }

# ---------- 0. sanity check ----------

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "需要命令: $1(请装 / 配置 PATH)"; }
require_cmd node
require_cmd git
[ -n "$INPUT_MD" ] || require_cmd multica  # 取 md 必须 multica(除非 --input)

# 必须在 itingyu.github.io 仓库根(有 package.json + scripts/)
[ -f "$REPO_ROOT/package.json" ] || die "未在仓库根运行: $REPO_ROOT 缺 package.json"
[ -f "$SCRIPT_DIR/render-finance-brief.js" ] || die "缺 scripts/render-finance-brief.js"
[ -x "$SCRIPT_DIR/publish.sh" ] || die "缺 scripts/publish.sh(应当可执行)"
[ -f "$REPO_ROOT/.github/workflows/build-posts.yml" ] \
  || die "缺 .github/workflows/build-posts.yml(M7.2 / AIWORK1-56 收尾必备)"

# 校验 publish.sh 含 v2 <slug> 子命令(M6.7 依赖)
if ! bash "$SCRIPT_DIR/publish.sh" --help 2>&1 | grep -q "v2 <slug> 子命令\|v2 草稿翻转子命令"; then
  die "scripts/publish.sh 不含 v2 <slug> 子命令(依赖 M6.7 / AIWORK1-55 落地)"
fi

# 校验 render-finance-brief.js 声明输出 .md(M6.4 依赖)
if ! node "$SCRIPT_DIR/render-finance-brief.js" --help 2>&1 | grep -q "index\.md"; then
  die "scripts/render-finance-brief.js 未声明输出 .md(依赖 M6.4 / AIWORK1-51 落地)"
fi

# 必须有 --latest / --date / --issue / --attachment / --input 之一
if [ -z "$MODE" ] && [ -z "$ISSUE_ID" ] && [ -z "$ATTACHMENT_ID" ] && [ -z "$INPUT_MD" ]; then
  echo "必须指定 --latest / --date / --issue / --attachment / --input 之一" >&2
  echo >&2
  usage >&2
  exit 2
fi

# 必须在 master 分支(沿用 v1:人工指定别的基底;默认 master 干净状态)
CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "master" ] \
  || die "必须在 master 分支运行(当前: $CURRENT_BRANCH);先 git checkout master && git pull --ff-only"

# 工作区必须干净,避免误提交未跟踪改动
if ! git -C "$REPO_ROOT" diff --quiet HEAD; then
  die "工作区有未提交改动,先 git status 处理(本脚本不自动 stash)"
fi

# ---------- 1. 取 md ----------

DOWNLOAD_DIR="$REPO_ROOT/.multica-downloads"
mkdir -p "$DOWNLOAD_DIR"
FINANCE_PROJECT_ID="${FINANCE_PROJECT_ID:-f5a4a713-d133-4bcd-bf17-321fb0451343}"

extract_date() {
  # 优先从文件名里抓 YYYY-MM-DD
  local base="$1"
  if [[ "$base" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

# 从 JSON 中抽取字段(优先 jq,退回 python3 / node —— 与 finance-sync.sh 一致)
json_get() {
  local json="$1" jq_expr="$2" py_code="$3"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r "$jq_expr"
    return $?
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$json" | python3 -c "$py_code"
    return $?
  fi
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$json" | node -e "$py_code"
    return $?
  fi
  die "需要 jq / python3 / node 之一来解析 JSON"
}

# 取 issue 评论里的 .md/.markdown 附件 id(优先 .md 后缀,否则最新一个)
attachment_id_from_issue() {
  local issue="$1"
  local json
  json="$(multica issue comment list "$issue" --output json 2>/dev/null)"
  json_get "$json" \
    '
    ([.[].attachments // [] | add // [] | map(select((.name // .filename // "") | test(".(md|markdown)$"))) | .[0].id // null]) as $md
    | ([.[].attachments // [] | add // [] | .[-1].id // null]) as $any
    | ($md[0] // $any[0]) // empty
    ' \
    '
const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
let chosen = null;
for (const c of data) {
  const atts = (c.attachments || []);
  for (const a of atts) {
    const n = (a.name || a.filename || "").toLowerCase();
    if (n.endsWith(".md") || n.endsWith(".markdown")) { chosen = a; break; }
  }
  if (chosen) break;
  if (!chosen && atts.length) chosen = atts[atts.length - 1];
}
process.stdout.write(chosen && chosen.id ? chosen.id : "");
'
}

# 取最新一条 issue id
latest_issue_id() {
  local json
  json="$(multica issue list --project "$FINANCE_PROJECT_ID" --sort created_at --direction desc --limit 20 --output json 2>/dev/null)"
  json_get "$json" '.issues[0].id // empty' \
    'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); const h = (d.issues || [])[0]; process.stdout.write(h ? h.id : "");'
}

# 按日期筛 issue id(标题含 YYYY-MM-DD)
issue_id_for_date() {
  local target="$1"
  local json
  json="$(multica issue list --project "$FINANCE_PROJECT_ID" --sort created_at --direction desc --limit 50 --output json 2>/dev/null)"
  json_get "$json" \
    ".issues // [] | map(select(.title // \"\" | test(\"$target\"))) | .[0].id // empty" \
    "
const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const list = (d.issues || []);
const hit = list.find((it) => (it.title || '').includes(process.argv[1]));
process.stdout.write(hit ? hit.id : '');
" "$target"
}

# 下载附件到 $DOWNLOAD_DIR,返回绝对路径
download_attachment() {
  local id="$1"
  local downloaded_line path
  downloaded_line="$(cd "$DOWNLOAD_DIR" && multica attachment download "$id" -o "$DOWNLOAD_DIR" 2>&1 | grep -E '^Downloaded: ' | head -n1)"
  path="${downloaded_line#Downloaded: }"
  path="${path#"${path%%[![:space:]]*}"}"  # trim leading whitespace
  [ -n "$path" ] || die "multica attachment download $id 解析 path 失败"
  # 兼容「Downloaded: 相对路径」(如 .multica-downloads/foo.md)
  case "$path" in
    /*) echo "$path" ;;
    *)  echo "$REPO_ROOT/$path" ;;
  esac
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
      [ -n "$ISSUE_ID" ] || die "必须指定 --latest / --date / --issue / --attachment / --input 之一"
      echo "$ISSUE_ID"
      ;;
  esac
}

MD_FILE=""
DATE=""

if [ -n "$INPUT_MD" ]; then
  # --input 本地 .md
  case "$INPUT_MD" in
    /*) MD_FILE="$INPUT_MD" ;;
    *)  MD_FILE="$REPO_ROOT/$INPUT_MD" ;;
  esac
  [ -f "$MD_FILE" ] || die "--input 文件不存在: $INPUT_MD(已展开到 $MD_FILE)"
  ok "① 取 md(本地): $MD_FILE"
else
  # 解析 attachment id
  if [ -n "$ATTACHMENT_ID" ]; then
    ATT_ID="$ATTACHMENT_ID"
  else
    RESOLVED_ISSUE="$(resolve_issue)"
    [ -n "$RESOLVED_ISSUE" ] || die "未找到匹配的 issue"
    # 取标题里的日期(若已显式给 --date 则覆盖)
    if [ -z "$TARGET_DATE" ]; then
      title_json="$(multica issue get "$RESOLVED_ISSUE" --output json 2>/dev/null)"
      TARGET_DATE="$(json_get "$title_json" \
        '.title // "" | match("(\\d{4}-\\d{2}-\\d{2})").captures[0].string // empty' \
        '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
const m = ((d.title || "").match(/(\d{4}-\d{2}-\d{2})/) || []);
process.stdout.write(m[1] || "");
')"
    fi
    ATT_ID="$(attachment_id_from_issue "$RESOLVED_ISSUE")"
    [ -n "$ATT_ID" ] || die "issue $RESOLVED_ISSUE 的评论里没有可下载的 .md/.markdown 附件"
  fi
  ok "① 取 md(下载):附件 $ATT_ID"
  MD_FILE="$(download_attachment "$ATT_ID")"
  [ -f "$MD_FILE" ] || die "附件下载失败: $ATT_ID → 期望 $MD_FILE"
fi

# 推断日期
if [ -n "$TARGET_DATE" ]; then
  DATE="$TARGET_DATE"
else
  DATE="$(extract_date "$(basename "$MD_FILE")")" \
    || die "无法从文件名 $(basename "$MD_FILE") 推断日期,请同时传 --date YYYY-MM-DD"
fi
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "日期格式不合法: $DATE"
SLUG="finance-$DATE"

ok "  → md: $MD_FILE(slug=$SLUG, date=$DATE)"

# ---------- 2. 渲染 .md ----------

OUT_DIR="$REPO_ROOT/posts/$SLUG"
OUT_MD="$OUT_DIR/index.md"
[ ! -e "$OUT_MD" ] || die "目标已存在,拒绝覆盖: $OUT_MD(若想重新发布,先 git rm 或换日期)"

ok "② 渲染 .md:node scripts/render-finance-brief.js"
node "$SCRIPT_DIR/render-finance-brief.js" \
  --input "$MD_FILE" \
  --slug "$SLUG" \
  --date "$DATE" 2>&1 | sed 's/^/    /'

[ -f "$OUT_MD" ] || die "render-finance-brief.js 未产出 .md: $OUT_MD(M6.4 / AIWORK1-51 未落地?)"

# 强校验:v2 严禁残留 .html
if [ -f "$OUT_DIR/index.html" ]; then
  die "render-finance-brief.js 仍产出 index.html(v2 应只产 .md);拒绝 push HTML"
fi

ok "  → 产物: $OUT_MD(YAML + MD body + build:cover/related markers)"

# ---------- 3. 委托 publish.sh <slug>(draft 翻转 + commit + push) ----------

# publish.sh <slug> 默认 --status publish:把 draft: true → false
ok "③ 委托 scripts/publish.sh $SLUG(--status publish,draft true → false)"
bash "$SCRIPT_DIR/publish.sh" "$SLUG" 2>&1 | sed 's/^/    /'

# ---------- 4. 报告 ----------

COMMIT_SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"

ok "④ .md 已推 origin/$CURRENT_BRANCH"
echo
echo "=== 本次改动文件 ==="
git -C "$REPO_ROOT" show --stat HEAD | sed 's/^/  /'
echo
ok "下一步:M7.2 workflow(.github/workflows/build-posts.yml)"
ok "      监听 master push → npm ci + validate-frontmatter + npm test + npm run build"
ok "      → 产物 commit auto-build → push master → Pages 60s 内上线"
ok "      无需开 PR,无需 review(草稿由 draft: 字段控制)。"
echo
ok "完成 ✅ commit=$COMMIT_SHORT → origin/$CURRENT_BRANCH(slug=$SLUG)"