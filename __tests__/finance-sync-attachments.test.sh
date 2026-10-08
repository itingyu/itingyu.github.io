#!/usr/bin/env bash
# finance-sync-attachments.test.sh
#
# 回归测试 —— AIWORK1-69 (2026-09-28)。
# scripts/finance-sync.sh 的「通过 issue 评论拿 .md 附件」路径要容忍
# attachments 字段的多种形态,任何形态都不应让 jq / python 抛:
#   - jq:  "Cannot iterate over string" / "Cannot index string with string \"name\""
#   - py:  "AttributeError: 'str' object has no attribute 'get'"
# 出错时应统一视为「该评论无附件」,走 die 「issue 评论里没有 .md 附件」错误。
#
# 本测试直接调用 finance-sync.sh 内 attachment_id_from_issue() 用到的
# 同一份 jq 表达式和 python body(下面就地复刻;任何对 finance-sync.sh
# 的解析逻辑改动必须同步这里 —— 见末尾 SYNC 注释)。
#
# 运行: bash scripts/__tests__/finance-sync-attachments.test.sh
# 不依赖 multica CLI / git / 网络。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 必须在仓库根运行,避免错把别的 finance-sync.sh 拉进来。
[ -f "$REPO_ROOT/scripts/finance-sync.sh" ] \
  || { echo "FAIL: 未在 itingyu.github.io 仓库根运行: $REPO_ROOT" >&2; exit 2; }

command -v jq >/dev/null 2>&1 \
  || { echo "FAIL: 需要 jq(请装 jq 后重跑)" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 \
  || { echo "FAIL: 需要 python3(请装 python3 后重跑)" >&2; exit 2; }

# ----- SYNC: 以下 jq 表达式 / python body 必须与 scripts/finance-sync.sh
#           attachment_id_from_issue() 中传入 json_get() 的参数保持一致。
#           任何对 finance-sync.sh 解析逻辑的改动必须同步更新本节。

JQ_EXPR='
([.[] | .attachments // [] | select(type == "array") | .[]]) as $all
| ($all | map(select((.name // .filename // "") | test("\\.(md|markdown)$"))) | .[0].id // null) as $md
| ($all | .[-1].id // null) as $any
| ($md // $any) // empty
'

# python body 是 json_get() 注入到 import + data=json.loads(sys.stdin.read()) 之后的部分。
PY_BODY='
chosen = None
for c in (data if isinstance(data, list) else []):
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

run_jq() {
  local payload="$1"
  # 用 -r(不用 -e):空结果走 exit 0 + 空 stdout,与 json_get() 调用方式一致。
  # 上层 finance-sync.sh 通过「输出非空 && !=null && !=empty」判断是否拿到附件。
  printf '%s' "$payload" | jq -r "$JQ_EXPR"
}

run_py() {
  local payload="$1"
  printf '%s' "$payload" | python3 -c "import json, sys
data = json.loads(sys.stdin.read())
${PY_BODY}"
}

# ----- 测试用例 -----
# 用例格式: "<label>|<payload>|<jq expected>|<py expected>"
# 期望值是 attachment id;"<none>" 表示空(没有匹配附件)。
# 用例覆盖 AIWORK1-69 issue 列出的三种 attachments 形态 + 合法路径 + 混合形态。

CASES=(
  "empty-array|[{\"id\":\"c1\",\"attachments\":[]}]|<none>|<none>"
  "string-object|[{\"id\":\"c1\",\"attachments\":\"[object Object]\"}]|<none>|<none>"
  "string-bracket|[{\"id\":\"c1\",\"attachments\":\"[object]\"}]|<none>|<none>"
  "string-empty-array-literal|[{\"id\":\"c1\",\"attachments\":\"[]\"}]|<none>|<none>"
  "null-attachments|[{\"id\":\"c1\",\"attachments\":null}]|<none>|<none>"
  "missing-attachments|[{\"id\":\"c1\"}]|<none>|<none>"
  "valid-md|[{\"id\":\"c1\",\"attachments\":[{\"id\":\"a1\",\"name\":\"brief.md\"}]}]|a1|a1"
  "valid-markdown|[{\"id\":\"c1\",\"attachments\":[{\"id\":\"a2\",\"name\":\"brief.markdown\"}]}]|a2|a2"
  "valid-by-filename|[{\"id\":\"c1\",\"attachments\":[{\"id\":\"a3\",\"filename\":\"report.md\"}]}]|a3|a3"
  "non-md-only|[{\"id\":\"c1\",\"attachments\":[{\"id\":\"a4\",\"name\":\"chart.png\"}]}]|a4|a4"
  "mixed-md-priority|[{\"id\":\"c1\",\"attachments\":[{\"id\":\"x1\",\"name\":\"chart.png\"}]},{\"id\":\"c2\",\"attachments\":[{\"id\":\"x2\",\"name\":\"brief.md\"}]}]|x2|x2"
  "mixed-with-string|[{\"id\":\"c1\",\"attachments\":\"[object]\"},{\"id\":\"c2\",\"attachments\":[{\"id\":\"y1\",\"name\":\"brief.md\"}]}]|y1|y1"
  "comments-list-empty|[]|<none>|<none>"
)

pass=0
fail=0
fails=()

for case in "${CASES[@]}"; do
  IFS='|' read -r label payload expect_jq expect_py <<<"$case"

  # --- jq ---
  jq_out=""
  jq_err=""
  if ! jq_out="$(run_jq "$payload" 2>&1)"; then
    jq_err="jq exited non-zero: $jq_out"
    jq_out="<crash>"
  fi
  # jq 对「empty」输出空 stdout(不是字面量 null/empty);上层用 -z 判断即可。
  # 这里把空串标准化成 <none>,与期望值对齐。
  [ -z "$jq_out" ] && jq_out="<none>"

  jq_ok=0
  if [ -z "$jq_err" ] && [ "$jq_out" = "$expect_jq" ]; then
    jq_ok=1
  fi

  # --- python ---
  py_out=""
  py_err=""
  if ! py_out="$(run_py "$payload" 2>&1)"; then
    py_err="python exited non-zero: $py_out"
    py_out="<crash>"
  fi
  [ -z "$py_out" ] && py_out="<none>"

  py_ok=0
  if [ -z "$py_err" ] && [ "$py_out" = "$expect_py" ]; then
    py_ok=1
  fi

  if [ "$jq_ok" = 1 ] && [ "$py_ok" = 1 ]; then
    pass=$((pass+1))
    printf '  PASS  %-32s  jq=%s  py=%s\n' "$label" "$jq_out" "$py_out"
  else
    fail=$((fail+1))
    fails+=("$label (jq_out='$jq_out' jq_err='$jq_err' py_out='$py_out' py_err='$py_err' expect_jq='$expect_jq' expect_py='$expect_py')")
    printf '  FAIL  %-32s  jq=%s%s  py=%s%s\n' \
      "$label" "$jq_out" "${jq_err:+ ERR=$jq_err}" "$py_out" "${py_err:+ ERR=$py_err}"
  fi
done

echo
echo "总结: $pass passed, $fail failed (共 $((pass+fail)) 个)"

if [ "$fail" -ne 0 ]; then
  echo
  echo "失败明细:"
  for f in "${fails[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

# 顺手做一遍 bash -n 静态检查,免得改坏了 finance-sync.sh 的语法。
bash -n "$REPO_ROOT/scripts/finance-sync.sh" \
  || { echo "FAIL: bash -n scripts/finance-sync.sh 失败" >&2; exit 1; }

echo "OK ✅"
exit 0