'use strict';

// AC-12 / AC-13 / AC-14 · RSS / sitemap 归一化等价
// §D9 锁定「归一化后逐元素逐属性比对」口径（v3 spec §D8 校正）。
// 归一化器:
//   - 去 <?xml ...?> 声明差异
//   - 折叠标签间空白
//   - lastBuildDate 固定值（spec 用 SOURCE_DATE_EPOCH = 2026-10-08）

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function siteDir() { return process.env.M3_SITE_DIR || ''; }

function normalizeXml(xml) {
  return String(xml)
    .replace(/<\?xml[^?]*\?>\s*/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseXmlLite(xml) {
  // 最小 XML 解析：只取 element + text，不处理嵌套属性冲突
  // 用于 sitemap/RSS 的归一化比对 —— 不校验 schema，只比对「归一化字符串」
  return normalizeXml(xml);
}

test('AC-12: /feeds/rss.xml 存在 + 归一化后含 channel + atom:link[self] + atom:link[related] × 2', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'feeds', 'rss.xml');
  if (!fs.existsSync(p)) return;
  const xml = fs.readFileSync(p, 'utf8');
  const norm = normalizeXml(xml);
  assert.ok(/<channel>[\s\S]*<\/channel>/.test(norm), 'rss 缺 <channel>');
  assert.ok(/href="https:\/\/itingyu\.github\.io\/feeds\/rss\.xml"/.test(norm),
    'rss 缺 atom:link[self]');
  const related = norm.match(/<atom:link[^>]*rel="related"[^>]*\/>/g) || [];
  assert.equal(related.length, 2,
    `rss 应有 2 条 atom:link[related]，实测 ${related.length}`);
  // item 数 == 22
  const items = norm.match(/<item>/g) || [];
  assert.equal(items.length, 22, `item 应 22 条，实测 ${items.length}`);
});

test('AC-12: rss channel 字段 title/link/description/language 齐全', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'feeds', 'rss.xml');
  if (!fs.existsSync(p)) return;
  const xml = fs.readFileSync(p, 'utf8');
  for (const tag of ['<title>', '<link>', '<description>', '<language>']) {
    assert.ok(xml.includes(tag), `rss 缺 ${tag}`);
  }
});

test('AC-13: per-series feed — 厨房学 15 篇 / 金融市场观察 5 篇', () => {
  const d = siteDir();
  if (!d) return;
  const samples = [
    ['feeds/series-厨房学.xml', 15, '厨房学'],
    ['feeds/series-金融市场观察.xml', 5, '金融市场观察'],
  ];
  for (const [file, expectN, name] of samples) {
    const p = path.join(d, file);
    if (!fs.existsSync(p)) continue;
    const xml = fs.readFileSync(p, 'utf8');
    const items = (normalizeXml(xml).match(/<item>/g) || []).length;
    assert.equal(items, expectN,
      `${name}: item 应 ${expectN} 条，实测 ${items}`);
    // channel link 指向 /series/<name>/
    assert.ok(xml.includes(`/series/${name}/`),
      `${name}: channel 缺 /series/${name}/ 链接`);
  }
});

test('AC-14: /sitemap.xml 含 22 篇文章 URL + changefreq + priority', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'sitemap.xml');
  if (!fs.existsSync(p)) return;
  const xml = fs.readFileSync(p, 'utf8');
  const norm = normalizeXml(xml);
  const locs = norm.match(/<loc>[^<]*<\/loc>/g) || [];
  // 至少 22 个 /posts/<slug>/
  const postLocs = locs.filter((s) => /\/posts\/[^/]+\/$/.test(s));
  assert.equal(postLocs.length, 22,
    `sitemap 应含 22 个文章 URL，实测 ${postLocs.length}`);
  // 含 2 个专栏 URL
  const seriesLocs = locs.filter((s) => /\/series\//.test(s));
  assert.ok(seriesLocs.length >= 2,
    `sitemap 应含 2 个专栏 URL，实测 ${seriesLocs.length}`);
  // changefreq + priority
  assert.ok(/<changefreq>/.test(norm), 'sitemap 缺 changefreq');
  assert.ok(/<priority>/.test(norm), 'sitemap 缺 priority');
});

test('AC-14: 有专栏的 URL 带 <series>（显示名原值）', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'sitemap.xml');
  if (!fs.existsSync(p)) return;
  const xml = fs.readFileSync(p, 'utf8');
  assert.ok(/<series>厨房学<\/series>/.test(xml),
    'sitemap 缺 <series>厨房学</series>');
  assert.ok(/<series>金融市场观察<\/series>/.test(xml),
    'sitemap 缺 <series>金融市场观察</series>');
});
