'use strict';

/* scripts/__tests__/sync-tags.test.js
 *
 * 断言 scripts/sync-tags.js 的核心契约:
 *   - 篇数 ≥ 3 且 _tags/<slug>.md 不存在 → 自动生成 (layout: tag / title: <slug> / tag: <slug>)
 *   - 篇数 < 3 → 不生成
 *   - 已存在 _tags/<slug>.md → 不覆盖(保留 human-curated title)
 *   - 跑两次 syncTags() 第二次无新增 → 幂等
 *
 * 测试用临时目录隔离真实仓库,避免污染 _posts/ / _tags/。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { syncTags, parseTags } = require('../sync-tags.js');

function makeTmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-tags-test-'));
  fs.mkdirSync(path.join(root, '_posts'));
  fs.mkdirSync(path.join(root, '_tags'));
  return root;
}
function rmTmp(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
function writePost(root, name, tags) {
  const tagsYaml =
    Array.isArray(tags) && tags.length > 0
      ? 'tags:\n' + tags.map((t) => `  - "${t}"`).join('\n') + '\n'
      : 'tags: []\n';
  const fm = `---\nlayout: post\ntitle: "T"\ndate: 2026-10-09 00:00:00 +0800\n${tagsYaml}---\nbody\n`;
  fs.writeFileSync(path.join(root, '_posts', name), fm, 'utf8');
}
function writeTag(root, slug, body) {
  fs.writeFileSync(
    path.join(root, '_tags', `${slug}.md`),
    body || `---\nlayout: tag\ntitle: ${slug}\ntag: ${slug}\n---\n`,
    'utf8'
  );
}
function readTag(root, slug) {
  return fs.readFileSync(path.join(root, '_tags', `${slug}.md`), 'utf8');
}

// 1. 解析 front matter 的 tags: 多行 list
test('parseTags: 多行 list 形式 → 数组', () => {
  const md = `---\nlayout: post\ntitle: "T"\ntags:\n  - "Python"\n  - "GC"\n---\nbody\n`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-tags-'));
  fs.writeFileSync(path.join(tmp, 'p.md'), md, 'utf8');
  try {
    assert.deepEqual(parseTags(path.join(tmp, 'p.md')), ['Python', 'GC']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 2. 解析 front matter 的 tags: 行内 list
test('parseTags: 行内 list 形式 → 数组', () => {
  const md = `---\nlayout: post\ntags: [Python, GC, finance]\n---\nbody\n`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-tags-'));
  fs.writeFileSync(path.join(tmp, 'p.md'), md, 'utf8');
  try {
    assert.deepEqual(parseTags(path.join(tmp, 'p.md')), ['Python', 'GC', 'finance']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 3. 没有 front matter 或没有 tags: → 空数组
test('parseTags: 缺 tags: → 空数组(不抛)', () => {
  const md = `---\nlayout: post\ntitle: "T"\n---\nbody\n`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-tags-'));
  fs.writeFileSync(path.join(tmp, 'p.md'), md, 'utf8');
  try {
    assert.deepEqual(parseTags(path.join(tmp, 'p.md')), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 4. 主流程:3 篇以上未存在 → 生成
test('sync-tags: 计数 ≥ 3 且不存在 → 生成 _tags/<slug>.md', () => {
  const root = makeTmpRepo();
  try {
    writePost(root, '2026-01-01-a.md', ['Python', 'GC']);
    writePost(root, '2026-01-02-b.md', ['Python', 'GC', 'Rust']);
    writePost(root, '2026-01-03-c.md', ['Python', 'GC']);

    const r = syncTags({ root, threshold: 3 });

    const created = r.created.map((c) => c.slug).sort();
    assert.deepEqual(created, ['GC', 'Python'], `created=${created.join(',')}`);
    assert.equal(fs.existsSync(path.join(root, '_tags', 'Python.md')), true);
    assert.equal(fs.existsSync(path.join(root, '_tags', 'GC.md')), true);
    assert.equal(fs.existsSync(path.join(root, '_tags', 'Rust.md')), false);
    assert.equal(r.created.length, 2);
  } finally {
    rmTmp(root);
  }
});

// 5. 已存在的 _tags/<slug>.md 不被覆盖(保留 human-curated title)
test('sync-tags: 已存在 → 不覆盖', () => {
  const root = makeTmpRepo();
  try {
    writePost(root, '2026-01-01-a.md', ['Python']);
    writePost(root, '2026-01-02-b.md', ['Python']);
    writePost(root, '2026-01-03-c.md', ['Python']);
    writeTag(
      root,
      'Python',
      '---\nlayout: tag\ntitle: 派森 / Python\ntag: Python\n---\n'
    );

    syncTags({ root, threshold: 3 });

    const onDisk = readTag(root, 'Python');
    assert.ok(onDisk.includes('title: 派森 / Python'), '人类编辑的 title 必须保留');
    assert.ok(!onDisk.includes('title: Python\n'), '不能把 title 改回 slug');
  } finally {
    rmTmp(root);
  }
});

// 6. 幂等:跑两次 → 第二次 created.length = 0
test('sync-tags: 跑两次 → 第二次无新增(幂等)', () => {
  const root = makeTmpRepo();
  try {
    writePost(root, '2026-01-01-a.md', ['Python']);
    writePost(root, '2026-01-02-b.md', ['Python']);
    writePost(root, '2026-01-03-c.md', ['Python']);

    const r1 = syncTags({ root, threshold: 3 });
    assert.equal(r1.created.length, 1);

    const r2 = syncTags({ root, threshold: 3 });
    assert.equal(r2.created.length, 0, '第二次必须 0 新增');
    assert.equal(r2.skippedExisting.length, 1);
  } finally {
    rmTmp(root);
  }
});

// 7. 阈值下不生成
test('sync-tags: 计数 < 阈值 → 不生成', () => {
  const root = makeTmpRepo();
  try {
    writePost(root, '2026-01-01-a.md', ['Python']);
    writePost(root, '2026-01-02-b.md', ['Python']);
    // Python 只有 2 篇

    const r = syncTags({ root, threshold: 3 });
    assert.equal(r.created.length, 0);
    assert.equal(fs.existsSync(path.join(root, '_tags', 'Python.md')), false);
    assert.equal(r.belowThreshold.length, 1);
    assert.equal(r.belowThreshold[0].slug, 'Python');
    assert.equal(r.belowThreshold[0].n, 2);
  } finally {
    rmTmp(root);
  }
});

// 8. 生成的 _tags/<slug>.md 内容契约
test('sync-tags: 生成内容 = layout: tag / title: <slug> / tag: <slug>', () => {
  const root = makeTmpRepo();
  try {
    writePost(root, '2026-01-01-a.md', ['Java']);
    writePost(root, '2026-01-02-b.md', ['Java']);
    writePost(root, '2026-01-03-c.md', ['Java']);

    syncTags({ root, threshold: 3 });

    const onDisk = readTag(root, 'Java');
    assert.match(onDisk, /^---\n/);
    assert.match(onDisk, /^layout: tag\n/m);
    assert.match(onDisk, /^title: Java\n/m);
    assert.match(onDisk, /^tag: Java\n/m);
    assert.match(onDisk, /\n---\n/);
  } finally {
    rmTmp(root);
  }
});

// 9. _posts 目录不存在 → 抛错
test('sync-tags: _posts 目录缺失 → 抛错', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-tags-test-'));
  try {
    assert.throws(() => syncTags({ root, threshold: 3 }), /_posts 目录不存在/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 10. 自定义阈值
test('sync-tags: --threshold 2 时 2 篇以上就生成', () => {
  const root = makeTmpRepo();
  try {
    writePost(root, '2026-01-01-a.md', ['Rust']);
    writePost(root, '2026-01-02-b.md', ['Rust']);

    const r = syncTags({ root, threshold: 2 });
    assert.equal(r.created.length, 1);
    assert.equal(r.created[0].slug, 'Rust');
  } finally {
    rmTmp(root);
  }
});

// 11. CJK slug 文件名正确创建(测试 setUp 的临时目录是 UTF-8 文件系统)
test('sync-tags: CJK slug → 文件名 = slug.md', () => {
  const root = makeTmpRepo();
  try {
    writePost(root, '2026-01-01-a.md', ['A股']);
    writePost(root, '2026-01-02-b.md', ['A股']);
    writePost(root, '2026-01-03-c.md', ['A股']);

    const r = syncTags({ root, threshold: 3 });
    assert.equal(r.created.length, 1);
    assert.equal(r.created[0].slug, 'A股');
    assert.equal(fs.existsSync(path.join(root, '_tags', 'A股.md')), true);
  } finally {
    rmTmp(root);
  }
});
