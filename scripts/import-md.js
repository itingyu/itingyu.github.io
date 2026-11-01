#!/usr/bin/env node
/* import-md.js —— 把任意 Markdown 文件变成一篇可渲染的博客文章。
 *
 * 用法:
 *   node scripts/import-md.js <file.md|目录> [...] [选项]
 *
 * 选项:
 *   --column <prog|finance|ai|life|misc>  必填(或从 front matter / 目录名推断)
 *   --series <slug>      专栏,须对应 _series/<slug>.md
 *   --tags a,b           覆盖标签,默认沿用原 front matter,否则用 column 名
 *   --title "..."        覆盖标题,默认取 # H1 或文件名
 *   --date YYYY-MM-DD    默认今天
 *   --slug <slug>        默认由文件名自动生成
 *   --dry-run            只打印将要写入的内容,不落盘
 *   --force              允许覆盖同名文章
 *   --push               校验全绿后 git commit + push
 *
 * 做什么:
 *   1. 补全 front matter(title/date/tags/excerpt/permalink 等)
 *   2. 落到 _posts/<date>-<slug>.md
 *   3. 跑 validate-frontmatter.js 严格校验,不通过则回滚本次写入
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseFrontmatter, stringifyFrontmatter, slugify, makeExcerpt, firstHeading,
} = require('./frontmatter');

const ROOT = path.resolve(__dirname, '..');
const POSTS = path.join(ROOT, '_posts');
const SERIES = path.join(ROOT, '_series');
const COLUMNS = new Set(['prog', 'finance', 'ai', 'life', 'misc']);

function usage(msg) {
  if (msg) process.stderr.write(`错误: ${msg}\n\n`);
  process.stderr.write(
    '用法: node scripts/import-md.js <file.md|目录> [...] --column <prog|finance|ai|life|misc>\n' +
    '      [--series <slug>] [--tags a,b] [--title "..."] [--date YYYY-MM-DD]\n' +
    '      [--slug xxx] [--dry-run] [--force] [--push]\n'
  );
  process.exit(msg ? 1 : 0);
}

function parseArgs(argv) {
  const o = { files: [], dryRun: false, force: false, push: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--column': o.column = argv[++i]; break;
      case '--series': o.series = argv[++i]; break;
      case '--tags': o.tags = argv[++i]; break;
      case '--title': o.title = argv[++i]; break;
      case '--date': o.date = argv[++i]; break;
      case '--slug': o.slug = argv[++i]; break;
      case '--dry-run': o.dryRun = true; break;
      case '--force': o.force = true; break;
      case '--push': o.push = true; break;
      case '-h': case '--help': usage(); break;
      default:
        if (a.startsWith('-')) usage(`未知参数 ${a}`);
        o.files.push(a);
    }
  }
  return o;
}

function collect(files) {
  const out = [];
  for (const f of files) {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) { process.stderr.write(`跳过(不存在): ${f}\n`); continue; }
    if (fs.statSync(abs).isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) {
        if (!/\.(md|markdown)$/i.test(name)) continue;
        if (/^readme\.md$/i.test(name)) continue;
        out.push(path.join(abs, name));
      }
    } else out.push(abs);
  }
  return out;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function inferColumn(file, fm, opts) {
  if (opts.column) return opts.column;
  if (fm.column && COLUMNS.has(fm.column)) return fm.column;
  // 从路径里找 /notes/<column>/ 或目录名等于 column
  const seg = file.split(path.sep);
  for (const s of seg) if (COLUMNS.has(s)) return s;
  return null;
}

function build(file, opts) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = parseFrontmatter(raw);
  const fm = parsed.fm || {};
  const body = (parsed.fm ? parsed.body : raw).replace(/^\s*\n/, '');

  const column = inferColumn(file, fm, opts);
  if (!column || !COLUMNS.has(column)) {
    throw new Error(`${path.basename(file)}: 无法确定 column，请用 --column 指定 (${[...COLUMNS].join('|')})`);
  }

  const series = opts.series !== undefined ? opts.series : (fm.series || '');
  if (series && !fs.existsSync(path.join(SERIES, `${series}.md`))) {
    process.stderr.write(`警告: series "${series}" 没有 _series/${series}.md，仍按输入写入\n`);
  }

  let tags = opts.tags
    ? opts.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : (Array.isArray(fm.tags) ? fm.tags : []);
  if (tags.length === 0) tags = [column];

  const title = (opts.title || fm.title || firstHeading(body) ||
    path.basename(file).replace(/\.(md|markdown)$/i, '')).replace(/[\r\n]+/g, ' ').trim();

  const date = opts.date || (typeof fm.date === 'string' ? fm.date.slice(0, 10) : '') || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${path.basename(file)}: --date 必须是 YYYY-MM-DD`);

  const slug = opts.slug || fm.slug || slugify(path.basename(file));
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
    throw new Error(`${path.basename(file)}: slug "${slug}" 不合法(只允许 a-z0-9-)，用 --slug 指定`);
  }

  let excerpt = (typeof fm.excerpt === 'string' && fm.excerpt.trim())
    ? fm.excerpt.trim()
    : (typeof fm.description === 'string' && fm.description.trim() ? fm.description.trim() : '');
  if (!excerpt) excerpt = makeExcerpt(body);
  excerpt = excerpt.replace(/[\r\n]+/g, ' ').slice(0, 490);

  const out = {
    layout: 'post',
    slug,
    title,
    date: `${date} 00:00:00 +0800`,
    column,
    series: series || null,
    tags,
    excerpt,
    pinned: fm.pinned === true,
    cover: fm.cover || null,
    draft: false,
    permalink: fm.permalink || `/notes/${column}/${series || column}/${slug}/`,
  };
  const text = stringifyFrontmatter(out) + '\n' + body.trimStart();
  const target = path.join(POSTS, `${date}-${slug}.md`);
  return { target, text, slug: `${date}-${slug}`, meta: out };
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.files.length === 0) usage('缺少输入文件');
  if (opts.column && !COLUMNS.has(opts.column)) usage(`--column 取值必须是 ${[...COLUMNS].join('|')}`);

  const files = collect(opts.files);
  if (files.length === 0) usage('没有找到可导入的 .md 文件');

  const results = [];
  for (const f of files) {
    try {
      const r = build(f, opts);
      if (fs.existsSync(r.target) && !opts.force) {
        process.stderr.write(`跳过(已存在): ${path.relative(ROOT, r.target)}\n`);
        continue;
      }
      if (opts.dryRun) {
        process.stdout.write(`\n=== ${path.basename(f)} → ${path.relative(ROOT, r.target)} ===\n${r.text}\n`);
        continue;
      }
      fs.mkdirSync(POSTS, { recursive: true });
      fs.writeFileSync(r.target, r.text);
      results.push(r);
      process.stdout.write(`写入 ${path.relative(ROOT, r.target)}  (column=${r.meta.column} series=${r.meta.series || '-'} tags=${r.meta.tags.join('/')})\n`);
    } catch (e) {
      process.stderr.write(`失败: ${e.message}\n`);
    }
  }

  if (opts.dryRun || results.length === 0) return;

  // 严格校验新写入的文章
  let failed = [];
  for (const r of results) {
    try {
      execFileSync(process.execPath,
        [path.join(__dirname, 'validate-frontmatter.js'), '--slug', r.slug],
        { cwd: ROOT, stdio: 'inherit' });
    } catch {
      failed.push(r);
    }
  }
  if (failed.length) {
    for (const r of failed) fs.rmSync(r.target, { force: true });
    process.stderr.write(`\n校验未通过，已回滚 ${failed.length} 个文件。修正后重试。\n`);
    process.exit(1);
  }

  if (opts.push) {
    const list = results.map((r) => path.relative(ROOT, r.target));
    execFileSync('git', ['add', ...list], { cwd: ROOT, stdio: 'inherit' });
    const msg = results.length === 1
      ? `post: ${results[0].meta.title}`
      : `post: 批量导入 ${results.length} 篇`;
    execFileSync('git', ['commit', '-m', msg], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('git', ['push', 'origin', 'master'], { cwd: ROOT, stdio: 'inherit' });
    process.stdout.write(`已推送 ${results.length} 篇，GitHub Pages 通常 60s 内构建完成。\n`);
  } else {
    process.stdout.write(`\n完成 ${results.length} 篇。推送: git push origin master（或下次加 --push）\n`);
  }
}

main();
