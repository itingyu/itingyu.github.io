#!/usr/bin/env node
'use strict';

// scripts/validate-frontmatter.js
// M6.6 — frontmatter 校验器(YAML 字段类型断言 + 引用路径校验 + typo 检测)
// 纯 Node 内置:require('node:fs') / require('node:path'),不引第三方库。
//
// 用法:
//   node scripts/validate-frontmatter.js [dir] [--strict] [--quiet]
//   dir: 默认为 posts/(相对仓根)
//
// 退出码:
//   0 = 全部通过(或只有 warn)
//   1 = 至少一个 fail
//
// 输出格式(可被 GH Actions / CI 直接消费):
//   <file>: <line>:<col>: [fail|warn] <message>
//   末尾汇总 fail/warn 计数。

const fs = require('node:fs');
const path = require('node:path');

// ============================================================
// 常量(与 design-v2.md §3.2 / 附 B 对齐)
// ============================================================

const KNOWN_KEYS = new Set([
  'title',
  'description', 'excerpt',
  'date',
  'tags',
  'slug',
  'author',
  'cover',
  'series',
  'pinned',
  'draft',
  'canonical',
]);

// 已知 typo 字典:出错键名 → 正确键名(单数/拼错)
const TYPO_MAP = new Map([
  ['dtae', 'date'],
  ['tite', 'title'],
  ['tiel', 'title'],
  ['titel', 'title'],
  ['tag', 'tags'],
  ['tagss', 'tags'],
  ['taags', 'tags'],
  ['descripton', 'description'],
  ['descritpion', 'description'],
  ['descripiton', 'description'],
  ['authro', 'author'],
  ['auhtor', 'author'],
  ['cober', 'cover'],
  ['publihsed', 'date'],
  ['piblished', 'date'],
]);

// draft / pinned 拼错识别
const BOOL_TYPO = new Map([
  ['ture', 'true'],
  ['treu', 'true'],
  ['ture ', 'true'],
  ['flase', 'false'],
  ['fasle', 'false'],
  ['flase ', 'false'],
]);

const TAG_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30})$/;
const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================
// 轻量 YAML 解析(只为 frontmatter 一段,范围:顶层 key:value)
// ============================================================

/**
 * 解析 frontmatter 段(去掉首尾 `---` 后传入)。
 * 返回 { keys: [{name, value, line}], rawLines, bodyOffset }
 *   line 是相对原始文件(1-indexed)
 * 失败抛 { reason, line }。
 */
function parseYamlFrontmatter(text, baseLineOffset = 1) {
  const lines = text.split(/\r?\n/);
  const keys = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过空行 / 注释
    if (trimmed === '' || trimmed.startsWith('#')) {
      i += 1;
      continue;
    }

    // 检查顶层 key
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) {
      throw { reason: `YAML 顶层解析失败(期望 key: value,得到 "${trimmed}")`, line: baseLineOffset + i };
    }
    const key = m[1];
    let rest = m[2];

    // 缩进表示的简单标量:折叠直到非空行或新顶层 key
    // 我们只识别 array inline (`[a, b]`) 或 flow(`a, b, c` 单行),不支持块数组(避免过度工程)
    let value = rest.trim();
    let valueLine = baseLineOffset + i;

    if (value === '' || value === '|' || value === '>') {
      // 块标量 / 空值:此处只接受空值或字面量,块内容(空 array)按空字符串处理
      value = '';
    } else if (value.startsWith('[') && !value.endsWith(']')) {
      throw { reason: `数组 "${key}" 缺少右括号`, line: valueLine };
    } else if (value.startsWith('[') && value.endsWith(']')) {
      // OK,内联数组
    } else if (/^['"]/.test(value) && !/['"]$/.test(value)) {
      throw { reason: `字符串 "${key}" 未闭合`, line: valueLine };
    }

    keys.push({ name: key, value, line: valueLine });
    i += 1;
  }
  return { keys, rawLines: lines };
}

/** 将内联数组 `[a, b, c]` / `a, b, c` 解析为字符串数组 */
function parseInlineArray(value) {
  if (typeof value !== 'string') return [];
  let v = value.trim();
  if (v === '') return [];
  if (v.startsWith('[') && v.endsWith(']')) {
    v = v.slice(1, -1).trim();
  }
  if (v === '') return [];
  return v.split(',').map(s => stripQuotes(s.trim())).filter(s => s !== '');
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseBool(value) {
  const v = stripQuotes(String(value).trim()).toLowerCase();
  if (v === 'true' || v === 'yes') return true;
  if (v === 'false' || v === 'no') return false;
  return undefined;
}

function looksLikeDate(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(stripQuotes(String(value).trim()));
}

// ============================================================
// 错误 / 警告结构
// ============================================================

function makeIssue(filePath, line, severity, msg) {
  return { file: filePath, line, severity, msg };
}

// ============================================================
// 单文件校验
// ============================================================

function validateFile(filePath, repoRoot, strict) {
  const issues = [];

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    issues.push(makeIssue(filePath, 1, 'fail', `无法读取文件: ${err.message}`));
    return issues;
  }

  const lines = raw.split(/\r?\n/);

  // 1. 必须是 `---` 开头
  if (lines.length === 0 || lines[0].trim() !== '---') {
    issues.push(makeIssue(filePath, 1, 'fail', '文件首行不是 `---`,frontmatter 缺失'));
    return issues;
  }

  // 2. 找第二个 `---`
  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx === -1) {
    issues.push(makeIssue(filePath, lines.length, 'fail', 'frontmatter 第二个 `---` 缺失'));
    return issues;
  }

  // 3. frontmatter 文本段
  const fmLines = lines.slice(1, endIdx);
  const fmText = fmLines.join('\n');

  let parsed;
  try {
    parsed = parseYamlFrontmatter(fmText, 2);
  } catch (err) {
    issues.push(makeIssue(filePath, err.line || endIdx, 'fail', err.reason));
    return issues;
  }

  // 4. 索引:key → entry
  const seen = new Map(); // key → [{value, line}] (支持同名键检测)
  for (const k of parsed.keys) {
    if (!seen.has(k.name)) seen.set(k.name, []);
    seen.get(k.name).push(k);
  }

  // 5. 重复键
  for (const [k, arr] of seen.entries()) {
    if (arr.length > 1) {
      for (let i = 1; i < arr.length; i += 1) {
        issues.push(makeIssue(filePath, arr[i].line, 'fail', `重复键 "${k}"`));
      }
    }
  }

  // 6. typo 检测(已知错拼)
  for (const k of parsed.keys) {
    if (KNOWN_KEYS.has(k.name)) continue;
    if (TYPO_MAP.has(k.name)) {
      issues.push(makeIssue(filePath, k.line, 'fail',
        `疑似 typo: "${k.name}:" → 建议 "${TYPO_MAP.get(k.name)}:"`));
    } else {
      issues.push(makeIssue(filePath, k.line, 'warn',
        `未知键 "${k.name}"(已知: ${[...KNOWN_KEYS].join(', ')})`));
    }
  }

  // 7. 必填字段
  const required = ['title', 'date', 'tags', 'cover'];
  // description 或 excerpt 至少其一
  const hasDescription = seen.has('description') || seen.has('excerpt');
  if (!hasDescription) {
    issues.push(makeIssue(filePath, endIdx + 1, 'fail',
      '缺必填字段 "description" 或 "excerpt"(两者其一即足)'));
  }
  for (const r of required) {
    if (!seen.has(r)) {
      issues.push(makeIssue(filePath, endIdx + 1, 'fail', `缺必填字段 "${r}"`));
    }
  }

  // 8. 类型校验
  // title: string,且不含 \n
  const titleEntry = seen.get('title')?.[0];
  if (titleEntry) {
    const tv = stripQuotes(titleEntry.value);
    if (tv === '') {
      issues.push(makeIssue(filePath, titleEntry.line, 'fail', 'title 不能为空字符串'));
    } else if (tv.includes('\n')) {
      issues.push(makeIssue(filePath, titleEntry.line, 'fail', 'title 不能包含换行符'));
    }
  }

  // date: ISO 8601 YYYY-MM-DD(也接受带时间段的)
  const dateEntry = seen.get('date')?.[0];
  if (dateEntry) {
    const dv = stripQuotes(dateEntry.value);
    if (!looksLikeDate(dv)) {
      issues.push(makeIssue(filePath, dateEntry.line, 'fail',
        `date 必须为 ISO 8601(YYYY-MM-DD),得到 "${dv}"`));
    } else {
      // 严格模式 + 未来超过 24h 报警
      const dayPart = dv.slice(0, 10);
      if (!DATE_ISO_RE.test(dayPart)) {
        issues.push(makeIssue(filePath, dateEntry.line, 'fail',
          `date 必须为 YYYY-MM-DD,得到 "${dayPart}"`));
      } else {
        const today = new Date();
        const ymd = new Date(`${dayPart}T00:00:00Z`);
        const diffHours = (ymd.getTime() - today.getTime()) / 3600000;
        if (diffHours > 24) {
          const sev = strict ? 'fail' : 'warn';
          issues.push(makeIssue(filePath, dateEntry.line, sev,
            `date 是未来日期(${dayPart}),超过今天 24h`));
        }
      }
    }
  }

  // tags: array<string>,元素 slug 格式;空数组 = 缺 tags(spec 附 B)
  const tagsEntry = seen.get('tags')?.[0];
  if (tagsEntry) {
    const tv = tagsEntry.value;
    if (tv !== '' && !tv.startsWith('[') && !tv.endsWith(']') && tv.includes(',')) {
      // 隐式 flow array:tags: a, b, c
      // OK
    }
    const arr = parseInlineArray(tv);
    if (arr.length === 0) {
      issues.push(makeIssue(filePath, tagsEntry.line, 'fail',
        'tags 不能为空数组(spec §附 B: 缺 tags 或 tags: [] → fail)'));
    }
    const slugs = new Set();
    for (const t of arr) {
      if (!TAG_SLUG_RE.test(t)) {
        issues.push(makeIssue(filePath, tagsEntry.line, 'fail',
          `tags 元素 "${t}" 不是合法 slug(^[a-z0-9](?:[a-z0-9-]{0,30})$)`));
      }
      if (slugs.has(t)) {
        issues.push(makeIssue(filePath, tagsEntry.line, 'warn', `tags 含重复元素 "${t}"`));
      }
      slugs.add(t);
    }
  }

  // description / excerpt: 必须是 string(非数组/非对象)
  for (const field of ['description', 'excerpt']) {
    const e = seen.get(field)?.[0];
    if (e) {
      const v = stripQuotes(e.value);
      if (v.startsWith('[') && v.endsWith(']')) {
        issues.push(makeIssue(filePath, e.line, 'fail', `${field} 必须是字符串,不能是数组`));
      }
    }
  }

  // draft / pinned: bool(且必须 true / false / yes / no)
  for (const field of ['draft', 'pinned']) {
    const e = seen.get(field)?.[0];
    if (e) {
      const raw = stripQuotes(e.value).toLowerCase();
      const b = parseBool(raw);
      if (b === undefined) {
        if (BOOL_TYPO.has(raw)) {
          issues.push(makeIssue(filePath, e.line, 'fail',
            `疑似 typo: ${field}: ${raw} → 建议 ${field}: ${BOOL_TYPO.get(raw)}`));
        } else {
          issues.push(makeIssue(filePath, e.line, 'fail',
            `${field} 必须为 bool(true / false / yes / no),得到 "${raw}"`));
        }
      }
    }
  }

  // cover: string,且路径在 posts/ 或 assets/ 下存在
  const coverEntry = seen.get('cover')?.[0];
  if (coverEntry) {
    const cv = stripQuotes(coverEntry.value);
    if (cv === '') {
      issues.push(makeIssue(filePath, coverEntry.line, 'fail', 'cover 不能为空字符串'));
    } else if (cv.startsWith('[')) {
      issues.push(makeIssue(filePath, coverEntry.line, 'fail', 'cover 必须是字符串路径,不能是数组'));
    } else if (path.isAbsolute(cv)) {
      issues.push(makeIssue(filePath, coverEntry.line, 'fail',
        `cover 必须是相对路径(以 posts/ 或 assets/ 开头),得到绝对路径 "${cv}"`));
    } else if (!/^posts\//.test(cv) && !/^assets\//.test(cv)) {
      issues.push(makeIssue(filePath, coverEntry.line, 'fail',
        `cover 路径必须以 "posts/" 或 "assets/" 开头,得到 "${cv}"`));
    } else {
      const full = path.join(repoRoot, cv);
      if (!fs.existsSync(full)) {
        const sev = strict ? 'fail' : 'warn';
        issues.push(makeIssue(filePath, coverEntry.line, sev,
          `cover 路径不存在: ${cv}(仓根 ${path.relative(process.cwd(), repoRoot) || '.'})`));
      }
    }
  }

  // slug 与目录名一致性
  const slugEntry = seen.get('slug')?.[0];
  if (slugEntry) {
    const sv = stripQuotes(slugEntry.value);
    const dirName = path.basename(path.dirname(filePath));
    if (sv !== dirName) {
      issues.push(makeIssue(filePath, slugEntry.line, 'fail',
        `slug "${sv}" 与目录名 "${dirName}" 不一致`));
    }
  }

  return issues;
}

// ============================================================
// 目录扫描
// ============================================================

function findMarkdownFiles(rootDir) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
    }
  }
  walk(rootDir);
  return out;
}

// ============================================================
// CLI
// ============================================================

function parseArgs(argv) {
  const args = { dir: null, strict: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--strict') args.strict = true;
    else if (a === '--quiet' || a === '-q') args.quiet = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) {
      // 未知 flag
    } else if (!args.dir) {
      args.dir = a;
    }
  }
  return args;
}

function usage() {
  process.stdout.write([
    '用法: node scripts/validate-frontmatter.js [dir] [--strict] [--quiet]',
    '',
    '参数:',
    '  dir         待校验的目录(递归找 .md),默认 posts/(相对仓根)',
    '  --strict    严格模式(date 未来 / cover 不存在 直接 fail,默认 warn)',
    '  --quiet     只打印失败行,不打印 warn',
    '  -h / --help 显示帮助',
    '',
    '退出码:',
    '  0 = 全合法(或只有 warn)',
    '  1 = 至少一个 fail',
    '',
  ].join('\n'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); process.exit(0); }

  const repoRoot = path.resolve(__dirname, '..');
  const targetDir = path.resolve(args.dir || path.join(repoRoot, 'posts'));

  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    process.stderr.write(`错误:目录不存在或不是目录: ${targetDir}\n`);
    process.exit(1);
  }

  const files = findMarkdownFiles(targetDir);
  if (files.length === 0) {
    process.stdout.write(`未找到任何 .md 文件: ${targetDir}\n`);
    process.exit(0);
  }

  let failCount = 0;
  let warnCount = 0;
  const allIssues = [];

  for (const f of files) {
    const issues = validateFile(f, repoRoot, args.strict);
    for (const it of issues) {
      allIssues.push(it);
      if (it.severity === 'fail') failCount += 1;
      else warnCount += 1;
    }
  }

  // 输出:按文件分组,可读性强
  // 格式:`<relativePath>:<line>: [fail|warn] <msg>`
  const rel = (p) => path.relative(repoRoot, p) || path.relative(process.cwd(), p);
  const grouped = new Map();
  for (const it of allIssues) {
    if (!grouped.has(it.file)) grouped.set(it.file, []);
    grouped.get(it.file).push(it);
  }
  // 稳定排序
  const sortedFiles = [...grouped.keys()].sort();
  for (const f of sortedFiles) {
    const list = grouped.get(f).slice().sort((a, b) => a.line - b.line);
    for (const it of list) {
      if (it.severity === 'warn' && args.quiet) continue;
      const tag = it.severity === 'fail' ? 'fail' : 'warn';
      process.stdout.write(`${rel(f)}:${it.line}: [${tag}] ${it.msg}\n`);
    }
  }

  process.stdout.write(
    `\nvalidate-frontmatter: ${files.length} 个文件,fail=${failCount}, warn=${warnCount}\n`
  );

  process.exit(failCount > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateFile,
  parseYamlFrontmatter,
  parseInlineArray,
  parseBool,
  TYPO_MAP,
  KNOWN_KEYS,
};