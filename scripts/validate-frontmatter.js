#!/usr/bin/env node
/* validate-frontmatter.js
 *
 * 校验 _posts/*.md 的 front matter 是否合规(契约级,design.md §5.1 / §5.7)。
 *
 * 检查项:
 *   必填:
 *     - layout(若存在,默认 post 由 Jekyll 兜底;非空)
 *     - title: string,单行,禁换行
 *     - date: YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS +ZZZZ
 *     - tags: 数组,非空,无重复,每个元素必须在 _tags/<slug>.md 集合内(缺则 ERROR)
 *     - excerpt: string,≤ 500 字,禁换行
 *   可选:
 *     - pinned: 仅 true/false
 *     - cover: null / /assets/... / https://...
 *     - draft: 仅 true/false(且 _posts/ 不应出现 draft: true)
 *     - series: 必须是 _series/<file>.md 的 title 集合里的一员(缺则 WARN)
 *
 * 用法:
 *   node scripts/validate-frontmatter.js [--slug <name>] [--root <dir>]
 *
 * 退出码: error > 0 = 1;warning 不挂。0 = 全绿。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// === 正则 ================================================================
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2} [+-]\d{4})?$/;
const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
// 设计 §5.7: slug = ^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// tag slug = ^[a-z0-9](?:[a-z0-9-]{0,30})$
const TAG_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30})$/;
// cover: null 或 /assets/... 或 https?://...
const COVER_RE = /^(\/assets\/|https?:\/\/)/;
// 标题含换行 = 非法
const TITLE_NEWLINE_RE = /[\r\n]/;

// === 解析 front matter ==================================================
function parseFrontmatter(md) {
  const m = md.match(/^\uFEFF?\s*---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { fm: null, body: md, raw: '', frontmatterError: '缺少 front matter `---` 包裹' };
  const raw = m[1];
  const body = m[2];
  const fm = Object.create(null);
  const errors = [];
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const km = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!km) { i++; continue; }
    const k = km[1];
    let v = km[2];
    if (v === '') {
      // 多行 list
      const items = [];
      i++;
      while (i < lines.length) {
        const lm = lines[i].match(/^\s*-\s*(.*)$/);
        if (lm) {
          items.push(unquote(lm[1].trim()));
          i++;
        } else break;
      }
      fm[k] = items;
    } else if (v.trim().startsWith('[') && v.trim().endsWith(']')) {
      v = v.trim();
      fm[k] = v
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      i++;
    } else {
      const trimmed = v.trim();
      if (trimmed === 'true') fm[k] = true;
      else if (trimmed === 'false') fm[k] = false;
      else if (trimmed === 'null' || trimmed === '~') fm[k] = null;
      else fm[k] = unquote(trimmed);
      i++;
    }
  }
  return { fm, body, raw, frontmatterError: errors.join('|') };
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

// === 加载 _tags/_series 词表 ===========================================
function loadTagVocabulary(root) {
  const TAGS_DIR = path.join(root, '_tags');
  const out = new Set();
  if (!fs.existsSync(TAGS_DIR)) return out;
  for (const f of fs.readdirSync(TAGS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const slug = f.replace(/\.md$/, '');
    out.add(slug);
  }
  return out;
}
function loadSeriesVocabulary(root) {
  const SERIES_DIR = path.join(root, '_series');
  const titles = new Set();
  const slugs = new Set();
  if (!fs.existsSync(SERIES_DIR)) return { titles, slugs };
  for (const f of fs.readdirSync(SERIES_DIR)) {
    if (!f.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(SERIES_DIR, f), 'utf8');
    const p = parseFrontmatter(text);
    if (p.fm && p.fm.title) titles.add(p.fm.title);
    slugs.add(f.replace(/\.md$/, ''));
  }
  return { titles, slugs };
}

// === 校验 ================================================================
function validateOne({ slug, root, tagVocabulary, seriesTitles }) {
  const file = path.join(root, '_posts', `${slug}.md`);
  if (!fs.existsSync(file)) {
    return { slug, file, errors: [`文件不存在: ${file}`], warnings: [] };
  }
  const text = fs.readFileSync(file, 'utf8');
  const { fm, frontmatterError } = parseFrontmatter(text);
  const errors = [];
  const warnings = [];

  if (frontmatterError) {
    errors.push(frontmatterError);
  }
  if (!fm) return { slug, file, errors, warnings };

  // layout(可选;若存在则必须非空字符串)
  if (fm.layout !== undefined) {
    if (typeof fm.layout !== 'string' || fm.layout.length === 0) {
      errors.push(`layout 必须是字符串`);
    }
  }

  // title:必填,string,单行
  if (fm.title === undefined || fm.title === null) {
    errors.push('缺少必填字段: title');
  } else if (typeof fm.title !== 'string') {
    errors.push(`title 必须是字符串(实际 ${typeof fm.title})`);
  } else if (TITLE_NEWLINE_RE.test(fm.title)) {
    errors.push('title 含换行,违反 §5.7 单行约束');
  }

  // date:必填,ISO
  if (fm.date === undefined || fm.date === null) {
    errors.push('缺少必填字段: date');
  } else if (typeof fm.date !== 'string' || !ISO_DATE_RE.test(fm.date)) {
    errors.push(`date 不是 ISO 格式(YYYY-MM-DD 或带时间): "${fm.date}"`);
  }

  // tags:必填,数组,非空,无重复,**每个 slug 必须有 _tags/<slug>.md**
  if (fm.tags === undefined || fm.tags === null) {
    errors.push('缺少必填字段: tags');
  } else if (!Array.isArray(fm.tags)) {
    errors.push(`tags 必须是数组(实际 ${typeof fm.tags})`);
  } else {
    if (fm.tags.length === 0) {
      warnings.push('tags 数组为空(§5.1 必填且非空)');
    }
    // 重复
    const seen = new Set();
    for (const t of fm.tags) {
      if (seen.has(t)) errors.push(`tags 含重复元素: "${t}"`);
      seen.add(t);
    }
    // 词表
    for (const t of fm.tags) {
      if (!tagVocabulary.has(t)) {
        errors.push(`tag "${t}" 没有对应 _tags/${t}.md 页面(§5.1 tag 词表)`);
      }
    }
  }

  // excerpt:必填,≤500,禁换行(空串视为合法但不推荐 → warning)
  if (fm.excerpt === undefined || fm.excerpt === null) {
    errors.push('缺少必填字段: excerpt');
  } else if (typeof fm.excerpt !== 'string') {
    errors.push(`excerpt 必须是字符串(实际 ${typeof fm.excerpt})`);
  } else {
    if (TITLE_NEWLINE_RE.test(fm.excerpt)) {
      errors.push('excerpt 含换行,违反 §5.7');
    }
    if (fm.excerpt.length === 0) {
      warnings.push('excerpt 为空串(§5.7 非空约束)');
    }
    if (fm.excerpt.length > 500) {
      errors.push(`excerpt 长度 ${fm.excerpt.length} 超过 500 字上限`);
    }
  }

  // pinned:可选 bool
  if (fm.pinned !== undefined && fm.pinned !== null && typeof fm.pinned !== 'boolean') {
    errors.push(`pinned 仅 true/false(实际 ${typeof fm.pinned}="${fm.pinned}")`);
  }

  // draft:可选 bool;_posts/ 中出现 draft: true 是 §D6 草稿泄漏,直接 ERROR
  if (fm.draft !== undefined && fm.draft !== null && typeof fm.draft !== 'boolean') {
    errors.push(`draft 仅 true/false(实际 ${typeof fm.draft}="${fm.draft}")`);
  }
  if (fm.draft === true) {
    errors.push('draft: true 出现在 _posts/(应放到 _drafts/,§D6)');
  }

  // cover:null / /assets/... / https?://...
  if (fm.cover !== undefined && fm.cover !== null) {
    if (typeof fm.cover !== 'string') {
      errors.push(`cover 必须是字符串或 null(实际 ${typeof fm.cover})`);
    } else if (!COVER_RE.test(fm.cover)) {
      errors.push(`cover 必须是 /assets/... 或 https?://...(实际 "${fm.cover}")`);
    }
  }

  // series:可选,必须在 _series title 集合里
  if (fm.series !== undefined && fm.series !== null) {
    if (typeof fm.series !== 'string') {
      errors.push(`series 必须是字符串或 null`);
    } else if (!seriesTitles.has(fm.series)) {
      warnings.push(`series "${fm.series}" 不在 _series/*.md 的 title 集合内`);
    }
  }

  return { slug, file, errors, warnings };
}

// === CLI ================================================================
function parseArgs(argv) {
  const args = { slug: null, root: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slug') args.slug = argv[++i];
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        '用法: node scripts/validate-frontmatter.js [--slug <name>] [--root <dir>]\n'
      );
      process.exit(0);
    } else if (a.startsWith('--')) {
      process.stderr.write(`validate-frontmatter: 未知参数 ${a}\n`);
      process.exit(2);
    } else if (!args.slug) {
      // 兼容旧用法:第一个位置参数视为 slug(单文件模式)
      args.slug = a;
    } else {
      process.stderr.write(`validate-frontmatter: 多余参数 ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const root = args.root ? path.resolve(args.root) : path.resolve(__dirname, '..');
  const POSTS_DIR = path.join(root, '_posts');
  if (!fs.existsSync(POSTS_DIR)) {
    process.stderr.write(`validate-frontmatter: _posts/ 目录不存在: ${POSTS_DIR}\n`);
    process.exit(1);
  }

  const tagVocabulary = loadTagVocabulary(root);
  const { titles: seriesTitles } = loadSeriesVocabulary(root);

  let slugs;
  if (args.slug) {
    slugs = [args.slug];
  } else {
    slugs = fs.readdirSync(POSTS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''));
  }

  if (slugs.length === 0) {
    process.stdout.write('validate-frontmatter: 没有要校验的 post。\n');
    process.exit(0);
  }

  const results = slugs.map((slug) =>
    validateOne({ slug, root, tagVocabulary, seriesTitles })
  );

  let totalErrors = 0;
  let totalWarnings = 0;
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
  process.stdout.write(
    `\n${results.length} 个 post, ${totalErrors} 个 error, ${totalWarnings} 个 warning\n`
  );
  process.stdout.write(
    `(tag 词表大小: ${tagVocabulary.size}, series 词表大小: ${seriesTitles.size})\n`
  );
  process.exit(totalErrors > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { validateOne, parseFrontmatter, loadTagVocabulary, loadSeriesVocabulary };
