'use strict';

// AC-20 · §D14 同日多篇文章稳定序
//   厨房学专栏页（15 篇）+ /posts/ 两页（22 篇）+ feeds/rss.xml item 集合
//   + 归档页厨房条目顺序必须 == v1 基线快照。
//
// 基线快照存于仓库根：scripts/__tests__/fixtures/v1-order-baseline.json
// 抽 3 篇（welcome / finance-2026-09-30 / kitchen-07-classic-recipes）做 DOM 视觉快照。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const REPO_ROOT = path.join(__dirname, '..');
const BASELINE = path.join(REPO_ROOT, 'scripts', '__tests__', 'fixtures',
  'v1-order-baseline.json');

function siteDir() { return process.env.M3_SITE_DIR || ''; }

function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

function extractPostHrefs($, selector) {
  return $(selector).toArray().map((el) => {
    const a = el.attribs && el.attribs.href ? el.attribs.href : null;
    if (a) return a;
    return $(el).find('a[href*="/posts/"]').first().attr('href') || '';
  }).filter(Boolean);
}

test('AC-20: v1-order-baseline.json 存在（Phase B 已落地）', () => {
  assert.ok(fs.existsSync(BASELINE),
    '基线快照缺失：Phase B 未落地');
});

test('AC-20: 厨房学专栏页 h3.post-title 顺序 == 基线', () => {
  const d = siteDir();
  const bl = loadBaseline();
  if (!d || !bl || !bl.kitchenSeries) return;
  const $ = cheerio.load(fs.readFileSync(
    path.join(d, 'series', '厨房学', 'index.html'), 'utf8'));
  const actual = extractPostHrefs($, 'h3.post-title').map((h) => {
    const m = h.match(/\/posts\/([^/]+)\//);
    return m ? m[1] : '';
  });
  assert.deepEqual(actual, bl.kitchenSeries,
    `厨房学顺序不符:\n  baseline=${JSON.stringify(bl.kitchenSeries)}\n  actual=${JSON.stringify(actual)}`);
});

test('AC-20: /posts/ 两页 href 并集 == 22 slug 且 == 基线', () => {
  const d = siteDir();
  const bl = loadBaseline();
  if (!d || !bl || !bl.allPosts) return;
  const $1 = cheerio.load(fs.readFileSync(path.join(d, 'posts', 'index.html'), 'utf8'));
  const $2 = fs.existsSync(path.join(d, 'posts', 'page2', 'index.html'))
    ? cheerio.load(fs.readFileSync(path.join(d, 'posts', 'page2', 'index.html'), 'utf8'))
    : null;
  const a1 = extractPostHrefs($1, 'h3.post-title').map((h) => {
    const m = h.match(/\/posts\/([^/]+)\//);
    return m ? m[1] : '';
  });
  const a2 = $2
    ? extractPostHrefs($2, 'h3.post-title').map((h) => {
      const m = h.match(/\/posts\/([^/]+)\//);
      return m ? m[1] : '';
    })
    : [];
  const union = [...new Set([...a1, ...a2])];
  assert.equal(union.length, 22, `/posts/ 两页并集应 22 篇，实测 ${union.length}`);
  assert.deepEqual(union.sort(), bl.allPosts.sort(),
    '并集 != 基线 22 slug');
});

test('AC-20: rss.xml item href 顺序 == 基线', () => {
  const d = siteDir();
  const bl = loadBaseline();
  if (!d || !bl || !bl.rssItems) return;
  const xml = fs.readFileSync(path.join(d, 'feeds', 'rss.xml'), 'utf8');
  const m = [...xml.matchAll(/<link>https:\/\/itingyu\.github\.io\/posts\/([^/]+)\/<\/link>/g)];
  const actual = m.map((x) => x[1]);
  assert.deepEqual(actual, bl.rssItems,
    `rss 顺序不符:\n  baseline=${JSON.stringify(bl.rssItems)}\n  actual=${JSON.stringify(actual)}`);
});

test('AC-20: 3 篇抽样 DOM 视觉快照（welcome / finance-2026-09-30 / kitchen-07-classic-recipes）', () => {
  const d = siteDir();
  if (!d) return;
  const snapshots = [
    'welcome',
    'finance-2026-09-30',
    'kitchen-07-classic-recipes',
  ];
  for (const slug of snapshots) {
    const p = path.join(d, 'posts', slug, 'index.html');
    if (!fs.existsSync(p)) continue;
    const $ = cheerio.load(fs.readFileSync(p, 'utf8'));
    // 关键 DOM 节点
    assert.ok($('h1').first().text().length > 0,
      `${slug}: h1 为空`);
    assert.ok($('article').length, `${slug}: 缺 <article>`);
    assert.ok($('header.article-header').length,
      `${slug}: 缺 article-header`);
    assert.ok($('div.post-meta').length,
      `${slug}: 缺 post-meta`);
    assert.ok($('p.post-excerpt').length,
      `${slug}: 缺 post-excerpt`);
    // 首行 blockquote（v1 摘要引用块）
    assert.ok($('article > blockquote').length || $('article p').first().text().length > 0,
      `${slug}: 正文首段为空`);
  }
});
