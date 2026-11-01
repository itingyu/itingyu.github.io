#!/usr/bin/env bash
# publish.sh —— 校验 → 同步标签页 → 提交 → 推送。
#
# 用法:
#   ./scripts/publish.sh [-m "commit message"] [--push]
#
# 默认只校验 + 暂存 + 提交；加 --push 才推送到 origin master。
# 校验失败立即中止，不会产生半截提交。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MSG=""
PUSH=0

while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="${2:-}"; shift 2 ;;
    --push) PUSH=1; shift ;;
    -h|--help)
      printf '用法: ./scripts/publish.sh [-m "message"] [--push]\n'
      exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

cd "$ROOT"

echo "→ 同步标签页"
node scripts/sync-tags.js

echo "→ 校验 front matter"
node scripts/validate-frontmatter.js

if [ -z "$MSG" ]; then
  COUNT=$(git status --porcelain _posts | wc -l | tr -d ' ')
  MSG="post: 更新 ${COUNT} 篇文章 $(date +%F)"
fi

git add _posts _tags
if git diff --cached --quiet; then
  echo "没有需要提交的改动。"
  exit 0
fi

git commit -m "$MSG"

if [ "$PUSH" -eq 1 ]; then
  echo "→ 推送 origin master"
  git push origin master
  echo "已推送。GitHub Pages 通常 60s 内构建完成。"
else
  echo "已提交。推送: git push origin master"
fi
