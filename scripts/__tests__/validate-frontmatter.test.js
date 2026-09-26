'use strict';

// scripts/__tests__/validate-frontmatter.test.js
// M7.5 测试矩阵(SDD测试工程师 解锁后由其扩展到 ≥ 8 条)
// 这里作为 SDD后端工程师 在 M6.6 阶段提交的功能性 + 关键路径覆盖,
// 测试矩阵主体 ≥ 8 条交由 SDD测试工程师 扩展(见 AIWORK1-54 DoD 的"完成定义")。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const VALIDATOR = path.join(ROOT, 'scripts', 'validate-frontmatter.js');
const FIX_DIR = path.join(__dirname, 'fixtures', 'frontmatter');

function run(args, cwd) {
  return spawnSync(process.execPath, [VALIDATOR, ...args], {
    cwd: cwd || ROOT,
    encoding: 'utf8',
  });
}

// 1. valid fixtures -> exit 0, no fail
test('validator: valid 3 fixtures exits 0', () => {
  const r = run([FIX_DIR]);
  assert.equal(r.status, 0);
  assert.ok(!/\[fail\]/.test(r.stdout), `should have no fail:\n${r.stdout}`);
});

// 2. missing title -> exit 1, line number reported
test('validator: missing title fails with file:line', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'slug: welcome',
    'date: 2026-09-26',
    'description: x',
    'tags: [note]',
    'cover: posts/welcome/cover.svg',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1, `should exit 1, stdout=\n${r.stdout}`);
  assert.ok(/\[fail\] 缺必填字段 "title"/.test(r.stdout), 'should report missing title');
  assert.ok(/welcome\/index\.md:\d+: \[fail\]/.test(r.stdout), 'should report file:line');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 3. typo dtae -> exit 1, suggests "date"
test('validator: typo dtae suggests date', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: welcome',
    'dtae: 2026-09-26',
    'description: x',
    'tags: [note]',
    'cover: posts/welcome/cover.svg',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(/疑似 typo: "dtae:" → 建议 "date:"/.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 4. typo tite -> exit 1
test('validator: typo tite suggests title', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'tite: t',
    'slug: welcome',
    'date: 2026-09-26',
    'description: x',
    'tags: [note]',
    'cover: posts/welcome/cover.svg',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(/疑似 typo: "tite:" → 建议 "title:"/.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 5. singular tag -> exit 1
test('validator: singular "tag:" suggests "tags:"', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: welcome',
    'date: 2026-09-26',
    'description: x',
    'tag: [note]',
    'cover: posts/welcome/cover.svg',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(/疑似 typo: "tag:" → 建议 "tags:"/.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 6. draft: ture -> exit 1 (bool typo)
test('validator: draft: ture suggests draft: true', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: welcome',
    'date: 2026-09-26',
    'description: x',
    'tags: [note]',
    'cover: posts/welcome/cover.svg',
    'draft: ture',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(/draft: ture/.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 7. date non-ISO -> exit 1
test('validator: date "2026/09/26" not ISO fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: welcome',
    'date: 2026/09/26',
    'description: x',
    'tags: [note]',
    'cover: posts/welcome/cover.svg',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(/date 必须为 ISO 8601/.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 8. tags element not slug -> exit 1
test('validator: tags with non-slug element fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: welcome',
    'date: 2026-09-26',
    'description: x',
    'tags: [note, "Bad Tag"]',
    'cover: posts/welcome/cover.svg',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(/tags 元素 "Bad Tag" 不是合法 slug/.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 9. excerpt fallback when description absent
test('validator: excerpt alone satisfies description requirement', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: welcome',
    'date: 2026-09-26',
    'excerpt: 摘要',
    'tags: [note]',
    'cover: posts/welcome/cover.svg',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 0, `should pass with excerpt alone:\n${r.stdout}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 10. cover not exists -> --strict fail, default warn
test('validator: cover missing fails under --strict', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: welcome',
    'date: 2026-09-26',
    'description: x',
    'tags: [note]',
    'cover: posts/welcome/nonexistent.svg',
    '---',
    '',
    'body',
  ].join('\n'));

  const strictR = run([tmp, '--strict']);
  assert.equal(strictR.status, 1);
  assert.ok(/cover 路径不存在/.test(strictR.stdout));

  const defaultR = run([tmp]);
  assert.equal(defaultR.status, 0, 'default mode warn does not fail');
  assert.ok(/cover 路径不存在/.test(defaultR.stdout));

  fs.rmSync(tmp, { recursive: true, force: true });
});

// 11. cover absolute path -> exit 1
test('validator: cover absolute path fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: welcome',
    'date: 2026-09-26',
    'description: x',
    'tags: [note]',
    'cover: /etc/passwd',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(/绝对路径/.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 12. duplicate key -> exit 1
test('validator: duplicate key fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: welcome',
    'date: 2026-09-26',
    'description: x',
    'tags: [note]',
    'cover: posts/welcome/cover.svg',
    'date: 2026-09-27',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(/重复键 "date"/.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 13. tags empty array -> exit 1 (空数组 = 缺 tags,doD 要求 tags 必须存在)
test('validator: empty tags array fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: welcome',
    'date: 2026-09-26',
    'description: x',
    'tags: []',
    'cover: posts/welcome/cover.svg',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(/tags 不能为空数组/.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 14. --help
test('validator: --help exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.ok(/用法:/.test(r.stdout));
});

// 15. nonexistent dir -> exit 1 with stderr
test('validator: nonexistent dir exits 1', () => {
  const r = run(['/tmp/no-such-dir-xyz-12345']);
  assert.equal(r.status, 1);
  assert.ok(/目录不存在/.test(r.stderr));
});

// 16. slug mismatch dir -> exit 1
test('validator: slug mismatch dir name fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-fm-'));
  const slugDir = path.join(tmp, 'welcome');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 'index.md'), [
    '---',
    'title: t',
    'slug: wrong-slug',
    'date: 2026-09-26',
    'description: x',
    'tags: [note]',
    'cover: posts/welcome/cover.svg',
    '---',
    '',
    'body',
  ].join('\n'));

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(/slug "wrong-slug" 与目录名 "welcome" 不一致/.test(r.stdout));
  fs.rmSync(tmp, { recursive: true, force: true });
});