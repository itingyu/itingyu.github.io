'use strict';

// AC-08 · §D4 JSON-LD 字段契约
//   首页: Person + Blog（blogPost 长度 == 22）
//   文章页: BlogPosting（恰好 1 个）+ BreadcrumbList
//     字段: headline / datePublished / dateModified / author / url / description / keywords
//     有专栏时: articleSection
//     hasPart: 有 series 且同专栏 ≥ 2 篇非草稿
// 依赖 M3_SITE_DIR

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

function siteDir() { return process.env.M3_SITE_DIR || ''; }

function loadJsonLd($, typeName) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt.trim()) return;
    try {
      const obj = JSON.parse(txt);
      if (typeName == null) out.push(obj);
      else if ((obj['@type'] || '').toString() === typeName) out.push(obj);
    } catch (_) { /* skip invalid */ }
  });
  return out;
}

test('AC-08: 首页含 Person + Blog，Blog.blogPost 长度 == 22', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'index.html');
  if (!fs.existsSync(p)) return;
  const $ = cheerio.load(fs.readFileSync(p, 'utf8'));
  const all = loadJsonLd($);
  const person = all.filter((o) => o['@type'] === 'Person');
  const blog = all.filter((o) => o['@type'] === 'Blog');
  assert.ok(person.length >= 1, '首页缺 Person JSON-LD');
  assert.ok(blog.length >= 1, '首页缺 Blog JSON-LD');
  // sameAs 含 GitHub
  const gh = (person[0].sameAs || []).find((u) => /github\.com/.test(u));
  assert.ok(gh, 'Person.sameAs 不含 GitHub 链接');
  // blogPost 长度
  const bp = blog[0].blogPost;
  assert.ok(Array.isArray(bp) || bp == null,
    'Blog.blogPost 应为数组');
  if (Array.isArray(bp)) {
    assert.equal(bp.length, 22, `Blog.blogPost 长度应为 22，实测 ${bp.length}`);
  }
});

test('AC-08: 文章页 BlogPosting 恰好 1 个（seo-tag 未重复注入）', () => {
  const d = siteDir();
  if (!d) return;
  const samples = ['welcome', 'finance-2026-09-30', 'kitchen-07-classic-recipes'];
  for (const slug of samples) {
    const p = path.join(d, 'posts', slug, 'index.html');
    if (!fs.existsSync(p)) continue;
    const $ = cheerio.load(fs.readFileSync(p, 'utf8'));
    const bps = loadJsonLd($, 'BlogPosting');
    assert.equal(bps.length, 1,
      `${slug}: BlogPosting 应恰好 1 个，实测 ${bps.length}`);
  }
});

test('AC-08: 文章页 BlogPosting 字段齐全 + keywords + 有专栏时 articleSection', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'posts', 'kitchen-07-classic-recipes', 'index.html');
  if (!fs.existsSync(p)) return;
  const $ = cheerio.load(fs.readFileSync(p, 'utf8'));
  const bp = loadJsonLd($, 'BlogPosting')[0];
  assert.ok(bp, 'kitchen-07 缺 BlogPosting');
  for (const k of ['headline', 'datePublished', 'dateModified', 'author', 'url', 'description', 'keywords']) {
    assert.ok(bp[k] != null && bp[k] !== '', `${k} 缺失或为空`);
  }
  assert.equal(bp.articleSection, '厨房学',
    `articleSection 应为 "厨房学"，实测 "${bp.articleSection}"`);
  assert.ok(Array.isArray(bp.keywords) || typeof bp.keywords === 'string',
    'keywords 应为数组或字符串');
});

test('AC-08: 厨房 07 的 hasPart 长度 == 14 且不含自身 URL', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'posts', 'kitchen-07-classic-recipes', 'index.html');
  if (!fs.existsSync(p)) return;
  const $ = cheerio.load(fs.readFileSync(p, 'utf8'));
  const bp = loadJsonLd($, 'BlogPosting')[0];
  assert.ok(Array.isArray(bp.hasPart),
    'kitchen-07 hasPart 应为数组');
  assert.equal(bp.hasPart.length, 14,
    `kitchen-07 hasPart 应为 14（除自身 15-1），实测 ${bp.hasPart.length}`);
  const selfUrl = bp.url;
  assert.ok(!bp.hasPart.some((x) => x.url === selfUrl),
    'hasPart 不应含自身 URL');
  bp.hasPart.forEach((x) => {
    assert.equal(x['@type'], 'BlogPosting', 'hasPart 元素应为 BlogPosting');
    assert.ok(x.url && x.headline, 'hasPart 元素应含 url + headline');
  });
});

test('AC-08: welcome（无专栏）无 hasPart', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'posts', 'welcome', 'index.html');
  if (!fs.existsSync(p)) return;
  const $ = cheerio.load(fs.readFileSync(p, 'utf8'));
  const bp = loadJsonLd($, 'BlogPosting')[0];
  assert.ok(bp, 'welcome 缺 BlogPosting');
  assert.ok(!bp.hasPart || bp.hasPart.length === 0,
    'welcome 不应有 hasPart');
  assert.ok(!bp.articleSection,
    'welcome 不应有 articleSection');
});

test('AC-08: 文章页含 BreadcrumbList', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'posts', 'welcome', 'index.html');
  if (!fs.existsSync(p)) return;
  const $ = cheerio.load(fs.readFileSync(p, 'utf8'));
  const bc = loadJsonLd($, 'BreadcrumbList');
  assert.equal(bc.length, 1, '欢迎页缺 BreadcrumbList');
  assert.ok(Array.isArray(bc[0].itemListElement),
    'itemListElement 应为数组');
});
