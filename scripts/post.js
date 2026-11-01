#!/usr/bin/env node
/* post.js —— 文章管理命令行：发布 / 下架 / 修改 / 查看。
 *
 * 用法：
 *   node scripts/post.js list [--column c] [--series s] [--search 关键词] [--limit N]
 *   node scripts/post.js show <slug>
 *   node scripts/post.js publish <file.md...> --column c [--series s] [--tags a,b] [--push]
 *   node scripts/post.js remove <slug...> [--push]
 *   node scripts/post.js set <slug> [--title T] [--column c] [--series s] [--tags a,b] [--date YYYY-MM-DD] [--pinned] [--push]
 *   node scripts/post.js body <slug> <file.md> [--push]      # 替换正文并重算摘要
 *
 * 所有写操作都支持 --dry-run（只预览）与 --push（校验通过后自动提交推送）。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseFrontmatter, stringifyFrontmatter, makeExcerpt } = require('./frontmatter.js');

const ROOT = path.resolve(__dirname, '..');
const POSTS = path.join(ROOT, '_posts');
const COLUMNS = new Set(['prog', 'ai', 'finance', 'life', 'misc']);

function usage(msg) {
  if (msg) process.stderr.write(`错误: ${msg}\n\n`);
  process.stderr.write(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('/*')[1].trim() + '\n');
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { _: [], dryRun: false, push: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--push') opts.push = true;
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--column') opts.column = argv[++i];
    else if (a === '--series') opts.series = argv[++i];
    else if (a === '--tags') opts.tags = argv[++i];
    else if (a === '--date') opts.date = argv[++i];
    else if (a === '--slug') opts.slug = argv[++i];
    else if (a === '--pinned') opts.pinned = true;
    else if (a === '--unpinned') opts.pinned = false;
    else if (a === '--limit') opts.limit = parseInt(argv[++i], 10);
    else if (a === '--search') opts.search = argv[++i];
    else if (a.startsWith('--')) usage(`未知参数 ${a}`);
    else opts._.push(a);
  }
  return opts;
}

// --- 仓库文章索引 -------------------------------------------------------
function loadPosts() {
  if (!fs.existsSync(POSTS)) return [];
  const out = [];
  for (const name of fs.readdirSync(POSTS).filter((f) => f.endsWith('.md'))) {
    const file = path.join(POSTS, name);
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = parseFrontmatter(raw);
    const fm = parsed.fm || {};
    out.push({
      file,
      rel: path.relative(ROOT, file),
      name,
      fm,
      body: parsed.body || '',
      slug: fm.slug || name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''),
      title: fm.title || '(无标题)',
      date: typeof fm.date === 'string' ? fm.date.slice(0, 10) : '',
      column: fm.column || '',
      series: fm.series || '',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
    });
  }
  return out;
}

function findPost(posts, key) {
  const hits = posts.filter((p) => p.slug === key || p.name === key || p.name === `${key}.md`
    || p.name.replace(/\.md$/, '') === key);
  if (hits.length === 0) {
    const near = posts.filter((p) => p.slug.includes(key) || p.title.includes(key)).slice(0, 5);
    const hint = near.length ? `\n相近的文章:\n${near.map((p) => `  ${p.slug}  ${p.title}`).join('\n')}` : '';
    throw new Error(`找不到文章 "${key}"${hint}`);
  }
  if (hits.length > 1) throw new Error(`"${key}" 匹配到多篇: ${hits.map((p) => p.slug).join(', ')}`);
  return hits[0];
}

// --- 写回 ---------------------------------------------------------------
const FIELD_ORDER = ['layout', 'slug', 'title', 'date', 'column', 'series', 'tags',
  'excerpt', 'pinned', 'cover', 'draft', 'permalink'];

function serialize(post) {
  const fm = post.fm;
  const ordered = {};
  for (const k of FIELD_ORDER) if (k in fm) ordered[k] = fm[k];
  for (const k of Object.keys(fm)) if (!(k in ordered)) ordered[k] = fm[k];
  return stringifyFrontmatter(ordered) + '\n' + String(post.body).replace(/^\s*\n/, '');
}

function writePost(post, opts, verb) {
  const text = serialize(post);
  if (opts.dryRun) {
    process.stdout.write(`\n--- 预览 ${verb}: ${post.rel} ---\n${text}\n`);
    return;
  }
  fs.writeFileSync(post.file, text);
  process.stdout.write(`${verb} ${post.rel}\n`);
}

// 写操作收尾：校验 → 提交 → 推送
function finalize(opts, message) {
  if (opts.dryRun) return;
  const { execFileSync } = require('child_process');
  const run = (cmd, args) =>
    execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT });

  try {
    run(process.execPath, [path.join(__dirname, 'validate-frontmatter.js')]);
  } catch (e) {
    process.stdout.write('\n校验未通过，已中止提交。修复后再执行。\n');
    process.exit(1);
  }
  run('git', ['add', '-A', '_posts']);
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: ROOT })
    .toString().trim().split('\n').filter(Boolean);
  if (!staged.length) {
    process.stdout.write('没有需要提交的改动。\n');
    return;
  }
  run('git', ['-c', 'user.name=itingyu', '-c', 'user.email=62842978+itingyu@users.noreply.github.com',
    'commit', '-q', '-m', message]);
  process.stdout.write(`已提交 ${staged.length} 个文件：${message}\n`);
  if (opts.push) {
    run('git', ['push', 'origin', 'master']);
    process.stdout.write('已推送到 master，Pages 会在约 1 分钟内完成部署。\n');
  } else {
    process.stdout.write('尚未推送：git push origin master\n');
  }
}

function permalinkFor(fm) {
  return `/notes/${fm.column}/${fm.series || fm.column}/${fm.slug}/`;
}

// --- 子命令 -------------------------------------------------------------
function cmdList(opts) {
  let posts = loadPosts();
  if (opts.column) posts = posts.filter((p) => p.column === opts.column);
  if (opts.series) posts = posts.filter((p) => p.series === opts.series);
  if (opts.search) {
    const q = opts.search.toLowerCase();
    posts = posts.filter((p) => (p.title + ' ' + p.tags.join(' ') + ' ' + p.body).toLowerCase().includes(q));
  }
  posts.sort((a, b) => (b.date + b.slug).localeCompare(a.date + a.slug));
  const total = posts.length;
  if (opts.limit) posts = posts.slice(0, opts.limit);
  for (const p of posts) {
    const tags = p.tags.length ? ' [' + p.tags.join(', ') + ']' : '';
    process.stdout.write(`${p.date}  ${p.slug.padEnd(46)} ${p.title}${tags}\n`);
  }
  process.stdout.write(`\n共 ${total} 篇${opts.limit ? `，显示 ${posts.length} 篇` : ''}\n`);
}

function cmdShow(opts) {
  const p = findPost(loadPosts(), opts._[0]);
  process.stdout.write(`文件: ${p.rel}\n标题: ${p.title}\nslug: ${p.slug}\n日期: ${p.date}\n`
    + `专栏: ${p.column}  子专栏: ${p.series || '-'}  标签: ${p.tags.join(', ') || '-'}\n`
    + `URL: ${p.fm.permalink || permalinkFor(p.fm)}\n\n${p.body.slice(0, 800)}\n`);
}

function cmdSet(opts) {
  const p = findPost(loadPosts(), opts._[0]);
  const fm = p.fm;
  if (opts.title !== undefined) fm.title = opts.title;
  if (opts.column !== undefined) {
    if (!COLUMNS.has(opts.column)) usage(`--column 取值必须是 ${[...COLUMNS].join('|')}`);
    fm.column = opts.column;
  }
  if (opts.series !== undefined) fm.series = opts.series || null;
  if (opts.tags !== undefined) {
    fm.tags = opts.tags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (opts.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) usage('--date 必须是 YYYY-MM-DD');
    fm.date = `${opts.date} 00:00:00 +0800`;
    // 日期变了，文件名要跟着改
    const base = `${opts.date}-${p.slug}.md`;
    const target = path.join(POSTS, base);
    if (target !== p.file) {
      if (fs.existsSync(target)) throw new Error(`目标文件已存在: ${base}`);
      if (!opts.dryRun) fs.renameSync(p.file, target);
      p.file = target;
      p.rel = path.relative(ROOT, target);
      process.stdout.write(`重命名 → ${p.rel}\n`);
    }
  }
  if (opts.pinned !== undefined) fm.pinned = opts.pinned;
  fm.permalink = permalinkFor(fm);
  writePost(p, opts, '已修改');
  finalize(opts, `post: 修改 ${fm.slug}`);
}

function cmdBody(opts) {
  const p = findPost(loadPosts(), opts._[0]);
  const file = opts._[1];
  if (!file) usage('body 需要 <slug> <file.md>');
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  const parsed = parseFrontmatter(raw);
  p.body = (parsed.fm ? parsed.body : raw).replace(/^\s*\n/, '');
  p.fm.excerpt = makeExcerpt(p.body).slice(0, 490);
  writePost(p, opts, '已替换正文');
  finalize(opts, `post: 更新正文 ${p.fm.slug}`);
}

function cmdRemove(opts) {
  const keys = opts._;
  if (!keys.length) usage('remove 需要至少一个 slug');
  const posts = loadPosts();
  const targets = keys.map((k) => findPost(posts, k));
  for (const p of targets) {
    process.stdout.write(`下架 ${p.rel}  → ${p.fm.permalink || ''} (该 URL 将失效)\n`);
    if (!opts.dryRun) fs.rmSync(p.file);
  }
  finalize(opts, `post: 下架 ${targets.map((t) => t.fm.slug).join(', ')}`);
}

function cmdPublish(opts) {
  const args = process.argv.slice(2);
  const idx = args.indexOf('publish');
  const rest = args.slice(idx + 1);
  const importArgs = ['scripts/import-md.js', ...rest];
  if (opts.dryRun) importArgs.push('--dry-run');
  if (opts.push) importArgs.push('--push');
  execFileSync(process.execPath, importArgs, { cwd: ROOT, stdio: 'inherit' });
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const opts = parseArgs(argv.slice(1));
  if (!cmd) usage('缺少子命令');
  switch (cmd) {
    case 'list': return cmdList(opts);
    case 'show': return cmdShow(opts);
    case 'set': return cmdSet(opts);
    case 'body': return cmdBody(opts);
    case 'remove': case 'unpublish': case 'rm': return cmdRemove(opts);
    case 'publish': case 'new': return cmdPublish(opts);
    default: usage(`未知子命令 "${cmd}"`);
  }
}

if (require.main === module) main();

module.exports = { parseArgs, loadPosts, findPost, permalinkFor };
