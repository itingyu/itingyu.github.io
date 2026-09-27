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
// M6.5 (AIWORK1-53, 329afdd) shipped the post-build golden at UTC 2026-09-26.
// Pin the build clock to that date so the byte-equal contract is reproducible.
const MOCK_BUILD_ISO = '2026-09-26T00:00:00.000Z';

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-byte-equal-'));
  fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
  for (const slug of ['welcome', 'finance-2026-09-26', 'sing-box-setup-experience']) {
    const srcDir = path.join(FIX, 'sources', slug);
    const dstDir = path.join(tmp, 'posts', slug);
    fs.mkdirSync(dstDir, { recursive: true });
    fs.copyFileSync(path.join(srcDir, 'index.md'), path.join(dstDir, 'index.md'));
    fs.copyFileSync(path.join(srcDir, 'cover.svg'), path.join(dstDir, 'cover.svg'));
  }
  return tmp;
}

function buildInTemp(tmp) {
  // M7.7: ALLOW_LEGACY_HTML 逃生口已删,不再设环境变量。
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

const SLUGS = ['welcome', 'finance-2026-09-26', 'sing-box-setup-experience'];

for (const slug of SLUGS) {
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