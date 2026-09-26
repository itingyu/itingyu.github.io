'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { parseHTMLFrontmatter, parseYAMLFrontmatter, validate } = require('../validate-frontmatter.js');

function makeProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-test-'));
}

function cleanProject(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function writePost(tmp, slug, html, md) {
  const dir = path.join(tmp, 'posts', slug);
  fs.mkdirSync(dir, { recursive: true });
  if (html != null) fs.writeFileSync(path.join(dir, 'index.html'), html);
  if (md != null) fs.writeFileSync(path.join(dir, 'source.md'), md);
  return dir;
}

// ----- 1. typo in YAML key (dtae instead of date) → validator rejects -----

test('validate: rejects YAML with typo key (dtae instead of date)', () => {
  const tmp = makeProject();
  try {
    const md = `---
title: 测试文章
slug: test-typo
dtae: 2026-09-26
tags: [note]
---

正文`;
    const fm = parseYAMLFrontmatter(md);
    assert.ok(fm, 'should parse');
    assert.equal(fm.title, '测试文章');
    assert.equal(fm.date, undefined, 'date should not be set when key is typo');
    const errs = validate({ ...fm, chipSlugs: fm.tags }, 'test-typo', path.join(tmp, 'posts'));
    assert.ok(errs.some(e => /missing date/.test(e)), `should report missing date, got: ${errs.join('; ')}`);
  } finally { cleanProject(tmp); }
});

// ----- 2. missing required field (no title) → validator rejects ---------

test('validate: rejects HTML post with empty title', () => {
  const html = `<!doctype html>
<html><head>
  <title></title>
  <meta property="article:published_time" content="2026-09-26" />
  <meta property="article:tag" content="note" />
</head><body></body></html>`;
  const fm = parseHTMLFrontmatter(html);
  assert.equal(fm.title, '');
  const errs = validate(fm, 'no-title', '/tmp');
  assert.ok(errs.some(e => /title/.test(e)), `should report missing title, got: ${errs.join('; ')}`);
});

// ----- 3. type error (tags malformed, no bracket) → validator rejects slug -----

test('validate: rejects tags whose elements fail slug format', () => {
  const md = `---
title: 类型错误示例
date: 2026-09-26
tags: [note, "bad tag"]
---

正文`;
  const fm = parseYAMLFrontmatter(md);
  assert.deepEqual(fm.tags, ['note', 'bad tag'], 'parses YAML tags array');
  const errs = validate({ ...fm, chipSlugs: fm.tags }, 'bad-tags', '/tmp');
  assert.ok(errs.some(e => /tag slug not/.test(e)), `should reject bad slug in tags array, got: ${errs.join('; ')}`);
});

// ----- 4. cover path does not exist on disk → validator rejects -----------

test('validate: rejects cover path that does not exist on disk', () => {
  const tmp = makeProject();
  try {
    const html = `<!doctype html>
<html><head>
  <title>封面缺失示例</title>
  <meta property="article:published_time" content="2026-09-26" />
  <meta property="article:tag" content="note" />
  <a class="chip" href="/tags/note/" data-tag="note">note</a>
  <meta name="cover" content="cover-missing.svg" />
</head><body></body></html>`;
    const fm = parseHTMLFrontmatter(html);
    assert.equal(fm.cover, 'cover-missing.svg');
    const errs = validate(fm, 'bad-cover', path.join(tmp, 'posts'));
    assert.ok(errs.some(e => /cover not found/.test(e)), `should report missing cover, got: ${errs.join('; ')}`);
  } finally { cleanProject(tmp); }
});

// ----- 5. all-valid HTML post with cover that exists → no errors ---------

test('validate: accepts all-valid HTML post with existing cover', () => {
  const tmp = makeProject();
  try {
    const slug = 'good-post';
    const dir = writePost(tmp, slug);
    fs.writeFileSync(path.join(dir, 'cover.svg'), '<svg></svg>');
    const html = `<!doctype html>
<html><head>
  <title>合法文章</title>
  <meta name="description" content="示例描述" />
  <meta property="article:published_time" content="2026-09-26" />
  <meta property="article:tag" content="note" />
  <a class="chip" href="/tags/note/" data-tag="note">note</a>
  <meta name="cover" content="cover.svg" />
  <meta name="series" content="intro" />
  <meta name="draft" content="false" />
  <meta name="pinned" content="true" />
</head><body></body></html>`;
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    const fm = parseHTMLFrontmatter(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
    const errs = validate(fm, slug, path.join(tmp, 'posts'));
    assert.deepEqual(errs, [], `should be valid, got: ${errs.join('; ')}`);
  } finally { cleanProject(tmp); }
});

// ----- bonus: bad date format (non ISO) → validator rejects ---------------

test('validate: rejects non-ISO date format', () => {
  const html = `<!doctype html>
<html><head>
  <title>日期格式错</title>
  <meta property="article:published_time" content="2026/09/26" />
</head><body></body></html>`;
  const fm = parseHTMLFrontmatter(html);
  const errs = validate(fm, 'bad-date', '/tmp');
  assert.ok(errs.some(e => /date not YYYY-MM-DD/.test(e)), `should reject non-ISO date, got: ${errs.join('; ')}`);
});

// ----- bonus: bad chip slug (data-tag contains uppercase) → validator rejects

test('validate: rejects chip data-tag that is not slug-format', () => {
  const html = `<!doctype html>
<html><head>
  <title>slug 错</title>
  <meta property="article:published_time" content="2026-09-26" />
  <a class="chip" href="/tags/Note/" data-tag="Note">Note</a>
</head><body></body></html>`;
  const fm = parseHTMLFrontmatter(html);
  const errs = validate(fm, 'bad-slug', '/tmp');
  assert.ok(errs.some(e => /tag slug not/.test(e)), `should reject uppercase chip slug, got: ${errs.join('; ')}`);
});