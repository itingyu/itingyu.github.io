'use strict';

// scripts/__tests__/toggle-draft.test.js —— 翻转 draft 字段的回归矩阵(M6.7)
// 覆盖:
//   1. 已有 draft: true  → publish 翻转 true → false,行内替换
//   2. 已有 draft: false → draft   翻转 false → true
//   3. 已达成目标状态   → no-op,文件不变,stdout 打印 current
//   4. 缺 draft 字段    → publish 在 fmEnd 前追加一行 draft: false
//   5. 缺 draft 字段    → draft   在 fmEnd 前追加一行 draft: true
//   6. frontmatter 缺  / 不闭合 → exit 2
//   7. draft 值非法    → exit 1
//   8. 文件不存在      → exit 2
//   9. 前后空格 / trailing comment 容错
//  10. 保留其它 frontmatter 字段顺序
//  11. publish.sh <slug> --status 模式调用(端到端 dry-run,只跑 toggle + add,不 commit/push)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const TOGGLE = path.join(__dirname, '..', 'toggle-draft.js');
const PUBLISH = path.join(__dirname, '..', 'publish.sh');

function makeTmp(slug = 'demo') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toggle-draft-'));
  const posts = path.join(dir, 'posts', slug);
  fs.mkdirSync(posts, { recursive: true });
  return { dir, md: path.join(posts, 'index.md') };
}

function writeMD(file, body) {
  fs.writeFileSync(file, body);
}

const SAMPLE_FM = `---
title: 翻转测试
date: 2026-09-26
tags: [note, life]
description: 测试用例
excerpt: 测试用例摘要
---

# 翻转测试

正文段落。
`;

function runToggle(md, wanted) {
  return cp.spawnSync(process.execPath, [TOGGLE, md, wanted], {
    encoding: 'utf8',
  });
}

// ---------- 1. true → false 替换 ----------
test('toggle-draft: draft: true → false 替换已有字段', () => {
  const { md, dir } = makeTmp('post-1');
  writeMD(md, SAMPLE_FM.replace('excerpt: 测试用例摘要', 'excerpt: 测试用例摘要\ndraft: true'));
  const r = runToggle(md, 'false');
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  assert.equal(r.stdout.trim(), 'true');
  const out = fs.readFileSync(md, 'utf8');
  assert.match(out, /^draft: false$/m);
  // 字段顺序保留
  const lines = out.split('\n');
  const draftIdx = lines.indexOf('draft: false');
  const excerptIdx = lines.indexOf('excerpt: 测试用例摘要');
  assert.ok(draftIdx > excerptIdx, 'draft 应该在 excerpt 之后');
  fs.rmSync(dir, { recursive: true });
});

// ---------- 2. false → true ----------
test('toggle-draft: draft: false → true 反向翻转', () => {
  const { md, dir } = makeTmp('post-2');
  writeMD(md, SAMPLE_FM.replace('excerpt: 测试用例摘要', 'excerpt: 测试用例摘要\ndraft: false'));
  const r = runToggle(md, 'true');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'false');
  const out = fs.readFileSync(md, 'utf8');
  assert.match(out, /^draft: true$/m);
  fs.rmSync(dir, { recursive: true });
});

// ---------- 3. no-op: 已是目标状态 ----------
test('toggle-draft: draft 已为目标值 → no-op,文件不变', () => {
  const { md, dir } = makeTmp('post-3');
  const original = SAMPLE_FM.replace('excerpt: 测试用例摘要', 'excerpt: 测试用例摘要\ndraft: false');
  writeMD(md, original);
  const r = runToggle(md, 'false');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'false');
  const out = fs.readFileSync(md, 'utf8');
  assert.equal(out, original, 'no-op 时文件应完全不变');
  fs.rmSync(dir, { recursive: true });
});

// ---------- 4. 缺 draft:publish 追加 ----------
test('toggle-draft: 缺 draft → publish 在 fmEnd 前追加 draft: false', () => {
  const { md, dir } = makeTmp('post-4');
  writeMD(md, SAMPLE_FM);
  const r = runToggle(md, 'false');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '<none>');
  const out = fs.readFileSync(md, 'utf8');
  // draft 必须在 == 行之前
  const lines = out.split('\n');
  const sepIdx = lines.indexOf('---', lines.indexOf('---') + 1);
  const draftIdx = lines.findIndex(l => /^draft: false$/.test(l));
  assert.ok(draftIdx >= 0 && draftIdx < sepIdx, 'draft 行应在 fmEnd --- 之前');
  fs.rmSync(dir, { recursive: true });
});

// ---------- 5. 缺 draft:draft 追加 ----------
test('toggle-draft: 缺 draft → draft 追加 draft: true', () => {
  const { md, dir } = makeTmp('post-5');
  writeMD(md, SAMPLE_FM);
  const r = runToggle(md, 'true');
  assert.equal(r.status, 0);
  const out = fs.readFileSync(md, 'utf8');
  assert.match(out, /^draft: true$/m);
  fs.rmSync(dir, { recursive: true });
});

// ---------- 6. frontmatter 缺失 / 不闭合 → exit 2 ----------
test('toggle-draft: frontmatter 缺失 → exit 2', () => {
  const { md, dir } = makeTmp('post-6');
  writeMD(md, '# 没有 frontmatter\n正文\n');
  const r = runToggle(md, 'true');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /frontmatter/i);
  fs.rmSync(dir, { recursive: true });
});

test('toggle-draft: frontmatter 起 --- 在但没有收 --- → exit 2', () => {
  const { md, dir } = makeTmp('post-7');
  writeMD(md, '---\ntitle: broken\n');
  const r = runToggle(md, 'true');
  assert.equal(r.status, 2);
  fs.rmSync(dir, { recursive: true });
});

// ---------- 7. draft 值非法 → exit 1 ----------
test('toggle-draft: draft 字段值非法(yes) → exit 1', () => {
  const { md, dir } = makeTmp('post-8');
  writeMD(md, SAMPLE_FM.replace('excerpt: 测试用例摘要', 'excerpt: 测试用例摘要\ndraft: yes'));
  const r = runToggle(md, 'true');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /draft 字段值非法/);
  fs.rmSync(dir, { recursive: true });
});

// ---------- 8. 文件不存在 → exit 2 ----------
test('toggle-draft: 文件不存在 → exit 2', () => {
  const r = runToggle('/tmp/__definitely-not-exists__/x.md', 'true');
  assert.equal(r.status, 2);
});

// ---------- 9. 前后空格 + trailing comment 容错 ----------
test('toggle-draft: 容忍 draft:   true 与 trailing comment', () => {
  const { md, dir } = makeTmp('post-9');
  writeMD(md, SAMPLE_FM.replace('excerpt: 测试用例摘要', 'excerpt: 测试用例摘要\ndraft:   true  # 默认草稿'));
  const r = runToggle(md, 'false');
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  assert.equal(r.stdout.trim(), 'true');
  const out = fs.readFileSync(md, 'utf8');
  assert.match(out, /^draft: false$/m);
  fs.rmSync(dir, { recursive: true });
});

// ---------- 10. 保留字段顺序与多余空行 ----------
test('toggle-draft: 保留其它 frontmatter 字段顺序与多余空行', () => {
  const { md, dir } = makeTmp('post-10');
  const original = [
    '---',
    'title: 顺序保留',
    'date: 2026-09-26',
    'tags: [t1]',
    '',
    'description: desc',
    'draft: true',
    'author: itingyu',
    '---',
    '',
    'body',
    '',
  ].join('\n');
  writeMD(md, original);
  const r = runToggle(md, 'false');
  assert.equal(r.status, 0);
  const out = fs.readFileSync(md, 'utf8');
  assert.match(out, /title: 顺序保留[\s\S]*date: 2026-09-26[\s\S]*tags: \[t1\][\s\S]*description: desc[\s\S]*draft: false[\s\S]*author: itingyu/);
  fs.rmSync(dir, { recursive: true });
});

// ---------- 11. publish.sh <slug> --status 端到端(dry-run,需要 git) ----------
function setupRepo(slug, mdBody) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-sh-'));
  cp.execSync('git init -q -b master', { cwd: tmp });
  cp.execSync('git config user.name tester', { cwd: tmp });
  cp.execSync('git config user.email tester@example.com', { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"x","version":"0.0.0","private":true,"scripts":{"test":"node --test"},"dependencies":{}}');
  fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'posts', slug, 'index.md'), mdBody);
  cp.execSync('git add -A && git commit -q -m initial', { cwd: tmp });
  fs.copyFileSync(PUBLISH, path.join(tmp, 'publish.sh'));
  fs.chmodSync(path.join(tmp, 'publish.sh'), 0o755);
  // 把 toggle-draft.js 一起拷过去(SCRIPT_DIR 指向 publish.sh 所在目录)
  fs.copyFileSync(TOGGLE, path.join(tmp, 'toggle-draft.js'));
  fs.chmodSync(path.join(tmp, 'toggle-draft.js'), 0o755);
  return tmp;
}

test('publish.sh <slug> --status publish: 真 git 仓库,翻转 + add,dry-run 不 commit/push', () => {
  const tmp = setupRepo('welcome',
    '---\ntitle: Welcome\ndate: 2026-09-26\ntags: [note]\ndraft: true\n---\n\n正文\n');

  const env = { ...process.env, PUBLISH_DRY_RUN: '1', PUBLISH_REPO_ROOT: tmp };
  const r = cp.spawnSync('bash', [path.join(tmp, 'publish.sh'), 'welcome', '--status', 'publish'], {
    cwd: tmp, env, encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stderr=${r.stderr}\nstdout=${r.stdout}`);
  const md = fs.readFileSync(path.join(tmp, 'posts', 'welcome', 'index.md'), 'utf8');
  assert.match(md, /^draft: false$/m);
  // dry-run:不应有 HEAD 之后的 commit
  const log = cp.execSync('git log --oneline', { cwd: tmp, encoding: 'utf8' });
  assert.match(log, /initial/, 'dry-run 不应产生新 commit');
  assert.equal(log.trim().split('\n').length, 1, '只应有 initial 一个 commit');
  fs.rmSync(tmp, { recursive: true });
});

test('publish.sh <slug> --status draft: 反向翻转 draft: false → true', () => {
  const tmp = setupRepo('welcome',
    '---\ntitle: Welcome\ndate: 2026-09-26\ntags: [note]\ndraft: false\n---\n\n正文\n');

  const env = { ...process.env, PUBLISH_DRY_RUN: '1', PUBLISH_REPO_ROOT: tmp };
  const r = cp.spawnSync('bash', [path.join(tmp, 'publish.sh'), 'welcome', '--status', 'draft'], {
    cwd: tmp, env, encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const md = fs.readFileSync(path.join(tmp, 'posts', 'welcome', 'index.md'), 'utf8');
  assert.match(md, /^draft: true$/m);
  fs.rmSync(tmp, { recursive: true });
});

test('publish.sh <slug>: 不存在的 slug → exit 1 + 错误提示', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-sh-'));
  cp.execSync('git init -q -b master', { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"x"}');
  fs.copyFileSync(PUBLISH, path.join(tmp, 'publish.sh'));
  fs.chmodSync(path.join(tmp, 'publish.sh'), 0o755);
  fs.copyFileSync(TOGGLE, path.join(tmp, 'toggle-draft.js'));

  const env = { ...process.env, PUBLISH_REPO_ROOT: tmp };
  const r = cp.spawnSync('bash', [path.join(tmp, 'publish.sh'), 'nope-not-here'], {
    cwd: tmp, env, encoding: 'utf8',
  });
  assert.equal(r.status, 1); // die() exits 1
  assert.match(r.stderr, /找不到|nope-not-here/);
  fs.rmSync(tmp, { recursive: true });
});

test('publish.sh <slug>: 不合法 slug → exit 1 + 错误提示', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-sh-'));
  cp.execSync('git init -q -b master', { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"x"}');
  fs.copyFileSync(PUBLISH, path.join(tmp, 'publish.sh'));
  fs.chmodSync(path.join(tmp, 'publish.sh'), 0o755);
  fs.copyFileSync(TOGGLE, path.join(tmp, 'toggle-draft.js'));

  const env = { ...process.env, PUBLISH_REPO_ROOT: tmp };
  const r = cp.spawnSync('bash', [path.join(tmp, 'publish.sh'), 'Bad_Slug'], {
    cwd: tmp, env, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /slug 不合法/);
  fs.rmSync(tmp, { recursive: true });
});

test('publish.sh <slug>: 已达成目标状态 → exit 0,no-op(不 commit)', () => {
  const tmp = setupRepo('welcome',
    '---\ntitle: Welcome\ndate: 2026-09-26\ntags: [note]\ndraft: true\n---\n\nbody\n');

  // current=true, --status draft(也是 true)→ no-op,文件不应变
  const env = { ...process.env, PUBLISH_REPO_ROOT: tmp };
  const r = cp.spawnSync('bash', [path.join(tmp, 'publish.sh'), 'welcome', '--status', 'draft'], {
    cwd: tmp, env, encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  assert.match(r.stdout, /无需翻转/);
  const md = fs.readFileSync(path.join(tmp, 'posts', 'welcome', 'index.md'), 'utf8');
  assert.match(md, /^draft: true$/m, 'no-op 文件不变');
  const log = cp.execSync('git log --oneline', { cwd: tmp, encoding: 'utf8' });
  assert.equal(log.trim().split('\n').length, 1, 'no-op 不应产生 commit');
  fs.rmSync(tmp, { recursive: true });
});

test('publish.sh: 无子命令 = v1 行为保留(--help / unknown arg)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-sh-'));
  cp.execSync('git init -q -b master', { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"x"}');
  fs.copyFileSync(PUBLISH, path.join(tmp, 'publish.sh'));
  fs.chmodSync(path.join(tmp, 'publish.sh'), 0o755);
  fs.copyFileSync(TOGGLE, path.join(tmp, 'toggle-draft.js'));

  const env = { ...process.env, PUBLISH_REPO_ROOT: tmp };

  // --help 应 exit 0
  const help = cp.spawnSync('bash', [path.join(tmp, 'publish.sh'), '--help'], { cwd: tmp, env, encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /v1 行为/);

  // 未知参数 → exit 2
  const bad = cp.spawnSync('bash', [path.join(tmp, 'publish.sh'), '--whatever'], { cwd: tmp, env, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  fs.rmSync(tmp, { recursive: true });
});