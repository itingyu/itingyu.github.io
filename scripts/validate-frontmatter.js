#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, 'posts');
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9-]+$/;
const TRUTHY = new Set(['true', 'false']);

function parseHTMLFrontmatter(html) {
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  const dateM = html.match(/<meta\s+property=["']article:published_time["']\s+content=["']([^"']*)["']/i);
  const tagM = [...html.matchAll(/<meta\s+property=["']article:tag["']\s+content=["']([^"']*)["']/gi)].map(m => m[1]);
  const chipM = [...html.matchAll(/data-tag=["']([^"']+)["']/g)].map(m => m[1]);
  const coverM = html.match(/<meta\s+name=["']cover["']\s+content=["']([^"']*)["']/i);
  const seriesM = html.match(/<meta\s+name=["']series["']\s+content=["']([^"']*)["']/i);
  const draftM = html.match(/<meta\s+name=["']draft["']\s+content=["']([^"']*)["']/i);
  const pinnedM = html.match(/<meta\s+name=["']pinned["']\s+content=["']([^"']*)["']/i);
  return { title: title.trim(), date: dateM && dateM[1].trim(), tags: tagM, chipSlugs: chipM, cover: coverM && coverM[1].trim(), series: seriesM && seriesM[1].trim(), draft: draftM && draftM[1].trim(), pinned: pinnedM && pinnedM[1].trim() };
}

function parseYAMLFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = { tags: [], cover: null, series: null, draft: null, pinned: null };
  const lines = m[1].split('\n');
  for (const ln of lines) {
    const kv = ln.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const k = kv[1], v = kv[2].trim();
    if (k === 'title') out.title = v.replace(/^["']|["']$/g, '');
    else if (k === 'date') out.date = v.replace(/^["']|["']$/g, '');
    else if (k === 'tags') {
      const arr = v.match(/^\[(.*)\]$/);
      out.tags = arr ? arr[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [v];
    } else if (k === 'cover') out.cover = v.replace(/^["']|["']$/g, '');
    else if (k === 'series') out.series = v.replace(/^["']|["']$/g, '');
    else if (k === 'draft') out.draft = v.replace(/^["']|["']$/g, '');
    else if (k === 'pinned') out.pinned = v.replace(/^["']|["']$/g, '');
  }
  return out;
}

function validate(fm, slug, postsRoot) {
  const errs = [];
  if (!fm.title || !fm.title.trim()) errs.push('missing or empty title');
  if (!fm.date) errs.push('missing date');
  else if (!ISO_DATE_RE.test(fm.date)) errs.push(`date not YYYY-MM-DD: "${fm.date}"`);
  if (fm.tags && !Array.isArray(fm.tags)) errs.push(`tags must be array, got ${typeof fm.tags}`);
  if (Array.isArray(fm.chipSlugs)) for (const s of fm.chipSlugs) if (!SLUG_RE.test(s)) errs.push(`tag slug not [a-z0-9-]+: "${s}"`);
  if (fm.series != null && fm.series !== '' && !SLUG_RE.test(fm.series)) errs.push(`series not slug: "${fm.series}"`);
  if (fm.draft != null && !TRUTHY.has(fm.draft)) errs.push(`draft not bool: "${fm.draft}"`);
  if (fm.pinned != null && !TRUTHY.has(fm.pinned)) errs.push(`pinned not bool: "${fm.pinned}"`);
  if (fm.cover) {
    const p = path.isAbsolute(fm.cover) ? fm.cover : path.join(postsRoot, slug, fm.cover);
    if (!fs.existsSync(p)) errs.push(`cover not found: posts/${slug}/${fm.cover}`);
  }
  return errs;
}

function main() {
  if (!fs.existsSync(POSTS_DIR)) { process.stdout.write('no posts/ dir, nothing to validate\n'); return 0; }
  const allErrs = [];
  for (const entry of fs.readdirSync(POSTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const htmlFile = path.join(POSTS_DIR, slug, 'index.html');
    if (fs.existsSync(htmlFile)) {
      const fm = parseHTMLFrontmatter(fs.readFileSync(htmlFile, 'utf8'));
      const errs = validate(fm, slug, POSTS_DIR);
      if (errs.length) allErrs.push({ src: `posts/${slug}/index.html`, errs });
    }
    const mdFile = path.join(POSTS_DIR, slug, 'source.md');
    if (fs.existsSync(mdFile)) {
      const fm = parseYAMLFrontmatter(fs.readFileSync(mdFile, 'utf8'));
      if (!fm) allErrs.push({ src: `posts/${slug}/source.md`, errs: ['missing YAML front matter (--- delimiters)'] });
      else {
        const errs = validate({ ...fm, chipSlugs: fm.tags }, slug, POSTS_DIR);
        if (errs.length) allErrs.push({ src: `posts/${slug}/source.md`, errs });
      }
    }
  }
  if (!allErrs.length) { process.stdout.write(`validate-frontmatter: all ${fs.readdirSync(POSTS_DIR).filter(e => fs.statSync(path.join(POSTS_DIR, e)).isDirectory()).length} posts OK\n`); return 0; }
  process.stderr.write(`validate-frontmatter: ${allErrs.length} error(s)\n`);
  for (const { src, errs } of allErrs) for (const e of errs) process.stderr.write(`  ${src}: ${e}\n`);
  return 1;
}

if (require.main === module) process.exit(main());
module.exports = { parseHTMLFrontmatter, parseYAMLFrontmatter, validate };