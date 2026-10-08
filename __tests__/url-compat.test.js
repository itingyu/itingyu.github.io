'use strict';

// AC-02 · §3 URL 兼容 —— 22 个 slug 全部产出；不出现 /posts/<date>-* 残留
// 依赖 build-site.test.js 落地的 M3_SITE_DIR

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SLUGS = [
  'finance-2026-09-26', 'finance-2026-09-27', 'finance-2026-09-28',
  'finance-2026-09-29', 'finance-2026-09-30',
  'kitchen-01-principles',
  'kitchen-02-ingredient-selection', 'kitchen-02b-prep-washing', 'kitchen-02c-raw-food',
  'kitchen-03-seasoning', 'kitchen-04-knife-skills', 'kitchen-05-heat-control',
  'kitchen-06-cooking-methods', 'kitchen-07-classic-recipes', 'kitchen-08-advanced',
  'kitchen-09-management', 'kitchen-10-nutrition', 'kitchen-11-taboos',
  'kitchen-12-eight-cuisines', 'kitchen-13-cuisine-dishes',
  'sing-box-setup-experience', 'welcome',
];

function siteDir() {
  return process.env.M3_SITE_DIR || '';
}

test('AC-02: 22 个 slug 全部在 _site/posts/<slug>/index.html 产出', () => {
  const d = siteDir();
  if (!d) return; // upstream 未落地
  for (const slug of SLUGS) {
    const p = path.join(d, 'posts', slug, 'index.html');
    assert.ok(fs.existsSync(p), `缺 ${p}`);
  }
});

test('AC-02: 22 个 slug 的 index.html 非空且包含必要节点', () => {
  const d = siteDir();
  if (!d) return;
  let count = 0;
  for (const slug of SLUGS) {
    const p = path.join(d, 'posts', slug, 'index.html');
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, 'utf8');
    assert.ok(html.length > 1000, `${slug} 文件过小: ${html.length} bytes`);
    assert.ok(html.includes('article-header'),
      `${slug} 缺 article-header 节点`);
    count++;
  }
  assert.equal(count, 22);
});

test('AC-02: 不存在形如 posts/<YYYY-MM-DD>-* 的残留（:name 占位符误用）', () => {
  const d = siteDir();
  if (!d) return;
  const postsDir = path.join(d, 'posts');
  if (!fs.existsSync(postsDir)) return;
  const entries = fs.readdirSync(postsDir);
  const bad = entries.filter((e) => /^\d{4}-\d{2}-\d{2}-/.test(e));
  assert.deepEqual(bad, [], `发现日期前缀残留: ${bad.join(', ')}`);
});

test('AC-02: SLUGS 数量恰好 = 22（防止本表漂移）', () => {
  assert.equal(SLUGS.length, 22);
});
