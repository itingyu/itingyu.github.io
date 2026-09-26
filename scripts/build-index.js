#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');

// ============================================================
// Configuration
// ============================================================

const SITE_ORIGIN = 'https://itingyu.github.io';
const ROOT = process.cwd();
const RSS_LIMIT = 20;
const HOME_LIMIT = 3;
const RELATED_LIMIT = 3;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const POSTS_DIR = path.join(ROOT, 'posts');
const INDEX_FILE = path.join(ROOT, 'index.html');
const COVER_EXTS = ['svg', 'jpg', 'jpeg', 'png', 'webp'];

// ============================================================
// Incremental build cache (SHA-256)
// ============================================================
// 缓存 schema:
//   {
//     "version": 1,
//     "postShas": { "<slug>": "<sha256 of posts/<slug>/index.html>" },
//     "fileShas": { "<rel-path>": "<sha256 of disk content after build>" },
//     "tagSlugs": ["finance", ...]
//   }
// 缓存位置:`scripts/.cache/build-index/index.json`(已加入 .gitignore)
// 失效策略:见 README「缓存失效策略」节。
// 任何改动 front matter 解析规则(parseFrontmatter / 模板 / pageShell / 聚合渲染)
// 都必须删除此目录,否则会输出陈旧内容。

const CACHE_VERSION = 1;
const CACHE_REL_DIR = path.join('scripts', '.cache', 'build-index');
const CACHE_FILE_NAME = 'index.json';

function cacheFileFor(rootDir) {
  return path.join(rootDir, CACHE_REL_DIR, CACHE_FILE_NAME);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256FileSync(p) {
  return sha256(fs.readFileSync(p));
}

function loadCache(rootDir) {
  const f = cacheFileFor(rootDir);
  try {
    const raw = fs.readFileSync(f, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || obj.version !== CACHE_VERSION) return null;
    if (!obj.postShas || typeof obj.postShas !== 'object') return null;
    if (!obj.fileShas || typeof obj.fileShas !== 'object') return null;
    if (!Array.isArray(obj.tagSlugs)) return null;
    return obj;
  } catch (_) {
    return null;
  }
}

function saveCache(rootDir, cache) {
  const dir = path.join(rootDir, CACHE_REL_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const f = cacheFileFor(rootDir);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
  fs.renameSync(tmp, f);
}

function clearCache(rootDir) {
  const dir = path.join(rootDir, CACHE_REL_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// HTML escaping
// ============================================================

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================
// Shared HTML fragments
// ============================================================

const HEAD_PRE_META = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  `;

const FOUC_SCRIPT = `
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
`;

const SITE_HEADER = `
  <header class="site-header">
    <a class="site-brand" href="/">
      <span class="site-brand-mark">i</span>
      <span>itingyu</span>
    </a>
    <nav class="site-nav" aria-label="主导航">
      <a href="/" data-nav="home">首页</a>
      <a href="/posts/" data-nav="posts">文章</a>
      <a href="/archive/" data-nav="archive">归档</a>
      <a href="/tags/" data-nav="tags">标签</a>
      <a href="/search/" data-nav="search">搜索</a>
      <a href="/about/" data-nav="about">关于</a>
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
`;

const SITE_FOOTER = `
  <footer class="site-footer">
    <div class="links">
      <a href="/">首页</a>
      <a href="/posts/">文章</a>
      <a href="/archive/">归档</a>
      <a href="/tags/">标签</a>
      <a href="/search/">搜索</a>
      <a href="/about/">关于</a>
      <a href="/feeds/rss.xml">RSS</a>
      <a href="https://github.com/itingyu" rel="noopener">GitHub</a>
    </div>
    <p>&copy; 2026 itingyu · 内容仅供参考，不构成投资建议。</p>
  </footer>
`;

const SKIP_LINK = `  <a class="skip-link" href="#main">跳到正文</a>
`;

function pageShell({ title, description, canonical, extraHead = '', activeNav = '', main }) {
  const ariaCurrent = (key) => activeNav === key ? ' aria-current="page"' : '';
  const nav = SITE_HEADER
    .replace('data-nav="home"', `data-nav="home"${ariaCurrent('home')}`)
    .replace('data-nav="posts"', `data-nav="posts"${ariaCurrent('posts')}`)
    .replace('data-nav="archive"', `data-nav="archive"${ariaCurrent('archive')}`)
    .replace('data-nav="tags"', `data-nav="tags"${ariaCurrent('tags')}`)
    .replace('data-nav="search"', `data-nav="search"${ariaCurrent('search')}`)
    .replace('data-nav="about"', `data-nav="about"${ariaCurrent('about')}`);
  return `${HEAD_PRE_META}<title>${escapeHTML(title)}</title>
  <meta name="description" content="${escapeHTML(description)}" />
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
  <link rel="canonical" href="${canonical}" />
${extraHead}${FOUC_SCRIPT}<body>
${SKIP_LINK}${nav}
  <main id="main" class="container">
${main}
  </main>
${SITE_FOOTER}</body>
</html>
`;
}

// ============================================================
// Frontmatter parser
// ============================================================

function parseFrontmatter(html, slug) {
  const out = { slug, title: '', description: null, date: null, tags: [], warnings: [] };

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
  if (titleMatch) {
    let t = titleMatch[1].trim();
    // Strip common suffixes like " · itingyu" so the displayed title stays short.
    t = t.replace(/\s*[·•|·\-–—]\s*itingyu\s*$/i, '');
    out.title = t;
  }

  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)
    || html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
  if (descMatch) {
    out.description = descMatch[1].trim();
  } else {
    out.description = null;
  }

  const dateMatch = html.match(/<meta\s+property=["']article:published_time["']\s+content=["']([^"']*)["']/i);
  let dateRaw = dateMatch ? dateMatch[1].trim() : null;
  if (!dateRaw) {
    const timeMatch = html.match(/<time\s+datetime=["']([^"']*)["']/i);
    if (timeMatch) dateRaw = timeMatch[1].trim();
  }
  out.date = dateRaw;
  if (dateRaw && !/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) {
    out.warnings.push(`non-ISO date "${dateRaw}"`);
  }

  // Collect tag display names from <meta property="article:tag" content="X">
  const metaTagRe = /<meta\s+property=["']article:tag["']\s+content=["']([^"']*)["']/gi;
  const tagNames = new Set();
  let mt;
  while ((mt = metaTagRe.exec(html)) !== null) {
    const v = mt[1].trim();
    if (v) tagNames.add(v);
  }

  // Collect chip mappings: <a class="chip" href="/tags/<slug>/" data-tag="<slug>">name</a>
  // Map display-name → slug
  const chipRe = /<a\s+[^>]*class=["'][^"']*\bchip\b[^"']*["'][^>]*href=["']\/tags\/([^/"']+)\/["'][^>]*data-tag=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const slugByDisplay = new Map();
  let m;
  while ((m = chipRe.exec(html)) !== null) {
    const dataTag = m[2];
    const display = m[3].replace(/<[^>]+>/g, '').trim();
    if (!display) continue;
    if (!slugByDisplay.has(display)) slugByDisplay.set(display, dataTag);
  }

  // Build tag list: each unique display name with resolved slug
  const tagList = [];
  const seenSlugs = new Set();
  for (const name of tagNames) {
    const slugVal = slugByDisplay.get(name) || slugifyTag(name);
    if (seenSlugs.has(slugVal)) continue;
    seenSlugs.add(slugVal);
    tagList.push({ slug: slugVal, name });
  }
  out.tags = tagList;

  return out;
}

// Deterministic slugify for tags when no chip is present.
// Lowercases ASCII; preserves Unicode letters/digits (browser/UA handles encoding).
function slugifyTag(name) {
  return String(name).trim().toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'tag';
}

// ============================================================
// Post scanner
// ============================================================

function scanPosts(rootDir = ROOT) {
  const postsDir = path.join(rootDir, 'posts');
  if (!fs.existsSync(postsDir)) return [];
  const entries = fs.readdirSync(postsDir, { withFileTypes: true });
  const posts = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const file = path.join(postsDir, slug, 'index.html');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(html, slug);
    posts.push({ ...fm, sourcePath: file });
  }
  return posts;
}

function byDateDesc(a, b) {
  const da = (a.date || '').toString();
  const db = (b.date || '').toString();
  if (da < db) return 1;
  if (da > db) return -1;
  return (a.slug || '').localeCompare(b.slug || '');
}

function sortPosts(posts) {
  return [...posts].sort(byDateDesc);
}

// ============================================================
// Article body extraction (RSS 全文输出)
//   - 从 <article>...</article> 中剥离 article-header / related aside
//   - 返回纯正文 HTML,供 RSS content:encoded 使用
// ============================================================

function extractArticleBody(html) {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (!articleMatch) return '';
  let body = articleMatch[1];
  body = body.replace(/<header class="article-header">[\s\S]*?<\/header>/i, '');
  body = body.replace(/<aside class="related"[\s\S]*?<\/aside>/i, '');
  return body.trim();
}

// ============================================================
// Cover image scanner
//   - posts/<slug>/cover.{svg,jpg,jpeg,png,webp}
//   - returns absolute URL or null
// ============================================================

function scanCover(slug, rootDir = ROOT) {
  const dir = path.join(rootDir, 'posts', slug);
  if (!fs.existsSync(dir)) return null;
  for (const ext of COVER_EXTS) {
    const p = path.join(dir, `cover.${ext}`);
    if (fs.existsSync(p)) {
      return `${SITE_ORIGIN}/posts/${slug}/cover.${ext}`;
    }
  }
  return null;
}

// ============================================================
// Related posts (同标签优先,排除自身,补日期新近,最多 N 篇)
// ============================================================

function computeRelated(post, allPosts, max = RELATED_LIMIT) {
  if (!post || !post.slug) return [];
  const tagSlugs = new Set((post.tags || []).map(t => t.slug));
  const sameTag = [];
  const others = [];
  for (const p of allPosts) {
    if (!p || p.slug === post.slug) continue;
    const overlap = (p.tags || []).some(t => tagSlugs.has(t.slug));
    (overlap ? sameTag : others).push(p);
  }
  sameTag.sort(byDateDesc);
  others.sort(byDateDesc);
  return [...sameTag, ...others].slice(0, max);
}

// ============================================================
// Article page enhancements (cover + related + progress div + reading-time)
//   1. 注入 reading-progress div(若文章页没有)
//   2. 升级「约 X 分钟」为 data-reading-time 占位(让 JS 实时计算)
//   3. 注入 cover img(若 posts/<slug>/cover.* 存在)
//   4. 注入「相关文章」区(基于同标签优先 + 日期降序)
//   5. 注入 og:image meta(若 cover 存在)
// 策略:幂等。每步用未匹配的占位,确保重复跑不产生双重内容。
// ============================================================

function buildRelatedSection(post, allPosts) {
  const related = computeRelated(post, allPosts);
  if (!related.length) {
    return `\n    <aside class="related" aria-label="相关文章">\n      <p class="related-title">相关文章</p>\n      <p class="related-empty">暂时没有相关文章。</p>\n    </aside>`;
  }
  const cards = related.map(p => {
    const date = (p.date || '').toString();
    const desc = (p.description || '').toString().slice(0, 120);
    return `        <li>
          <a class="related-card" href="/posts/${escapeHTML(p.slug)}/">
            <p class="related-card-title">${escapeHTML(p.title)}</p>
            <p class="related-card-meta"><time datetime="${escapeHTML(date)}">${escapeHTML(date)}</time></p>
            ${desc ? `<p class="related-card-excerpt">${escapeHTML(desc)}</p>` : ''}
          </a>
        </li>`;
  }).join('\n');
  return `\n    <aside class="related" aria-label="相关文章">
      <p class="related-title">相关文章</p>
      <ul class="related-grid">
${cards}
      </ul>
    </aside>`;
}

function injectArticlePageEnhancements(html, post, allPosts, rootDir = ROOT) {
  let out = html;

  // 1. reading-progress div(幂等:已存在则跳过)
  if (!/class="reading-progress"[^>]*data-reading-progress/.test(out)) {
    out = out.replace(
      /(<a\s+class="skip-link"[^>]*>)/,
      `<div class="reading-progress" data-reading-progress aria-hidden="true"></div>\n  $1`
    );
  }

  // 2. reading-time(幂等:已有 data-reading-time 则跳过;否则升级「约 N 分钟」)
  if (!/data-reading-time/.test(out)) {
    out = out.replace(
      /<span>约\s*\d+\s*分钟<\/span>/,
      '<span data-reading-time>约 1 分钟</span>'
    );
  }

  // 3. cover image(幂等:已有 class="post-cover" 则跳过)
  const coverURL = scanCover(post.slug, rootDir);
  if (coverURL && !/class="post-cover"/.test(out)) {
    // 优先注入到 article-header 结束后的 article 内部
    const coverHTML = `\n      <img class="post-cover" src="${escapeHTML(coverURL)}" alt="${escapeHTML(post.title || '')}封面" loading="lazy" />`;
    if (/<\/header>\s*<!--\s*build:cover\s*-->/.test(out)) {
      out = out.replace(/<!--\s*build:cover\s*-->/, `<!-- build:cover -->${coverHTML}`);
    } else if (/<\/header>\s*(<)/.test(out)) {
      out = out.replace(/<\/header>(\s*<!--[^-]*-->\s*)*(\s*)<(?!img|aside|figure)/, (m) => `${m.replace(/<$/, '')}${coverHTML}\n      <`);
    } else {
      // 兜底:插到 article 后
      out = out.replace(/(<article[^>]*>)/, `$1${coverHTML}`);
    }
  }

  // 4. related section(幂等:已有 class="related" 则跳过)
  if (!/class="related"\s+aria-label="相关文章"/.test(out)) {
    const relatedSection = buildRelatedSection(post, allPosts);
    // 插到 </article> 后、article-footer 前;若没有 article-footer 则插到 </main> 前
    if (/<\/article>\s*<!--\s*build:related\s*-->/.test(out)) {
      out = out.replace(/<!--\s*build:related\s*-->/, `<!-- build:related -->${relatedSection}`);
    } else if (/<\/article>(\s*<!--[^-]*-->\s*)*\s*<footer class="article-footer">/.test(out)) {
      out = out.replace(/(<\/article>)/, `$1${relatedSection}\n\n    `);
    } else if (/<\/article>/.test(out)) {
      out = out.replace(/(<\/article>)/, `$1${relatedSection}`);
    } else {
      out = out.replace(/(<\/main>)/, `${relatedSection}\n  $1`);
    }
  }

  // 5. og:image(幂等:已有 og:image 则跳过)
  if (coverURL && !/<meta\s+property=["']og:image["']/.test(out)) {
    out = out.replace(
      /(<meta\s+property=["']article:author["'][^>]*>\s*)(\n)/,
      `$1    <meta property="og:image" content="${escapeHTML(coverURL)}" />$2`
    );
  }

  // 6. 字数 / 词数(紧跟 data-reading-time 后面;幂等)
  if (!/data-word-count/.test(out) && /data-reading-time/.test(out)) {
    out = out.replace(
      /(<span\s+data-reading-time>[^<]*<\/span>)/,
      '$1\n          <span class="dot">·</span>\n          <span class="word-count" data-word-count>统计中…</span>'
    );
  }

  // 7. JSON-LD BreadcrumbList(Home › Tag › Article;幂等)
  if (!hasJSONLDType(out, 'BreadcrumbList')) {
    const items = [{ name: '首页', url: `${SITE_ORIGIN}/` }];
    if (post.tags && post.tags.length > 0) {
      const t = post.tags[0];
      items.push({ name: t.name, url: `${SITE_ORIGIN}/tags/${t.slug}/` });
    } else {
      items.push({ name: '标签', url: `${SITE_ORIGIN}/tags/` });
    }
    items.push({ name: post.title || post.slug, url: postURL(post) });
    const breadcrumbScript = renderBreadcrumbListJSONLD(items);
    out = injectJSONLDIntoHead(out, breadcrumbScript);
  }

  return out;
}

// ============================================================
// JSON-LD structured data (Schema.org)
//   - BreadcrumbList: 文章页(Home › Tag › Article)
//   - CollectionPage: 标签页、归档页
//   - Blog: 首页
//   - 单独 <script type="application/ld+json"> 块;
//     JSON 由 build-index 自动注入,不在 HTML 模板手工维护
//   - 幂等: 已含目标 @type 的脚本则跳过
// ============================================================

function postURL(p) {
  return `${SITE_ORIGIN}/posts/${p.slug}/`;
}

function hasJSONLDType(html, type) {
  const re = new RegExp(
    `<script[^>]*type=["']application/ld\\+json["'][^>]*>[\\s\\S]*?"@type"\\s*:\\s*"${type}"`,
    'i',
  );
  return re.test(html);
}

function renderJSONLDScript(obj) {
  return `\n  <script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n  </script>`;
}

function renderBreadcrumbListJSONLD(items) {
  return renderJSONLDScript({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': items.map((it, i) => ({
      '@type': 'ListItem',
      'position': i + 1,
      'name': it.name,
      'item': it.url,
    })),
  });
}

function buildBlogPostingRef(p) {
  const ref = { '@type': 'BlogPosting', headline: p.title, url: p.url };
  if (p.date) ref.datePublished = p.date;
  return ref;
}

function renderCollectionPageJSONLD({ name, description, url, posts }) {
  return renderJSONLDScript({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    description,
    url,
    hasPart: posts.map(buildBlogPostingRef),
  });
}

function renderBlogJSONLD({ name, description, url, posts }) {
  return renderJSONLDScript({
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name,
    description,
    url,
    blogPost: posts.map(buildBlogPostingRef),
  });
}

// 注入 JSON-LD <script> 到 head: 优先插到 FOUC <script> 前,否则插到 </head> 前
function injectJSONLDIntoHead(html, jsonldScript) {
  if (/<script>\s*\(function\(\)\{/.test(html)) {
    return html.replace(
      /(\s*)(?=<script>\s*\(function\(\)\{)/,
      (_m, ws) => `${jsonldScript}\n${ws || ''}`,
    );
  }
  if (/<\/head>/.test(html)) {
    return html.replace(/(<\/head>)/, `  ${jsonldScript}\n$1`);
  }
  return html;
}

// ============================================================
// Renderers
// ============================================================

function renderPostListItem(post) {
  const tagHTML = (post.tags || []).map(t => {
    return `          <a class="chip" href="/tags/${escapeHTML(t.slug)}/" data-tag="${escapeHTML(t.slug)}">${escapeHTML(t.name)}</a>`;
  }).join('\n          <span class="dot">·</span>\n');
  return `      <li>
        <h3 class="post-title"><a href="/posts/${escapeHTML(post.slug)}/">${escapeHTML(post.title)}</a></h3>
        <div class="post-meta">
          <time datetime="${escapeHTML(post.date || '')}">${escapeHTML(post.date || '')}</time>
${post.tags && post.tags.length ? `          <span class="dot">·</span>\n${tagHTML}\n` : ''}        </div>
        <p class="post-excerpt">${escapeHTML(post.description || post.title || '')}</p>
      </li>`;
}

function renderPostsIndex(posts) {
  const sorted = sortPosts(posts);
  const tagChips = collectTagChips(posts);
  const main = `    <h1>文章</h1>
    <div class="tag-row">
${tagChips}
    </div>
    <ul class="post-list">
${sorted.map(renderPostListItem).join('\n')}
    </ul>
`;
  return pageShell({
    title: '文章 · itingyu',
    description: 'itingyu 的所有文章。',
    canonical: `${SITE_ORIGIN}/posts/`,
    activeNav: 'posts',
    main,
  });
}

function collectTagChips(posts) {
  const counts = new Map();
  for (const p of posts) {
    for (const t of (p.tags || [])) {
      counts.set(t.slug, (counts.get(t.slug) || 0) + 1);
    }
  }
  const tagNames = new Map();
  for (const p of posts) {
    for (const t of (p.tags || [])) {
      if (!tagNames.has(t.slug)) tagNames.set(t.slug, t.name);
    }
  }
  const sorted = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b));
  return sorted.map(slug => {
    const name = tagNames.get(slug);
    const count = counts.get(slug);
    return `      <a class="chip" href="/tags/${escapeHTML(slug)}/" data-tag="${escapeHTML(slug)}">${escapeHTML(name)} <span style="opacity:.6">· ${count}</span></a>`;
  }).join('\n');
}

function renderArchive(posts) {
  const sorted = sortPosts(posts);
  const groups = new Map();
  for (const p of sorted) {
    const key = (p.date || '').slice(0, 7); // YYYY-MM
    if (!key.match(/^\d{4}-\d{2}$/)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const keys = Array.from(groups.keys()).sort().reverse();
  const main = `    <h1>归档</h1>
 ${keys.map(k => {
  const [year, month] = k.split('-');
  const list = groups.get(k).map(p => `        <li>
          <time datetime="${escapeHTML(p.date || '')}">${escapeHTML((p.date || '').slice(5))}</time>
          <a href="/posts/${escapeHTML(p.slug)}/">${escapeHTML(p.title)}</a>
        </li>`).join('\n');
  return `    <div class="archive-group">
      <h3>${year} 年 ${parseInt(month, 10)} 月</h3>
      <ul>
 ${list}
      </ul>
    </div>`;
}).join('\n')}
 `;
  const collectionJSONLD = renderCollectionPageJSONLD({
    name: '归档 · itingyu',
    description: '按月归档的全部文章。',
    url: `${SITE_ORIGIN}/archive/`,
    posts: sorted.map(p => ({ title: p.title, url: postURL(p), date: p.date })),
  });
  return pageShell({
    title: '归档 · itingyu',
    description: '按月归档的全部文章。',
    canonical: `${SITE_ORIGIN}/archive/`,
    activeNav: 'archive',
    extraHead: collectionJSONLD,
    main,
  });
}

function renderTagsIndex(posts) {
  const tagNames = new Map();
  const counts = new Map();
  for (const p of posts) {
    for (const t of (p.tags || [])) {
      counts.set(t.slug, (counts.get(t.slug) || 0) + 1);
      if (!tagNames.has(t.slug)) tagNames.set(t.slug, t.name);
    }
  }
  const sorted = Array.from(counts.keys()).sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));

  // 字号权重:count=min → 0.9rem,count=max → 1.8rem,中间线性插值
  const countsArr = Array.from(counts.values());
  const minC = Math.min(...countsArr);
  const maxC = Math.max(...countsArr);
  const span = Math.max(1, maxC - minC);
  function sizeWeight(c, slug) {
    if (maxC === minC) {
      // 没有频次差异 → 用 slug 字符哈希给 [0.3, 0.95] 的离散权重
      // 保证每个 chip weight 不同,color-mix tint 才有层次
      let h = 0;
      for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
      return (0.3 + (Math.abs(h) % 65) / 100).toFixed(2);
    }
    return ((c - minC) / span).toFixed(2);
  }
  function rem(t) { return (0.9 + parseFloat(t) * 0.9).toFixed(2) + 'rem'; }

  // count 全相等时文案改提示
  const hint = maxC === minC
    ? `    <p style="color:var(--fg-muted);text-align:center;margin:0 0 1rem">当前 <strong>${sorted.length}</strong> 个标签 · 文章 ≥ 3 篇后字号会反映文章数量</p>`
    : `    <p style="color:var(--fg-muted);text-align:center;margin:0 0 1rem">字号大小反映文章数量 · 最多 ${maxC} 篇,最少 ${minC} 篇。点击进入标签归档。</p>`;

  const cloud = sorted.length === 0
    ? ''
    : sorted.map(slug => {
        const name = tagNames.get(slug);
        const count = counts.get(slug);
        const w = sizeWeight(count, slug);
        return `        <li><a class="chip" href="/tags/${escapeHTML(slug)}/" data-tag="${escapeHTML(slug)}" style="--tag-size:${rem(w)};--tag-weight:${w}">${escapeHTML(name)}<span class="tag-count">${count}</span></a></li>`;
      }).join('\n');
  const main = `    <h1>标签</h1>
${hint}
    <ul class="tag-cloud">
${cloud}
    </ul>
`;
  return pageShell({
    title: '标签 · itingyu',
    description: '按标签浏览所有文章。',
    canonical: `${SITE_ORIGIN}/tags/`,
    activeNav: 'tags',
    main,
  });
}

function renderTagPage(tagSlug, tagName, posts) {
  const tagged = sortPosts(posts.filter(p => (p.tags || []).some(t => t.slug === tagSlug)));
  const list = tagged.map(p => `      <li>
        <h3 class="post-title"><a href="/posts/${escapeHTML(p.slug)}/">${escapeHTML(p.title)}</a></h3>
        <div class="post-meta">
          <time datetime="${escapeHTML(p.date || '')}">${escapeHTML(p.date || '')}</time>
        </div>
        <p class="post-excerpt">${escapeHTML(p.description || p.title || '')}</p>
      </li>`).join('\n');
  const main = `    <h1>标签：${escapeHTML(tagName)}</h1>
    <p><a href="/tags/">← 返回全部标签</a></p>

    <ul class="post-list">
 ${list}
    </ul>
 `;
  const collectionJSONLD = renderCollectionPageJSONLD({
    name: `${tagName} · itingyu`,
    description: `「${tagName}」标签下的全部文章。`,
    url: `${SITE_ORIGIN}/tags/${tagSlug}/`,
    posts: tagged.map(p => ({ title: p.title, url: postURL(p), date: p.date })),
  });
  return pageShell({
    title: `${tagName} · itingyu`,
    description: `「${tagName}」标签下的全部文章。`,
    canonical: `${SITE_ORIGIN}/tags/${tagSlug}/`,
    activeNav: 'tags',
    extraHead: collectionJSONLD,
    main,
  });
}

function renderRSS(posts, buildDate, rootDir = ROOT) {
  const sorted = sortPosts(posts).slice(0, RSS_LIMIT);
  const rfc822 = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return new Date().toUTCString();
    return dt.toUTCString();
  };
  // lastBuildDate should be deterministic so --check is stable across runs.
  // Default: latest post date; falls back to provided buildDate / today.
  let lastBuildInput;
  if (buildDate) {
    lastBuildInput = buildDate;
  } else if (sorted.length > 0 && sorted[0].date) {
    lastBuildInput = sorted[0].date;
  } else {
    lastBuildInput = new Date();
  }
  const lastBuild = rfc822(lastBuildInput);
  const items = sorted.map(p => {
    const link = `${SITE_ORIGIN}/posts/${p.slug}/`;
    const pubDate = p.date ? rfc822(p.date) : lastBuild;
    const cats = (p.tags || []).map(t => `      <category>${escapeXML(t.name)}</category>`).join('\n');
    // 全文输出(RSS 2.0 + content:encoded 命名空间)
    let fullBody = '';
    const postFile = path.join(rootDir, 'posts', p.slug, 'index.html');
    if (fs.existsSync(postFile)) {
      const raw = fs.readFileSync(postFile, 'utf8');
      fullBody = extractArticleBody(raw);
    }
    return `    <item>
      <title>${escapeXML(p.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXML(p.description || '')}</description>${fullBody ? `\n      <content:encoded><![CDATA[${fullBody}]]></content:encoded>` : ''}
${cats ? cats + '\n' : ''}    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>itingyu · 博客</title>
    <link>${SITE_ORIGIN}/</link>
    <description>编程学习 / 金融观察 / 算法可视化。</description>
    <language>zh-cn</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${SITE_ORIGIN}/feeds/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

// ============================================================
// Search index (客户端全文搜索)
//   - assets/search-index.json
//   - 每个 post 含 title/description/tags/date/excerpt(纯文本前 500 字)
//   - 由 search.js 加载,纯前端匹配
// ============================================================

function stripTags(html) {
  return String(html == null ? '' : html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function renderSearchIndex(posts, rootDir = ROOT) {
  const sorted = sortPosts(posts);
  const items = sorted.map(p => {
    let excerpt = '';
    const file = path.join(rootDir, 'posts', p.slug, 'index.html');
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      const body = extractArticleBody(raw);
      excerpt = stripTags(body).slice(0, 500);
    }
    return {
      slug: p.slug,
      url: `${SITE_ORIGIN}/posts/${p.slug}/`,
      title: p.title,
      description: p.description || '',
      tags: (p.tags || []).map(t => t.name),
      date: p.date || '',
      excerpt,
    };
  });
  return JSON.stringify(
    { generated: new Date().toISOString().slice(0, 10), posts: items },
    null, 2,
  ) + '\n';
}

function renderSearchPage() {
  // pageShell 已包含 theme.js;追加 search.js
  const base = pageShell({
    title: '搜索 · itingyu',
    description: '在所有文章中搜索关键词。',
    canonical: `${SITE_ORIGIN}/search/`,
    activeNav: 'search',
    main: `    <h1>搜索</h1>
    <p class="search-hint">输入关键词搜索标题、标签、描述与正文。支持空格分隔多个关键词。</p>

    <div class="search-box">
      <input type="search" data-search-input
             placeholder="试试搜索：金融 / 算法 / 入门..."
             aria-label="搜索关键词"
             autocomplete="off" autocorrect="off" autocapitalize="off"
             spellcheck="false" />
      <p class="search-status" data-search-status aria-live="polite">正在加载索引…</p>
    </div>

    <ul class="search-results" data-search-results aria-label="搜索结果"></ul>
`,
  });
  // 在 </body> 前插入 search.js
  return base.replace('</body>', '  <script defer src="/assets/search.js"></script>\n</body>');
}

function renderSitemap(posts) {
  const staticPages = [
    { loc: `${SITE_ORIGIN}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE_ORIGIN}/posts/`, changefreq: 'weekly', priority: '0.9' },
    { loc: `${SITE_ORIGIN}/archive/`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${SITE_ORIGIN}/tags/`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${SITE_ORIGIN}/search/`, changefreq: 'monthly', priority: '0.4' },
    { loc: `${SITE_ORIGIN}/about/`, changefreq: 'monthly', priority: '0.5' },
  ];
  const tagNames = new Map();
  const tagSet = new Set();
  for (const p of posts) {
    for (const t of (p.tags || [])) {
      tagSet.add(t.slug);
      if (!tagNames.has(t.slug)) tagNames.set(t.slug, t.name);
    }
  }
  const tagPages = Array.from(tagSet).sort().map(slug => ({
    loc: `${SITE_ORIGIN}/tags/${slug}/`,
    changefreq: 'monthly',
    priority: '0.5',
  }));
  const postPages = sortPosts(posts).map(p => ({
    loc: `${SITE_ORIGIN}/posts/${p.slug}/`,
    lastmod: p.date || '',
    changefreq: 'monthly',
    priority: '0.8',
  }));
  const all = [...staticPages, ...tagPages, ...postPages];
  const today = new Date().toISOString().slice(0, 10);
  const urls = all.map(u => {
    const lastmod = u.lastmod || today;
    return `  <url><loc>${u.loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

// ============================================================
// Home page (index.html) update between markers
// ============================================================

const HOME_START_MARK = '<!-- build:posts-start -->';
const HOME_END_MARK = '<!-- build:posts-end -->';

function renderHomePostsSection(posts) {
  const top = sortPosts(posts).slice(0, HOME_LIMIT);
  const items = top.map(p => `      <li>
        <h3 class="post-title"><a href="/posts/${escapeHTML(p.slug)}/">${escapeHTML(p.title)}</a></h3>
        <div class="post-meta">
          <time datetime="${escapeHTML(p.date || '')}">${escapeHTML(p.date || '')}</time>
${(p.tags && p.tags.length) ? `          <span class="dot">·</span>\n          <a class="chip" href="/tags/${escapeHTML(p.tags[0].slug)}/" data-tag="${escapeHTML(p.tags[0].slug)}">${escapeHTML(p.tags[0].name)}</a>\n` : '        '}        </div>
        <p class="post-excerpt">${escapeHTML(p.description || p.title || '')}</p>
      </li>`).join('\n');
  return `${HOME_START_MARK}
    <h2 class="section-title">最新文章</h2>
    <ul class="post-list">
${items}
    </ul>

    <p style="margin-top: 1.5rem;"><a href="/posts/">查看全部文章 →</a></p>
${HOME_END_MARK}`;
}

function updateHomePage(html, posts) {
  if (html.indexOf(HOME_START_MARK) === -1 || html.indexOf(HOME_END_MARK) === -1) {
    return null; // no markers
  }
  let out = html;
  // JSON-LD Blog(叠加在现有 Person 之上;幂等)
  if (!hasJSONLDType(out, 'Blog')) {
    const blogJSONLD = renderBlogJSONLD({
      name: 'itingyu · 博客',
      description: 'itingyu 的个人博客。记录编程学习、金融市场观察与算法可视化笔记。',
      url: `${SITE_ORIGIN}/`,
      posts: sortPosts(posts).map(p => ({ title: p.title, url: postURL(p), date: p.date })),
    });
    out = injectJSONLDIntoHead(out, blogJSONLD);
  }
  const section = renderHomePostsSection(posts);
  const re = new RegExp(`${HOME_START_MARK}[\\s\\S]*?${HOME_END_MARK}`);
  return out.replace(re, section);
}

// ============================================================
// Build orchestration
// ============================================================

function computeBuild(rootDir = ROOT) {
  const posts = scanPosts(rootDir);

  const postsIndex = renderPostsIndex(posts);
  const archive = renderArchive(posts);
  const tagsIndex = renderTagsIndex(posts);

  const tagBuckets = new Map();
  const tagNames = new Map();
  for (const p of posts) {
    for (const t of (p.tags || [])) {
      tagBuckets.set(t.slug, (tagBuckets.get(t.slug) || 0) + 1);
      if (!tagNames.has(t.slug)) tagNames.set(t.slug, t.name);
    }
  }
  const tagPages = {};
  for (const [slug, name] of tagNames.entries()) {
    tagPages[slug] = renderTagPage(slug, name, posts);
  }

  const rss = renderRSS(posts, null, rootDir);
  const sitemap = renderSitemap(posts);
  const searchIndex = renderSearchIndex(posts, rootDir);
  const searchPage = renderSearchPage();

  let homeReplacement = null;
  const homeFile = path.join(rootDir, 'index.html');
  if (fs.existsSync(homeFile)) {
    const homeHtml = fs.readFileSync(homeFile, 'utf8');
    homeReplacement = updateHomePage(homeHtml, posts);
  }

  // 文章页增强注入(cover + related + progress + reading-time + og:image)
  const articlePages = {};
  for (const p of posts) {
    if (!p.sourcePath) continue;
    const file = path.join(rootDir, 'posts', p.slug, 'index.html');
    if (!fs.existsSync(file)) continue;
    const original = fs.readFileSync(file, 'utf8');
    const enhanced = injectArticlePageEnhancements(original, p, posts, rootDir);
    articlePages[`posts/${p.slug}/index.html`] = enhanced;
  }

  return {
    posts,
    files: {
      'posts/index.html': postsIndex,
      'archive/index.html': archive,
      'tags/index.html': tagsIndex,
      'feeds/rss.xml': rss,
      'sitemap.xml': sitemap,
      'search/index.html': searchPage,
      'assets/search-index.json': searchIndex,
      ...Object.fromEntries(Object.entries(tagPages).map(([slug, content]) =>
        [`tags/${slug}/index.html`, content])),
    },
    articlePages,
    homeReplacement,
    tagSlugs: Array.from(tagNames.keys()).sort(),
  };
}

function writeBuild(build, rootDir = ROOT) {
  const written = [];
  const removed = [];

  for (const [rel, content] of Object.entries(build.files)) {
    const full = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    written.push(rel);
  }

  // 文章页增强(只在内容真正变化时写入,避免无谓编辑)
  if (build.articlePages) {
    for (const [rel, content] of Object.entries(build.articlePages)) {
      const full = path.join(rootDir, rel);
      let before = null;
      try { before = fs.readFileSync(full, 'utf8'); } catch (_) {}
      if (before !== null && before === content) continue;
      fs.writeFileSync(full, content);
      written.push(rel);
    }
  }

  // home page replacement
  if (build.homeReplacement !== null) {
    const homeFile = path.join(rootDir, 'index.html');
    const before = fs.readFileSync(homeFile, 'utf8');
    if (before !== build.homeReplacement) {
      fs.writeFileSync(homeFile, build.homeReplacement);
      written.push('index.html');
    }
  }

  // prune tags/<slug>/index.html that no longer exist
  const tagsDir = path.join(rootDir, 'tags');
  if (fs.existsSync(tagsDir)) {
    const tagDirs = fs.readdirSync(tagsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
    for (const slug of tagDirs) {
      if (!build.tagSlugs.includes(slug)) {
        const idxFile = path.join(tagsDir, slug, 'index.html');
        if (fs.existsSync(idxFile)) {
          fs.unlinkSync(idxFile);
          removed.push(`tags/${slug}/index.html`);
        }
      }
    }
  }

  return { written, removed };
}

function checkDrift(build, rootDir = ROOT) {
  const drift = [];
  for (const [rel, expected] of Object.entries(build.files)) {
    const full = path.join(rootDir, rel);
    let actual;
    try {
      actual = fs.readFileSync(full, 'utf8');
    } catch (_) {
      drift.push({ rel, reason: 'missing' });
      continue;
    }
    if (actual !== expected) drift.push({ rel, reason: 'mismatch' });
  }
  if (build.articlePages) {
    for (const [rel, expected] of Object.entries(build.articlePages)) {
      const full = path.join(rootDir, rel);
      let actual;
      try { actual = fs.readFileSync(full, 'utf8'); }
      catch (_) { drift.push({ rel, reason: 'missing' }); continue; }
      if (actual !== expected) drift.push({ rel, reason: 'mismatch' });
    }
  }
  if (build.homeReplacement !== null) {
    const homeFile = path.join(rootDir, 'index.html');
    const actual = fs.readFileSync(homeFile, 'utf8');
    if (actual !== build.homeReplacement) drift.push({ rel: 'index.html', reason: 'mismatch' });
  }
  return drift;
}

// ============================================================
// CLI
// ============================================================

const ALL_TARGETS = ['posts', 'archive', 'tags', 'tag-pages', 'rss', 'sitemap', 'home', 'article-pages'];

function usage() {
  return `Usage: node scripts/build-index.js [options]

Options:
  --check          Check for drift without writing files (exit 1 if drift)
  --no-cache       Force full rebuild (bypass SHA-256 cache, equivalent to fresh clone)
  --only <name>    Only regenerate one output (posts|archive|tags|tag-pages|rss|sitemap|home|article-pages)
  --root <path>    Project root (default: cwd)
  -h, --help       Show this help
`;
}

function parseArgs(argv) {
  const opts = { check: false, noCache: false, only: null, root: ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--no-cache') opts.noCache = true;
    else if (a === '--only') { opts.only = argv[++i]; }
    else if (a === '--root') { opts.root = path.resolve(argv[++i]); }
    else if (a === '-h' || a === '--help') { opts.help = true; }
    else if (a.startsWith('--')) { /* unknown */ }
  }
  return opts;
}

function resolveTargets(opts) {
  if (!opts.only) return ALL_TARGETS;
  if (!ALL_TARGETS.includes(opts.only)) {
    process.stderr.write(`Unknown --only target: ${opts.only}\nValid: ${ALL_TARGETS.join(', ')}\n`);
    return null;
  }
  return [opts.only];
}

function relBelongsToTarget(rel, target) {
  if (target === 'posts') return rel === 'posts/index.html';
  if (target === 'archive') return rel === 'archive/index.html';
  if (target === 'tags') return rel === 'tags/index.html';
  if (target === 'tag-pages') return rel.startsWith('tags/') && rel !== 'tags/index.html';
  if (target === 'rss') return rel === 'feeds/rss.xml';
  if (target === 'sitemap') return rel === 'sitemap.xml';
  if (target === 'home') return rel === 'index.html';
  if (target === 'article-pages') return rel.startsWith('posts/') && rel !== 'posts/index.html';
  return false;
}

// 不受 --only 过滤影响,始终写入的「基线」文件(搜索 + 静态模板)。
function isBaselineRel(rel) {
  return rel === 'search/index.html' || rel === 'assets/search-index.json';
}

function isAggregateRel(rel) {
  // 不依赖具体 slug 的聚合页(以及模板无关的静态页)
  return rel === 'posts/index.html'
      || rel === 'archive/index.html'
      || rel === 'tags/index.html'
      || rel === 'feeds/rss.xml'
      || rel === 'sitemap.xml'
      || rel === 'index.html'
      || rel === 'search/index.html'
      || rel === 'assets/search-index.json';
}

function slugFromArticleRel(rel) {
  // posts/<slug>/index.html → <slug>
  const m = rel.match(/^posts\/([^/]+)\/index\.html$/);
  return m ? m[1] : null;
}

function collectFileMap(build) {
  const map = {};
  for (const [rel, content] of Object.entries(build.files || {})) map[rel] = content;
  for (const [rel, content] of Object.entries(build.articlePages || {})) map[rel] = content;
  if (build.homeReplacement !== null) map['index.html'] = build.homeReplacement;
  return map;
}

function runFullBuild(opts) {
  // 与原行为完全一致:重新渲染所有目标并写入(无 cache 干预)。
  const build = computeBuild(opts.root);
  const targets = resolveTargets(opts);
  if (!targets) return 2;

  // 按目标过滤
  if (!targets.includes('posts')) delete build.files['posts/index.html'];
  if (!targets.includes('archive')) delete build.files['archive/index.html'];
  if (!targets.includes('tags')) delete build.files['tags/index.html'];
  if (!targets.includes('tag-pages')) {
    for (const rel of Object.keys(build.files)) {
      if (rel.startsWith('tags/') && rel !== 'tags/index.html') delete build.files[rel];
    }
  }
  if (!targets.includes('rss')) delete build.files['feeds/rss.xml'];
  if (!targets.includes('sitemap')) delete build.files['sitemap.xml'];
  if (!targets.includes('home')) build.homeReplacement = null;
  if (!targets.includes('article-pages')) build.articlePages = {};

  if (opts.check) {
    const drift = checkDrift(build, opts.root);
    if (drift.length) {
      process.stdout.write('drift detected:\n');
      for (const d of drift) process.stdout.write(`  ${d.rel} (${d.reason})\n`);
      return 1;
    }
    process.stdout.write('no drift\n');
    return 0;
  }

  const { written, removed } = writeBuild(build, opts.root);
  for (const w of written) process.stdout.write(`write  ${w}\n`);
  for (const r of removed) process.stdout.write(`remove ${r}\n`);

  // 全量重建后也要写缓存,否则下次仍要走全量。
  persistCacheFromBuild(opts.root, build);
  return 0;
}

// 重建并写盘 SHA-256 缓存(供下次 incremental 使用)。
function persistCacheFromBuild(rootDir, build) {
  const posts = scanPosts(rootDir);
  const postShas = {};
  for (const p of posts) postShas[p.slug] = sha256FileSync(p.sourcePath);

  const allFiles = collectFileMap(build);
  const fileShas = {};
  for (const rel of Object.keys(allFiles)) {
    try {
      fileShas[rel] = sha256FileSync(path.join(rootDir, rel));
    } catch (_) { /* file may have been deleted concurrently */ }
  }
  const tagSlugsSet = new Set();
  for (const p of posts) for (const t of (p.tags || [])) tagSlugsSet.add(t.slug);
  saveCache(rootDir, {
    version: CACHE_VERSION,
    postShas,
    fileShas,
    tagSlugs: Array.from(tagSlugsSet).sort(),
  });
}

function runIncrementalBuild(opts) {
  const cache = opts.noCache ? null : loadCache(opts.root);
  const posts = scanPosts(opts.root);
  const postShas = {};
  for (const p of posts) postShas[p.slug] = sha256FileSync(p.sourcePath);

  // diff post 集
  const changedSlugs = [];
  const addedSlugs = [];
  const removedSlugs = [];
  for (const slug of Object.keys(postShas)) {
    if (!cache || !cache.postShas[slug]) addedSlugs.push(slug);
    else if (cache.postShas[slug] !== postShas[slug]) changedSlugs.push(slug);
  }
  if (cache) {
    for (const slug of Object.keys(cache.postShas)) {
      if (!(slug in postShas)) removedSlugs.push(slug);
    }
  }
  const anyPostChange = changedSlugs.length > 0 || addedSlugs.length > 0 || removedSlugs.length > 0;
  const cachePresent = !!cache;

  // 决定 --only 目标
  const targets = resolveTargets(opts);
  if (!targets) return 2;

  // 完整渲染所有内容(纯 JS、零 IO,代价小);从 build.files / articlePages / homeReplacement 取值
  const build = computeBuild(opts.root);
  const allFiles = collectFileMap(build);

  // 受 --only 过滤后的文件集(基线文件如搜索页/索引不受 --only 影响)。
  const candidateRels = Object.keys(allFiles).filter(rel => {
    if (isBaselineRel(rel)) return true;
    return targets.some(t => relBelongsToTarget(rel, t));
  });

  // 计算受影响集合
  const affected = new Set();
  for (const rel of candidateRels) {
    let dirty = false;

    if (!cachePresent || opts.noCache) {
      dirty = true;
    } else if (!cache.fileShas[rel]) {
      dirty = true; // 缓存从未记录过这个文件
    } else {
      try {
        const diskSha = sha256FileSync(path.join(opts.root, rel));
        if (diskSha !== cache.fileShas[rel]) dirty = true;
      } catch (_) {
        dirty = true; // 文件丢失 → 当 dirty 处理
      }
    }

    // 即使 disk 干净,post 变化也可能让内容过期
    if (!dirty && anyPostChange) {
      if (isAggregateRel(rel)) {
        dirty = true; // 聚合页依赖所有 post 元数据
      } else if (rel.startsWith('tags/') && rel !== 'tags/index.html') {
        // tag 页依赖该 tag 内的所有 post → 安全起见,任何 post 变化都重算
        dirty = true;
      } else if (rel.startsWith('posts/') && rel !== 'posts/index.html') {
        // 文章页依赖自身 + 其它 post(related 跨页聚合)
        dirty = true;
      }
    }

    if (dirty) affected.add(rel);
  }

  // 快速通道:全 0 变化 + 全 0 dirty → 无事可做
  if (!anyPostChange && affected.size === 0) {
    process.stdout.write('no-op: cache + disk match, no post changes\n');
    return 0;
  }

  // 打印 change-set 摘要(便于用户在 PR 反馈中确认增量范围)
  const changeSummary = [];
  if (changedSlugs.length) changeSummary.push(`changed:${changedSlugs.join(',')}`);
  if (addedSlugs.length) changeSummary.push(`added:${addedSlugs.join(',')}`);
  if (removedSlugs.length) changeSummary.push(`removed:${removedSlugs.join(',')}`);
  process.stdout.write(`incremental: posts ${changeSummary.join(' | ') || 'unchanged'} | affected ${affected.size} file(s)\n`);

  // 写入受影响文件(disk 对比写入,避免 mtime 无谓跳动)
  const written = [];
  for (const rel of affected) {
    const expected = allFiles[rel];
    const full = path.join(opts.root, rel);
    let before = null;
    try { before = fs.readFileSync(full, 'utf8'); } catch (_) {}
    if (before === expected) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, expected);
    written.push(rel);
  }
  for (const w of written) process.stdout.write(`write  ${w}\n`);

  // 修剪已不存在的 tag 页(只删当前 cache.tagSlugs 已知且 posts 里不再用的)
  const removed = pruneStaleTagPages(opts.root, posts, cache);
  for (const r of removed) process.stdout.write(`remove ${r}\n`);

  // 更新缓存:记下本次 build 后所有相关文件的 disk SHA
  const newFileShas = {};
  for (const rel of candidateRels) {
    try {
      newFileShas[rel] = sha256FileSync(path.join(opts.root, rel));
    } catch (_) { /* 文件可能已被删 */ }
  }
  const tagSlugsSet = new Set();
  for (const p of posts) for (const t of (p.tags || [])) tagSlugsSet.add(t.slug);
  saveCache(opts.root, {
    version: CACHE_VERSION,
    postShas,
    fileShas: newFileShas,
    tagSlugs: Array.from(tagSlugsSet).sort(),
  });

  return 0;
}

function pruneStaleTagPages(rootDir, posts, cache) {
  const removed = [];
  const tagsDir = path.join(rootDir, 'tags');
  if (!fs.existsSync(tagsDir)) return removed;
  const currentTagSlugs = new Set();
  for (const p of posts) for (const t of (p.tags || [])) currentTagSlugs.add(t.slug);
  const tagDirs = fs.readdirSync(tagsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  for (const slug of tagDirs) {
    if (!currentTagSlugs.has(slug)) {
      const idxFile = path.join(tagsDir, slug, 'index.html');
      if (fs.existsSync(idxFile)) {
        fs.unlinkSync(idxFile);
        removed.push(`tags/${slug}/index.html`);
      }
    }
  }
  return removed;
}

function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { process.stdout.write(usage()); return 0; }

  // --check 始终走全量 rebuild + drift 路径(不被缓存影响)。
  if (opts.check) return runFullBuild(opts);

  // --no-cache 或缓存缺失/损坏 → 退化为原全量行为。
  const cache = opts.noCache ? null : loadCache(opts.root);
  if (!cache) {
    if (opts.noCache) process.stdout.write('no-cache: full rebuild\n');
    return runFullBuild(opts);
  }

  return runIncrementalBuild(opts);
}

if (require.main === module) {
  const code = run(process.argv.slice(2));
  process.exit(code);
}

module.exports = {
  parseFrontmatter,
  scanPosts,
  sortPosts,
  scanCover,
  computeRelated,
  extractArticleBody,
  stripTags,
  injectArticlePageEnhancements,
  computeBuild,
  writeBuild,
  checkDrift,
  renderPostsIndex,
  renderArchive,
  renderTagsIndex,
  renderTagPage,
  renderRSS,
  renderSitemap,
  renderSearchIndex,
  renderSearchPage,
  renderHomePostsSection,
  updateHomePage,
  renderBreadcrumbListJSONLD,
  renderCollectionPageJSONLD,
  renderBlogJSONLD,
  injectJSONLDIntoHead,
  postURL,
  HOME_START_MARK,
  HOME_END_MARK,
  RSS_LIMIT,
  HOME_LIMIT,
  // Incremental cache (SHA-256)
  sha256,
  sha256FileSync,
  loadCache,
  saveCache,
  clearCache,
  run,
  runFullBuild,
  runIncrementalBuild,
  parseArgs,
  CACHE_VERSION,
  CACHE_REL_DIR,
};