'use strict';

// AC-01 · §2.2 / §6.1 _config.yml 契约（design-v3.md）
//
// 不依赖 jekyll build —— 直接解析仓库内 _config.yml 即可。
// 即使 Phase A/B 还没落地，本测试也能在 `_config.yml` 出现时立刻接管断言。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const REPO_ROOT = path.join(__dirname, '..');
const CFG_PATH = path.join(REPO_ROOT, '_config.yml');

function loadConfig() {
  if (!fs.existsSync(CFG_PATH)) return null;
  return YAML.parse(fs.readFileSync(CFG_PATH, 'utf8'));
}

test('AC-01: _config.yml exists', () => {
  assert.ok(fs.existsSync(CFG_PATH),
    '_config.yml 缺失：Phase A 未落地');
});

test('AC-01: plugins 恰好 = [jekyll-paginate, jekyll-seo-tag, jekyll-optional-front-matter]', () => {
  const cfg = loadConfig();
  if (!cfg) return;
  assert.deepEqual(cfg.plugins, [
    'jekyll-paginate',
    'jekyll-seo-tag',
    'jekyll-optional-front-matter',
  ]);
});

test('AC-01: permalink == "/posts/:slug/" (不是 :name)', () => {
  const cfg = loadConfig();
  if (!cfg) return;
  assert.equal(cfg.permalink, '/posts/:slug/');
});

test('AC-01: timezone/lang/baseurl/url/paginate/paginate_path', () => {
  const cfg = loadConfig();
  if (!cfg) return;
  assert.equal(cfg.timezone, 'Asia/Shanghai');
  assert.equal(cfg.lang, 'zh-CN');
  assert.equal(cfg.baseurl, '');
  assert.equal(cfg.url, 'https://itingyu.github.io');
  assert.equal(cfg.paginate, 12);
  assert.equal(cfg.paginate_path, '/posts/page:num/');
});

test('AC-01: markdown/highlighter/kramdown/safe', () => {
  const cfg = loadConfig();
  if (!cfg) return;
  assert.equal(cfg.markdown, 'kramdown');
  assert.equal(cfg.highlighter, 'rouge');
  assert.equal(cfg.kramdown && cfg.kramdown.input, 'GFM');
  assert.equal(cfg.safe, true);
});

test('AC-01: collections.series.permalink=/series/:name/ + output=true', () => {
  const cfg = loadConfig();
  if (!cfg || !cfg.collections || !cfg.collections.series) return;
  assert.equal(cfg.collections.series.permalink, '/series/:name/');
  assert.equal(cfg.collections.series.output, true);
});

test('AC-01: collections.tags.permalink=/tags/:name/ + output=true', () => {
  const cfg = loadConfig();
  if (!cfg || !cfg.collections || !cfg.collections.tags) return;
  assert.equal(cfg.collections.tags.permalink, '/tags/:name/');
  assert.equal(cfg.collections.tags.output, true);
});

test('AC-01: exclude 覆盖 node_modules/scripts/package.json/design*.md', () => {
  const cfg = loadConfig();
  if (!cfg || !Array.isArray(cfg.exclude)) return;
  const must = ['node_modules/', 'scripts/', 'package.json', 'design*.md'];
  for (const m of must) {
    assert.ok(cfg.exclude.includes(m), `exclude 缺 ${m}`);
  }
});
