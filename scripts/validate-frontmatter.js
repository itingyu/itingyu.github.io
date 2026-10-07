#!/usr/bin/env node
/* validate-frontmatter.js
 *
 * 校验 posts/<slug>/index.html 中的 frontmatter(meta tags + JSON-LD)是否完整 / 合规。
 *
 * 必填字段:
 *   <title>...</title>                      文章标题
 *   <meta name="description" content="..."> 描述
 *   <meta property="article:published_time" content="YYYY-MM-DD"> 发布日期
 *   <meta property="article:author" content="..."> 作者
 *
 * 推荐(缺失则 warning):
 *   <meta property="og:title" content="...">
 *   <meta property="og:description" content="...">
 *   <meta property="article:tag" content="...">(至少 1 个)
 *   <meta property="article:section" content="...">(专栏)
 *   <meta name="series:description" content="...">(专栏描述)
 *   <script type="application/ld+json"> BlogPosting JSON-LD
 *
 * 用法:
 *   node scripts/validate-frontmatter.js              # 校验 posts/ 下所有 index.html
 *   node scripts/validate-frontmatter.js <slug>...     # 只校验指定 slug
 *
 * 退出码: 0 = 全绿,1 = 有错误。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'posts');

const REQUIRED_META = [
  { name: 'title',         re: /<title>([\s\S]*?)<\/title>/i,                   label: '<title>' },
  { name: 'description',   re: /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i, label: '<meta name="description">' },
  { name: 'published_time', re: /<meta\s+property=["']article:published_time["']\s+content=["']([^"']*)["']/i, label: '<meta property="article:published_time">' },
  { name: 'author',        re: /<meta\s+property=["']article:author["']\s+content=["']([^"']*)["']/i, label: '<meta property="article:author">' },
];

const RECOMMENDED_META = [
  { name: 'og_title',       re: /<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i,         label: '<meta property="og:title">' },
  { name: 'og_description', re: /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i,   label: '<meta property="og:description">' },
  { name: 'section',        re: /<meta\s+property=["']article:section["']\s+content=["']([^"']*)["']/i,  label: '<meta property="article:section">' },
  { name: 'series_desc',    re: /<meta\s+name=["']series:description["']\s+content=["']([^"']*)["']/i,    label: '<meta name="series:description">' },
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const TAG_RE = /<meta\s+property=["']article:tag["']\s+content=["']([^"']*)["']/gi;

function validateOne(slug) {
  const file = path.join(POSTS_DIR, slug, 'index.html');
  if (!fs.existsSync(file)) {
    return { slug, file, errors: [`文件不存在: ${file}`], warnings: [] };
  }
  const html = fs.readFileSync(file, 'utf8');
  const errors = [];
  const warnings = [];

  for (const { name, re, label } of REQUIRED_META) {
    if (!re.test(html)) errors.push(`缺少必填字段: ${label}`);
  }
  for (const { name, re, label } of RECOMMENDED_META) {
    if (!re.test(html)) warnings.push(`缺少推荐字段: ${label}`);
  }

  // ISO date 校验
  const dateMatch = html.match(/<meta\s+property=["']article:published_time["']\s+content=["']([^"']*)["']/i);
  if (dateMatch && !ISO_DATE_RE.test(dateMatch[1])) {
    errors.push(`发布日期不是 ISO 格式: "${dateMatch[1]}"`);
  }

  // 至少 1 个 tag
  let tagMatch;
  let tagCount = 0;
  TAG_RE.lastIndex = 0;
  while ((tagMatch = TAG_RE.exec(html)) !== null) tagCount++;
  if (tagCount === 0) warnings.push('没有任何 <meta property="article:tag">');

  // JSON-LD BlogPosting
  const jsonldBlocks = html.match(/<script\s+type=["']application\/ld\+json["'][\s\S]*?<\/script>/gi) || [];
  let foundBlogPosting = false;
  for (const block of jsonldBlocks) {
    try {
      const inner = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      const obj = JSON.parse(inner);
      if (obj && obj['@type'] === 'BlogPosting') {
        foundBlogPosting = true;
        if (!obj.headline) errors.push('BlogPosting JSON-LD 缺少 headline');
        if (!obj.datePublished) errors.push('BlogPosting JSON-LD 缺少 datePublished');
        if (!obj.description) warnings.push('BlogPosting JSON-LD 缺少 description');
        break;
      }
    } catch (_) {
      errors.push('BlogPosting JSON-LD 解析失败');
    }
  }
  if (!foundBlogPosting) warnings.push('没有 BlogPosting JSON-LD');

  return { slug, file, errors, warnings };
}

function main() {
  const argv = process.argv.slice(2);
  let slugs;
  if (argv.length > 0) {
    slugs = argv;
  } else {
    if (!fs.existsSync(POSTS_DIR)) {
      process.stderr.write(`validate-frontmatter: posts/ 目录不存在\n`);
      process.exit(1);
    }
    slugs = fs.readdirSync(POSTS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }

  if (slugs.length === 0) {
    process.stdout.write('validate-frontmatter: 没有要校验的 post。\n');
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  const results = [];
  for (const slug of slugs) {
    results.push(validateOne(slug));
  }

  for (const r of results) {
    if (r.errors.length === 0 && r.warnings.length === 0) {
      process.stdout.write(`✔ ${r.slug}\n`);
    } else {
      for (const e of r.errors) {
        process.stdout.write(`✖ ${r.slug}: ${e}\n`);
        totalErrors++;
      }
      for (const w of r.warnings) {
        process.stdout.write(`⚠ ${r.slug}: ${w}\n`);
        totalWarnings++;
      }
    }
  }

  process.stdout.write(`\n${results.length} 个 post, ${totalErrors} 个 error, ${totalWarnings} 个 warning\n`);
  if (totalErrors > 0) process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { validateOne };
