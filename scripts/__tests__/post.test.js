/* post.test.js —— 文章管理 CLI 的纯函数测试 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseArgs, findPost, permalinkFor } = require('../post.js');

const ROOT = path.resolve(__dirname, '..', '..');

test('parseArgs: 解析位置参数与选项', () => {
  const o = parseArgs(['my-post', '--title', '新标题', '--tags', 'a,b', '--push'], {});
  assert.equal(o._[0], 'my-post');
  assert.equal(o.title, '新标题');
  assert.equal(o.tags, 'a,b');
  assert.equal(o.push, true);
});

test('parseArgs: --column 与 --series 分别取值', () => {
  const o = parseArgs(['x.md', '--column', 'ai', '--series', 'ai-llm'], {});
  assert.equal(o.column, 'ai');
  assert.equal(o.series, 'ai-llm');
});

test('parseArgs: 布尔开关', () => {
  const o = parseArgs(['x', '--dry-run'], {});
  assert.equal(o.dryRun, true);
  assert.equal(o.push, false);
});

test('permalinkFor: 栏目/子栏目/slug 拼装', () => {
  assert.equal(
    permalinkFor({ slug: 'my-post', column: 'prog', series: 'prog-eng' }),
    '/notes/prog/prog-eng/my-post/'
  );
});

test('permalinkFor: 无子专栏时用专栏名兜底', () => {
  assert.equal(
    permalinkFor({ slug: 'my-post', column: 'misc', series: null }),
    '/notes/misc/misc/my-post/'
  );
});

test('findPost: 按 slug 或文件名命中文章', () => {
  const posts = [
    { slug: 'alpha', name: '2026-01-01-alpha.md', title: 'A', fm: { slug: 'alpha' } },
    { slug: 'beta', name: '2026-01-02-beta.md', title: 'B', fm: { slug: 'beta' } },
  ];
  assert.equal(findPost(posts, 'beta').slug, 'beta');
  assert.equal(findPost(posts, '2026-01-02-beta.md').slug, 'beta');
});

test('findPost: 找不到时报错并提示相近 slug', () => {
  assert.throws(
    () => findPost([{ slug: 'alpha', name: '2026-01-01-alpha.md', title: 'A', fm: {} }], 'gamma'),
    /gamma/
  );
});
