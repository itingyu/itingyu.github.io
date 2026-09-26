'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const search = require(path.join(__dirname, '..', '..', 'assets', 'search.js'));
const { fuzzyMatch, editDistance } = search;

const samplePosts = [
  { slug: 'welcome', title: '欢迎来到新博客', url: '/posts/welcome/', date: '2026-09-26' },
  { slug: 'finance-2026-09-26', title: '金融简报 · 2026-09-26', url: '/posts/finance-2026-09-26/', date: '2026-09-26' },
  { slug: 'multi-tag-post', title: '多标签示例', url: '/posts/multi-tag-post/', date: '2026-02-20' },
  { slug: 'edge-cases-post', title: '边缘案例', url: '/posts/edge-cases-post/', date: '2026-03-10' },
];

test('search: fuzzyMatch returns top-3 candidates within editDistance 2 (DoD)', () => {
  const hits = fuzzyMatch('wecome', samplePosts, 3);
  assert.ok(Array.isArray(hits));
  assert.equal(hits.length, 1, 'only welcome has editDistance 1');
  assert.equal(hits[0].slug, 'welcome');
  assert.equal(hits[0].title, '欢迎来到新博客');
});

test('search: fuzzyMatch returns empty array when slug is unrelated (DoD)', () => {
  const hits = fuzzyMatch('asdfqwer', samplePosts, 3);
  assert.deepEqual(hits, []);
});

test('search: fuzzyMatch uses prefix match (≥3 chars) when editDistance > 2', () => {
  const hits = fuzzyMatch('welc', samplePosts, 3);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].slug, 'welcome');
});

test('search: fuzzyMatch excludes exact-match slug', () => {
  const hits = fuzzyMatch('welcome', samplePosts, 3);
  assert.deepEqual(hits, [], 'exact match should not be suggested as candidate');
});

test('search: fuzzyMatch respects topN limit', () => {
  const hits = fuzzyMatch('wel', samplePosts, 1);
  assert.equal(hits.length, 1);
});

test('search: fuzzyMatch empty/whitespace query returns []', () => {
  assert.deepEqual(fuzzyMatch('', samplePosts, 3), []);
  assert.deepEqual(fuzzyMatch('   ', samplePosts, 3), []);
});

test('search: editDistance classic Levenshtein cases', () => {
  assert.equal(editDistance('hello', 'hello'), 0);
  assert.equal(editDistance('wecome', 'welcome'), 1);
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('abc', ''), 3);
});