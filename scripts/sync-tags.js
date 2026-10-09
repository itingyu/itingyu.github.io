#!/usr/bin/env node
/* sync-tags.js
 *
 * 幂等生成 _tags/<slug>.md:
 *   1. 扫描 _posts/*.md 的 tags: → 按 slug 计数
 *   2. 对 篇数 >= 3 且 _tags/<slug>.md 不存在 的 tag,生成:
 *        ---
 *        layout: tag
 *        title: <slug>
 *        tag: <slug>
 *        ---
 *   3. 已存在页面不覆盖(保留 human-curated 的 title 显示名)
 *
 * 用法:
 *   node scripts/sync-tags.js                     # 默认按 ROOT 走
 *   node scripts/sync-tags.js --root <dir>        # 指定仓库根
 *   node scripts/sync-tags.js --threshold <N>     # 自定义计数阈值,默认 3
 *
 * 退出码: 0 = 成功(包括无新增场景),非 0 = 致命错误。
 *
 * 设计契约:design.md §5.3 / §D11。
 * 本工具属于源文件维护工具(同 new-post.sh / publish.sh),产物提交进 git;
 * 不是 Pages build 步骤,GitHub Pages 不跑任何脚本。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// === CLI 解析 ============================================================
function parseArgs(argv) {
  const args = { root: null, threshold: 3 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = argv[++i];
    else if (a === '--threshold') args.threshold = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        '用法: node scripts/sync-tags.js [--root <dir>] [--threshold <N>]\n'
      );
      process.exit(0);
    } else {
      process.stderr.write(`sync-tags: 未知参数 ${a}\n`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.threshold) || args.threshold < 1) {
    process.stderr.write('sync-tags: --threshold 必须是 ≥ 1 的整数\n');
    process.exit(2);
  }
  return args;
}

// === front matter 解析(仅读 tags: 字段) =================================
function parseTags(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const m = text.match(/^\uFEFF?\s*---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return [];
  const raw = m[1];
  const lines = raw.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const km = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!km) { i++; continue; }
    const k = km[1];
    if (k !== 'tags') {
      i++;
      continue;
    }
    let v = km[2].trim();
    if (v === '') {
      // 多行 list
      i++;
      while (i < lines.length) {
        const lm = lines[i].match(/^\s*-\s*(.*)$/);
        if (lm) {
          out.push(unquote(lm[1].trim()));
          i++;
        } else break;
      }
    } else if (v.startsWith('[') && v.endsWith(']')) {
      const items = v
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      out.push(...items);
      i++;
    } else {
      out.push(unquote(v));
      i++;
    }
  }
  return out;
}
function unquote(s) {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

// === 主流程 ==============================================================
function syncTags({ root, threshold }) {
  const POSTS_DIR = path.join(root, '_posts');
  const TAGS_DIR = path.join(root, '_tags');

  if (!fs.existsSync(POSTS_DIR)) {
    throw new Error(`_posts 目录不存在: ${POSTS_DIR}`);
  }
  fs.mkdirSync(TAGS_DIR, { recursive: true });

  // 1. 计数
  const counts = Object.create(null);
  let scannedFiles = 0;
  const posts = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
  for (const f of posts) {
    scannedFiles++;
    const tags = parseTags(path.join(POSTS_DIR, f));
    for (const t of tags) {
      if (!t) continue;
      counts[t] = (counts[t] || 0) + 1;
    }
  }

  // 2. 现有 _tags/*.md 集合(已存在的不覆盖)
  const existing = new Set(
    fs.readdirSync(TAGS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
  );

  // 3. 生成缺的
  const created = [];
  const skippedExisting = [];
  const belowThreshold = [];
  const eligible = Object.entries(counts).filter(([_, n]) => n >= threshold);

  // 排序确保输出稳定(便于测试 + 幂等)
  eligible.sort(([a], [b]) => a.localeCompare(b));

  for (const [slug, n] of eligible) {
    if (existing.has(slug)) {
      skippedExisting.push({ slug, n });
      continue;
    }
    const filePath = path.join(TAGS_DIR, `${slug}.md`);
    const content =
      `---\nlayout: tag\ntitle: ${slug}\ntag: ${slug}\n---\n`;
    fs.writeFileSync(filePath, content, 'utf8');
    created.push({ slug, n, filePath });
  }

  for (const [slug, n] of Object.entries(counts)) {
    if (n < threshold && !skippedExisting.find((e) => e.slug === slug) && !created.find((c) => c.slug === slug)) {
      belowThreshold.push({ slug, n });
    }
  }
  belowThreshold.sort((a, b) => b.n - a.n);

  return {
    scannedFiles,
    uniqueTags: Object.keys(counts).length,
    threshold,
    created,
    skippedExisting,
    belowThreshold,
  };
}

function report(r) {
  process.stdout.write(
    `sync-tags: 扫描 ${r.scannedFiles} 个 _posts/*.md,共 ${r.uniqueTags} 个不同 tag\n`
  );
  process.stdout.write(
    `sync-tags: 阈值 ${r.threshold} 篇以上 → 新建 ${r.created.length} 个,跳过已存在 ${r.skippedExisting.length} 个\n`
  );
  if (r.created.length > 0) {
    process.stdout.write('  + 新建:\n');
    for (const c of r.created) {
      process.stdout.write(`    ${c.slug}.md  (${c.n} 篇)\n`);
    }
  }
  if (r.skippedExisting.length > 0) {
    process.stdout.write('  ~ 已存在(未覆盖):\n');
    for (const s of r.skippedExisting) {
      process.stdout.write(`    ${s.slug}.md  (${s.n} 篇)\n`);
    }
  }
  if (r.belowThreshold.length > 0) {
    process.stdout.write(`  . 低于阈值(${r.threshold} 篇): ${r.belowThreshold.length} 个,不生成\n`);
  }
}

// === 入口 ================================================================
if (require.main === module) {
  const args = parseArgs(process.argv);
  const root = args.root ? path.resolve(args.root) : path.resolve(__dirname, '..');
  try {
    const r = syncTags({ root, threshold: args.threshold });
    report(r);
    process.exit(0);
  } catch (e) {
    process.stderr.write(`sync-tags: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { syncTags, parseTags };
