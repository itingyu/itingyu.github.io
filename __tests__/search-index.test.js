'use strict';

// AC-09 · §D5 search 索引契约
//   索引文件: /search/index.json
//   schema: { generated, posts: [{ id, url, title, description, tags, date, excerpt, content }] }
//   content: 全文纯文本（不含 HTML 标签）
//   posts 长度 == 22（已发布）
//   assets/search.js 索引 URL 字面量 == /search/index.json
//   /assets/search-index.json 不存在

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function siteDir() { return process.env.M3_SITE_DIR || ''; }

test('AC-09: /search/index.json 是合法 JSON', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'search', 'index.json');
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, 'utf8');
  let obj;
  assert.doesNotThrow(() => { obj = JSON.parse(raw); }, '索引 JSON 解析失败');
  assert.ok(typeof obj === 'object' && obj !== null, '索引应为对象');
});

test('AC-09: 索引 schema + posts 长度 == 22 + 每项含必需键', () => {
  const d = siteDir();
  if (!d) return;
  const p = path.join(d, 'search', 'index.json');
  if (!fs.existsSync(p)) return;
  const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(obj.generated, '缺 generated');
  assert.ok(Array.isArray(obj.posts), 'posts 应为数组');
  assert.equal(obj.posts.length, 22,
    `posts 长度应为 22，实测 ${obj.posts.length}`);
  const required = ['id', 'url', 'title', 'description', 'tags', 'date', 'excerpt', 'content'];
  for (const post of obj.posts) {
    for (const k of required) {
      assert.ok(post[k] != null, `索引项 ${post.id || post.url} 缺 ${k}`);
    }
    assert.ok(!post.content.includes('<'),
      `${post.id} content 含 HTML 标签（应 strip_html）`);
    assert.ok(post.content.length > 0,
      `${post.id} content 为空`);
  }
});

test('AC-09: assets/search.js 索引 URL 字面量 == /search/index.json', () => {
  const repo = path.join(__dirname, '..', 'assets', 'search.js');
  if (!fs.existsSync(repo)) return;
  const js = fs.readFileSync(repo, 'utf8');
  assert.ok(js.includes('/search/index.json'),
    'search.js 未引用 /search/index.json');
});

test('AC-09: /assets/search-index.json 不存在（v1 老路径已退役）', () => {
  const d = siteDir();
  if (!d) return;
  assert.ok(!fs.existsSync(path.join(d, 'assets', 'search-index.json')),
    '_site/assets/search-index.json 应已退役');
});
