#!/usr/bin/env bash
# build.sh · 站点构建入口(Phase G · design-v3 §6.5)
# 默认走 Jekyll bundle;支持 LEGACY=1 走老的 node scripts/lib.js
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${LEGACY:-0}" = "1" ]; then
  exec node scripts/lib.js "$@"
else
  exec npm run build "$@"
fi
