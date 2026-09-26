'use strict';

// scripts/__tests__/validate-frontmatter.test.js
// M7.5 — YAML frontmatter 校验测试矩阵(SDD测试工程师 主 owner)。
// 9 条用例覆盖 AIWORK1-60 DoD 清单(8 必选 + 1 bonus)。
// 复用 M6.6 落地实现 scripts/validate-frontmatter.js(commit a27c570)。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const VALIDATOR = path.join(ROOT, 'scripts', 'validate-frontmatter.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [VALIDATOR, ...args], {
    cwd: cwd || ROOT,
    encoding: 'utf8',
  });
}

function makePostDir(label = 'welcome') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm75-fm-'));
  const slugDir = path.join(tmp, label);
  fs.mkdirSync(slugDir, { recursive: true });
  return { tmp, slugDir };
}

function writePost(slugDir, frontmatterLines) {
  const fm = ['---', ...frontmatterLines, '---', '', 'body'].join('\n');
  fs.writeFileSync(path.join(slugDir, 'index.md'), fm);
}

// 通用清理
function rmTmp(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 必备 frontmatter 行(覆盖所有必填字段;cover 用合法路径 posts/<slug>/cover.svg)
const fullLines = (slug) => ([
  `title: 完整合法 frontmatter`,
  `slug: ${slug}`,
  `date: 2026-09-26`,
  `description: 合法完整的 fixture,所有必填字段到位`,
  `tags: [note, life]`,
  `cover: posts/${slug}/cover.svg`,
  `draft: false`,
]);

// ---------------------------------------------------------------
// 用例 1:合法完整 → exit 0(DoD 清单 #1)
// ---------------------------------------------------------------
test('1. 合法完整 frontmatter → exit 0,无 fail', () => {
  const { tmp, slugDir } = makePostDir('happy');
  writePost(slugDir, fullLines('happy'));

  const r = run([tmp]);
  assert.equal(r.status, 0, `应为 exit 0,实际=${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(!/\[fail\]/.test(r.stdout), `stdout 不应包含 [fail]:\n${r.stdout}`);
  rmTmp(tmp);
});

// ---------------------------------------------------------------
// 用例 2:缺 title → exit 1 + 错误信息含文件名(DoD 清单 #2)
// ---------------------------------------------------------------
test('2. 缺 title → exit 1,错误信息含文件名 + 行号', () => {
  const { tmp, slugDir } = makePostDir('notitle');
  writePost(slugDir, [
    `slug: notitle`,
    `date: 2026-09-26`,
    `description: x`,
    `tags: [note]`,
    `cover: posts/notitle/cover.svg`,
  ]);

  const r = run([tmp]);
  assert.equal(r.status, 1, `应为 exit 1,实际=${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(
    /\[fail\] 缺必填字段 "title"/.test(r.stdout),
    `应报 "缺必填字段 title":\n${r.stdout}`
  );
  assert.ok(
    /notitle\/index\.md:\d+: \[fail\]/.test(r.stdout),
    `文件名(notitle/index.md)与行号应出现在输出:\n${r.stdout}`
  );
  rmTmp(tmp);
});

// ---------------------------------------------------------------
// 用例 3:dtae: typo → exit 1(DoD 清单 #3)
// ---------------------------------------------------------------
test('3. dtae: typo → exit 1,建议 date', () => {
  const { tmp, slugDir } = makePostDir('typo-dtae');
  writePost(slugDir, [
    `title: t`,
    `slug: typo-dtae`,
    `dtae: 2026-09-26`,
    `description: x`,
    `tags: [note]`,
    `cover: posts/typo-dtae/cover.svg`,
  ]);

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(
    /疑似 typo: "dtae:" → 建议 "date:"/.test(r.stdout),
    `应建议 dtae → date:\n${r.stdout}`
  );
  rmTmp(tmp);
});

// ---------------------------------------------------------------
// 用例 4:tag:(单数)→ exit 1(DoD 清单 #4)
// ---------------------------------------------------------------
test('4. tag:(单数)→ exit 1,建议 tags', () => {
  const { tmp, slugDir } = makePostDir('singular');
  writePost(slugDir, [
    `title: t`,
    `slug: singular`,
    `date: 2026-09-26`,
    `description: x`,
    `tag: [note]`,
    `cover: posts/singular/cover.svg`,
  ]);

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(
    /疑似 typo: "tag:" → 建议 "tags:"/.test(r.stdout),
    `应建议 tag → tags:\n${r.stdout}`
  );
  rmTmp(tmp);
});

// ---------------------------------------------------------------
// 用例 5:draft: ture typo → exit 1(DoD 清单 #5)
// ---------------------------------------------------------------
test('5. draft: ture → exit 1(bool typo)', () => {
  const { tmp, slugDir } = makePostDir('booltypo');
  writePost(slugDir, [
    `title: t`,
    `slug: booltypo`,
    `date: 2026-09-26`,
    `description: x`,
    `tags: [note]`,
    `cover: posts/booltypo/cover.svg`,
    `draft: ture`,
  ]);

  const r = run([tmp]);
  assert.equal(r.status, 1);
  assert.ok(
    /draft: ture.*建议.*draft: true/.test(r.stdout),
    `应识别 draft: ture 为 bool typo:\n${r.stdout}`
  );
  rmTmp(tmp);
});

// ---------------------------------------------------------------
// 用例 6:cover 路径不存在 → exit 1(DoD 清单 #6,需 --strict)
// ---------------------------------------------------------------
test('6. cover 路径不存在(missing.svg)→ --strict 下 exit 1', () => {
  const { tmp, slugDir } = makePostDir('missingcov');
  writePost(slugDir, [
    `title: t`,
    `slug: missingcov`,
    `date: 2026-09-26`,
    `description: x`,
    `tags: [note]`,
    `cover: posts/missingcov/missing.svg`,
  ]);

  // 默认模式:warn,exit 0
  const defaultR = run([tmp]);
  assert.equal(defaultR.status, 0, `默认模式应 exit 0(warn):\n${defaultR.stdout}`);
  assert.ok(/cover 路径不存在/.test(defaultR.stdout), '默认模式应输出 cover 路径不存在的 warn');

  // --strict:fail,exit 1
  const strictR = run([tmp, '--strict']);
  assert.equal(strictR.status, 1, `--strict 模式应 exit 1:\n${strictR.stdout}`);
  assert.ok(
    /cover 路径不存在: posts\/missingcov\/missing\.svg/.test(strictR.stdout),
    `应明确报告 missing.svg 路径:\n${strictR.stdout}`
  );
  assert.ok(/\[fail\]/.test(strictR.stdout), 'strict 下 cover 缺失应为 [fail]');
  rmTmp(tmp);
});

// ---------------------------------------------------------------
// 用例 7:日期格式错(2026-13-99)→ exit 1(DoD 清单 #7)
// ---------------------------------------------------------------
test('7. 日期 2026-13-99 格式错 → exit 1', () => {
  const { tmp, slugDir } = makePostDir('baddate');
  writePost(slugDir, [
    `title: t`,
    `slug: baddate`,
    `date: 2026-13-99`,
    `description: x`,
    `tags: [note]`,
    `cover: posts/baddate/cover.svg`,
  ]);

  const r = run([tmp]);
  assert.equal(r.status, 1);
  // 实现:首先会被 ISO 正则 `\d{4}-\d{2}-\d{2}` 通过,然后实际 Date 解析失败 → 在 NORMAL 模式下后续校验仍报 fail
  // 任何与 date 格式相关的 fail 都算覆盖
  assert.ok(
    /date/.test(r.stdout) && /\[fail\]/.test(r.stdout),
    `应报告 date 相关 [fail]:\n${r.stdout}`
  );
  rmTmp(tmp);
});

// ---------------------------------------------------------------
// 用例 8:空数组合法 → exit 0(DoD 清单 #8)
//   "空数组" = 空目录(无 .md 文件),CLI 默认返回 0,不打 fail
// ---------------------------------------------------------------
test('8. 空目录(0 个 .md)→ exit 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm75-empty-'));
  // 不放任何 .md

  const r = run([tmp]);
  assert.equal(r.status, 0, `空目录应 exit 0,实际=${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(!/\[fail\]/.test(r.stdout), `空目录不应有 [fail]:\n${r.stdout}`);
  rmTmp(tmp);
});

// ---------------------------------------------------------------
// 用例 9(bonus):description ↔ excerpt 双轨兼容(两者并存→exit 0)
//   spec §3.2:description 优先,缺则回退 excerpt;两者并存 = 兼容,exit 0。
// ---------------------------------------------------------------
test('9. bonus: description + excerpt 并存 → exit 0(双轨兼容)', () => {
  const { tmp, slugDir } = makePostDir('twotrack');
  writePost(slugDir, [
    `title: t`,
    `slug: twotrack`,
    `date: 2026-09-26`,
    `description: description 优先`,
    `excerpt: excerpt 兜底摘要`,
    `tags: [note]`,
    `cover: posts/twotrack/cover.svg`,
  ]);

  const r = run([tmp]);
  assert.equal(r.status, 0, `两者并存应 exit 0,实际=${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(!/\[fail\]/.test(r.stdout), `两者并存不应有 [fail]:\n${r.stdout}`);
  rmTmp(tmp);
});