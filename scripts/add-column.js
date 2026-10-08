// 给 _posts/ 和 _series/ 加 column 字段(修版:保 closing ---)
const fs = require('fs');
const path = require('path');

const SUB_TO_COL = {
  '编程语言精进': '知识宝典',
  'AI 与大模型工程': '知识宝典',
  '架构设计进阶': '知识宝典',
  '数据与存储': '知识宝典',
  '工程效能': '知识宝典',
  '性能与可靠性': '知识宝典',
  '软实力与职业': '知识宝典',
  '安全与合规': '知识宝典',
  '复盘系列': '知识宝典',
  '股市分析专栏': '知识宝典',
  '入门基础': '股票专栏',
  '看懂公司': '股票专栏',
  '选股与行业': '股票专栏',
  '心理与策略': '股票专栏',
  '实战案例': '股票专栏',
  '量化与跨境': '股票专栏',
  '工具与实操': '股票专栏',
  '估值与周期': '股票专栏',
  '体系方法论': '股票专栏',
  '金融市场观察': '股票专栏',
  'AI 学习笔记': 'AI学习笔记',
  '考驾照': '考驾照',
  '职场调研': '职场调研',
  '厨房学': '厨房学',
};

function parseFM(text) {
  // 允许前置空行/BOM
  const m = text.match(/^\uFEFF?\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  return { fm: m[1], body: m[2], raw: m[0] };
}
function getField(fm, key) {
  const re = new RegExp(`^${key}:`, 'm');
  return re.test(fm);
}
function setField(fm, key, val) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (re.test(fm)) return fm.replace(re, `${key}: ${val}`);
  return `${fm}\n${key}: ${val}`;
}

// === 处理 _series/ ===
let seriesTouched = 0, seriesFixed = 0;
for (const f of fs.readdirSync('_series').filter(x => x.endsWith('.md'))) {
  const fp = path.join('_series', f);
  let txt = fs.readFileSync(fp, 'utf8');
  const p = parseFM(txt);
  if (!p) continue;
  const fmLines = p.fm.split('\n');
  const titleLine = fmLines.find(l => l.startsWith('title:'));
  const title = titleLine ? titleLine.replace(/^title:\s*/, '').trim().replace(/^["']|["']$/g, '') : '';
  const col = SUB_TO_COL[title];
  if (!col) continue;
  if (getField(p.fm, 'column')) continue;
  const newFm = setField(p.fm, 'column', col);
  fs.writeFileSync(fp, `---\n${newFm}\n---\n`, 'utf8');
  seriesTouched++;
}
console.log(`_series touched: ${seriesTouched}`);

// === 处理 _posts/ ===
let postTouched = 0, postFixed = 0, postSkip = 0;
for (const f of fs.readdirSync('_posts').filter(x => x.endsWith('.md'))) {
  const fp = path.join('_posts', f);
  let txt = fs.readFileSync(fp, 'utf8');
  const p = parseFM(txt);
  if (!p) { postSkip++; continue; }
  // 修破文件: 找 series 字段,看 column 是不是直接追加在 series 后(无 closing ---)
  const hasClosingFence = /---\r?\n[^\-]/.test(txt.slice(p.raw.length));
  // 简单: 检查原 raw 后内容是不是 # 或其他 markdown,意味着 closing --- 没了
  const afterRaw = txt.slice(p.raw.length);
  const isBody = afterRaw.match(/^#\s/);
  // 总是先把 raw 提取成 fm+body,重写完整
  if (getField(p.fm, 'column')) {
    // 有 column 但前面可能被破坏
    if (isBody) {
      // raw 还包含 body。重写
      fs.writeFileSync(fp, `---\n${p.fm}\n---\n${afterRaw}`, 'utf8');
      postFixed++;
    }
    continue;
  }
  const seriesLine = p.fm.split('\n').find(l => l.startsWith('series:'));
  const series = seriesLine ? seriesLine.replace(/^series:\s*/, '').trim().replace(/^["']|["']$/g, '') : null;
  if (!series || series === 'null') { postSkip++; continue; }
  const col = SUB_TO_COL[series];
  if (!col) { postSkip++; continue; }
  const newFm = setField(p.fm, 'column', col);
  // 修:保 closing ---
  fs.writeFileSync(fp, `---\n${newFm}\n---\n${p.body}`, 'utf8');
  postTouched++;
}
console.log(`_posts touched: ${postTouched}, fixed broken: ${postFixed}, skipped: ${postSkip}`);
