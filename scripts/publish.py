#!/usr/bin/env python3
"""publish.py —— 校验 → 提交 → 推送。

用法:
    python3 scripts/publish.py [-m "commit message"] [--push]

默认只校验 + 暂存 + 提交；加 --push 才推送到 origin master。
校验失败立即中止，不会产生半截提交。
"""

from __future__ import annotations

import argparse
import datetime
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, check=check, text=True, capture_output=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="校验并提交博客变更")
    parser.add_argument("-m", "--message", default="")
    parser.add_argument("--push", action="store_true")
    opts = parser.parse_args()

    print("→ 校验 front matter")
    proc = run([sys.executable, os.path.join("scripts", "validate_frontmatter.py")], check=False)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        print("校验未通过，已中止。", file=sys.stderr)
        return 1

    msg = opts.message or (
        f"post: 更新 {len(run(['git', 'status', '--porcelain', '_posts']).stdout.splitlines())} 篇文章 "
        f"{datetime.date.today().isoformat()}"
    )

    run(["git", "add", "_posts"])
    if not run(["git", "diff", "--cached", "--quiet"], check=False).returncode:
        print("没有需要提交的改动。")
        return 0

    run(["git", "commit", "-m", msg])
    if opts.push:
        print("→ 推送 origin master")
        run(["git", "push", "origin", "master"])
        print("已推送。GitHub Pages 通常 60s 内构建完成。")
    else:
        print(f"已提交。推送: git push origin master")
    return 0


if __name__ == "__main__":
    sys.exit(main())
