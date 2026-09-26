#!/usr/bin/env bash
# new-post.sh — 一键生成 Markdown 文章骨架(纯 POSIX bash,无依赖)
# 输出 posts/<slug>/index.md,头部 YAML frontmatter + MD body 含两个 v2 marker
#
# 用法: ./scripts/new-post.sh <slug> "<title>" [--tag <tag>...] [--date <ISO>] [--excerpt "<text>"] [--cover <path>]

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUTHOR="${NEW_POST_AUTHOR:-itingyu}"

usage() {
  cat <<EOF
用法: new-post.sh <slug> "<title>" [--tag <tag>...] [--date <ISO>] [--excerpt "<text>"] [--cover <path>]

参数:
  <slug>                 文章 slug,只允许 [a-z0-9-],作为目录名与 URL 段
  <title>                文章标题(必填,带引号)
  --tag <tag>            标签,可重复多次(写入 frontmatter tags 数组)
  --date <ISO>           发布日期,默认 \$(date -Iseconds);spec §3.2 推荐 YYYY-MM-DD
  --excerpt "<text>"     文章摘要(description),默认空字符串
  --cover <path>         封面图路径(支持 .svg/.jpg/.jpeg/.png/.webp),复制到 posts/<slug>/cover.<ext>,frontmatter 写 cover: <name>
  -h | --help            显示本帮助

示例:
  ./scripts/new-post.sh my-first-post "我的第一篇" --tag note --excerpt "占位示例"
  ./scripts/new-post.sh hello "Hello" --tag note --cover /tmp/cover.svg

输出文件:posts/<slug>/index.md
  头部 YAML frontmatter(title / description / date / tags / slug / author / [cover] / draft)
  MD body 顶部含 <!-- build:cover --> marker,末尾含 <!-- build:related --> marker
EOF
}

[ $# -ge 1 ] || { usage; exit 1; }
case "$1" in
  -h|--help) usage; exit 0 ;;
esac

[ $# -ge 2 ] || { echo "错误:缺少 <title>" >&2; usage; exit 1; }

SLUG="$1"; shift
TITLE="$1"; shift

DESCRIPTION=""
TAGS=()
COVER_PATH=""
COVER_FIELD=""
COVER_EXT=""
DATE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)    TAGS+=("$2"); shift 2 ;;
    --date)   DATE="$2"; shift 2 ;;
    --excerpt) DESCRIPTION="$2"; shift 2 ;;
    --cover)  COVER_PATH="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "错误:未知参数 $1" >&2; usage; exit 1 ;;
  esac
done

# slug 校验(spec §3.5)
case "$SLUG" in
  ""|*[!a-z0-9-]*)
    echo "错误:slug 只允许 [a-z0-9-],当前: '$SLUG'" >&2; exit 1 ;;
esac

# 默认日期:$(date -Iseconds) → "2026-09-26T15:46:25+08:00" 形式(ISO 8601)
[ -n "$DATE" ] || DATE="$(date -Iseconds)"

OUT_DIR="$REPO_ROOT/posts/$SLUG"
OUT_FILE="$OUT_DIR/index.md"

if [ -e "$OUT_FILE" ]; then
  echo "错误:目标已存在,拒绝覆盖: $OUT_FILE" >&2
  exit 1
fi

# 封面图:校验后缀 + 复制到 posts/<slug>/cover.<ext>(固定文件名 spec §3.5,build-index scanCover 仅识别 cover.{ext}),frontmatter 写入 cover 字段
if [ -n "$COVER_PATH" ]; then
  [ -f "$COVER_PATH" ] || { echo "错误:封面图不存在: $COVER_PATH" >&2; exit 1; }
  COVER_EXT="${COVER_PATH##*.}"
  case "$COVER_EXT" in
    svg|jpg|jpeg|png|webp) ;;
    *) echo "错误:封面图仅支持 .svg/.jpg/.jpeg/.png/.webp,当前后缀: '.$COVER_EXT'" >&2; exit 1 ;;
  esac
  COVER_FIELD="cover: cover.${COVER_EXT}"
fi

# tags YAML 数组字面量
if [ "${#TAGS[@]}" -gt 0 ]; then
  TAGS_YAML="["
  for i in "${!TAGS[@]}"; do
    if [ "$i" -gt 0 ]; then
      TAGS_YAML="${TAGS_YAML}, "
    fi
    TAGS_YAML="${TAGS_YAML}${TAGS[$i]}"
  done
  TAGS_YAML="${TAGS_YAML}]"
else
  TAGS_YAML="[]"
fi

# 写盘
mkdir -p "$OUT_DIR"
if [ -n "$COVER_PATH" ]; then
  cp "$COVER_PATH" "$OUT_DIR/cover.${COVER_EXT}"
fi

# MD 输出 —— frontmatter 字段顺序对齐 issue DoD(title / description / date / tags / slug / author / [cover] / draft)
# MD body 含两个 v2 marker(<!-- build:cover --> / <!-- build:related -->),markdown.js htmlCommentPassthrough 契约透传
{
  printf '%s\n' '---'
  printf 'title: "%s"\n' "$TITLE"
  printf 'description: "%s"\n' "$DESCRIPTION"
  printf 'date: %s\n' "$DATE"
  printf 'tags: %s\n' "$TAGS_YAML"
  printf 'slug: %s\n' "$SLUG"
  printf 'author: %s\n' "$AUTHOR"
  if [ -n "$COVER_FIELD" ]; then
    printf '%s\n' "$COVER_FIELD"
  fi
  printf 'draft: true\n'
  printf '%s\n' '---'
  printf '\n'
  printf '%s\n' '<!-- build:cover -->'
  printf '\n'
  printf '%s\n' '这是新文章的开头。请在此处撰写正文。'
  printf '\n'
  printf '%s\n' '<!-- build:related -->'
  printf '\n'
} > "$OUT_FILE"

echo "已生成: $OUT_FILE"
if [ -n "$COVER_PATH" ]; then
  echo "封面图: $OUT_DIR/cover.${COVER_EXT}"
fi