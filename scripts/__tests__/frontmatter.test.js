'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFrontmatter, stringifyFrontmatter, slugify, makeExcerpt, firstHeading,
} = require('../frontmatter.js');

test('frontmatter: 解析标量 / 块状列表 / 行内列表', () => {
  const md = '---\ntitle: "标题: 带冒号"\ncount: 3\ndraft: false\ncover: null\ntags:\n  - a\n  - b\nlist: [x, "y"]\n---\n正文\n';
  const { fm, body } = parseFrontmatter(md);
  assert.equal(fm.title, '标题: 带冒号');
  assert.equal(fm.count, '3');
  assert.equal(fm.draft, false);
  assert.equal(fm.cover, null);
  assert.deepEqual(fm.tags, ['a', 'b']);
  assert.deepEqual(fm.list, ['x', 'y']);
  assert.equal(body.trim(), '正文');
});

test('frontmatter: 无 front matter 时返回 null', () => {
  const { fm, frontmatterError } = parseFrontmatter('# 纯正文\n');
  assert.equal(fm, null);
  assert.ok(frontmatterError);
});

test('frontmatter: stringify → parse 往返一致', () => {
  const fm = {
    layout: 'post', slug: 'x', title: '带 "引号" 的标题', date: '2026-11-01 00:00:00 +0800',
    column: 'prog', series: null, tags: ['a', 'b c'], excerpt: '摘要', pinned: false,
    cover: null, draft: false, permalink: '/notes/prog/prog/x/',
  };
  const round = parseFrontmatter(stringifyFrontmatter(fm) + '\n正文\n');
  assert.equal(round.fm.title, fm.title);
  assert.equal(round.fm.column, 'prog');
  assert.equal(round.fm.series, null);
  assert.deepEqual(round.fm.tags, ['a', 'b c']);
  assert.equal(round.fm.pinned, false);
});

test('slugify: 去日期前缀 / 非 ASCII 退化哈希 / 非法字符折叠', () => {
  assert.equal(slugify('2026-10-09-render-test-mermaid-latex.md'), 'render-test-mermaid-latex');
  assert.equal(slugify('Hello World!.md'), 'hello-world');
  assert.match(slugify('一篇中文笔记.md'), /^post-[0-9a-f]{8}$/);
});

test('makeExcerpt: 跳过标题，取首段并限长', () => {
  const body = '# 大标题\n\n这是第一段正文，长度足够触发摘要提取，应该被选中。\n\n第二段。';
  const e = makeExcerpt(body, 20);
  assert.equal(e.startsWith('这是第一段正文'), true);
  assert.equal(e.length, 20);
});

test('firstHeading: 取第一个 H1', () => {
  assert.equal(firstHeading('\n## H2\n# 真标题\ntext'), '真标题');
  assert.equal(firstHeading('无标题'), '');
});
