#!/usr/bin/env node
// migrate-from-mkdocs.js · 把 aliyun1 /notes/ 下的 mkdocs MD 迁到 Jekyll _posts/
// 协议:design-v3 §6.6 (跨主机内容迁移)
//
// 用法:
//   node scripts/migrate-from-mkdocs.js --config scripts/config/migrate-pilot.json
//   node scripts/migrate-from-mkdocs.js --src "/notes/知识宝典/01-编程语言精进/1.1.1-*.md" --series 编程语言精进
//   node scripts/migrate-from-mkdocs.js --list   # 列出 /notes/ 所有可迁 MD
//   node scripts/migrate-from-mkdocs.js --dry-run --config ...
//
// 输出:stdout JSONL {ok, src, dst, title, series, tags, bytes} 或 {ok:false, src, error}

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SSH_HOST = 'aliyun1';
const NOTES_ROOT = '/notes';
const POSTS_DIR = path.join(process.cwd(), '_posts');
const SERIES_DIR = path.join(process.cwd(), '_series');

const TZ_OFFSET = '+0800';

// === CLI 解析 ============================================================
function parseArgs(argv) {
  const args = { dryRun: false, list: false, overwrite: false, autoAll: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--list') args.list = true;
    else if (a === '--overwrite') args.overwrite = true;
    else if (a === '--auto-all') args.autoAll = true;
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--src') args.src = argv[++i];
    else if (a === '--src-dir') args.srcDir = argv[++i];
    else if (a === '--series') args.series = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
  }
  return args;
}

// === 数据源:SSH 或本地 ==================================================
function readSource(srcArg) {
  // srcArg 形如 "/notes/AI学习笔记/01-.../Day01.md" 或相对本地路径
  if (srcArg.startsWith('/notes/') || srcArg.startsWith('/')) {
    // 远端 SSH
    const remote = srcArg;
    const localMirror = path.join('/tmp/notes-import', remote.replace(/^\/notes\//, ''));
    if (fs.existsSync(localMirror)) {
      return fs.readFileSync(localMirror, 'utf8');
    }
    return execFileSync('ssh', [SSH_HOST, `cat ${shellQuote(remote)}`], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  return fs.readFileSync(srcArg, 'utf8');
}
function sshFind(glob) {
  // 优先用本地镜像(批量迁时用)
  const mirror = '/tmp/notes-import';
  if (fs.existsSync(mirror)) {
    return walkMirror(mirror, '').map((p) => '/notes/' + p);
  }
  const out = execFileSync(
    'ssh',
    [SSH_HOST, `find ${shellQuote(NOTES_ROOT)} -type f -name "*.md" 2>/dev/null | sort`],
    { encoding: 'utf8' }
  );
  return out.split('\n').filter(Boolean);
}
function walkMirror(dir, prefix) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMirror(p, path.join(prefix, e.name)));
    else if (e.name.endsWith('.md')) out.push(path.join(prefix, e.name));
  }
  return out.sort();
}
function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// === front matter 解析 ==================================================
function splitFrontmatter(md) {
  // 匹配文件首段 `---...---` 包裹的 YAML(允许前置空行/空白)
  const m = md.match(/^\uFEFF?\s*---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { fm: {}, body: md, raw: '' };
  const raw = m[1];
  const body = m[2];
  // 极简 YAML:只解析 `key: value` 与 `key: [a, b]`(够用,mkdocs 没用嵌套结构)
  const fm = {};
  for (const line of raw.split(/\r?\n/)) {
    const km = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!km) continue;
    const k = km[1];
    let v = km[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else {
      v = unquote(v);
    }
    fm[k] = v;
  }
  return { fm, body, raw };
}
function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// === 字段归一 ===========================================================
function normalize(fm) {
  const out = { ...fm };
  // date: 优先 date, 次之 created, 都无则 1970-01-01 兜底
  const d = (fm.date || fm.created || '1970-01-01').toString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error(`bad date format: ${d} (src=${JSON.stringify(fm)})`);
  }
  out.date = `${d} 00:00:00 ${TZ_OFFSET}`;

  // subtitle → 并入 title
  if (fm.subtitle) {
    out.title = `${out.title}（${fm.subtitle}）`;
  }

  // category 归一:
  //  "知识宝典 · 编程语言精进 · Go 专题"        → 编程语言精进 (取中间段)
  //  "02-AI 与大模型工程"                       → AI 与大模型工程 (剥 "NN-" 前缀)
  if (fm.category && typeof fm.category === 'string') {
    const parts = fm.category.split(/[·]/).map((s) => s.trim()).filter(Boolean);
    let s = parts.length >= 2 ? parts[1] : parts[0];
    s = String(s).replace(/^\d{2}-/, '');   // 剥 "01-" "02-" 这类目录前缀
    // 归一: "AI与大模型工程" → "AI 与大模型工程" (与 _series/ 登记保持一致)
    s = s.replace(/AI与大模型工程/, 'AI 与大模型工程');
    if (s && s !== '知识宝典' && s !== '股票专栏' && s !== 'AI学习笔记') {
      out.series = s;
    }
  }

  // excerpt: 优先 description, 否则从 body 第一段提
  if (!out.excerpt && fm.description) {
    out.excerpt = String(fm.description).replace(/\n/g, ' ').slice(0, 200);
  }

  return out;
}

// === slug & 路径 ========================================================
function slugify(s) {
  return s
    .replace(/^\d{4}-\d{2}-\d{2}\s*/, '') // 剥 "2026-07-13 " 之类日期前缀(防双日期)
    .replace(/[（(][^）)]+[）)]/g, '')   // 去中英文括号里的副标题
    .replace(/·/g, '-')                  // 中点统一为短横
    .replace(/[・|｜]/g, '-')            // 日文点 + 全角竖线
    .replace(/[\s_]+/g, '-')             // 空白与下划线
    .replace(/[^\w\u4e00-\u9fa5-]/g, '') // 去标点(保留中文)
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 50);                       // 截断 50 字符
}
function postFilename(date, title) {
  return `${date.slice(0, 10)}-${slugify(title)}.md`;
}

// === body 重写 =========================================================
function rewriteBody(body, series) {
  let b = body;
  // 1) mkdocs 链接 `[X](相对路径)` → Jekyll 保持相对即可(Jekyll server 会解)
  //    但 _posts/ 内部链接若指向 ../xxx/ 不动(Jekyll 能算)
  // 2) 图片 `./assets/X.png` → 保留(assets/ 在 repo 根,Jekyll 复制到 _site)
  // 3) H1 已经在 mkdocs 内联 front matter 写了 title,删除 body 里的 H1 防重
  //    允许前置空行
  b = b.replace(/^\s*# [^\n]*\r?\n/, '');
  return b;
}

// === series 校验 ========================================================
function knownSeries() {
  if (!fs.existsSync(SERIES_DIR)) return new Set();
  return new Set(
    fs
      .readdirSync(SERIES_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name.replace(/\.md$/, ''))
  );
}

// === 单条迁移 ==========================================================
function migrateOne(remotePath, overrides, known, dryRun, overwrite) {
  if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
  }
  // 跳过 README.md / index.md(不是文章,是索引页)
  if (/\/(README|index)\.md$/.test(remotePath)) {
    return { ok: false, src: remotePath, skip: 'README/index', reason: '索引页' };
  }
  const md = readSource(remotePath);
  const { fm, body } = splitFrontmatter(md);
  const n = normalize({ ...fm, ...overrides });
  // overrides 优先
  if (overrides && overrides.series) n.series = overrides.series;
  if (overrides && overrides.tags) n.tags = overrides.tags;
  if (overrides && overrides.excerpt) n.excerpt = overrides.excerpt;

  // path-based fallback:无 series 时从路径推
  if (!n.series) {
    // 3 级: /notes/知识宝典/03-架构设计进阶/3.6.1-...md → series="架构设计进阶"
    const m3 = remotePath.match(/^\/notes\/([^/]+)\/([^/]+)\/[^/]+\.md$/);
    if (m3) {
      const [_, lvl1, lvl2] = m3;
      // 股票专栏/NN-子系列/xx-yy-...md → "NN-子系列" 剥前缀 → 子系列名
      if (lvl1 === '股票专栏') {
        n.series = lvl2.replace(/^\d{2}-/, '');
      } else if (lvl1 === 'AI学习笔记') {
        n.series = 'AI 学习笔记';
      } else if (lvl1 === '知识宝典') {
        // 知识宝典/NN-二级/... → 二级系列
        n.series = lvl2.replace(/^\d{2}-/, '');
      } else if (lvl1 === '考驾照') {
        n.series = '考驾照';
      } else if (lvl1 === '职场调研') {
        n.series = '职场调研';
      }
    }
    // 2 级: /notes/职场调研/xx.md 或 /notes/AI学习笔记/xx.md
    if (!n.series) {
      const m2 = remotePath.match(/^\/notes\/([^/]+)\/[^/]+\.md$/);
      if (m2) {
        const [_, lvl1] = m2;
        n.series = lvl1 === 'AI学习笔记' ? 'AI 学习笔记'
          : lvl1 === '考驾照' ? '考驾照'
          : lvl1 === '职场调研' ? '职场调研'
          : lvl1 === '股票专栏' ? '金融市场观察'
          : lvl1 === '知识宝典' ? '知识宝典'
          : lvl1;
      }
    }
  }

  const date = n.date.slice(0, 10);
  const fname = postFilename(date, n.title);
  const dst = path.join(POSTS_DIR, fname);

  // 冲突检查
  if (fs.existsSync(dst) && !overwrite && !overrides?.force) {
    return { ok: false, src: remotePath, dst, skip: 'exists' };
  }

  // 校验 series 是否在 _series/ 登记
  if (n.series && !known.has(n.series)) {
    return { ok: false, src: remotePath, dst, error: `series 未知: ${n.series}（_series/ 未登记）` };
  }

  const yamlFm = renderFrontmatter(n);
  const newBody = rewriteBody(body, n.series);
  const out = `---\n${yamlFm}---\n\n${newBody}`;

  if (!dryRun) {
    fs.writeFileSync(dst, out, 'utf8');
  }
  return {
    ok: true,
    src: remotePath,
    dst,
    title: n.title,
    series: n.series || null,
    tags: n.tags || [],
    date,
    bytes: Buffer.byteLength(out, 'utf8'),
    dryRun,
  };
}

function renderFrontmatter(n) {
  const lines = [];
  lines.push('layout: post');
  lines.push(`title: ${JSON.stringify(n.title)}`);
  lines.push(`date: ${n.date}`);
  if (n.series) lines.push(`series: ${JSON.stringify(n.series)}`);
  if (n.tags && n.tags.length) {
    lines.push('tags:');
    for (const t of n.tags) lines.push(`  - ${JSON.stringify(t)}`);
  }
  lines.push(`excerpt: ${JSON.stringify(n.excerpt || '')}`);
  lines.push('pinned: false');
  lines.push('cover: null');
  lines.push('draft: false');
  return lines.join('\n') + '\n';
}

// === list 模式 ==========================================================
function listAll() {
  const all = sshFind('*.md');
  for (const p of all) {
    try {
      const md = readSource(p);
      const isIndex = /\/(README|index)\.md$/.test(p);
      const { fm } = splitFrontmatter(md);
      const n = normalize(fm);
      // 与 migrateOne 同步跑 path-fallback
      if (!n.series) {
        const m3 = p.match(/^\/notes\/([^/]+)\/([^/]+)\/[^/]+\.md$/);
        if (m3) {
          const [_, lvl1, lvl2] = m3;
          if (lvl1 === '股票专栏') n.series = lvl2.replace(/^\d{2}-/, '');
          else if (lvl1 === 'AI学习笔记') n.series = 'AI 学习笔记';
          else if (lvl1 === '知识宝典') n.series = lvl2.replace(/^\d{2}-/, '');
          else if (lvl1 === '考驾照') n.series = '考驾照';
          else if (lvl1 === '职场调研') n.series = '职场调研';
        }
        if (!n.series) {
          const m2 = p.match(/^\/notes\/([^/]+)\/[^/]+\.md$/);
          if (m2) {
            const [_, lvl1] = m2;
            n.series = lvl1 === 'AI学习笔记' ? 'AI 学习笔记'
              : lvl1 === '考驾照' ? '考驾照'
              : lvl1 === '职场调研' ? '职场调研'
              : lvl1 === '股票专栏' ? '金融市场观察'
              : lvl1 === '知识宝典' ? '知识宝典'
              : lvl1;
          }
        }
      }
      console.log(JSON.stringify({ src: p, title: n.title, date: n.date, series: n.series || null, tags: n.tags || [], isIndex }));
    } catch (e) {
      console.log(JSON.stringify({ src: p, error: String(e.message || e) }));
    }
  }
}

// === config 模式 ========================================================
function loadConfig(p) {
  const txt = fs.readFileSync(p, 'utf8');
  return JSON.parse(txt);
}

// === main ==============================================================
function main() {
  const args = parseArgs(process.argv);
  const known = knownSeries();

  if (args.list) {
    return listAll();
  }

  const items = [];
  if (args.autoAll) {
    // 全量:从本地镜像扫所有 MD(跳 README/index),由 path-fallback 自动推 series
    const all = sshFind('*.md');
    for (const p of all) {
      if (/\/(README|index)\.md$/.test(p)) continue;
      items.push({ src: p, overrides: {} });
    }
  } else if (args.config) {
    const cfg = loadConfig(args.config);
    for (const it of cfg.items) {
      items.push({ src: it.src, overrides: it });
    }
  } else if (args.src) {
    const paths = sshFind(args.src);
    const limited = args.limit ? paths.slice(0, args.limit) : paths;
    for (const p of limited) {
      items.push({ src: p, overrides: args.series ? { series: args.series } : {} });
    }
  } else {
    console.error('用法: --auto-all | --config <json> | --src <glob> [--series X] [--limit N]');
    process.exit(2);
  }

  let ok = 0, fail = 0;
  for (const it of items) {
    try {
      const r = migrateOne(it.src, it.overrides, known, args.dryRun, args.overwrite);
      console.log(JSON.stringify(r));
      if (r.ok) ok++;
      else if (r.skip === 'exists') { /* skip silently */ }
      else fail++;
    } catch (e) {
      fail++;
      console.log(JSON.stringify({ ok: false, src: it.src, error: String(e.message || e) }));
    }
  }
  console.error(`\n=== done: ${ok} ok / ${fail} fail / ${items.length} total ===`);
  process.exit(fail === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { splitFrontmatter, normalize, slugify, migrateOne };
