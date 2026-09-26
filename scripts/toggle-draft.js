#!/usr/bin/env node
'use strict';

// scripts/toggle-draft.js —— 翻转 posts/<slug>/index.md YAML frontmatter 的 draft 字段。
//
// 用法:
//   node scripts/toggle-draft.js <md-file> <wanted>     # wanted: "true" | "false"
//
// 退出码:
//   0  翻转成功(或目标值已存在,空操作)
//   1  参数错误 / frontmatter 缺失 / draft 字段值非法
//   2  YAML 边界异常
//
// 副作用:把 <md-file> 写回原路径(原子 writeFileSync,非原子,但同一文件系统)。
//
// 行为:
//   1. 解析首段 --- ... --- frontmatter 区间
//   2. 在 frontmatter 内查找 draft: 行(允许 trailing comment / 前后空格)
//   3. 若 current == wanted → 打印当前值,不动文件,exit 0
//   4. 若 draft 不存在    → 在 frontmatter 末尾(fmEnd 之前)追加一行 draft: <wanted>
//   5. 若 draft 存在且值不同 → 替换那一行
//   6. 写回文件(保留行尾换行)
//
// stdout:旧 draft 值(<none> 表示原本没有此字段)
// stderr:仅错误路径

const fs = require('node:fs');

function die(msg, code = 1) {
  console.error('toggle-draft: ' + msg);
  process.exit(code);
}

const file = process.argv[2];
const wanted = process.argv[3];

if (!file || !wanted) {
  die('用法:node scripts/toggle-draft.js <md-file> <true|false>', 2);
}
if (wanted !== 'true' && wanted !== 'false') {
  die('--status 只接受 true|false,当前: ' + wanted, 2);
}
if (!fs.existsSync(file)) {
  die('文件不存在: ' + file, 2);
}

const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n');

// 找首段 --- ... ---
let fmStart = -1;
let fmEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '---') {
    if (fmStart === -1) {
      fmStart = i;
    } else {
      fmEnd = i;
      break;
    }
  }
}
if (fmStart === -1 || fmEnd === -1 || fmEnd <= fmStart + 1) {
  die('YAML frontmatter 缺失或不完整: ' + file, 2);
}

// 在 frontmatter 区间里扫描 draft: 行
let draftIdx = -1;
let current = null;
for (let i = fmStart + 1; i < fmEnd; i++) {
  // 匹配 "draft: <value>"(允许前后空白 + trailing comment),value 不含 #
  const m = lines[i].match(/^draft\s*:\s*(.*?)\s*(?:#.*)?$/);
  if (m) {
    const raw = (m[1] || '').trim();
    if (raw !== 'true' && raw !== 'false') {
      die('draft 字段值非法: ' + JSON.stringify(raw) + '(只接受 true/false)', 1);
    }
    draftIdx = i;
    current = raw;
    break;
  }
}

if (current === wanted) {
  process.stdout.write(current + '\n');
  process.exit(0);
}

const newLine = 'draft: ' + wanted;
if (draftIdx === -1) {
  // 追加一行(在 fmEnd 行之前)
  lines.splice(fmEnd, 0, newLine);
} else {
  lines[draftIdx] = newLine;
}

const trailingNL = text.endsWith('\n');
fs.writeFileSync(file, lines.join('\n') + (trailingNL ? '\n' : ''));

process.stdout.write((current === null ? '<none>' : current) + '\n');
process.exit(0);