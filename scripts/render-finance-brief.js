#!/usr/bin/env node
/* render-finance-brief.js
 *
 * 把金融小队产出的 Markdown 简报渲染成 itingyu.github.io 的一篇博客文章。
 *
 * 设计目标:
 *   - 纯 Node 内置模块(无第三方依赖)。
 *   - 输出的 HTML 与 posts/welcome/index.html 同构(head / meta / JSON-LD / 主题脚本 / footer)。
 *   - front matter 一律进 <meta> + JSON-LD;不入 HTML 注释。
 *   - 输出文件名由 --slug 决定,落在 posts/<slug>/index.html。
 *   - 自动维护 posts/index.html 与 archive/index.html(手写加项,不删旧项)。
 *
 * 已知约束(README/设计稿):
 *   - 不自动 commit / push。完成后打印 git 命令,让人 review。
 *   - 不调 multica CLI —— 这个脚本只吃本地 .md;取附件留给 finance-sync.sh。
 *
 * 用法:
 *   node scripts/render-finance-brief.js \
 *     --input path/to/brief.md \
 *     --date 2026-09-26 \
 *     --slug finance-2026-09-26 \
 *     [--title "金融每日简报 · 2026-09-26"] \
 *     [--excerpt "..."] \
 *     [--cover <name>] \
 *     [--help]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// M6.1: shared Markdown renderer (17-feature grammar set). The 17 features
// in scripts/markdown.js are the canonical source of truth; this file keeps
// its finance-specific extensions (paintTickers, table layout) layered on
// top. M6.6 will switch this file to fully delegate to renderMarkdown().
const sharedMarkdown = require('./markdown.js');

const TAG_SLUG = 'finance';
const TAG_LABEL = '金融';
const ARTICLE_SECTION = 'Finance';
const DISCLAIMER_TEXT =
  '本站内容均为个人观点,所涉及的金融标的仅供学习研究使用,不构成任何投资建议。据此操作,风险自担。';

const USAGE = `用法:
  node scripts/render-finance-brief.js \\
    --input <markdown-file> \\
    --date <YYYY-MM-DD> \\
    --slug <post-slug> \\
    [--title "<title>"] \\
    [--excerpt "<excerpt>"] \\
    [--cover <name>]

参数:
  --input     金融小队产出的 Markdown 简报(必填)
  --date      发布日期,YYYY-MM-DD(必填)
  --slug      文章 slug,会生成 posts/<slug>/index.html(必填)
  --title     文章标题;缺省取 md 第一行 # 标题
  --excerpt   摘要;缺省取 md 第一段正文
  --cover     封面图文件名(放在 posts/<slug>/ 下,如 cover.svg)
  --help      输出本帮助

示例:
  node scripts/render-finance-brief.js \\
    --input brief-2026-09-26.md \\
    --date 2026-09-26 \\
    --slug finance-2026-09-26
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--input') {
      args.input = argv[++i];
    } else if (a === '--date') {
      args.date = argv[++i];
    } else if (a === '--slug') {
      args.slug = argv[++i];
    } else if (a === '--title') {
      args.title = argv[++i];
    } else if (a === '--excerpt') {
      args.excerpt = argv[++i];
    } else if (a === '--cover') {
      args.cover = argv[++i];
    } else if (a && a.startsWith('--')) {
      throw new Error(`未知参数: ${a}`);
    } else {
      args._.push(a);
    }
  }
  return args;
}

function die(msg) {
  process.stderr.write(`render-finance-brief: ${msg}\n`);
  process.exit(1);
}

function assertDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    die(`--date 必须是 YYYY-MM-DD 形式,得到: ${s}`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) die(`--date 不是合法日期: ${s}`);
  return s;
}

function assertSlug(s) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(s)) {
    die(`--slug 必须是小写字母/数字/短横线,得到: ${s}`);
  }
  return s;
}

/* ---------- markdown 渲染器(最小集合) ---------- */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

/* 把 frontmatter tag 名转成 URL slug(/tags/<slug>/ 用)。
 * 与 build-index.js:slugifyTag 语义对齐:小写、空格/斜杠转 -、保留 CJK、
 * 纯符号兜底为 "tag"。当原始名就是 '金融' 时回退到 finance,保持与历史页面兼容。
 */
function slugifyTagForFinance(name) {
  const s = String(name).trim();
  if (s === '金融' || s.toLowerCase() === 'finance') return 'finance';
  return (
    s
      .toLowerCase()
      .replace(/[\s/]+/g, '-')
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'tag'
  );
}

/* 解析最简 YAML frontmatter 段(若存在)。
 *
 * 约定:首行(去前后空白后)必须匹配 /^---+\s*$/ 才视为 frontmatter 起始;
 *      之后逐行收集 `key: value`,再次匹配 /^---+\s*$/ 即闭合。
 *
 * 支持的 value 类型(最小集合,够金融小队日常用法):
 *   - 裸字符串:   description: 2026-09-28 交易日...
 *   - 引号字符串: title: "每日金融简报 · 2026-09-28"
 *   - inline 数组:tags: ["finance", "daily-brief", "a-share"]
 *   - 布尔:       draft: true / draft: false
 *   - 数字:       date: 2026-09-28
 *
 * 返回 { data, endLine }:
 *   - data: 解析后的对象,无 frontmatter 时为 null
 *   - endLine: 闭合 `---` 的行下标(0-based),无 frontmatter 时为 0
 *           调用方应跳过 lines[0..endLine],从 endLine + 1 开始渲染正文
 */
function parseFrontmatter(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  if (lines.length === 0 || !/^---+\s*$/.test(lines[0])) {
    return { data: null, endLine: 0 };
  }
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^---+\s*$/.test(line)) {
      return { data: out, endLine: i };
    }
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue; // 跳过空行 / 不识别的行
    out[m[1]] = coerceYamlValue(m[2].trim());
  }
  // 没有闭合 fence → 当作没有 frontmatter,避免误吞正文
  return { data: null, endLine: 0 };
}

function coerceYamlValue(raw) {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return parseYamlInlineArray(raw.slice(1, -1));
  }
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

/* 把 "a, b, \"c, d\"" 拆成 ["a", "b", "c, d"]。引号内的逗号不拆。 */
function parseYamlInlineArray(inner) {
  const out = [];
  let buf = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      buf += c;
    } else if (c === ',') {
      const v = buf.trim();
      if (v) out.push(coerceYamlValue(v));
      buf = '';
    } else {
      buf += c;
    }
  }
  const tail = buf.trim();
  if (tail) out.push(coerceYamlValue(tail));
  return out;
}

/* 把 6 位代码 + 涨跌幅(允许跨多空格)替换成 ticker/delta span。
 * 必须先 escape 再 replace,避免替换尖括号。
 *
 * 不用 \b:JS 中 \w 不会匹配中文,所以中日字符与数字之间没有 word boundary,
 * 用 (?<![\w.]) 限制 ticker 前面不是 . 或 word char 来收紧边界。
 */
function paintTickers(escaped) {
  return escaped.replace(
    /(?<![\w.])(\d{6})(\s+)([+-]\d+(?:\.\d+)?%)/g,
    (_, ticker, ws, delta) => {
      const isUp = delta.startsWith('+');
      const cls = isUp ? 'delta-up' : 'delta-down';
      return `<span class="ticker">${ticker}</span>${ws}<span class="${cls}">${delta}</span>`;
    },
  );
}

/* 行内:代码 -> 粗体 -> 斜体 -> 标的价格 -> 自动链接 */
function renderInline(text) {
  let s = escapeHtml(text);

  s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);

  s = s.replace(/\*\*([^*]+)\*\*/g, (_, inner) => `<strong>${inner}</strong>`);
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, (_, lead, inner) => `${lead}<em>${inner}</em>`);

  s = paintTickers(s);

  // 自动外链:http(s)://...
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" rel="noopener">${m}</a>`);

  return s;
}

/* 渲染单个表格 cell(应用 ticker 染色 + 其它行内规则)。 */
function renderCell(text) {
  // 表格里常见 [代码, 名称, 收盘价, 涨跌幅] 四列。
  // 涨跌幅单独成格时,如果该 cell 是 +/- 百分比,就保持原样;否则正常 inline 渲染。
  return renderInline(text);
}

/* 解析整篇 md。返回 { title, body(HTML), excerpt, frontmatter } */
function renderMarkdown(md) {
  const normalized = md.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  // 先剥离 YAML frontmatter(若有),返回 { data, endLine }
  const { data: frontmatter, endLine: fmEndLine } = parseFrontmatter(normalized);
  const fm = frontmatter || {};
  let i = fmEndLine > 0 ? fmEndLine + 1 : 0;
  // 跳过闭合 fence 后那个空行(常见的 markdown 写法)
  if (i < lines.length && lines[i].trim() === '') i++;

  const out = [];
  let title = null;
  let excerpt = null;

  // 表格辅助:累积表格起始/对齐/数据行,遇非表格行就 flush。
  function flushTable(buf) {
    if (!buf) return null;
    if (buf.rows.length < 2) {
      // 没有表头/对齐行 → 退化为普通段落
      return buf.rows.map((r) => `<p>${r.map(renderInline).join(' | ')}</p>`).join('\n');
    }
    const header = buf.rows[0];
    const bodyRows = buf.rows.slice(2);
    const headHtml =
      '<thead><tr>' +
      header.map((c) => `<th>${renderInline(c)}</th>`).join('') +
      '</tr></thead>';

    const bodyHtml =
      '<tbody>' +
      bodyRows
        .map((r) => {
          // 表格行染色:若某 cell 是 6 位数字,把它包成 ticker span;
          // 另一个 cell 是 +/- 百分比,包成 delta-up / delta-down span。
          const tickerIdx = r.findIndex((c) => /^\d{6}$/.test(c.trim()));
          const deltaIdx = r.findIndex(
            (c) => /^[+-]\d+(?:\.\d+)?%$/i.test(c.trim()),
          );
          const newRow = r.slice();
          if (tickerIdx >= 0) {
            newRow[tickerIdx] = `<span class="ticker">${r[tickerIdx].trim()}</span>`;
          }
          if (deltaIdx >= 0 && deltaIdx !== tickerIdx) {
            const raw = r[deltaIdx].trim();
            const cls = raw.startsWith('+') ? 'delta-up' : 'delta-down';
            newRow[deltaIdx] = `<span class="${cls}">${raw}</span>`;
          }
          return (
            '<tr>' +
            newRow.map((c) => `<td>${c.startsWith('<span') ? c : renderCell(c)}</td>`).join('') +
            '</tr>'
          );
        })
        .join('') +
      '</tbody>';
    return `<table class="brief-table">${headHtml}${bodyHtml}</table>`;
  }

  while (i < lines.length) {
    const line = lines[i];

    // 跳过纯空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 分隔线 ---
    if (/^---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) {
        // H1 既作为 title,又作为文章主标题。
        // 但 article-header 已经输出了一个 <h1>,正文里再重复一次会很丑;
        // 所以:第一条 H1 仅提取 title,跳过输出;后续 H1 才渲染。
        if (title === null) {
          title = text;
          i++;
          continue;
        }
        out.push(`<h${level}>${renderInline(text)}</h${level}>`);
        i++;
        continue;
      }
      out.push(`<h${level}>${renderInline(text)}</h${level}>`);
      i++;
      continue;
    }

    // 引用(支持连续行)
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${buf.map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }

    // 表格(连续 | 起头)
    if (/^\|/.test(line)) {
      const buf = { rows: [] };
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i]
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
        buf.rows.push(cells);
        i++;
      }
      const html = flushTable(buf);
      if (html) out.push(html);
      continue;
    }

    // 无序列表
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (
        i < lines.length &&
        (/^[-*+]\s+/.test(lines[i]) || (items.length && lines[i].trim() !== '' && !/^[#>\|]/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])))
      ) {
        if (/^[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^[-*+]\s+/, ''));
          i++;
        } else {
          // 续行(简单处理:折到上一项)
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
      }
      out.push(
        '<ul>' + items.map((it) => `<li>${renderInline(it)}</li>`).join('') + '</ul>',
      );
      continue;
    }

    // 段落(连续非空行)
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^[-*+]\s+/.test(lines[i]) &&
      !/^\|/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    const paraText = para.join(' ').trim();
    if (paraText) {
      const html = `<p>${renderInline(paraText)}</p>`;
      out.push(html);
      if (excerpt === null) excerpt = paraText;
    }
  }

  if (title === null) {
    // 优先级:frontmatter.title > 默认占位
    if (fm.title) title = String(fm.title);
    else title = '金融每日简报';
  }

  return { title, body: out.join('\n'), excerpt, frontmatter: fm };
}

/* ---------- 页面装配 ---------- */

function escapeJsonLd(s) {
  // JSON-LD 里只会有双引号 / 反斜杠 / 换行需要转义
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderPage({ title, slug, date, excerpt, body, cover = null, tags = null }) {
  const canonical = `https://itingyu.github.io/posts/${slug}/`;
  const editUrl = `https://github.com/itingyu/itingyu.github.io/edit/master/posts/${slug}/index.html`;
  const dateCN = date; // YYYY-MM-DD 本身就是 ISO 排版,符合站点其他页面
  const coverURL = cover ? `https://itingyu.github.io/posts/${slug}/${cover}` : null;

  // tag 渲染:frontmatter.tags 优先;缺省回退到单 tag「金融」(向后兼容 9/27 简报)
  // tags 是 string[](原始名);每个 tag 同时:
  //   1) 写一条 <meta property="article:tag"> 让 build-index 收下做 tags/index 聚合与 search-index
  //   2) 在 article-header 渲一个 <a class="chip">,data-tag 用 slugified 形式供 chip 解析
  // 第一个 tag 作为 primary(用于 chip 与 breadcrumb 决定)
  const effectiveTags = Array.isArray(tags) && tags.length > 0 ? tags : [TAG_LABEL];
  const tagMeta = effectiveTags
    .map((t) => `  <meta property="article:tag" content="${escapeHtml(String(t))}" />`)
    .join('\n');
  const primaryTag = effectiveTags[0];
  const primarySlug = slugifyTagForFinance(primaryTag);
  const primaryName = String(primaryTag);

  const jsonLd = JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: title,
      datePublished: date,
      dateModified: date,
      author: { '@type': 'Person', name: 'itingyu' },
      url: canonical,
      description: excerpt,
      articleSection: ARTICLE_SECTION,
      keywords: [...effectiveTags, '金融市场', '每日简报'],
    },
    null,
    2,
  );

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} · itingyu</title>
  <meta name="description" content="${escapeHtml(excerpt)}" />
  <meta name="author" content="itingyu" />
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
  <link rel="canonical" href="${canonical}" />

  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(excerpt)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:locale" content="zh_CN" />
  <meta property="article:published_time" content="${date}" />
  <meta property="article:author" content="itingyu" />
${tagMeta}${coverURL ? `\n  <meta property="og:image" content="${coverURL}" />` : ''}

  <!-- JSON-LD -->
  <script type="application/ld+json">
${jsonLd}
  </script>

  <script>
    (function(){
      try {
        var t = localStorage.getItem('itingyu-theme');
        if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', t);
      } catch (_) {}
    })();
  </script>
  <link rel="stylesheet" href="/assets/style.css" />
  <script defer src="/assets/theme.js"></script>
</head>
<body>
  <div class="reading-progress" data-reading-progress aria-hidden="true"></div>
  <a class="skip-link" href="#main">跳到正文</a>

  <header class="site-header">
    <a class="site-brand" href="/">
      <span class="site-brand-mark">i</span>
      <span>itingyu</span>
    </a>
    <nav class="site-nav" aria-label="主导航">
      <a href="/">首页</a>
      <a href="/posts/">文章</a>
      <a href="/archive/">归档</a>
      <a href="/tags/">标签</a>
      <a href="/about/">关于</a>
      <button class="theme-toggle" type="button"
              aria-label="切换主题" data-theme-toggle>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
      </button>
    </nav>
  </header>

  <main id="main" class="container">
    <article>
      <header class="article-header">
        <h1>${escapeHtml(title)}</h1>
        <div class="post-meta">
          <time datetime="${date}">${dateCN}</time>
          <span class="dot">·</span>
          <a class="chip" href="/tags/${primarySlug}/" data-tag="${primarySlug}">${escapeHtml(primaryName)}</a>
          <span class="dot">·</span>
          <span data-reading-time>约 1 分钟</span>
        </div>
        <p class="post-excerpt">${escapeHtml(excerpt)}</p>
      </header>${coverURL ? `\n      <img class="post-cover" src="${coverURL}" alt="${escapeHtml(title)}封面" loading="lazy" />` : ''}

      ${body}

      <div class="callout callout-warn">
        <strong>免责声明</strong> · ${DISCLAIMER_TEXT}
      </div>
      <!-- build:related -->
    </article>

    <footer class="article-footer">
      <p>本页最后更新:${date} · 发现错别字?<a href="${editUrl}" rel="noopener">在 GitHub 上编辑</a>。</p>
    </footer>
  </main>

  <footer class="site-footer">
    <div class="links">
      <a href="/">首页</a>
      <a href="/posts/">文章</a>
      <a href="/archive/">归档</a>
      <a href="/about/">关于</a>
      <a href="/feeds/rss.xml">RSS</a>
      <a href="https://github.com/itingyu" rel="noopener">GitHub</a>
    </div>
    <p>&copy; 2026 itingyu · 内容仅供参考,不构成投资建议。</p>
  </footer>
</body>
</html>
`;
}

/* ---------- 索引页手写增量 ---------- */

const POST_LIST_ITEM = (title, slug, date, excerpt) => `      <li>
        <h3 class="post-title"><a href="/posts/${slug}/">${escapeHtml(title)}</a></h3>
        <div class="post-meta">
          <time datetime="${date}">${date}</time>
          <span class="dot">·</span>
          <a class="chip" href="/tags/${TAG_SLUG}/" data-tag="${TAG_SLUG}">${TAG_LABEL}</a>
        </div>
        <p class="post-excerpt">${escapeHtml(excerpt)}</p>
      </li>
`;

function updatePostsIndex(repoRoot, { title, slug, date, excerpt }) {
  const file = path.join(repoRoot, 'posts', 'index.html');
  if (!fs.existsSync(file)) {
    process.stderr.write(`warn: 缺少 ${file},跳过 posts/index.html 更新\n`);
    return;
  }
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes(`href="/posts/${slug}/"`)) {
    process.stderr.write(`info: posts/${slug} 已在 posts/index.html,跳过\n`);
    return;
  }
  const item = POST_LIST_ITEM(title, slug, date, excerpt);
  // 在 <ul class="post-list"> 后插入(保持时间倒序:新文插顶部)
  const re = /(<ul class="post-list">\s*\n)/;
  if (!re.test(html)) die('posts/index.html 找不到 <ul class="post-list">,请人工处理');
  html = html.replace(re, `$1${item}`);
  fs.writeFileSync(file, html);
}

function updateArchiveIndex(repoRoot, { title, slug, date }) {
  const file = path.join(repoRoot, 'archive', 'index.html');
  if (!fs.existsSync(file)) {
    process.stderr.write(`warn: 缺少 ${file},跳过 archive/index.html 更新\n`);
    return;
  }
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes(`href="/posts/${slug}/"`)) {
    process.stderr.write(`info: posts/${slug} 已在 archive/index.html,跳过\n`);
    return;
  }

  const [y, m] = date.split('-');
  const groupTitle = `${y} 年 ${parseInt(m, 10)} 月`;

  const entry = `        <li>
          <time datetime="${date}">${date.slice(5).replace('-', '-')}</time>
          <a href="/posts/${slug}/">${escapeHtml(title)}</a>
        </li>
`;

  // 是否已有该月分组
  const groupRe = new RegExp(
    `(<div class="archive-group">\\s*\\n\\s*<h3>${groupTitle}</h3>\\s*\\n\\s*<ul>\\s*\\n)`,
  );
  if (groupRe.test(html)) {
    html = html.replace(groupRe, (m) => `${m}${entry}`);
  } else {
    // 在 </main> 前插入新分组
    const newGroup = `    <div class="archive-group">
      <h3>${groupTitle}</h3>
      <ul>
${entry}      </ul>
    </div>
`;
    html = html.replace(/(<\/main>)/, `${newGroup}$1`);
  }
  fs.writeFileSync(file, html);
}

/* ---------- main ---------- */

function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (!args.input || !args.date || !args.slug) {
    process.stderr.write(`缺少必填参数\n\n${USAGE}`);
    process.exit(2);
  }

  const date = assertDate(args.date);
  const slug = assertSlug(args.slug);
  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) die(`找不到输入文件: ${args.input}`);

  const repoRoot = path.resolve(__dirname, '..');
  const md = fs.readFileSync(inputPath, 'utf8');
  const {
    title: mdTitle,
    body,
    excerpt: mdExcerpt,
    frontmatter: fm,
  } = renderMarkdown(md);

  // draft 跳过:与 publish.sh 兜底语义对齐,避免意外发布草稿
  if (fm.draft === true) {
    process.stdout.write(
      `SKIP · draft=true,跳过生成 ${slug} (frontmatter.draft === true)\n`,
    );
    return;
  }

  // 优先级:CLI --title > frontmatter.title > 正文 H1 > 默认「金融每日简报」
  const title = args.title || mdTitle;
  // 优先级:CLI --excerpt > frontmatter.description > 正文首段 > 标题
  const fmDescription = typeof fm.description === 'string' ? fm.description : null;
  const excerpt = (args.excerpt || fmDescription || mdExcerpt || title).slice(0, 240);
  // frontmatter.tags 是字符串数组;缺省回退到 ['金融']
  const tags = Array.isArray(fm.tags) && fm.tags.length > 0
    ? fm.tags.map((t) => String(t))
    : null;

  const outDir = path.join(repoRoot, 'posts', slug);
  const outFile = path.join(outDir, 'index.html');
  fs.mkdirSync(outDir, { recursive: true });

  // 封面图:复制到 posts/<slug>/ 下,确保 build-index 能扫到
  let coverFile = null;
  if (args.cover) {
    const coverSrc = path.resolve(args.cover);
    if (!fs.existsSync(coverSrc)) die(`找不到封面图: ${args.cover}`);
    const coverName = path.basename(coverSrc);
    const coverDst = path.join(outDir, coverName);
    fs.copyFileSync(coverSrc, coverDst);
    coverFile = coverName;
  }

  const html = renderPage({ title, slug, date, excerpt, body, cover: coverFile, tags });
  fs.writeFileSync(outFile, html);

  updatePostsIndex(repoRoot, { title, slug, date, excerpt });
  updateArchiveIndex(repoRoot, { title, slug, date });

  const rel = path.relative(repoRoot, outFile);
  process.stdout.write(`OK · 生成 ${rel}\n`);
  process.stdout.write(`下一步:\n`);
  process.stdout.write(`  git add posts/${slug}/index.html posts/index.html archive/index.html\n`);
  process.stdout.write(`  git commit -m "AIWORK1-27 · 新增金融简报 ${slug}"\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  renderMarkdown,
  renderInline,
  renderPage,
  parseFrontmatter,
  slugifyTagForFinance,
};
