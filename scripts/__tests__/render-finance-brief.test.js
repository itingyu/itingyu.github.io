'use strict';

/*
 * scripts/__tests__/render-finance-brief.test.js
 *
 * AIWORK1-51 · M6.4 — 验证 scripts/render-finance-brief.js 改产 .md 的契约:
 *
 *   1. 删除 renderPage / updatePostsIndex / updateArchiveIndex(装配归 build-index)
 *   2. module.exports 仅有 { renderMarkdown, parseArgs }
 *   3. renderMarkdown(briefJson) 复用 scripts/markdown.js 同源(拒绝 <script>/<style>)
 *   4. --help 输出提示文件后缀为 .md
 *   5. 输出结构:posts/<slug>/index.md 头部 YAML + MD body + 两个 marker
 *   6. **不再写** index.html 到 finance 简报路径
 *
 * 通过 node:test 跑(node ≥ 18 内置)。零依赖。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const rb = require('../render-finance-brief.js');
const { renderMarkdown, parseArgs } = rb;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'render-finance-brief.js');

// ============================================================================
// § 1. Public surface — 只导出 { renderMarkdown, parseArgs }
// ============================================================================

test('exports: only renderMarkdown + parseArgs (no renderPage / updatePostsIndex / updateArchiveIndex)', () => {
  const keys = Object.keys(rb).sort();
  assert.deepEqual(keys, ['parseArgs', 'renderMarkdown'].sort(),
    `exports must be exactly {renderMarkdown, parseArgs}, got ${JSON.stringify(keys)}`);
});

test('exports: renderMarkdown is a function', () => {
  assert.equal(typeof renderMarkdown, 'function');
});

test('exports: parseArgs is a function', () => {
  assert.equal(typeof parseArgs, 'function');
});

test('source: script must not define renderPage / updatePostsIndex / updateArchiveIndex', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  // 这些函数名应仅作为"已删除"的注释提及,不能存在函数定义
  assert.equal(/^function\s+renderPage\b/m.test(src), false,
    'renderPage function must be removed (assembly belongs to build-index)');
  assert.equal(/^function\s+updatePostsIndex\b/m.test(src), false,
    'updatePostsIndex function must be removed');
  assert.equal(/^function\s+updateArchiveIndex\b/m.test(src), false,
    'updateArchiveIndex function must be removed');
});

// ============================================================================
// § 2. parseArgs — 必填/可选参数与默认值
// ============================================================================

test('parseArgs: --help sets args.help', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs: required flags input/date/slug captured', () => {
  const a = parseArgs(['--input', 'a.md', '--date', '2026-09-26', '--slug', 'finance-x']);
  assert.equal(a.input, 'a.md');
  assert.equal(a.date, '2026-09-26');
  assert.equal(a.slug, 'finance-x');
});

test('parseArgs: optional flags title/excerpt/cover/outDir captured', () => {
  const a = parseArgs([
    '--title', 'T', '--excerpt', 'E', '--cover', 'c.svg', '--out-dir', '/tmp/x',
  ]);
  assert.equal(a.title, 'T');
  assert.equal(a.excerpt, 'E');
  assert.equal(a.cover, 'c.svg');
  assert.equal(a.outDir, '/tmp/x');
});

test('parseArgs: unknown --flag throws', () => {
  assert.throws(() => parseArgs(['--unknown-flag']), /未知参数/);
});

// ============================================================================
// § 3. renderMarkdown(briefJson) — 契约
// ============================================================================

const VALID_BRIEF = {
  title: '非交易日情报简报 · 2026-09-26（周六）',
  date: '2026-09-26',
  slug: 'finance-2026-09-26',
  excerpt: '本简报由 Multica 金融小队队长基于公开渠道信息整理。',
  body: '# 非交易日情报简报 · 2026-09-26（周六）\n\n第一段正文。\n\n## 二级标题\n\n- 列表项\n',
};

test('renderMarkdown: returns string with YAML frontmatter at top', () => {
  const out = renderMarkdown(VALID_BRIEF);
  assert.equal(typeof out, 'string');
  assert.ok(out.startsWith('---\n'), 'must start with ---');
  assert.ok(/\n---\n\n/.test(out), 'must have closing --- before body');
});

test('renderMarkdown: frontmatter contains all required fields', () => {
  const out = renderMarkdown(VALID_BRIEF);
  assert.match(out, /^title: "非交易日情报简报 · 2026-09-26（周六）"$/m);
  assert.match(out, /^date: 2026-09-26$/m);
  assert.match(out, /^slug: finance-2026-09-26$/m);
  assert.match(out, /^description: "本简报由 Multica 金融小队队长基于公开渠道信息整理。"/m);
  assert.match(out, /^tags: \[finance\]$/m);
  assert.match(out, /^author: itingyu$/m);
  assert.match(out, /^draft: false$/m);
});

test('renderMarkdown: insertCoverMarker placed after # heading + first paragraph', () => {
  const out = renderMarkdown(VALID_BRIEF);
  const idx = out.indexOf('<!-- build:cover -->');
  const titleIdx = out.indexOf('# 非交易日情报简报');
  const firstParaIdx = out.indexOf('第一段正文');
  assert.ok(idx > 0, 'cover marker must exist');
  assert.ok(titleIdx > 0, 'title heading must exist');
  assert.ok(firstParaIdx > 0, 'first paragraph must exist');
  assert.ok(titleIdx < idx, 'cover marker must be after title heading');
  assert.ok(firstParaIdx < idx, 'cover marker must be after first paragraph');
});

test('renderMarkdown: <!-- build:related --> placed at end of body', () => {
  const out = renderMarkdown(VALID_BRIEF);
  const tail = out.trimEnd();
  assert.ok(/<!-- build:related -->\s*$/.test(tail),
    '<!-- build:related --> must be the last content of the .md file');
});

test('renderMarkdown: marker insertion is idempotent (no duplicate cover marker)', () => {
  const briefWithMarker = {
    ...VALID_BRIEF,
    body: '<!-- build:cover -->\n\n# T\n\n<!-- build:related -->\n\npara',
  };
  const out = renderMarkdown(briefWithMarker);
  const coverCount = (out.match(/<!-- build:cover -->/g) || []).length;
  const relatedCount = (out.match(/<!-- build:related -->/g) || []).length;
  assert.equal(coverCount, 1, 'must not duplicate cover marker');
  assert.equal(relatedCount, 1, 'must not duplicate related marker');
});

test('renderMarkdown: required-field validation throws on missing title', () => {
  const { title, ...rest } = VALID_BRIEF;
  assert.throws(() => renderMarkdown(rest), /缺 title/);
});

test('renderMarkdown: required-field validation throws on missing date', () => {
  const { date, ...rest } = VALID_BRIEF;
  assert.throws(() => renderMarkdown(rest), /缺 date/);
});

test('renderMarkdown: required-field validation throws on bad slug', () => {
  assert.throws(() => renderMarkdown({ ...VALID_BRIEF, slug: 'BAD UPPER' }),
    /缺 slug/);
});

test('renderMarkdown: required-field validation throws on empty body', () => {
  assert.throws(() => renderMarkdown({ ...VALID_BRIEF, body: '   ' }),
    /缺 body/);
});

test('renderMarkdown: required-field validation throws on empty tags array', () => {
  assert.throws(() => renderMarkdown({ ...VALID_BRIEF, tags: [] }),
    /tags 必须是非空数组/);
});

// ============================================================================
// § 4. 同源契约 — 复用 scripts/markdown.js 的安全规则
// ============================================================================

test('renderMarkdown: rejects <script> blocks via shared markdown.js', () => {
  assert.throws(
    () => renderMarkdown({ ...VALID_BRIEF, body: '# T\n\n<script>alert(1)</script>\n' }),
    /<script>/,
  );
});

test('renderMarkdown: rejects <style> blocks via shared markdown.js', () => {
  assert.throws(
    () => renderMarkdown({ ...VALID_BRIEF, body: '# T\n\n<style>x{}</style>\n' }),
    /<style>/,
  );
});

// ============================================================================
// § 5. cover 字段可选 + draft 默认 false
// ============================================================================

test('renderMarkdown: cover is optional (omitted when null)', () => {
  const out = renderMarkdown({ ...VALID_BRIEF, cover: null });
  assert.ok(!/^cover:/m.test(out), 'cover field must not appear when null');
});

test('renderMarkdown: cover appears in frontmatter when provided', () => {
  const out = renderMarkdown({ ...VALID_BRIEF, cover: 'cover.svg' });
  assert.match(out, /^cover: cover\.svg$/m);
});

test('renderMarkdown: draft: true honored when explicitly true', () => {
  const out = renderMarkdown({ ...VALID_BRIEF, draft: true });
  assert.match(out, /^draft: true$/m);
});

// ============================================================================
// § 6. --help 输出 — 必须提到 .md 后缀
// ============================================================================

test('CLI: --help mentions .md extension (and does not describe index.html as the output product)', () => {
  const out = cp.spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(out.status, 0, `--help should exit 0, got ${out.status}: ${out.stderr}`);
  assert.match(out.stdout, /\.md/, '--help output must mention .md');
  // 不应在「输出」/「产物」段把 index.html 描述为产物;
  // 在「不再做」声明里提到 index.html 是 OK 的(说明职责迁移)
  assert.ok(!/产物[^]*index\.html/.test(out.stdout),
    '--help output must not describe index.html as the produced artifact');
});

test('CLI: missing required args exits 2 and prints usage', () => {
  const out = cp.spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /缺少必填参数/);
});

// ============================================================================
// § 7. CLI: 实际产出 posts/<slug>/index.md — 不写 index.html
// ============================================================================

test('CLI: writes <slug>/index.md (no index.html) when run with --out-dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rfin-'));
  const inputMd = path.join(tmp, 'brief.md');
  fs.writeFileSync(inputMd,
    '# 非交易日情报简报 · 2026-09-26（周六）\n\n首段正文。\n\n## 二级\n\n- a\n- b\n');

  const out = cp.spawnSync('node', [
    SCRIPT,
    '--input', inputMd,
    '--date', '2026-09-26',
    '--slug', 'finance-cli-test',
    '--out-dir', tmp,
  ], { encoding: 'utf8' });

  assert.equal(out.status, 0, `CLI failed: ${out.stderr}`);

  const mdFile = path.join(tmp, 'finance-cli-test', 'index.md');
  const htmlFile = path.join(tmp, 'finance-cli-test', 'index.html');
  assert.ok(fs.existsSync(mdFile), `must create ${mdFile}`);
  assert.ok(!fs.existsSync(htmlFile), `must NOT create ${htmlFile}`);

  const content = fs.readFileSync(mdFile, 'utf8');
  assert.ok(content.startsWith('---\n'), 'output must start with YAML frontmatter');
  assert.ok(/<!-- build:cover -->/.test(content), 'must contain build:cover marker');
  assert.ok(/<!-- build:related -->/.test(content), 'must contain build:related marker');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('CLI: end-to-end byte-stable for the same input (idempotent re-runs)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rfin-idem-'));
  const inputMd = path.join(tmp, 'brief.md');
  fs.writeFileSync(inputMd,
    '# T\n\n第一段。\n\n- a\n- b\n');
  const args = [
    SCRIPT,
    '--input', inputMd,
    '--date', '2026-09-26',
    '--slug', 'idem',
    '--out-dir', tmp,
  ];
  cp.spawnSync('node', args, { encoding: 'utf8' });
  const first = fs.readFileSync(path.join(tmp, 'idem', 'index.md'), 'utf8');
  cp.spawnSync('node', args, { encoding: 'utf8' });
  const second = fs.readFileSync(path.join(tmp, 'idem', 'index.md'), 'utf8');
  assert.equal(first, second, 'rerun on same input must produce identical bytes');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ============================================================================
// § 8. YAML 转义 — 标题/摘要里的特殊字符必须正确 escape
// ============================================================================

test('renderMarkdown: YAML double-quoted string escapes backslash + quote + newline', () => {
  const out = renderMarkdown({
    title: 'a "quote" and \\ backslash',
    date: '2026-09-26',
    slug: 's',
    excerpt: 'multi\nline',
    body: '# T\n\np\n',
  });
  // 双引号要 \"
  assert.match(out, /^title: "a \\"quote\\" and \\\\ backslash"$/m);
  // 换行要空格
  assert.match(out, /^description: "multi line"$/m);
});

test('renderMarkdown: frontmatter field order is stable (snapshot)', () => {
  const out = renderMarkdown(VALID_BRIEF);
  const order = [...out.matchAll(/^([a-z]+):/gm)].map((m) => m[1]);
  assert.deepEqual(order, [
    'title', 'date', 'slug', 'description', 'tags', 'author', 'draft',
  ], `field order drifted: ${JSON.stringify(order)}`);
});

// ============================================================================
// § 9. fixtures: 已生成的 scripts/__tests__/fixtures/finance-2026-09-26/index.md 契约
// ============================================================================

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'finance-2026-09-26');

test('fixture: scripts/__tests__/fixtures/finance-2026-09-26/index.md exists (M6.4 完成定义)', () => {
  const p = path.join(FIXTURE_DIR, 'index.md');
  assert.ok(fs.existsSync(p), `missing ${p}`);
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(content.startsWith('---\n'));
  assert.ok(/<!-- build:cover -->/.test(content));
  assert.ok(/<!-- build:related -->/.test(content));
  assert.match(content, /^date: 2026-09-26$/m);
  assert.match(content, /^slug: finance-2026-09-26$/m);
});
