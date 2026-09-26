'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseFrontmatter } = require('../build-index.js');

const FIX = path.join(__dirname, 'fixtures');

function readFixture(slug) {
  return fs.readFileSync(path.join(FIX, slug, 'index.html'), 'utf8');
}

// 1. parse <meta name="description"> → description
test('frontmatter: parses meta description', () => {
  const html = readFixture('minimal-post');
  const fm = parseFrontmatter(html, 'minimal-post');
  assert.equal(fm.description, '最小化的 fixture 文章。');
});

// 2. parse <meta property="article:published_time"> → date
test('frontmatter: parses article:published_time as date', () => {
  const html = readFixture('multi-tag-post');
  const fm = parseFrontmatter(html, 'multi-tag-post');
  assert.equal(fm.date, '2026-02-20');
});

// 3. parse multiple <meta property="article:tag"> → tags array
test('frontmatter: parses multiple article:tag into tags array', () => {
  const html = readFixture('multi-tag-post');
  const fm = parseFrontmatter(html, 'multi-tag-post');
  const names = fm.tags.map(t => t.name).sort();
  assert.deepEqual(names, ['note', '算法', '金融']);
  // slug resolution prefers chip data-tag
  const note = fm.tags.find(t => t.name === 'note');
  const finance = fm.tags.find(t => t.name === '金融');
  assert.equal(note.slug, 'note');
  assert.equal(finance.slug, 'finance');
});

// 4. missing description → null (does not throw)
test('frontmatter: missing description returns null without throwing', () => {
  const html = `<!doctype html><html><head>
    <title>No desc</title>
    <meta property="article:published_time" content="2026-01-01" />
  </head><body></body></html>`;
  const fm = parseFrontmatter(html, 'no-desc');
  assert.equal(fm.description, null);
  assert.equal(fm.title, 'No desc');
  assert.equal(fm.date, '2026-01-01');
});

// 5. non-ISO date format → warning but still accepted
test('frontmatter: non-ISO date emits warning but is accepted', () => {
  const html = `<!doctype html><html><head>
    <title>D</title>
    <meta property="article:published_time" content="March 10, 2026" />
  </head><body></body></html>`;
  const fm = parseFrontmatter(html, 'weird-date');
  assert.equal(fm.date, 'March 10, 2026');
  assert.ok(fm.warnings.some(w => w.includes('non-ISO')), 'should warn');
});

// ============================================================
// spec v1.2 · AIWORK1-40 · article:pinned + article:modified_time 解析
// ============================================================

// 6. article:pinned=true → fm.pinned === true
test('frontmatter: parses article:pinned=true into fm.pinned (DoD #1)', () => {
  const html = readFixture('pinned-post');
  const fm = parseFrontmatter(html, 'pinned-post');
  assert.equal(fm.pinned, true);
});

// 7. 缺省 / content="false" / content 缺省 → fm.pinned === false
test('frontmatter: missing or article:pinned=false stays fm.pinned=false (DoD #2)', () => {
  // 7a 缺省 meta
  const htmlNoMeta = `<!doctype html><html><head>
    <title>no pinned</title>
    <meta property="article:published_time" content="2026-04-01" />
  </head><body></body></html>`;
  assert.equal(parseFrontmatter(htmlNoMeta, 'np1').pinned, false);

  // 7b content="false"
  const htmlFalse = `<!doctype html><html><head>
    <title>false pinned</title>
    <meta property="article:published_time" content="2026-04-01" />
    <meta property="article:pinned" content="false" />
  </head><body></body></html>`;
  assert.equal(parseFrontmatter(htmlFalse, 'np2').pinned, false);

  // 7c content="True" / "TRUE" 大小写不敏感
  const htmlTrueUpper = `<!doctype html><html><head>
    <title>TRUE pinned</title>
    <meta property="article:published_time" content="2026-04-01" />
    <meta property="article:pinned" content="TRUE" />
  </head><body></body></html>`;
  assert.equal(parseFrontmatter(htmlTrueUpper, 'np3').pinned, true);
});

// 8. article:modified_time → fm.dateModified
test('frontmatter: parses article:modified_time into fm.dateModified (DoD #3)', () => {
  const html = readFixture('pinned-post');
  const fm = parseFrontmatter(html, 'pinned-post');
  assert.equal(fm.dateModified, '2026-04-15');

  // 缺省时 dateModified === null(不抛错,后续排序回退 date)
  const htmlNoMod = `<!doctype html><html><head>
    <title>no mod</title>
    <meta property="article:published_time" content="2026-04-01" />
  </head><body></body></html>`;
  assert.equal(parseFrontmatter(htmlNoMod, 'nm').dateModified, null);
});