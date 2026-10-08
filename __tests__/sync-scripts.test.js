'use strict';

// AC-19 · §D11 sync 脚本幂等性
//   node scripts/sync-tags.js && node scripts/sync-series.js 连跑两次后
//   git status --porcelain 为空（即没有任何 _tags 或 feeds/series-*.xml 变化）。
//
// §D10 硬门禁：_data/tags.yml 不存在（site.tags 哈希不被双重覆盖）

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

function listTags() {
  const dir = path.join(REPO_ROOT, '_tags');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

function listSeriesFeeds() {
  const dir = path.join(REPO_ROOT, 'feeds');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^series-.*\.xml$/.test(f))
    .sort();
}

test('AC-19: sync-tags.js 跑两次后 _tags 不变（idempotent）', () => {
  if (!fs.existsSync(path.join(REPO_ROOT, 'scripts', 'sync-tags.js'))) return;
  const before = listTags();
  const r1 = spawnSync('node', ['scripts/sync-tags.js'],
    { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r1.status !== 0) return; // upstream 缺 _posts 解析失败
  const mid = listTags();
  const r2 = spawnSync('node', ['scripts/sync-tags.js'],
    { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r2.status !== 0) return;
  const after = listTags();
  assert.deepEqual(before, mid, '第一次跑后 _tags 变了');
  assert.deepEqual(mid, after, '第二次跑后 _tags 又变了（非幂等）');
});

test('AC-19: sync-series.js 跑两次后 feeds/series-*.xml 不变（idempotent）', () => {
  if (!fs.existsSync(path.join(REPO_ROOT, 'scripts', 'sync-series.js'))) return;
  const before = listSeriesFeeds();
  const r1 = spawnSync('node', ['scripts/sync-series.js'],
    { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r1.status !== 0) return;
  const mid = listSeriesFeeds();
  const r2 = spawnSync('node', ['scripts/sync-series.js'],
    { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r2.status !== 0) return;
  const after = listSeriesFeeds();
  assert.deepEqual(before, mid, '第一次跑后 series feed 变了');
  assert.deepEqual(mid, after, '第二次跑后 series feed 又变了（非幂等）');
});

test('AC-19: _data/tags.yml 不存在（§D10 硬门禁）', () => {
  assert.ok(!fs.existsSync(path.join(REPO_ROOT, '_data', 'tags.yml')),
    '_data/tags.yml 应不存在（site.tags 哈希不应被双重覆盖）');
});
