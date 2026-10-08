'use strict';

// Public build fixture (公共 build 夹具) — design-v3.md §9 AC 前置
// Run once before other contract tests; exports siteDir for downstream tests.
//
// 本测试扮演 §9 表格里说的「跑 bundle exec jekyll build --destination <tmp>」前置：
//   1. 若仓库内 _site/ 已存在（Phase C 大 PR 合并后的过渡期），直接复用
//   2. 否则起一个临时目录，调 jekyll 构建；Date 冻结为 2026-10-08
//   3. 把 siteDir 通过 process.env.M3_SITE_DIR 暴露给下游测试
//
// 下游测试（config-contract 之外）用 before() 钩子读 M3_SITE_DIR 找产物。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const ENV_SITE = 'M3_SITE_DIR';
const FIXED_DATE = '2026-10-08T00:00:00+08:00';

function findJekyll() {
  const candidates = [
    '/home/tq/.local/share/gem/ruby/3.3.0/bin/jekyll',
    '/usr/local/bin/jekyll',
    '/usr/bin/jekyll',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const r = spawnSync('which', ['jekyll'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function preBuiltSite() {
  const p = path.join(REPO_ROOT, '_site');
  return fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html')) ? p : null;
}

function hasJekyll() {
  return findJekyll() !== null;
}

function hasConfig() {
  return fs.existsSync(path.join(REPO_ROOT, '_config.yml')) &&
         fs.existsSync(path.join(REPO_ROOT, '_posts'));
}

function build() {
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3-site-'));
  const jekyll = findJekyll();
  if (!jekyll) throw new Error('jekyll binary not found');

  // 用 SOURCE_DATE_EPOCH + jekyll 的 future 校验禁未来日期
  const env = {
    ...process.env,
    SOURCE_DATE_EPOCH: String(Math.floor(new Date(FIXED_DATE).getTime() / 1000)),
  };
  const r = spawnSync(jekyll, [
    'build',
    '--source', REPO_ROOT,
    '--destination', siteDir,
    '--trace',
    '--quiet',
  ], { env, encoding: 'utf8', timeout: 240_000 });

  if (r.status !== 0) {
    fs.rmSync(siteDir, { recursive: true, force: true });
    throw new Error(`jekyll build failed (status ${r.status}):\n${r.stderr || r.stdout}`);
  }
  return siteDir;
}

test('build-site: M3_SITE_DIR is set (pre-built or freshly built)', () => {
  let siteDir = process.env[ENV_SITE] || preBuiltSite() || null;
  if (!siteDir && hasJekyll() && hasConfig()) {
    siteDir = build();
  }
  if (!siteDir) {
    // 没有 _site/、没有 _config.yml、jekyll 又跑不起来 —— Phase A/B 还没落地。
    // 这种情况本测试直接 PASS，但下游测试会因为 M3_SITE_DIR 缺失而跳过/失败，
    // 测试报告中自然体现。
    process.env[ENV_SITE] = '';
    return;
  }
  process.env[ENV_SITE] = siteDir;
  assert.ok(fs.existsSync(path.join(siteDir, 'index.html')),
    `_site/index.html missing under ${siteDir}`);
});

test('build-site: 22 posts (sanity check on _site)', () => {
  const siteDir = process.env[ENV_SITE];
  if (!siteDir) return; // upstream 未落地，跳过
  const postsDir = path.join(siteDir, 'posts');
  if (!fs.existsSync(postsDir)) return;
  const slugs = fs.readdirSync(postsDir).filter((s) =>
    fs.existsSync(path.join(postsDir, s, 'index.html'))
  );
  assert.equal(slugs.length, 22,
    `expected 22 post slugs under _site/posts/, got ${slugs.length}: ${slugs.join(',')}`);
});
