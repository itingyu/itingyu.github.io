'use strict';
// migrate-columns.js — 一次性迁移脚本:重排 196 篇文章的 column / series / permalink
// 从旧的 6 L1 × 24 L2 拆成新的 5 L1 × 8 L2 (按行业领域)

const fs = require('node:fs');
const path = require('node:path');

const POSTS_DIR = path.join(__dirname, '..', '_posts');

// 旧 → 新 映射
// 旧 column slug: 知识宝典 / AI学习笔记 / 股票专栏 / 厨房学 / 考驾照 / 职场调研 / 其他
// 旧 series slug(可能带引号)
const COL_MAP = {
  '知识宝典': 'prog',
  'AI学习笔记': 'ai',
  '股票专栏': 'finance',
  '厨房学': 'life',
  '考驾照': 'life',
  '职场调研': 'life',
  '其他': 'misc'
};

// series key 是 "column|series" 拼接(去除引号)
const SER_MAP = {
  // 知识宝典
  '知识宝典|编程语言精进': 'prog-lang',
  '知识宝典|架构设计进阶': 'prog-eng',
  '知识宝典|数据与存储': 'prog-eng',
  '知识宝典|性能与可靠性': 'prog-eng',
  '知识宝典|工程效能': 'prog-eng',
  '知识宝典|软实力与职业': 'prog-eng',
  '知识宝典|安全与合规': 'prog-eng',
  '知识宝典|AI 与大模型工程': 'ai-llm',
  '知识宝典|股市分析专栏': 'fin-stock',
  '知识宝典|复盘系列': 'fin-stock',
  // AI学习笔记
  'AI学习笔记|AI 学习笔记': 'ai-basics',
  'AI学习笔记|"AI 学习笔记"': 'ai-basics',
  // 股票专栏
  '股票专栏|入门基础': 'fin-stock',
  '股票专栏|金融市场观察': 'fin-stock',
  '股票专栏|"金融市场观察"': 'fin-stock',
  '股票专栏|估值与周期': 'fin-stock',
  '股票专栏|选股与行业': 'fin-stock',
  '股票专栏|体系方法论': 'fin-stock',
  '股票专栏|实战案例': 'fin-stock',
  '股票专栏|心理与策略': 'fin-stock',
  '股票专栏|量化与跨境': 'fin-stock',
  '股票专栏|安全与合规': 'fin-stock',
  '股票专栏|工具与实操': 'fin-stock',
  '股票专栏|看懂公司': 'fin-stock',
  '股票专栏|复盘系列': 'fin-stock',
  // 厨房学
  '厨房学|厨房学': 'life-kitchen',
  // 考驾照
  '考驾照|考驾照': 'life-driving',
  // 职场调研
  '职场调研|职场调研': 'life-work',
  // 其他(无 series,直接挂 misc)
  '其他|其他': ''  // 留空表示无 series
};

function unquote(s) {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function processFile(fp) {
  let txt = fs.readFileSync(fp, 'utf8');
  const m = txt.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fp, ok: false, reason: 'no frontmatter' };
  const fm = m[1];
  const body = m[2];

  // 解析 column / series / permalink
  const colMatch = fm.match(/^column:\s*([^\n]+)$/m);
  const serMatch = fm.match(/^series:\s*([^\n]+)$/m);
  const permMatch = fm.match(/^permalink:\s*([^\n]+)$/m);

  if (!colMatch) return { fp, ok: false, reason: 'no column' };

  const oldCol = unquote(colMatch[1]);
  const oldSer = serMatch ? unquote(serMatch[1]) : null;
  const oldPerm = permMatch ? permMatch[1].trim() : null;

  const newCol = COL_MAP[oldCol];
  if (!newCol) return { fp, ok: false, reason: `unknown column: ${oldCol}` };

  const serKey = `${oldCol}|${oldSer || ''}`;
  const newSer = SER_MAP[serKey];
  if (newSer === undefined) {
    return { fp, ok: false, reason: `unknown series combo: ${serKey}` };
  }

  // 替换 frontmatter
  let newFm = fm
    .replace(/^column:\s*[^\n]+$/m, `column: ${newCol}`)
    .replace(/^series:\s*[^\n]+$/m, newSer ? `series: ${newSer}` : 'series: ""');

  // 替换 permalink: /notes/<old-col-encoded>/<old-ser-encoded>/<slug>/ → /notes/<new-col>/<new-ser>/<slug>/
  let newPerm = oldPerm;
  if (oldPerm && oldPerm.startsWith('/notes/')) {
    const parts = oldPerm.split('/');
    // parts = ['', 'notes', '<col>', '<ser>', '<slug>']
    if (parts.length >= 5) {
      parts[2] = newCol;
      parts[3] = newSer || 'misc';
      newPerm = parts.join('/');
      // 旧的可能尾斜杠不一致
      if (oldPerm.endsWith('/') && !newPerm.endsWith('/')) newPerm += '/';
    }
  }

  if (newPerm && newPerm !== oldPerm) {
    newFm = newFm.replace(/^permalink:\s*[^\n]+$/m, `permalink: ${newPerm}`);
  }

  const newTxt = `---\n${newFm}\n---\n${body}`;
  fs.writeFileSync(fp, newTxt);
  return { fp, ok: true, oldCol, newCol, oldSer, newSer, newPerm };
}

let ok = 0, fail = 0;
const fails = [];
for (const fn of fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'))) {
  const r = processFile(path.join(POSTS_DIR, fn));
  if (r.ok) ok++;
  else { fail++; fails.push(r); }
}
console.log(`OK: ${ok}  FAIL: ${fail}`);
for (const f of fails) console.log('  FAIL:', f);
