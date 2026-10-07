'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { validateOne } = require('../validate-frontmatter.js');

function writePosts(slug, html) {
  const dir = path.join(os.tmpdir(), 'validate-test-posts', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return dir;
}

const COMPLETE_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>完整文章</title>
  <meta name="description" content="测试描述" />
  <meta property="article:published_time" content="2026-10-07" />
  <meta property="article:author" content="itingyu" />
  <meta property="og:title" content="完整文章" />
  <meta property="og:description" content="测试描述" />
  <meta property="article:section" content="厨房学" />
  <meta name="series:description" content="测试专栏描述" />
  <meta property="article:tag" content="cooking" />
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": "完整文章",
      "datePublished": "2026-10-07",
      "description": "测试描述"
    }
  </script>
</head>
<body><p>正文</p></body>
</html>
`;

// 1. 完整 frontmatter → 0 error
test('validate-frontmatter: 完整文章 → 0 error', () => {
  const dir = writePosts('complete-post', COMPLETE_HTML);
  // 临时把 ROOT 改到 tmp;这里直接验证 validateOne 的逻辑而不是 main 的目录扫描
  const r = validateOne('complete-post');
  // validateOne 读 ROOT/posts/<slug>;所以这一项必须放在 ROOT/posts/...
  // 直接覆盖 posts/complete-post
  const targetDir = path.join(path.resolve(__dirname, '..', '..'), 'posts', 'complete-post');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'index.html'), COMPLETE_HTML);
  try {
    const r = validateOne('complete-post');
    assert.equal(r.errors.length, 0, `errors: ${r.errors.join('|')}`);
    assert.equal(r.warnings.length, 0, `warnings: ${r.warnings.join('|')}`);
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

// 2. 缺 description → error
test('validate-frontmatter: 缺 description → error', () => {
  const targetDir = path.join(path.resolve(__dirname, '..', '..'), 'posts', 'no-desc-post');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'index.html'), `<!doctype html><html><head>
    <title>缺描述</title>
    <meta property="article:published_time" content="2026-01-01" />
    <meta property="article:author" content="itingyu" />
  </head><body></body></html>`);
  try {
    const r = validateOne('no-desc-post');
    assert.ok(r.errors.some((e) => e.includes('description')), '应报缺少 description');
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

// 3. 非 ISO 日期 → error
test('validate-frontmatter: 非 ISO 日期 → error', () => {
  const targetDir = path.join(path.resolve(__dirname, '..', '..'), 'posts', 'bad-date-post');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'index.html'), `<!doctype html><html><head>
    <title>B</title>
    <meta name="description" content="d" />
    <meta property="article:published_time" content="March 10, 2026" />
    <meta property="article:author" content="itingyu" />
  </head><body></body></html>`);
  try {
    const r = validateOne('bad-date-post');
    assert.ok(r.errors.some((e) => e.includes('ISO')), '应报非 ISO 日期');
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

// 4. 缺 article:tag → warning(不是 error)
test('validate-frontmatter: 无 tag → warning', () => {
  const targetDir = path.join(path.resolve(__dirname, '..', '..'), 'posts', 'no-tag-post');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'index.html'), `<!doctype html><html><head>
    <title>N</title>
    <meta name="description" content="d" />
    <meta property="article:published_time" content="2026-01-01" />
    <meta property="article:author" content="itingyu" />
  </head><body></body></html>`);
  try {
    const r = validateOne('no-tag-post');
    assert.equal(r.errors.length, 0, '无 tag 不应报 error');
    assert.ok(r.warnings.some((w) => w.includes('article:tag')), '应 warn 缺 tag');
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

// 5. JSON-LD 缺 headline → error
test('validate-frontmatter: BlogPosting JSON-LD 缺 headline → error', () => {
  const targetDir = path.join(path.resolve(__dirname, '..', '..'), 'posts', 'bad-jsonld-post');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'index.html'), `<!doctype html><html><head>
    <title>J</title>
    <meta name="description" content="d" />
    <meta property="article:published_time" content="2026-01-01" />
    <meta property="article:author" content="itingyu" />
    <meta property="article:tag" content="t" />
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"BlogPosting","datePublished":"2026-01-01"}
    </script>
  </head><body></body></html>`);
  try {
    const r = validateOne('bad-jsonld-post');
    assert.ok(r.errors.some((e) => e.includes('headline')), '应报缺 headline');
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

// 6. JSON-LD 无法解析 → error
test('validate-frontmatter: BlogPosting JSON-LD 解析失败 → error', () => {
  const targetDir = path.join(path.resolve(__dirname, '..', '..'), 'posts', 'broken-jsonld-post');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'index.html'), `<!doctype html><html><head>
    <title>B</title>
    <meta name="description" content="d" />
    <meta property="article:published_time" content="2026-01-01" />
    <meta property="article:author" content="itingyu" />
    <meta property="article:tag" content="t" />
    <script type="application/ld+json">
      { not valid json
    </script>
  </head><body></body></html>`);
  try {
    const r = validateOne('broken-jsonld-post');
    assert.ok(r.errors.some((e) => e.includes('JSON-LD 解析失败')), '应报 JSON-LD 解析失败');
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

// 7. 空数组 tags = 0 个,但 description 完整 → warnings 而非 errors
test('validate-frontmatter: 0 个 tag → warning(>=1 推荐)', () => {
  const targetDir = path.join(path.resolve(__dirname, '..', '..'), 'posts', 'zero-tag-post');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'index.html'), `<!doctype html><html><head>
    <title>Z</title>
    <meta name="description" content="d" />
    <meta property="article:published_time" content="2026-01-01" />
    <meta property="article:author" content="itingyu" />
  </head><body></body></html>`);
  try {
    const r = validateOne('zero-tag-post');
    assert.equal(r.errors.length, 0);
    assert.ok(r.warnings.length > 0);
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

// 8. 不存在的 slug → error
test('validate-frontmatter: 不存在的 slug → error', () => {
  const r = validateOne('does-not-exist-slug');
  assert.ok(r.errors.length > 0);
  assert.ok(r.errors[0].includes('文件不存在'), '应报文件不存在');
});
