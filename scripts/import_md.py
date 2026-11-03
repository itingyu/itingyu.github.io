#!/usr/bin/env python3
"""import_md.py —— 把任意 Markdown 文件变成一篇可渲染的博客文章。

用法：
    python3 scripts/import_md.py <file.md|目录> [...] [选项]

选项：
    --column <prog|ai|finance|life|misc>  必填（或从 front matter / 路径推断）
    --series <slug>      专栏，须对应 _series/<slug>.md
    --tags a,b           覆盖标签，默认沿用原 front matter，否则用 column 名
    --title "..."        覆盖标题，默认取 # H1 或文件名
    --date YYYY-MM-DD    默认今天
    --slug <slug>        默认由文件名自动生成
    --dry-run            只打印将要写入的内容，不落盘
    --force              允许覆盖同名文章
    --push               校验全绿后 git commit + push

做什么：
    1. 补全 front matter(title/date/tags/excerpt/permalink 等)
    2. 落到 _posts/<date>-<slug>.md
    3. 跑严格校验，不通过则回滚本次写入
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
    first_heading, make_excerpt, normalize_date, parse_frontmatter, slugify,
    stringify_frontmatter,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS = os.path.join(ROOT, "_posts")
SERIES = os.path.join(ROOT, "_series")
COLUMNS_DIR = os.path.join(ROOT, "_columns")


def columns() -> set[str]:
    """专栏白名单 = _columns/ 下的文件名，新增专栏无需改脚本。"""
    if not os.path.isdir(COLUMNS_DIR):
        return set()
    return {n[:-3] for n in os.listdir(COLUMNS_DIR) if n.endswith(".md")}


def today() -> str:
    return datetime.date.today().isoformat()


def collect(paths: list[str]) -> list[str]:
    out: list[str] = []
    for f in paths:
        abs_path = os.path.abspath(f)
        if not os.path.exists(abs_path):
            print(f"跳过(不存在): {f}", file=sys.stderr)
            continue
        if os.path.isdir(abs_path):
            for name in sorted(os.listdir(abs_path)):
                if not name.lower().endswith((".md", ".markdown")):
                    continue
                if name.lower() == "readme.md":
                    continue
                out.append(os.path.join(abs_path, name))
        else:
            out.append(abs_path)
    return out


def infer_column(file: str, fm: dict, column: str | None) -> str | None:
    if column:
        return column
    if fm.get("column") in columns():
        return fm["column"]
    for seg in file.split(os.sep):
        if seg in columns():
            return seg
    return None


def build(file: str, opts) -> dict:
    with open(file, encoding="utf-8") as fh:
        raw = fh.read()
    parsed = parse_frontmatter(raw)
    fm = parsed["fm"] or {}
    body = (parsed["body"] if parsed["fm"] else raw).lstrip("\n")

    column = infer_column(file, fm, opts.column)
    if not column or column not in columns():
        raise ValueError(
            f"{os.path.basename(file)}: 无法确定 column，请用 --column 指定 "
            f"({'|'.join(sorted(columns()))})"
        )

    series = opts.series if opts.series is not None else (fm.get("series") or "")
    if series and not os.path.exists(os.path.join(SERIES, f"{series}.md")):
        print(f'警告: series "{series}" 没有 _series/{series}.md，仍按输入写入', file=sys.stderr)

    if opts.tags:
        tags = [t.strip() for t in opts.tags.split(",") if t.strip()]
    elif isinstance(fm.get("tags"), list):
        tags = list(fm["tags"])
    else:
        tags = []
    if not tags:
        tags = [column]

    title = (
        opts.title
        or fm.get("title")
        or first_heading(body)
        or os.path.splitext(os.path.basename(file))[0]
    )
    title = re.sub(r"[\r\n]+", " ", str(title)).strip()

    date = opts.date or (
        fm["date"][:10] if isinstance(fm.get("date"), str) else ""
    ) or today()
    date = normalize_date(date)
    if not date:
        raise ValueError(
            f"{os.path.basename(file)}: --date 必须是 YYYY-MM-DD 或 'YYYY-MM-DD HH:MM[:SS]'"
        )

    slug = opts.slug or fm.get("slug") or slugify(os.path.basename(file))
    if not re.match(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$", slug):
        raise ValueError(
            f"{os.path.basename(file)}: slug \"{slug}\" 不合法(只允许 a-z0-9-)，用 --slug 指定"
        )

    excerpt = ""
    if isinstance(fm.get("excerpt"), str) and fm["excerpt"].strip():
        excerpt = fm["excerpt"].strip()
    elif isinstance(fm.get("description"), str) and fm["description"].strip():
        excerpt = fm["description"].strip()
    if not excerpt:
        excerpt = make_excerpt(body)
    excerpt = re.sub(r"[\r\n]+", " ", excerpt)[:490]

    meta = {
        "layout": "post",
        "slug": slug,
        "title": title,
        "date": f"{date} +0800",
        "column": column,
        "series": series or None,
        "tags": tags,
        "excerpt": excerpt,
        "pinned": fm.get("pinned") is True,
        "cover": fm.get("cover") or None,
        "draft": False,
        "permalink": fm.get("permalink") or f"/notes/{column}/{series or column}/{slug}/",
    }
    text = stringify_frontmatter(meta) + "\n" + body.lstrip()
    # Jekyll 只认 YYYY-MM-DD-slug.md；日期里的时分秒只留在 front matter
    target = os.path.join(POSTS, f"{date[:10]}-{slug}.md")
    return {"target": target, "text": text, "slug": f"{date}-{slug}", "meta": meta}


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, cwd=ROOT, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="把任意 Markdown 变成博客文章")
    parser.add_argument("files", nargs="+", help="输入的 .md 文件或目录")
    parser.add_argument("--column", default=None)
    parser.add_argument("--series", default=None)
    parser.add_argument("--tags", default=None)
    parser.add_argument("--title", default=None)
    parser.add_argument("--date", default=None)
    parser.add_argument("--slug", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--push", action="store_true")
    opts = parser.parse_args()

    if opts.column and opts.column not in columns():
        print(f"错误: --column 取值必须是 {'|'.join(sorted(columns()))}", file=sys.stderr)
        return 1

    files = collect(opts.files)
    if not files:
        print("错误: 没有找到可导入的 .md 文件", file=sys.stderr)
        return 1

    results: list[dict] = []
    for f in files:
        try:
            r = build(f, opts)
        except ValueError as e:
            print(f"失败: {e}", file=sys.stderr)
            continue
        if os.path.exists(r["target"]) and not opts.force:
            print(f"跳过(已存在): {os.path.relpath(r['target'], ROOT)}", file=sys.stderr)
            continue
        if opts.dry_run:
            print(f"\n=== {os.path.basename(f)} → {os.path.relpath(r['target'], ROOT)} ===\n{r['text']}\n")
            continue
        os.makedirs(POSTS, exist_ok=True)
        with open(r["target"], "w", encoding="utf-8") as fh:
            fh.write(r["text"])
        results.append(r)
        meta = r["meta"]
        print(
            f"写入 {os.path.relpath(r['target'], ROOT)}  "
            f"(column={meta['column']} series={meta['series'] or '-'} "
            f"tags={'/'.join(meta['tags'])})"
        )

    if opts.dry_run or not results:
        return 0

    failed: list[dict] = []
    for r in results:
        try:
            run([sys.executable, os.path.join("scripts", "validate_frontmatter.py"),
                 "--slug", r["slug"]])
        except subprocess.CalledProcessError:
            failed.append(r)
    if failed:
        for r in failed:
            os.remove(r["target"])
        print(f"\n校验未通过，已回滚 {len(failed)} 个文件。修正后重试。", file=sys.stderr)
        return 1

    if opts.push:
        paths = [os.path.relpath(r["target"], ROOT) for r in results]
        run(["git", "add", *paths])
        msg = (
            f"post: {results[0]['meta']['title']}"
            if len(results) == 1
            else f"post: 批量导入 {len(results)} 篇"
        )
        run(["git", "commit", "-m", msg])
        run(["git", "push", "origin", "master"])
        print(f"已推送 {len(results)} 篇，GitHub Pages 通常 60s 内构建完成。")
    else:
        print(f"\n完成 {len(results)} 篇。推送: git push origin master（或下次加 --push）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
