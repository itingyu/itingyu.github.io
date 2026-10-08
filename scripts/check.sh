#!/usr/bin/env bash
# check.sh · 站点完整性检查(Phase G · design-v3 §6.5)
# 走 Jekyll doctor
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm run check "$@"
