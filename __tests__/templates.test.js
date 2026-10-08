'use strict';

// AC-03 / AC-05 / AC-06 / AC-07 / AC-10 / AC-11 / AC-22 · DOM/class 契约
// §4.5 整站壳 / §3 URL 完整 / §D2 专栏 / §4.3 可访问性
// 依赖 build-site.test.js 的 M3_SITE_DIR

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const NAV_PATHS = ['/', '/posts/', '/archive/', '/tags/', '/series/', '/search/', '/about/'];

function siteDir() {
  return process.env.M3_SITE_DIR || '';
}

function load$(p) {
  return cheerio.load(fs.readFileSync(p, 'utf8'));
}

function assertShell($, label) {
  // §4.5 整站壳
  assert.ok($('a.skip-link[href="#main"]').length, `${label}: 缺 skip-link`);
  assert.ok($('header.site-header').length, `${label}: 缺 header.site-header`);
  assert.ok($('a.site-brand > span.site-brand-mark').length,
    `${label}: 缺 site-brand-mark`);
  assert.ok($('nav.site-nav[aria-label="主导航"]').length,
    `${label}: 缺 nav.site-nav`);
  assert.equal($('nav.site-nav a').length, 7,
    `${label}: nav.site-nav 应有 7 个 a, 实际 ${$('nav.site-nav a').length}`);
  assert.ok($('button.theme-toggle[data-theme-toggle]').length,
    `${label}: 缺 theme-toggle`);
  assert.ok($('main#main.container, main#main').length, `${label}: 缺 main#main`);
  assert.ok($('footer.site-footer > div.links').length, `${label}: 缺 footer.links`);
  // footer.links 包含 9 个链接（含 RSS + GitHub）
  assert.equal($('footer.site-footer > div.links a').length, 9,
    `${label}: footer.links 应有 9 个 a`);
}

test('AC-22 / §4.3: <html lang="zh-CN"> + 装饰 SVG aria-hidden', () => {
  const d = siteDir();
  if (!d) return;
  for (const rel of NAV_PATHS) {
    const file = path.join(d, rel === '/' ? 'index.html' : `${rel}index.html`);
    if (!fs.existsSync(file)) continue;
    const $ = load$(file);
    assert.equal($('html').attr('lang'), 'zh-CN',
      `${rel}: html[lang] != zh-CN`);
    // 内联 FOUC 脚本在 <link rel="stylesheet"> 之前
    const headHtml = $('head').html() || '';
    const fouc = headHtml.indexOf('itingyu-theme');
    const css = headHtml.indexOf('rel="stylesheet"');
    assert.ok(fouc >= 0, `${rel}: 缺内联 FOUC 脚本`);
    assert.ok(css >= 0 && fouc < css,
      `${rel}: FOUC 脚本不在 stylesheet 之前`);
    // 装饰 SVG aria-hidden
    const svgs = $('svg');
    let bad = 0;
    svgs.each((_, el) => {
      if ($(el).attr('aria-hidden') !== 'true') bad++;
    });
    assert.equal(bad, 0, `${rel}: ${bad} 个 SVG 缺 aria-hidden="true"`);
  }
});

test('AC-03: 首页 + 文章页 + 归档 + 标签 + 标签详情 + 专栏 + 专栏详情 + 搜索 + about + 404 整站壳齐全', () => {
  const d = siteDir();
  if (!d) return;
  const samples = [
    ['/', 'index.html'],
    ['/posts/welcome/', 'posts/welcome/index.html'],
    ['/archive/', 'archive/index.html'],
    ['/tags/', 'tags/index.html'],
    ['/tags/finance/', 'tags/finance/index.html'],
    ['/series/', 'series/index.html'],
    ['/series/厨房学/', 'series/厨房学/index.html'],
    ['/search/', 'search/index.html'],
    ['/about/', 'about/index.html'],
    ['/404.html', '404.html'],
  ];
  for (const [url, file] of samples) {
    const p = path.join(d, file);
    if (!fs.existsSync(p)) continue;
    const $ = load$(p);
    assertShell($, url);
  }
});

test('AC-03: 首页含 h2.section-title / ul.post-list / 「查看全部文章」链接', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'index.html');
  if (!fs.existsSync(p)) return;
  const $ = load$(p);
  assert.ok($('h2.section-title').length, '首页缺 h2.section-title');
  assert.ok($('ul.post-list').length, '首页缺 ul.post-list');
  assert.ok($('a[href="/posts/"]').filter((_, el) =>
    $(el).text().includes('查看全部文章')).length,
    '首页缺「查看全部文章」链接');
});

test('AC-05: 归档按月分组，首组是 2026-10', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'archive/index.html');
  if (!fs.existsSync(p)) return;
  const $ = load$(p);
  assert.ok($('div.archive-group').length >= 2, '归档至少 2 个月份分组');
  const groups = $('div.archive-group').toArray();
  const firstMonth = $(groups[0]).attr('data-month') ||
                     $(groups[0]).find('[data-month]').attr('data-month') ||
                     '';
  // 取每组的 heading
  const h = $(groups[0]).find('h2, h3, .month-label').first().text();
  assert.ok(/2026[-\s]*10/.test(firstMonth + h),
    `首月应为 2026-10，实测 "${firstMonth}" / "${h}"`);
});

test('AC-06: 标签总览 chip 数 == 24，finance=5、kitchen=15、note=1', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'tags/index.html');
  if (!fs.existsSync(p)) return;
  const $ = load$(p);
  assert.equal($('div.tag-cloud a.chip').length, 24,
    `tag-cloud 应有 24 chip，实测 ${$('div.tag-cloud a.chip').length}`);

  function count(slug) {
    const tagDir = path.join(d, 'tags', slug);
    if (!fs.existsSync(tagDir)) return -1;
    const $p = load$(path.join(tagDir, 'index.html'));
    const cards = $p('ul.post-list > li').length;
    return cards;
  }
  assert.equal(count('finance'), 5);
  assert.equal(count('kitchen'), 15);
  assert.equal(count('note'), 1);
});

test('AC-07: 专栏总览 ul.series-grid × 2 + 路径含 CJK 原字符', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'series/index.html');
  if (!fs.existsSync(p)) return;
  const $ = load$(p);
  assert.equal($('ul.series-grid > a.series-card').length, 2,
    `series-grid 应有 2 个 series-card，实测 ${$('ul.series-grid > a.series-card').length}`);
  // 路径含 CJK 原字符（不得被 percent-encode）
  assert.ok(fs.existsSync(path.join(d, 'series', '厨房学', 'index.html')),
    '缺 /series/厨房学/');
  assert.ok(fs.existsSync(path.join(d, 'series', '金融市场观察', 'index.html')),
    '缺 /series/金融市场观察/');
  // 厨房学页 h3.post-title 数 == 15
  const k = load$(path.join(d, 'series', '厨房学', 'index.html'));
  assert.equal(k('h3.post-title').length, 15,
    `厨房学页应 15 篇，实测 ${k('h3.post-title').length}`);
});

test('AC-10: about 含 Person JSON-LD + div.callout', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'about/index.html');
  if (!fs.existsSync(p)) return;
  const $ = load$(p);
  const ld = $('script[type="application/ld+json"]').text();
  assert.ok(ld.includes('"@type":"Person"') || ld.includes('"@type": "Person"'),
    'about 缺 Person JSON-LD');
  assert.ok($('div.callout').length, 'about 缺 div.callout');
});

test('AC-11: 404 main 含 fourofour + robots.txt 字节相同', () => {
  const d = siteDir();
  if (!d) return;
  const p404 = path.join(d, '404.html');
  if (fs.existsSync(p404)) {
    const $ = load$(p404);
    assert.ok(($('main').attr('class') || '').includes('fourofour'),
      '404 main 缺 fourofour');
  }
  // robots.txt 字节相同（仓库根 vs _site）
  const repoRobots = path.join(__dirname, '..', 'robots.txt');
  const siteRobots = path.join(d, 'robots.txt');
  if (fs.existsSync(repoRobots) && fs.existsSync(siteRobots)) {
    const a = fs.readFileSync(repoRobots);
    const b = fs.readFileSync(siteRobots);
    assert.ok(a.equals(b), 'robots.txt 字节与仓库不一致');
  }
});

test('AC-22: 当前 nav 项带 aria-current="page"', () => {
  const d = siteDir();
  if (!d) return;
  const checks = [
    ['index.html', '/'],
    ['posts/index.html', '/posts/'],
    ['posts/welcome/index.html', '/posts/welcome/'],
    ['tags/index.html', '/tags/'],
    ['series/index.html', '/series/'],
  ];
  for (const [file, label] of checks) {
    const p = path.join(d, file);
    if (!fs.existsSync(p)) continue;
    const $ = load$(p);
    const cur = $('nav.site-nav a[aria-current="page"]');
    assert.ok(cur.length, `${label}: 当前 nav 项缺 aria-current="page"`);
  }
});
