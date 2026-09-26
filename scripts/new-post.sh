#!/usr/bin/env bash
# new-post.sh — 一键生成博客文章页(纯 POSIX bash,无依赖)
# 用法: ./scripts/new-post.sh <slug> "<title>" [--tag <tag>...] [--date YYYY-MM-DD] [--excerpt "<text>"] [--cover <path>]

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$REPO_ROOT/scripts/templates/post.html"
AUTHOR="${NEW_POST_AUTHOR:-itingyu}"

usage() {
  cat <<EOF
用法: new-post.sh <slug> "<title>" [--tag <tag>...] [--date YYYY-MM-DD] [--excerpt "<text>"] [--cover <path>]

参数:
  <slug>                 文章 slug,只允许 [a-z0-9-],作为目录名与 URL 段
  <title>                文章标题(必填,带引号)
  --tag <tag>            标签,可重复多次(对应 tags/<tag>/ 与 chip)
  --date YYYY-MM-DD      发布日期,默认今天
  --excerpt "<text>"     文章摘要,默认与标题相同的占位说明
  --cover <path>         封面图路径(支持 .svg/.jpg/.png/.webp),会复制到 posts/<slug>/
  -h | --help            显示本帮助

示例:
  ./scripts/new-post.sh my-first-post "我的第一篇" --tag note --excerpt "占位示例"
  ./scripts/new-post.sh hello "Hello" --tag note --cover /tmp/cover.svg
EOF
}

[ $# -ge 1 ] || { usage; exit 1; }
case "$1" in
  -h|--help) usage; exit 0 ;;
esac

[ $# -ge 2 ] || { echo "错误:缺少 <title>" >&2; usage; exit 1; }

SLUG="$1"; shift
TITLE="$1"; shift

DATE="$(date +%F)"
EXCERPT=""
TAGS=()
COVER_PATH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)    TAGS+=("$2"); shift 2 ;;
    --date)   DATE="$2"; shift 2 ;;
    --excerpt) EXCERPT="$2"; shift 2 ;;
    --cover)  COVER_PATH="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "错误:未知参数 $1" >&2; usage; exit 1 ;;
  esac
done

# slug 校验
case "$SLUG" in
  ""|*[!a-z0-9-]*)
    echo "错误:slug 只允许 [a-z0-9-],当前: '$SLUG'" >&2; exit 1 ;;
esac

# 日期格式校验
case "$DATE" in
  ????-??-??) ;;
  *) echo "错误:日期必须是 YYYY-MM-DD,当前: '$DATE'" >&2; exit 1 ;;
esac

# 默认摘要
[ -n "$EXCERPT" ] || EXCERPT="$TITLE —— 占位摘要,请在生成后替换。"

OUT_DIR="$REPO_ROOT/posts/$SLUG"
OUT_FILE="$OUT_DIR/index.html"

if [ -e "$OUT_FILE" ]; then
  echo "错误:目标已存在,拒绝覆盖: $OUT_FILE" >&2
  exit 1
fi

[ -f "$TEMPLATE" ] || { echo "错误:模板不存在: $TEMPLATE" >&2; exit 1; }

# 构建 <meta property="article:tag"> 块
if [ "${#TAGS[@]}" -gt 0 ]; then
  TAGS_HTML=""
  for t in "${TAGS[@]}"; do
    TAGS_HTML="${TAGS_HTML}  <meta property=\"article:tag\" content=\"${t}\" />
"
  done
else
  TAGS_HTML=""
fi

# 构建 post-meta 内的 chip 段(每个 tag 一个 chip,后跟分隔点)
if [ "${#TAGS[@]}" -gt 0 ]; then
  POSTMETA_TAGS=""
  for t in "${TAGS[@]}"; do
    POSTMETA_TAGS="${POSTMETA_TAGS}          <a class=\"chip\" href=\"/tags/${t}/\" data-tag=\"${t}\">${t}</a>
          <span class=\"dot\">·</span>
"
  done
else
  POSTMETA_TAGS=""
fi

# 封面图:复制到 posts/<slug>/,渲染时 inline 进 og:image 与 post-cover
COVER_HTML=""
if [ -n "$COVER_PATH" ]; then
  [ -f "$COVER_PATH" ] || { echo "错误:封面图不存在: $COVER_PATH" >&2; exit 1; }
  COVER_NAME="$(basename "$COVER_PATH")"
  case "$COVER_NAME" in
    *.svg|*.jpg|*.jpeg|*.png|*.webp) ;;
    *) echo "错误:封面图仅支持 .svg/.jpg/.jpeg/.png/.webp" >&2; exit 1 ;;
  esac
  OG_IMAGE="  <meta property=\"og:image\" content=\"https://itingyu.github.io/posts/${SLUG}/${COVER_NAME}\" />
"
  COVER_HTML="      <img class=\"post-cover\" src=\"/posts/${SLUG}/${COVER_NAME}\" alt=\"${TITLE}封面\" loading=\"lazy\" />
"
else
  OG_IMAGE=""
fi

# 用 awk 做占位符替换,避免 sed 在不同实现上的转义差异
mkdir -p "$OUT_DIR"
if [ -n "$COVER_PATH" ]; then
  cp "$COVER_PATH" "$OUT_DIR/$COVER_NAME"
fi
awk -v title="$TITLE" \
    -v desc="$EXCERPT" \
    -v slug="$SLUG" \
    -v date="$DATE" \
    -v author="$AUTHOR" \
    -v tags_html="$TAGS_HTML" \
    -v postmeta_tags="$POSTMETA_TAGS" \
    -v og_image="$OG_IMAGE" \
    -v cover_html="$COVER_HTML" '
  {
    gsub(/\{\{TITLE\}\}/, title)
    gsub(/\{\{DESCRIPTION\}\}/, desc)
    gsub(/\{\{SLUG\}\}/, slug)
    gsub(/\{\{DATE\}\}/, date)
    gsub(/\{\{AUTHOR\}\}/, author)
    gsub(/\{\{TAGS_HTML\}\}/, tags_html)
    gsub(/\{\{POSTMETA_TAGS\}\}/, postmeta_tags)
    gsub(/\{\{OG_IMAGE\}\}/, og_image)
    gsub(/\{\{COVER_HTML\}\}/, cover_html)
    gsub(/\{\{BODY\}\}/, "")
    print
  }
' "$TEMPLATE" > "$OUT_FILE"

echo "已生成: $OUT_FILE"
[ -n "$COVER_PATH" ] && echo "封面图: $OUT_DIR/$COVER_NAME"