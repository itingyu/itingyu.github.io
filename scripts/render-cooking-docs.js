#!/usr/bin/env node
/* render-cooking-docs.js
 *
 * 把 admin 整理的烹饪学习 Markdown 文档批量转换为 itingyu.github.io 的博客文章页。
 *
 * 设计目标:
 *   - 纯 Node 内置模块(无第三方依赖)。
 *   - 复用 render-finance-brief.js 的 markdown 渲染器思路(escapeHtml / renderInline /
 *     renderMarkdown),内联,不抽 markdown.js(M6 评审中,本期不动 spec)。
 *   - 输出文件名由 --slug 决定,落在 posts/<slug>/index.html。
 *   - 同时把原始 .md 复制为 posts/<slug>/source.md,沿用 sing-box 实践。
 *   - frontmatter 全进 <meta> + JSON-LD;不入 HTML 注释。
 *   - 每篇都标记 article:section=厨房学 + series:description,让 lib.js
 *     自动聚合成第二个专栏(/series/厨房学/index.html)。
 *   - 不自动 commit / push。完成后打印 git 命令,让人 review。
 *
 * 用法:
 *   node scripts/render-cooking-docs.js \
 *     --input path/to/cooking.md \
 *     --slug kitchen-01-principles \
 *     [--date YYYY-MM-DD] \
 *     [--title "..."] \
 *     [--tags "cooking,kitchen"] \
 *     [--difficulty "⭐"] \
 *     [--description "..."]
 *
 *   # 批量模式(用内置 15 篇清单):
 *   node scripts/render-cooking-docs.js --batch
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SERIES_NAME = '厨房学';
const SERIES_SLUG = '厨房学';
const SERIES_DESCRIPTION = '从厨房原理到八大菜系家常做法的系统学习路径,业余到家庭厨房实战';
const AUTHOR = 'itingyu';
const SITE_ORIGIN = 'https://itingyu.github.io';
const DISCLAIMER_TEXT =
  '本站内容均为学习笔记与经验总结,所有菜谱与技法请结合实际食材、季节与个人口味灵活调整。涉及生食、营养与健康的内容仅供参考,特殊体质或疾病请咨询专业营养师/医生。';

// 15 篇文章清单(沿用 README 阅读路径顺序)
const ARTICLES = [
  { file: '01-厨房原理总论.md',         slug: 'kitchen-01-principles',        title: '厨房原理总论',                difficulty: '⭐',   tags: ['cooking', 'kitchen', 'principles'] },
  { file: '02-食材识别与挑选.md',         slug: 'kitchen-02-ingredient-selection', title: '食材识别与挑选',              difficulty: '⭐',   tags: ['cooking', 'kitchen', 'ingredient'] },
  { file: '02b-食材预处理与清洗.md',       slug: 'kitchen-02b-prep-washing',     title: '食材预处理与清洗',            difficulty: '⭐',   tags: ['cooking', 'kitchen', 'prep'] },
  { file: '02c-生食指南.md',              slug: 'kitchen-02c-raw-food',         title: '生食指南',                    difficulty: '⭐',   tags: ['cooking', 'kitchen', 'raw-food'] },
  { file: '03-调味学基础.md',             slug: 'kitchen-03-seasoning',         title: '调味学基础',                  difficulty: '⭐⭐',  tags: ['cooking', 'kitchen', 'seasoning'] },
  { file: '04-刀工技法.md',               slug: 'kitchen-04-knife-skills',      title: '刀工技法',                    difficulty: '⭐⭐',  tags: ['cooking', 'kitchen', 'knife-skills'] },
  { file: '05-火候掌控.md',               slug: 'kitchen-05-heat-control',      title: '火候掌控',                    difficulty: '⭐⭐',  tags: ['cooking', 'kitchen', 'heat-control'] },
  { file: '06-烹饪方法.md',               slug: 'kitchen-06-cooking-methods',   title: '烹饪方法',                    difficulty: '⭐⭐⭐', tags: ['cooking', 'kitchen', 'methods'] },
  { file: '07-经典菜谱精讲.md',           slug: 'kitchen-07-classic-recipes',   title: '经典菜谱精讲',                difficulty: '⭐⭐⭐', tags: ['cooking', 'kitchen', 'recipes'] },
  { file: '08-进阶技法.md',               slug: 'kitchen-08-advanced',          title: '进阶技法',                    difficulty: '⭐⭐⭐', tags: ['cooking', 'kitchen', 'advanced'] },
  { file: '09-厨房管理与效率.md',         slug: 'kitchen-09-management',        title: '厨房管理与效率',              difficulty: '⭐',   tags: ['cooking', 'kitchen', 'management'] },
  { file: '10-食材营养与健康.md',         slug: 'kitchen-10-nutrition',         title: '食材营养与健康',              difficulty: '⭐⭐',  tags: ['cooking', 'kitchen', 'nutrition'] },
  { file: '11-食物相克与真禁忌速查.md',   slug: 'kitchen-11-taboos',            title: '食物相克与真禁忌速查',        difficulty: '⭐',   tags: ['cooking', 'kitchen', 'food-safety'] },
  { file: '12-中国八大菜系详解.md',       slug: 'kitchen-12-eight-cuisines',    title: '中国八大菜系详解',            difficulty: '⭐',   tags: ['cooking', 'kitchen', 'chinese-cuisine'] },
  { file: '13-八大菜系代表菜家常做法.md', slug: 'kitchen-13-cuisine-dishes',    title: '八大菜系代表菜家常做法',      difficulty: '⭐⭐',  tags: ['cooking', 'kitchen', 'chinese-cuisine'] },
];

const USAGE = `用法:
  node scripts/render-cooking-docs.js --batch
  node scripts/render-cooking-docs.js \\
    --input <path> --slug <slug> [--date YYYY-MM-DD] [--title "..."] \\
    [--tags "tag1,tag2"] [--difficulty "⭐"] [--description "..."]
`;

function die(msg) {
  process.stderr.write(`render-cooking-docs: ${msg}\n`);
  process.exit(1);
}

function assertSlug(s) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(s)) {
    die(`--slug 必须是小写字母/数字/短横线,得到: ${s}`);
  }
  return s;
}

function assertDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) die(`--date 必须是 YYYY-MM-DD 形式,得到: ${s}`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) die(`--date 不是合法日期: ${s}`);
  return s;
}

function parseArgs(argv) {
  const args = { _: [], batch: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--batch') args.batch = true;
    else if (a === '--input') args.input = argv[++i];
    else if (a === '--slug') args.slug = argv[++i];
    else if (a === '--date') args.date = argv[++i];
    else if (a === '--title') args.title = argv[++i];
    else if (a === '--tags') args.tags = argv[++i];
    else if (a === '--difficulty') args.difficulty = argv[++i];
    else if (a === '--description') args.description = argv[++i];
    else if (a && a.startsWith('--')) throw new Error(`未知参数: ${a}`);
    else args._.push(a);
  }
  return args;
}

/* ---------- markdown 渲染器(自实现,与 render-finance-brief.js 思路一致) ---------- */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function slugifyTag(name) {
  const s = String(name).trim();
  return (
    s
      .toLowerCase()
      .replace(/[\s/]+/g, '-')
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'tag'
  );
}

/* 行内:代码 -> 粗体 -> 斜体 -> 自动外链 */
function renderInline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, inner) => `<strong>${inner}</strong>`);
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, (_, lead, inner) => `${lead}<em>${inner}</em>`);
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" rel="noopener">${m}</a>`);
  return s;
}

/* 把 markdown 行内语法去掉,得到「明文」(用于 description / og:description) */
function stripMarkdownInline(text) {
  let s = String(text);
  // ```code``` / `code`
  s = s.replace(/`([^`]+)`/g, '$1');
  // ![alt](url) → alt;[link](url) → link
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // 粗体 / 斜体
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  // 自动外链保留文字
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (m) => m);
  // 去掉行尾 #
  s = s.replace(/\s*#+\s*$/, '');
  return s.trim();
}

/* 解析 YAML frontmatter(最小集合)。 */
function parseFrontmatter(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  if (lines.length === 0 || !/^---+\s*$/.test(lines[0])) {
    return { data: null, endLine: 0 };
  }
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^---+\s*$/.test(line)) return { data: out, endLine: i };
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return { data: null, endLine: 0 };
}

/* 表格行 → cells(trim + 内部不展开 inline) */
function parseTableRow(line) {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

function renderMarkdown(md) {
  const normalized = md.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  const { data: frontmatter, endLine: fmEndLine } = parseFrontmatter(normalized);
  const fm = frontmatter || {};
  let i = fmEndLine > 0 ? fmEndLine + 1 : 0;
  if (i < lines.length && lines[i].trim() === '') i++;

  const out = [];
  let title = null;
  let excerpt = null;
  let firstParagraph = null;

  function flushTable(buf) {
    if (!buf || buf.rows.length < 2) return null;
    // 跳过对齐行(|---|---|)
    const header = buf.rows[0];
    const bodyRows = buf.rows.slice(2);
    const headHtml =
      '<thead><tr>' +
      header.map((c) => `<th>${renderInline(c)}</th>`).join('') +
      '</tr></thead>';
    const bodyHtml =
      '<tbody>' +
      bodyRows
        .map((r) => '<tr>' + r.map((c) => `<td>${renderInline(c)}</td>`).join('') + '</tr>')
        .join('') +
      '</tbody>';
    return `<table>${headHtml}${bodyHtml}</table>`;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) {
        if (title === null) { title = text; i++; continue; }
        out.push(`<h${level}>${renderInline(text)}</h${level}>`);
        i++;
        continue;
      }
      out.push(`<h${level}>${renderInline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${buf.map(renderInline).join('<br>')}</blockquote>`);
      // 首段 blockquote 优先作为 excerpt(更稳定地拿到一句话简介)
      if (excerpt === null) excerpt = stripMarkdownInline(buf.join(' '));
      continue;
    }

    if (/^\|/.test(line)) {
      const buf = { rows: [] };
      while (i < lines.length && /^\|/.test(lines[i])) {
        buf.rows.push(parseTableRow(lines[i]));
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
        (/^[-*+]\s+/.test(lines[i]) ||
          (items.length && lines[i].trim() !== '' && !/^[#>\|]/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])))
      ) {
        if (/^[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^[-*+]\s+/, ''));
          i++;
        } else {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
      }
      out.push('<ul>' + items.map((it) => `<li>${renderInline(it)}</li>`).join('') + '</ul>');
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (
        i < lines.length &&
        (/^\d+\.\s+/.test(lines[i]) ||
          (items.length && lines[i].trim() !== '' && !/^[#>\|]/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])))
      ) {
        if (/^\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\d+\.\s+/, ''));
          i++;
        } else {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
      }
      out.push('<ol>' + items.map((it) => `<li>${renderInline(it)}</li>`).join('') + '</ol>');
      continue;
    }

    // 代码块(fenced)
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 跳过闭合 ```
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre${cls}><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
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
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^\|/.test(lines[i]) &&
      !/^---+\s*$/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    const paraText = para.join(' ').trim();
    if (paraText) {
      out.push(`<p>${renderInline(paraText)}</p>`);
      // 备选 excerpt:第一个像样的正文段(>30 字,过滤掉 "核心:" "步骤" 等短行)
      if (firstParagraph === null) firstParagraph = paraText;
      if (excerpt === null && paraText.length > 30) {
        excerpt = stripMarkdownInline(paraText);
      }
    }
  }

  if (title === null) {
    if (fm.title) title = String(fm.title);
    else title = '厨房学';
  }

  // 兜底:仍无 excerpt 时用首个段落
  if (excerpt === null && firstParagraph) {
    excerpt = stripMarkdownInline(firstParagraph);
  }

  return { title, body: out.join('\n'), excerpt, frontmatter: fm };
}

/* ---------- 页面装配 ---------- */

function escapeJsonLd(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderPage({ title, slug, date, excerpt, body, tags }) {
  const canonical = `${SITE_ORIGIN}/posts/${slug}/`;
  const editUrl = `https://github.com/itingyu/itingyu.github.io/edit/master/posts/${slug}/index.html`;

  const tagMeta = tags
    .map((t) => `  <meta property="article:tag" content="${escapeHtml(t)}" />`)
    .join('\n');
  const primarySlug = slugifyTag(tags[0]);
  const primaryName = tags[0];

  const jsonLd = JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: title,
      datePublished: date,
      dateModified: date,
      author: { '@type': 'Person', name: AUTHOR },
      url: canonical,
      description: excerpt,
      articleSection: SERIES_NAME,
      keywords: [...tags, SERIES_NAME, '烹饪学习'],
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
  <meta name="author" content="${AUTHOR}" />
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
  <link rel="canonical" href="${canonical}" />

  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(excerpt)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:locale" content="zh_CN" />
  <meta property="article:published_time" content="${date}" />
  <meta property="article:author" content="${AUTHOR}" />
  <meta property="article:section" content="${escapeHtml(SERIES_NAME)}" />
  <meta name="series:description" content="${escapeHtml(SERIES_DESCRIPTION)}" />
${tagMeta}

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
  <script defer src="/assets/keys.js"></script>
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
      <a href="/series/">专栏</a>
      <a href="/search/">搜索</a>
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
          <circle cx="12 12" r="4"/>
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
          <time datetime="${date}">${date}</time>
          <span class="dot">·</span>
          <a class="chip" href="/tags/${primarySlug}/" data-tag="${primarySlug}">${escapeHtml(primaryName)}</a>
          <span class="dot">·</span>
          <a class="chip" href="/series/${SERIES_SLUG}/" data-series="${SERIES_SLUG}">${escapeHtml(SERIES_NAME)}</a>
          <span class="dot">·</span>
          <span data-reading-time>约 1 分钟</span>
        </div>
        <p class="post-excerpt">${escapeHtml(excerpt)}</p>
      </header>

      ${body}

      <div class="callout callout-note">
        <strong>说明</strong> · ${DISCLAIMER_TEXT}
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
      <a href="/tags/">标签</a>
      <a href="/series/">专栏</a>
      <a href="/search/">搜索</a>
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

/* ---------- 单篇渲染 ---------- */

function renderOne({ inputPath, slug, date, title, tags, difficulty, description, repoRoot }) {
  const outDir = path.join(repoRoot, 'posts', slug);
  const outFile = path.join(outDir, 'index.html');
  const sourceFile = path.join(outDir, 'source.md');

  fs.mkdirSync(outDir, { recursive: true });

  // 复制原始 .md → posts/<slug>/source.md(沿用 sing-box 实践,便于后续维护)
  fs.copyFileSync(inputPath, sourceFile);

  const md = fs.readFileSync(inputPath, 'utf8');
  const { title: mdTitle, body, excerpt: mdExcerpt, frontmatter: fm } = renderMarkdown(md);

  const finalTitle = title || (fm && fm.title) || mdTitle;
  const fmDescription = (fm && typeof fm.description === 'string') ? fm.description : null;
  const rawExcerpt = (description || fmDescription || mdExcerpt || finalTitle);
  const excerpt = rawExcerpt.slice(0, 240);

  const html = renderPage({
    title: finalTitle,
    slug,
    date,
    excerpt,
    body,
    tags,
  });

  fs.writeFileSync(outFile, html);

  return { outFile, sourceFile, title: finalTitle, excerpt };
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

  if (args.help) { process.stdout.write(USAGE); return; }

  const repoRoot = path.resolve(__dirname, '..');
  const inputDir = path.join(repoRoot, '..', 'attachments', 'cooking', 'cooking');
  const defaultInputDir = fs.existsSync(inputDir)
    ? inputDir
    : path.join(repoRoot, 'attachments', 'cooking', 'cooking');

  if (args.batch) {
    const summary = [];
    for (const article of ARTICLES) {
      const inputPath = path.join(defaultInputDir, article.file);
      if (!fs.existsSync(inputPath)) {
        die(`找不到输入文件: ${inputPath}`);
      }
      const slug = assertSlug(article.slug);
      const date = assertDate('2026-10-07');
      const tags = article.tags;
      const out = renderOne({
        inputPath,
        slug,
        date,
        title: article.title,
        tags,
        difficulty: article.difficulty,
        description: null,
        repoRoot,
      });
      summary.push(`OK · ${slug} (${path.relative(repoRoot, out.outFile)})`);
    }
    process.stdout.write(summary.join('\n') + '\n');
    process.stdout.write(`\n总计 ${summary.length} 篇。下一步:\n`);
    process.stdout.write(`  npm run build\n`);
    process.stdout.write(`  npm test\n`);
    process.stdout.write(`  npm run check\n`);
    return;
  }

  if (!args.input || !args.slug) {
    process.stderr.write(`缺少必填参数\n\n${USAGE}`);
    process.exit(2);
  }

  const slug = assertSlug(args.slug);
  const date = assertDate(args.date || '2026-10-07');
  const tags = (args.tags || 'cooking,kitchen').split(',').map((t) => t.trim()).filter(Boolean);

  const out = renderOne({
    inputPath: path.resolve(args.input),
    slug,
    date,
    title: args.title || null,
    tags,
    difficulty: args.difficulty || null,
    description: args.description || null,
    repoRoot,
  });

  process.stdout.write(`OK · 生成 ${path.relative(repoRoot, out.outFile)}\n`);
  process.stdout.write(`     + 源 ${path.relative(repoRoot, out.sourceFile)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  renderMarkdown,
  renderPage,
  escapeHtml,
  slugifyTag,
  SERIES_NAME,
  SERIES_DESCRIPTION,
  ARTICLES,
};
