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
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, check=check, text=True, capture_output=True)


def sync_skill(root: Path) -> None:
    """把 Minis skill 归档到 docs/skills/，避免仓库手册与实际脚本脱节。

    权威源在 /var/minis/skills/blog-publish/SKILL.md（仓库外），同步时加上归档说明头。
    """
    src = Path("/var/minis/skills/blog-publish/SKILL.md")
    dst = root / "docs" / "skills" / "blog-publish.md"
    if not src.exists():
        return
    body = src.read_text(encoding="utf-8")
    head = (
        "# 博客发布 Skill（归档副本）\n\n"
        "> 本文是 Minis skill `blog-publish` 的归档副本，权威源在 "
        "`/var/minis/skills/blog-publish/SKILL.md`。\n"
        "> 目的：让仓库本身自带操作手册，不依赖外部 skill 也能照着发文章。\n\n"
        "---\n\n## 原 skill 定义\n\n```yaml\n"
        + body.split("---", 2)[1].strip() + "\n```\n\n"
    )
    content = head + body.split("---", 2)[2].lstrip("\n")
    if dst.exists() and dst.read_text(encoding="utf-8") == content:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(content, encoding="utf-8")
    print(f"已同步 skill 归档: {dst}")


def main() -> int:
    parser = argparse.ArgumentParser(description="校验并提交博客变更")
    parser.add_argument("-m", "--message", default="")
    parser.add_argument("--push", action="store_true")
    opts = parser.parse_args()

    sync_skill(Path.cwd())

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
