#!/usr/bin/env python3
"""Python 工具链单元测试：python3 -m unittest discover scripts/tests -v"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from frontmatter import (  # noqa: E402
    first_heading, make_excerpt, parse_frontmatter, slugify, stringify_frontmatter,
)


class TestParseFrontmatter(unittest.TestCase):
    def test_scalars(self):
        parsed = parse_frontmatter("---\ntitle: 标题\ncount: 3\ndraft: false\n---\n\n正文\n")
        self.assertEqual(parsed["fm"]["title"], "标题")
        self.assertEqual(parsed["fm"]["count"], "3")
        self.assertIs(parsed["fm"]["draft"], False)
        self.assertIn("正文", parsed["body"])

    def test_block_list(self):
        parsed = parse_frontmatter("---\ntags:\n  - a\n  - b\n---\n")
        self.assertEqual(parsed["fm"]["tags"], ["a", "b"])

    def test_inline_list(self):
        parsed = parse_frontmatter("---\ntags: [a, b]\n---\n")
        self.assertEqual(parsed["fm"]["tags"], ["a", "b"])

    def test_quoted_value(self):
        parsed = parse_frontmatter('---\ntitle: "带: 冒号"\n---\n')
        self.assertEqual(parsed["fm"]["title"], "带: 冒号")

    def test_no_frontmatter(self):
        parsed = parse_frontmatter("# 只有正文\n")
        self.assertIsNone(parsed["fm"])
        self.assertIn("只有正文", parsed["body"])


class TestStringify(unittest.TestCase):
    def test_roundtrip(self):
        meta = {
            "layout": "post",
            "slug": "demo",
            "title": "标题: 带冒号",
            "tags": ["a", "b"],
            "pinned": False,
            "cover": None,
        }
        parsed = parse_frontmatter(stringify_frontmatter(meta))
        self.assertEqual(parsed["fm"]["slug"], "demo")
        self.assertEqual(parsed["fm"]["title"], "标题: 带冒号")
        self.assertEqual(parsed["fm"]["tags"], ["a", "b"])
        self.assertIs(parsed["fm"]["pinned"], False)
        self.assertIsNone(parsed["fm"]["cover"])


class TestSlugify(unittest.TestCase):
    def test_ascii_kept(self):
        self.assertEqual(slugify("hello-world.md"), "hello-world")

    def test_chinese_falls_back_to_hash(self):
        out = slugify("中文笔记.md")
        self.assertTrue(out.startswith("post-"))
        self.assertRegex(out, r"^post-[0-9a-f]{8}$")

    def test_stable(self):
        self.assertEqual(slugify("中文.md"), slugify("中文.md"))


class TestExcerpt(unittest.TestCase):
    def test_skips_headings(self):
        body = "# 标题\n\n这是正文第一句，用来验证摘要。"
        self.assertTrue(make_excerpt(body).startswith("这是正文"))

    def test_empty_body(self):
        self.assertEqual(make_excerpt(""), "")


class TestFirstHeading(unittest.TestCase):
    def test_finds_h1(self):
        self.assertEqual(first_heading("前面文字\n\n# 真标题\n\n正文"), "真标题")

    def test_none(self):
        self.assertEqual(first_heading("没有标题的正文"), "")


class TestValidateTool(unittest.TestCase):
    """对真实仓库跑一遍校验，确保 0 error。"""

    def test_repo_is_clean(self):
        proc = subprocess.run(
            [sys.executable, os.path.join(ROOT, "scripts", "validate_frontmatter.py")],
            cwd=ROOT, capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("0 个 error", proc.stdout)


class TestPostTool(unittest.TestCase):
    def test_help_runs(self):
        proc = subprocess.run(
            [sys.executable, os.path.join(ROOT, "scripts", "post.py"), "--help"],
            cwd=ROOT, capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0)
        for cmd in ("publish", "set", "body", "remove", "list", "show"):
            self.assertIn(cmd, proc.stdout)

    def test_list_runs(self):
        proc = subprocess.run(
            [sys.executable, os.path.join(ROOT, "scripts", "post.py"), "list", "--limit", "3"],
            cwd=ROOT, capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("共", proc.stdout)

    def test_permalink_helper(self):
        sys.path.insert(0, os.path.join(ROOT, "scripts"))
        import post

        self.assertEqual(post.permalink_for("prog", "prog-eng", "x"), "/notes/prog/prog-eng/x/")
        self.assertEqual(post.permalink_for("misc", "", "x"), "/notes/misc/misc/x/")


if __name__ == "__main__":
    unittest.main()
