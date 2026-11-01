#!/usr/bin/env python3
"""frontmatter.py —— front matter 解析 / 序列化的唯一实现。

本仓库使用的 YAML 子集：
  标量（字符串 / True / False / None） + 块状列表(- item) + 行内列表([a, b])

被 validate_frontmatter.py、import_md.py、post.py 共用，避免多套解析逻辑漂移。
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

FRONTMATTER_RE = re.compile(r"^\uFEFF?\s*---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$")
KEY_RE = re.compile(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$")
LIST_ITEM_RE = re.compile(r"^\s*-\s*(.*)$")

FIELD_ORDER = [
    "layout", "slug", "title", "date", "column", "series",
    "tags", "excerpt", "description", "pinned", "cover", "draft", "permalink",
]


def unquote(s: str) -> str:
    if len(s) >= 2 and s.startswith('"') and s.endswith('"'):
        return s[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    if len(s) >= 2 and s.startswith("'") and s.endswith("'"):
        return s[1:-1].replace("''", "'")
    return s


def parse_frontmatter(md: str) -> dict:
    """返回 {fm, body, raw, frontmatter_error}；fm 为 None 表示没有 front matter。"""
    m = FRONTMATTER_RE.match(md)
    if not m:
        return {
            "fm": None,
            "body": md,
            "raw": "",
            "frontmatter_error": "缺少 front matter `---` 包裹",
        }

    raw, body = m.group(1), m.group(2)
    fm: dict[str, Any] = {}
    lines = raw.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].replace("\r", "")
        km = KEY_RE.match(line)
        if not km:
            i += 1
            continue
        key, value = km.group(1), km.group(2)
        if value == "":
            items: list[str] = []
            i += 1
            while i < len(lines):
                lm = LIST_ITEM_RE.match(lines[i].replace("\r", ""))
                if not lm:
                    break
                items.append(unquote(lm.group(1).strip()))
                i += 1
            fm[key] = items
        elif value.strip().startswith("[") and value.strip().endswith("]"):
            fm[key] = [
                unquote(s.strip())
                for s in value.strip()[1:-1].split(",")
                if unquote(s.strip())
            ]
            i += 1
        else:
            t = value.strip()
            if t == "true":
                fm[key] = True
            elif t == "false":
                fm[key] = False
            elif t in ("null", "~"):
                fm[key] = None
            else:
                fm[key] = unquote(t)
            i += 1

    return {"fm": fm, "body": body, "raw": raw, "frontmatter_error": ""}


def yaml_string(s: Any) -> str:
    """含 YAML 特殊起始字符 / 冒号 / 引号时用双引号包裹。"""
    str_ = str(s)
    if re.match(r'^[\s>|*&!%#@`{}\[\],-]|:\s|["\'\n]', str_) or str_ == "":
        return '"' + str_.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return str_


def stringify_frontmatter(fm: dict) -> str:
    keys = [k for k in FIELD_ORDER if k in fm]
    keys += [k for k in fm if k not in FIELD_ORDER]
    out = ["---"]
    for k in keys:
        v = fm[k]
        if isinstance(v, (list, tuple)):
            if not v:
                out.append(f"{k}: []")
                continue
            out.append(f"{k}:")
            for item in v:
                out.append(f"  - {yaml_string(item)}")
        elif v is None:
            out.append(f"{k}: null")
        elif isinstance(v, bool):
            out.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, (int, float)):
            out.append(f"{k}: {v}")
        else:
            out.append(f"{k}: {yaml_string(v)}")
    out.append("---")
    out.append("")
    return "\n".join(out)


def normalize_date(s: str) -> str:
    """把 YYYY-MM-DD[ HH:MM[:SS]] 规范成 'YYYY-MM-DD HH:MM:SS'；非法返回空串。"""
    m = re.match(
        r"^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?)?$", (s or "").strip()
    )
    if not m:
        return ""
    return f"{m.group(1)} {m.group(2) or '00:00'}:{m.group(3) or '00'}"


def slugify(name: str) -> str:
    """文件名 → slug。纯中文名无法转写时退回稳定短哈希。"""
    base = re.sub(r"\.(md|markdown|txt)$", "", str(name), flags=re.I)
    base = re.sub(r"^\d{4}-\d{2}-\d{2}[-_]?", "", base).lower()
    ascii_ = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:60]
    if len(ascii_.replace("-", "")) >= 2:
        return ascii_
    h = hashlib.sha1(base.encode("utf-8")).hexdigest()[:8]
    return f"post-{h}"


def plain_text(md: str) -> str:
    text = re.sub(r"```[\s\S]*?```", " ", md)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.M)
    text = re.sub(r"[*_`>|-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def make_excerpt(body: str, limit: int = 160) -> str:
    """取第一段有效正文作为摘要（跳过标题行与过短段落）。"""
    no_headings = re.sub(r"^#{1,6}\s+.*$", "", body, flags=re.M)
    for para in re.split(r"\n\s*\n", no_headings):
        t = plain_text(para)
        if len(t) >= 20:
            return t[:limit].replace('"', " ").replace("\n", " ").strip()
    return plain_text(no_headings)[:limit].replace('"', " ").replace("\n", " ").strip()


def first_heading(body: str) -> str:
    m = re.search(r"^#\s+(.+)$", body, flags=re.M)
    return m.group(1).strip() if m else ""
