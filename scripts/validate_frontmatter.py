#!/usr/bin/env python3
"""validate_frontmatter.py —— 校验 _posts/*.md 的 front matter 是否合规。

检查项：
  必填：
    - title: 字符串，单行，禁换行
    - date: YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS +ZZZZ
    - tags: 数组，非空，无重复（标签只是展示，不要求有独立页面）
    - excerpt: 字符串，≤ 500 字，禁换行
  可选：
    - layout / pinned / draft / cover
    - series: 必须是 _series/<slug>.md 的文件名或其 title（缺则 WARN）

用法：
    python3 scripts/validate_frontmatter.py [--slug <name>] [--root <dir>]

退出码：error > 0 时为 1，否则 0。
"""

from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from frontmatter import parse_frontmatter  # noqa: E402

ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2} [+-]\d{4})?$")
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
COVER_RE = re.compile(r"^(\/assets\/|https?:\/\/)")
NEWLINE_RE = re.compile(r"[\r\n]")


def load_series_vocabulary(root: str) -> tuple[set, set]:
    """返回 (titles, slugs)：_series/*.md 的 title 集合与文件名（slug）集合。"""
    series_dir = os.path.join(root, "_series")
    titles: set = set()
    slugs: set = set()
    if not os.path.isdir(series_dir):
        return titles, slugs
    for name in sorted(os.listdir(series_dir)):
        if not name.endswith(".md"):
            continue
        with open(os.path.join(series_dir, name), encoding="utf-8") as fh:
            parsed = parse_frontmatter(fh.read())
        if parsed["fm"] and parsed["fm"].get("title"):
            titles.add(parsed["fm"]["title"])
        slugs.add(name[:-3])
    return titles, slugs


def validate_one(slug: str, root: str, series_vocab: set) -> dict:
    file = os.path.join(root, "_posts", f"{slug}.md")
    if not os.path.exists(file):
        return {"slug": slug, "file": file, "errors": [f"文件不存在: {file}"], "warnings": []}

    with open(file, encoding="utf-8") as fh:
        text = fh.read()
    parsed = parse_frontmatter(text)
    fm = parsed["fm"]
    errors: list[str] = []
    warnings: list[str] = []

    if parsed["frontmatter_error"]:
        errors.append(parsed["frontmatter_error"])
    if fm is None:
        return {"slug": slug, "file": file, "errors": errors, "warnings": warnings}

    # layout：若存在则必须非空字符串
    if "layout" in fm and fm["layout"] is not None:
        if not isinstance(fm["layout"], str) or not fm["layout"]:
            errors.append("layout 必须是字符串")

    # title：必填、单行
    title = fm.get("title")
    if title is None:
        errors.append("缺少必填字段: title")
    elif not isinstance(title, str):
        errors.append(f"title 必须是字符串(实际 {type(title).__name__})")
    elif NEWLINE_RE.search(title):
        errors.append("title 含换行，违反单行约束")

    # date：必填、ISO
    date = fm.get("date")
    if date is None:
        errors.append("缺少必填字段: date")
    elif not isinstance(date, str) or not ISO_DATE_RE.match(date):
        errors.append(f'date 不是 ISO 格式(YYYY-MM-DD 或带时间): "{date}"')

    # tags：必填、数组、非空、无重复
    tags = fm.get("tags")
    if tags is None:
        errors.append("缺少必填字段: tags")
    elif not isinstance(tags, list):
        errors.append(f"tags 必须是数组(实际 {type(tags).__name__})")
    else:
        if not tags:
            warnings.append("tags 数组为空")
        seen: set = set()
        for t in tags:
            if t in seen:
                errors.append(f'tags 含重复元素: "{t}"')
            seen.add(t)

    # excerpt：必填、≤500、禁换行
    excerpt = fm.get("excerpt")
    if excerpt is None:
        errors.append("缺少必填字段: excerpt")
    elif not isinstance(excerpt, str):
        errors.append(f"excerpt 必须是字符串(实际 {type(excerpt).__name__})")
    else:
        if NEWLINE_RE.search(excerpt):
            errors.append("excerpt 含换行，违反单行约束")
        if not excerpt:
            warnings.append("excerpt 为空串")
        if len(excerpt) > 500:
            errors.append(f"excerpt 长度 {len(excerpt)} 超过 500 字上限")

    # slug：格式
    slug_value = fm.get("slug")
    if slug_value is not None and not SLUG_RE.match(str(slug_value)):
        errors.append(f'slug "{slug_value}" 不合法(只允许小写字母、数字、连字符)')

    # pinned / draft：仅布尔
    for field in ("pinned", "draft"):
        if field in fm and fm[field] is not None and not isinstance(fm[field], bool):
            errors.append(f"{field} 仅 true/false(实际 \"{fm[field]}\")")
    if fm.get("draft") is True:
        errors.append("draft: true 出现在 _posts/(应放到 _drafts/)")

    # cover：null / /assets/... / https?://...
    cover = fm.get("cover")
    if cover is not None:
        if not isinstance(cover, str):
            errors.append(f"cover 必须是字符串或 null(实际 {type(cover).__name__})")
        elif not COVER_RE.match(cover):
            errors.append(f'cover 必须是 /assets/... 或 https?://...(实际 "{cover}")')

    # series：必须在 _series 的 slug 或 title 集合里
    series = fm.get("series")
    if series is not None:
        if not isinstance(series, str):
            errors.append("series 必须是字符串或 null")
        elif series not in series_vocab:
            warnings.append(f'series "{series}" 既不是 _series/ 的文件名，也不是其 title')

    return {"slug": slug, "file": file, "errors": errors, "warnings": warnings}


def main() -> int:
    parser = argparse.ArgumentParser(description="校验 _posts/*.md 的 front matter")
    parser.add_argument("--slug", default=None, help="只校验指定 slug")
    parser.add_argument("--root", default=None, help="仓库根目录")
    args = parser.parse_args()

    root = os.path.abspath(args.root) if args.root else os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    posts_dir = os.path.join(root, "_posts")
    if not os.path.isdir(posts_dir):
        print(f"validate_frontmatter: _posts/ 目录不存在: {posts_dir}", file=sys.stderr)
        return 1

    titles, slugs = load_series_vocabulary(root)
    series_vocab = titles | slugs

    if args.slug:
        target_slugs = [args.slug]
    else:
        target_slugs = [
            f[:-3] for f in sorted(os.listdir(posts_dir)) if f.endswith(".md")
        ]

    if not target_slugs:
        print("validate_frontmatter: 没有要校验的 post。")
        return 0

    results = [validate_one(s, root, series_vocab) for s in target_slugs]
    total_errors = 0
    total_warnings = 0
    for r in results:
        if not r["errors"] and not r["warnings"]:
            print(f"✔ {r['slug']}")
            continue
        for e in r["errors"]:
            print(f"✖ {r['slug']}: {e}")
            total_errors += 1
        for w in r["warnings"]:
            print(f"⚠ {r['slug']}: {w}")
            total_warnings += 1

    print(f"\n{len(results)} 个 post, {total_errors} 个 error, {total_warnings} 个 warning")
    print(f"(series 词表大小: {len(titles)})")
    return 1 if total_errors else 0


if __name__ == "__main__":
    sys.exit(main())
