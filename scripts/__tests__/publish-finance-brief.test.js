'use strict';

// scripts/__tests__/publish-finance-brief.test.js —— M7.3 收尾契约
//
// 覆盖 publish-finance-brief.sh 的 sanity check / 参数解析 / 文档契约;
// 不覆盖 end-to-end(那是 node render-finance-brief.js + publish.sh <slug> + workflow 的联调,
// 由 M6.4 / M6.7 / M7.2 联合负责)。
//
// 1. 静态源码契约:文档显式包含 v2 命令链 + 不再 push .html + 依赖 M6.4/M6.7/M7.2
// 2. --help 通过 sanity check 后输出 v2 文档
// 3. 未知参数 exit 2
// 4. 无任何 --latest/--date/--issue/--attachment/--input exit 2
// 5. --date 缺值 exit 2
// 6. sanity check:缺 scripts/render-finance-brief.js → exit 1
// 7. sanity check:render-finance-brief.js 未声明 .md 输出 → exit 1 + 错误信息含 M6.4
// 8. sanity check:publish.sh 不含 v2 <slug> 子命令 → exit 1 + 错误信息含 M6.7
// 9. sanity check:.github/workflows/build-posts.yml 缺失 → exit 1 + 错误信息含 M7.2
// 10. --help 不依赖文件存在(在 sanity check 失败前先走 usage 分支)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const PUBLISH_FINANCE = path.join(__dirname, '..', 'publish-finance-brief.sh');
const PUBLISH = path.join(__dirname, '..', 'publish.sh');

function makeTmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-finance-brief-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  // 把 publish-finance-brief.sh 拷到 test repo(它的 SCRIPT_DIR 由 BASH_SOURCE 解析,
  // 必须和被检文件同目录,否则 sanity check 永远看真仓的 render-finance-brief.js)
  fs.copyFileSync(PUBLISH_FINANCE, path.join(dir, 'scripts', 'publish-finance-brief.sh'));
  fs.chmodSync(path.join(dir, 'scripts', 'publish-finance-brief.sh'), 0o755);
  // 把 test repo 初始化成 git 仓库 + 提交一次,以便 git diff HEAD 不报「无 HEAD」歧义
  cp.spawnSync('git', ['init', '-q', '--initial-branch=master'], { cwd: dir });
  cp.spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  cp.spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  cp.spawnSync('git', ['add', '-A'], { cwd: dir });
  cp.spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

// 注入一个「v2 已落地」的最小 stub 仓:
//   - scripts/render-finance-brief.js 声明输出 .md
//   - scripts/publish.sh 含 v2 <slug> 子命令(直接拷真 publish.sh)
//   - .github/workflows/build-posts.yml 存在
function makeV2ReadyRepo() {
  const dir = makeTmpRepo();
  fs.writeFileSync(
    path.join(dir, 'scripts', 'render-finance-brief.js'),
    `#!/usr/bin/env node
console.log("用法: node scripts/render-finance-brief.js --slug <slug> -- 会生成 posts/<slug>/index.md(必填)");`,
  );
  fs.copyFileSync(PUBLISH, path.join(dir, 'scripts', 'publish.sh'));
  fs.chmodSync(path.join(dir, 'scripts', 'publish.sh'), 0o755);
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.github', 'workflows', 'build-posts.yml'),
    '# stub for v2 readiness test\n',
  );
  return dir;
}

// 跑 publish-finance-brief.sh(已拷到 test repo 的 scripts/ 下)
function runScript(cwd, args = [], env = {}) {
  return cp.spawnSync('bash', [path.join(cwd, 'scripts', 'publish-finance-brief.sh'), ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

// ---------- 1. 静态源码契约 ----------
test('publish-finance-brief.sh: 文档显式声明 v2 命令链(node render-finance-brief.js + publish.sh finance-<date>)', () => {
  const src = fs.readFileSync(PUBLISH_FINANCE, 'utf8');
  assert.match(src, /node scripts\/render-finance-brief\.js/,
    '必须显式声明 node render-finance-brief.js 命令');
  // publish.sh finance-<date> —— 在 usage / design doc 里出现一次以上
  assert.match(src, /publish\.sh finance-<date>/,
    '必须显式声明 publish.sh finance-<date> 命令');
});

test('publish-finance-brief.sh: 文档显式声明「不再 push index.html」+ workflow 接管', () => {
  const src = fs.readFileSync(PUBLISH_FINANCE, 'utf8');
  assert.match(src, /不再[^。]*?index\.html/, '必须显式声明不再 push index.html');
  assert.match(src, /M7\.2.*workflow|workflow.*M7\.2/,
    '必须显式声明 HTML 由 M7.2 workflow 出');
});

test('publish-finance-brief.sh: 文档显式声明依赖 M6.4 + M6.7 + M7.2', () => {
  const src = fs.readFileSync(PUBLISH_FINANCE, 'utf8');
  assert.match(src, /M6\.4[\s\S]{0,200}render-finance-brief\.js/,
    'M6.4 必须与 render-finance-brief.js 同时出现在文档');
  assert.match(src, /M6\.7[\s\S]{0,200}publish\.sh[\s\S]{0,80}<slug>/,
    'M6.7 必须与 publish.sh <slug> 同时出现');
  assert.match(src, /M7\.2[\s\S]{0,200}build-posts\.yml/,
    'M7.2 必须与 build-posts.yml 同时出现');
});

test('publish-finance-brief.sh: 删除旧 git add posts/finance-*/index.html 逻辑', () => {
  const src = fs.readFileSync(PUBLISH_FINANCE, 'utf8');
  // 不再直接 add 任何 index.html;只 add .md
  assert.doesNotMatch(src, /git add posts\/finance-[^*]*index\.html/,
    '不能有 git add posts/finance-*/index.html 残留');
});

// ---------- 2. --help 不被 sanity check 拦截(因为 --help 在 set -e 前 exit 0) ----------
test('publish-finance-brief.sh: --help 在空仓(无 scripts/)也走 usage 分支输出 v2 文档', () => {
  const r = runScript(makeTmpRepo(), ['--help']);
  // 设计:--help 先于 sanity check 走(usage | exit 0),即使仓库空也输出
  assert.equal(r.status, 0, `期望 exit 0,实际 ${r.status};stderr=${r.stderr}`);
  assert.match(r.stdout, /publish-finance-brief\.sh/);
  assert.match(r.stdout, /node scripts\/render-finance-brief\.js/);
});

// ---------- 3. 未知参数 exit 2 ----------
test('publish-finance-brief.sh: 未知参数 exit 2', () => {
  const r = runScript(makeV2ReadyRepo(), ['--bogus-flag']);
  assert.equal(r.status, 2, `期望 exit 2,实际 ${r.status};stderr=${r.stderr}`);
});

// ---------- 4. 缺关键参数 exit 2(且不依赖 sanity check) ----------
test('publish-finance-brief.sh: 无 --latest/--date/--issue/--attachment/--input → exit 2', () => {
  const r = runScript(makeV2ReadyRepo(), []);
  assert.equal(r.status, 2, `期望 exit 2,实际 ${r.status};stderr=${r.stderr}`);
  assert.match(r.stderr + r.stdout, /--latest|--date|--issue|--attachment|--input/);
});

// ---------- 5. --date 缺值 exit 2 ----------
test('publish-finance-brief.sh: --date 后无参数值 exit 2', () => {
  const r = runScript(makeV2ReadyRepo(), ['--date']);
  assert.equal(r.status, 2, `期望 exit 2,实际 ${r.status};stderr=${r.stderr}`);
});

// ---------- 6. sanity check: render-finance-brief.js 缺失 → exit 1 ----------
test('publish-finance-brief.sh: 缺 scripts/render-finance-brief.js → exit 1', () => {
  const cwd = makeTmpRepo();
  fs.copyFileSync(PUBLISH, path.join(cwd, 'scripts', 'publish.sh'));
  fs.chmodSync(path.join(cwd, 'scripts', 'publish.sh'), 0o755);
  fs.mkdirSync(path.join(cwd, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'build-posts.yml'), 'x');
  // 故意不写 render-finance-brief.js
  const r = runScript(cwd, ['--date', '2026-09-26']);
  assert.equal(r.status, 1, `期望 exit 1,实际 ${r.status};stderr=${r.stderr}`);
  assert.match(r.stderr, /render-finance-brief\.js/, '错误信息必须点名 render-finance-brief.js');
});

// ---------- 7. sanity check: render-finance-brief.js 未声明 .md → exit 1 + 提示 M6.4 ----------
test('publish-finance-brief.sh: render-finance-brief.js 未声明 .md 输出 → exit 1 + 提示 M6.4', () => {
  const cwd = makeV2ReadyRepo();
  // 把 render-finance-brief.js 改成声明 .html(v1 行为)
  fs.writeFileSync(
    path.join(cwd, 'scripts', 'render-finance-brief.js'),
    `#!/usr/bin/env node
console.log("用法: node scripts/render-finance-brief.js --slug <slug> -- 会生成 posts/<slug>/index.html(必填)");`,
  );
  const r = runScript(cwd, ['--date', '2026-09-26']);
  assert.equal(r.status, 1, `期望 exit 1,实际 ${r.status};stderr=${r.stderr}`);
  assert.match(r.stderr, /render-finance-brief\.js/, '必须点名 render-finance-brief.js');
  assert.match(r.stderr, /M6\.4/, '必须提示依赖 M6.4');
});

// ---------- 8. sanity check: publish.sh 不含 v2 <slug> 子命令 → exit 1 + 提示 M6.7 ----------
test('publish-finance-brief.sh: publish.sh 不含 v2 <slug> 子命令 → exit 1 + 提示 M6.7', () => {
  const cwd = makeV2ReadyRepo();
  // 把 publish.sh 改成 v1(不含 v2 <slug>,且 help 输出也不含触发字符串)
  fs.writeFileSync(
    path.join(cwd, 'scripts', 'publish.sh'),
    `#!/usr/bin/env bash
echo "publish.sh: 仅 master build+push(v1 行为,无翻转子命令)"`,
  );
  fs.chmodSync(path.join(cwd, 'scripts', 'publish.sh'), 0o755);
  const r = runScript(cwd, ['--date', '2026-09-26']);
  assert.equal(r.status, 1, `期望 exit 1,实际 ${r.status};stderr=${r.stderr}`);
  assert.match(r.stderr, /publish\.sh/, '必须点名 publish.sh');
  assert.match(r.stderr, /M6\.7/, '必须提示依赖 M6.7');
});

// ---------- 9. sanity check: build-posts.yml 缺失 → exit 1 + 提示 M7.2 ----------
test('publish-finance-brief.sh: .github/workflows/build-posts.yml 缺失 → exit 1 + 提示 M7.2', () => {
  const cwd = makeV2ReadyRepo();
  fs.rmSync(path.join(cwd, '.github', 'workflows', 'build-posts.yml'));
  const r = runScript(cwd, ['--date', '2026-09-26']);
  assert.equal(r.status, 1, `期望 exit 1,实际 ${r.status};stderr=${r.stderr}`);
  assert.match(r.stderr, /build-posts\.yml|M7\.2/, '必须显式提示 build-posts.yml 缺失或 M7.2 依赖');
});