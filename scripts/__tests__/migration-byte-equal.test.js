'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIX = path.join(__dirname, 'fixtures', 'migration-byte-equal');

// Build embeds `new Date().toISOString().slice(0, 10)` in sitemap.xml static-page
// lastmod fields and in assets/search-index.json `generated`. Without a frozen
// build date, those bytes drift daily and byte-equality is impossible.
//
// AIWORK1-82 (M6.5 收尾) shipped the post-build golden at UTC 2026-10-08.
// Pin the build clock to that date so the byte-equal contract is reproducible.
const MOCK_BUILD_ISO = '2026-10-08T00:00:00.000Z';

let _savedDate;
function withMockedDate(fn) {
  _savedDate = _savedDate || Date;
  class MockDate extends _savedDate {
    constructor(...args) {
      if (args.length === 0) super(MOCK_BUILD_ISO);
      else super(...args);
    }
    static now() { return new _savedDate(MOCK_BUILD_ISO).getTime(); }
  }
  global.Date = MockDate;
  try { return fn(); }
  finally { global.Date = _savedDate; }
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function makeProject() {
  // M6.5 收尾后 v2 流水线已有 20 篇 posts/<slug>/index.md;为做 v2 MD→HTML
  // 重构后的 byte-equal 回测,把所有 MD 源 + 封面图都搬到 tmp 的 posts/ 下,
  // 这样 build 出来的产物与仓内已 build 的产物应该字节级一致。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-byte-equal-'));
  fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
  const srcRoot = path.join(REPO_ROOT, 'posts');
  for (const slug of fs.readdirSync(srcRoot)) {
    const srcDir = path.join(srcRoot, slug);
    const stat = fs.statSync(srcDir);
    if (!stat.isDirectory()) continue;
    const dstDir = path.join(tmp, 'posts', slug);
    fs.mkdirSync(dstDir, { recursive: true });
    const md = path.join(srcDir, 'index.md');
    const cover = path.join(srcDir, 'cover.svg');
    if (fs.existsSync(md)) fs.copyFileSync(md, path.join(dstDir, 'index.md'));
    if (fs.existsSync(cover)) fs.copyFileSync(cover, path.join(dstDir, 'cover.svg'));
  }
  return tmp;
}

function buildInTemp(tmp) {
  // Bust require cache so ROOT binding picks up the mocked Date when invoked
  // through child build script.
  delete require.cache[require.resolve(path.join(REPO_ROOT, 'scripts', 'build-index.js'))];
  const bi = require(path.join(REPO_ROOT, 'scripts', 'build-index.js'));
  withMockedDate(() => {
    const build = bi.computeBuild(tmp);
    bi.writeBuild(build, tmp);
  });
}

function assertByteEqual(label, builtPath, goldenPath) {
  const built = fs.readFileSync(builtPath);
  const golden = fs.readFileSync(goldenPath);
  const builtSha = sha256(built);
  const goldenSha = sha256(golden);
  assert.equal(
    builtSha,
    goldenSha,
    `${label}: sha256 mismatch\n  built: ${builtSha}\n golden: ${goldenSha}`,
  );
}

const POST_SLUGS = fs.readdirSync(path.join(REPO_ROOT, 'posts'))
  .filter(name => fs.statSync(path.join(REPO_ROOT, 'posts', name)).isDirectory());

for (const slug of POST_SLUGS) {
  test(`migration byte-equal: posts/${slug}/index.html`, () => {
    const tmp = makeProject();
    try {
      buildInTemp(tmp);
      assertByteEqual(
        `posts/${slug}/index.html`,
        path.join(tmp, 'posts', slug, 'index.html'),
        path.join(REPO_ROOT, 'posts', slug, 'index.html'),
      );
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
}

test('migration byte-equal: feeds/rss.xml', () => {
  const tmp = makeProject();
  try {
    buildInTemp(tmp);
    assertByteEqual(
      'feeds/rss.xml',
      path.join(tmp, 'feeds', 'rss.xml'),
      path.join(REPO_ROOT, 'feeds', 'rss.xml'),
    );
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('migration byte-equal: sitemap.xml', () => {
  const tmp = makeProject();
  try {
    buildInTemp(tmp);
    assertByteEqual(
      'sitemap.xml',
      path.join(tmp, 'sitemap.xml'),
      path.join(REPO_ROOT, 'sitemap.xml'),
    );
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('migration byte-equal: assets/search-index.json', () => {
  const tmp = makeProject();
  try {
    buildInTemp(tmp);
    assertByteEqual(
      'assets/search-index.json',
      path.join(tmp, 'assets', 'search-index.json'),
      path.join(REPO_ROOT, 'assets', 'search-index.json'),
    );
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});