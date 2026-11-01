#!/usr/bin/env python3
"""post.py —— 文章管理命令行：发布 / 下架 / 修改 / 查看。

用法：
    python3 scripts/post.py list   [--column c] [--search kw] [--limit n]
    python3 scripts/post.py show   <slug>
    python3 scripts/post.py publish <file.md|目录> [--column c] [--series s] [--tags a,b] [--push]
    python3 scripts/post.py set    <slug> [--title T] [--tags a,b] [--column c] [--series s] [--push]
    python3 scripts/post.py body   <slug> <file.md> [--push]
    python3 scripts/post.py remove <slug> [<slug> ...] [--push]

通用开关：
    --dry-run   只打印将要发生的变更，不写盘、不提交
    --push      变更后自动 git commit + push（发布前会跑全站校验）
"""

from __future__ import annotations

import argparse
import datetime
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from frontmatter import (  # noqa: E402
    make_excerpt, parse_frontmatter, slugify, stringify_frontmatter,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS = os.path.join(ROOT, "_posts")
COLUMNS = {"prog", "ai", "finance", "life", "misc", "naming"}


# ---------- 基础操作 ----------

def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, check=check, text=True, capture_output=True)


def load_posts() -> list[dict]:
    posts: list[dict] = []
    if not os.path.isdir(POSTS):
        return posts
    for name in sorted(os.listdir(POSTS)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(POSTS, name)
        with open(path, encoding="utf-8") as fh:
            parsed = parse_frontmatter(fh.read())
        fm = parsed["fm"] or {}
        posts.append({
            "rel": os.path.join("_posts", name),
            "path": path,
            "fm": fm,
            "body": parsed["body"],
            "slug": fm.get("slug") or re.sub(r"^\d{4}-\d{2}-\d{2}-", "", name[:-3]),
            "date": str(fm.get("date") or "")[:10],
            "title": fm.get("title") or name[:-3],
            "column": fm.get("column") or "",
            "series": fm.get("series") or "",
            "tags": fm.get("tags") if isinstance(fm.get("tags"), list) else [],
        })
    return posts


def find_post(slug: str, posts: list[dict]) -> dict | None:
    """按 slug 精确匹配；也允许用标题做模糊查找。"""
    for p in posts:
        if p["slug"] == slug:
            return p
    for p in posts:
        if p["rel"].endswith(f"{slug}.md"):
            return p
    needle = slug.lower()
    for p in posts:
        if needle in str(p["title"]).lower():
            return p
    return None


def require_post(slug: str, posts: list[dict]) -> dict:
    p = find_post(slug, posts)
    if not p:
        close = [x["slug"] for x in posts if slug[:3] in x["slug"]][:5]
        hint = f"相近的 slug: {', '.join(close)}" if close else "用 list 查看全部文章"
        print(f"错误: 找不到文章 \"{slug}\"。{hint}", file=sys.stderr)
        raise SystemExit(1)
    return p


def permalink_for(column: str, series: str, slug: str) -> str:
    return f"/notes/{column}/{series or column}/{slug}/"


def write_post(path: str, meta: dict, body: str) -> None:
    text = stringify_frontmatter(meta) + "\n" + (body or "").lstrip()
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


# ---------- 校验与提交 ----------

def validate_all() -> bool:
    proc = run([sys.executable, os.path.join("scripts", "validate_frontmatter.py")], check=False)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode == 0


def finalize(opts, message: str, paths: list[str] | None = None) -> None:
    """校验 → 提交 → （可选）推送。校验不过则中止，文件已写入需人工回滚。"""
    if not validate_all():
        print("\n校验未通过，已中止提交。修正后重新执行。", file=sys.stderr)
        raise SystemExit(1)
    targets = paths if paths else ["_posts"]
    run(["git", "add", *targets])
    staged = run(["git", "diff", "--cached", "--name-only"], check=False).stdout.split()
    if not staged:
        print("没有需要提交的变更。")
        return
    run(["git", "commit", "-m", message])
    # 以实际提交内容计数，避免把先前遗留的暂存项算进来
    committed = run(["git", "show", "--name-only", "--format=", "HEAD"], check=False).stdout.split()
    print(f"已提交 {len(committed)} 个文件：{message}")
    if opts.push:
        run(["git", "push", "origin", "master"])
        print("已推送到 master，GitHub Pages 通常 60s 内完成构建。")
    else:
        print("尚未推送：git push origin master")


# ---------- 子命令 ----------

def cmd_list(opts) -> int:
    posts = load_posts()
    if opts.column:
        posts = [p for p in posts if p["column"] == opts.column]
    if opts.search:
        kw = opts.search.lower()
        posts = [p for p in posts if kw in p["title"].lower() or kw in " ".join(p["tags"]).lower()]
    posts.sort(key=lambda p: (p["date"], p["slug"]), reverse=True)
    total = len(posts)
    if opts.limit:
        posts = posts[: opts.limit]
    for p in posts:
        tags = " ".join(f"#{t}" for t in p["tags"])
        print(f"{p['date']}  {p['title']}  [{p['column']}]  {p['slug']}  {tags}")
    print(f"\n共 {total} 篇" + (f"，显示 {len(posts)} 篇" if opts.limit else ""))
    return 0


def cmd_show(opts) -> int:
    p = require_post(opts.slug, load_posts())
    fm = p["fm"]
    print(f"文件: {p['rel']}")
    print(f"标题: {fm.get('title')}")
    print(f"slug: {p['slug']}")
    print(f"日期: {str(fm.get('date'))[:10]}")
    print(f"专栏: {fm.get('column')}  子专栏: {fm.get('series') or '-'}")
    print(f"标签: {', '.join(p['tags']) or '-'}")
    print(f"URL:  {fm.get('permalink')}")
    if p["body"].strip():
        print("\n正文预览:\n" + p["body"].strip()[:400])
    return 0


def cmd_publish(opts) -> int:
    import import_md

    files = import_md.collect(opts.files)
    if not files:
        print("错误: 没有找到 .md 文件", file=sys.stderr)
        return 1
    results = []
    for f in files:
        try:
            r = import_md.build(f, opts)
        except ValueError as e:
            print(f"失败: {e}", file=sys.stderr)
            continue
        if os.path.exists(r["target"]) and not opts.force:
            print(f"跳过(已存在): {os.path.relpath(r['target'], ROOT)}", file=sys.stderr)
            continue
        if opts.dry_run:
            print(f"\n=== {os.path.basename(f)} → {os.path.relpath(r['target'], ROOT)} ===\n{r['text']}\n")
            continue
        with open(r["target"], "w", encoding="utf-8") as fh:
            fh.write(r["text"])
        results.append(r)
        m = r["meta"]
        print(f"写入 {os.path.relpath(r['target'], ROOT)}  (column={m['column']} "
              f"series={m['series'] or '-'} tags={'/'.join(m['tags'])})")
    if opts.dry_run or not results:
        return 0
    paths = [os.path.relpath(r["target"], ROOT) for r in results]
    title = results[0]["meta"]["title"]
    msg = f"post: {title}" if len(results) == 1 else f"post: 批量发布 {len(results)} 篇"
    finalize(opts, msg, paths)
    return 0


def cmd_set(opts) -> int:
    p = require_post(opts.slug, load_posts())
    meta = dict(p["fm"])
    changed: list[str] = []

    if opts.title:
        meta["title"] = opts.title
        changed.append("title")
    if opts.tags is not None:
        meta["tags"] = [t.strip() for t in opts.tags.split(",") if t.strip()]
        changed.append("tags")
    if opts.column:
        if opts.column not in COLUMNS:
            print(f"错误: --column 取值必须是 {'|'.join(sorted(COLUMNS))}", file=sys.stderr)
            return 1
        meta["column"] = opts.column
        changed.append("column")
    if opts.series is not None:
        meta["series"] = opts.series or None
        changed.append("series")
    if opts.pinned:
        meta["pinned"] = True
        changed.append("pinned")
    if opts.unpinned:
        meta["pinned"] = False
        changed.append("pinned")

    if not changed:
        print("没有指定要修改的字段。可用: --title --tags --column --series --pinned")
        return 1

    # slug / column / series 变了，permalink 要跟着重算
    new_permalink = permalink_for(
        meta.get("column") or "misc", meta.get("series") or "", meta.get("slug") or p["slug"]
    )
    if new_permalink != meta.get("permalink"):
        changed.append("permalink")
        meta["permalink"] = new_permalink

    if opts.dry_run:
        print(f"将修改 {p['rel']}: {', '.join(changed)}")
        print(stringify_frontmatter(meta))
        return 0

    write_post(p["path"], meta, p["body"])
    print(f"已修改 {p['rel']}  ({', '.join(changed)})")
    finalize(opts, f"post: 修改 {meta.get('slug')}", [p["rel"]])
    return 0


def cmd_body(opts) -> int:
    p = require_post(opts.slug, load_posts())
    with open(opts.file, encoding="utf-8") as fh:
        new_body = fh.read()
    meta = dict(p["fm"])
    meta["excerpt"] = make_excerpt(new_body)[:490]
    if opts.dry_run:
        print(f"将替换 {p['rel']} 正文，摘要更新为: {meta['excerpt']}")
        return 0
    write_post(p["path"], meta, new_body)
    print(f"已替换正文 {p['rel']}")
    finalize(opts, f"post: 更新正文 {meta.get('slug')}", [p["rel"]])
    return 0


def cmd_remove(opts) -> int:
    posts = load_posts()
    targets = [require_post(s, posts) for s in opts.slugs]
    for t in targets:
        print(f"下架 {t['rel']}  → {t['fm'].get('permalink') or ''} (该 URL 将失效)")
    if opts.dry_run:
        return 0
    for t in targets:
        os.remove(t["path"])
    names = [t["fm"].get("slug") or t["slug"] for t in targets]
    finalize(opts, f"post: 下架 {', '.join(names)}", [t["rel"] for t in targets])
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="文章管理：发布 / 修改 / 下架 / 查看")
    sub = parser.add_subparsers(dest="cmd", required=True)

    def add_common(sp):
        sp.add_argument("--dry-run", action="store_true", help="只预览不落盘")
        sp.add_argument("--push", action="store_true", help="变更后自动提交并推送")

    sp = sub.add_parser("list", help="列出文章")
    sp.add_argument("--column", choices=sorted(COLUMNS))
    sp.add_argument("--search", help="按标题/标签模糊匹配")
    sp.add_argument("--limit", type=int, default=20)
    sp.set_defaults(func=cmd_list)

    sp = sub.add_parser("show", help="查看某篇文章")
    sp.add_argument("slug")
    sp.set_defaults(func=cmd_show)

    sp = sub.add_parser("publish", help="发布新文章（裸 md 即可）")
    sp.add_argument("files", nargs="+")
    sp.add_argument("--column", choices=sorted(COLUMNS))
    sp.add_argument("--series")
    sp.add_argument("--tags")
    sp.add_argument("--title")
    sp.add_argument("--date")
    sp.add_argument("--slug")
    sp.add_argument("--force", action="store_true", help="覆盖同名文章")
    add_common(sp)
    sp.set_defaults(func=cmd_publish)

    sp = sub.add_parser("set", help="修改文章元数据")
    sp.add_argument("slug")
    sp.add_argument("--title")
    sp.add_argument("--tags")
    sp.add_argument("--column", choices=sorted(COLUMNS))
    sp.add_argument("--series")
    sp.add_argument("--pinned", action="store_true")
    sp.add_argument("--unpinned", action="store_true")
    add_common(sp)
    sp.set_defaults(func=cmd_set)

    sp = sub.add_parser("body", help="替换正文")
    sp.add_argument("slug")
    sp.add_argument("file")
    add_common(sp)
    sp.set_defaults(func=cmd_body)

    sp = sub.add_parser("remove", help="下架文章")
    sp.add_argument("slugs", nargs="+")
    add_common(sp)
    sp.set_defaults(func=cmd_remove)

    return parser


def main() -> int:
    parser = build_parser()
    opts = parser.parse_args()
    return opts.func(opts)


if __name__ == "__main__":
    sys.exit(main())
