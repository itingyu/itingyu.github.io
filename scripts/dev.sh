#!/usr/bin/env bash
# dev.sh · 本地预览(Phase G · design-v3 §6.5)
# bundle exec jekyll serve,带 livereload
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm run serve "$@"
