#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

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

function pageShell({ title, description, canonical, ogImage, extraHead = '', activeNav = '', main }) {
  const ariaCurrent = (key) => activeNav === key ? ' aria-current="page"' : '';
  const nav = SITE_HEADER
    .replace('data-nav="home"', `data-nav="home"${ariaCurrent('home')}`)
    .replace('data-nav="posts"', `data-nav="posts"${ariaCurrent('posts')}`)
    .replace('data-nav="archive"', `data-nav="archive"${ariaCurrent('archive')}`)
    .replace('data-nav="tags"', `data-nav="tags"${ariaCurrent('tags')}`)
    .replace('data-nav="search"', `data-nav="search"${ariaCurrent('search')}`)
    .replace('data-nav="about"', `data-nav="about"${ariaCurrent('about')}`);
  const ogTag = ogImage
    ? `\n  <meta property="og:image" content="${escapeHTML(ogImage)}" />`
    : '';
  return `${HEAD_PRE_META}<title>${escapeHTML(title)}</title>
  <meta name="description" content="${escapeHTML(description)}" />
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
  <link rel="canonical" href="${canonical}" />${ogTag}
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
// og:image URL (absolutely required per spec design.md:242)
//   - 有 cover → posts/<slug>/cover.<ext>(绝对 URL)
//   - 无 cover → assets/og-default.svg(绝对 URL,默认图)
// ============================================================

function defaultOgImage() {
  return `${SITE_ORIGIN}/assets/og-default.svg`;
}

function scanOgImage(slug, rootDir = ROOT) {
  return scanCover(slug, rootDir) || defaultOgImage();
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

  // 5. og:image(幂等:已有 og:image 则跳过;有 cover → cover URL,否则回退默认图)
  const ogImage = scanOgImage(post.slug, rootDir);
  if (ogImage && !/<meta\s+property=["']og:image["']/.test(out)) {
    out = out.replace(
      /(<meta\s+property=["']article:author["'][^>]*>)([ \t]*\n)/,
      `$1\n    <meta property="og:image" content="${escapeHTML(ogImage)}" />$2`
    );
  }

  // 6. 字数 / 词数(紧跟 data-reading-time 后面;幂等)
  if (!/data-word-count/.test(out) && /data-reading-time/.test(out)) {
    out = out.replace(
      /(<span\s+data-reading-time>[^<]*<\/span>)/,
      '$1\n          <span class="dot">·</span>\n          <span class="word-count" data-word-count>统计中…</span>'
    );
  }

  return out;
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
    ogImage: defaultOgImage(),
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
  return pageShell({
    title: '归档 · itingyu',
    description: '按月归档的全部文章。',
    canonical: `${SITE_ORIGIN}/archive/`,
    ogImage: defaultOgImage(),
    activeNav: 'archive',
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
    ogImage: defaultOgImage(),
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
  return pageShell({
    title: `${tagName} · itingyu`,
    description: `「${tagName}」标签下的全部文章。`,
    canonical: `${SITE_ORIGIN}/tags/${tagSlug}/`,
    ogImage: defaultOgImage(),
    activeNav: 'tags',
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
    ogImage: defaultOgImage(),
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
const HOME_OG_MARK = '<!-- build:og-image -->';

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
  const section = renderHomePostsSection(posts);
  const re = new RegExp(`${HOME_START_MARK}[\\s\\S]*?${HOME_END_MARK}`);
  let out = html.replace(re, section);

  // 首页 head og:image(默认图,绝对 URL;幂等:marker 唯一)
  if (out.indexOf(HOME_OG_MARK) !== -1) {
    // ogLine 没有前导缩进 — 复用 marker 行原本的 2 空格缩进(由前面的 `\n  ` 提供)
    const ogLine = `<meta property="og:image" content="${escapeHTML(defaultOgImage())}" />\n  `;
    out = out.replace(
      new RegExp(`${HOME_OG_MARK}(\\s*<meta\\s+property=["']og:locale["'])`),
      `${ogLine}$1`
    );
  }
  return out;
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

function usage() {
  return `Usage: node scripts/build-index.js [options]

Options:
  --check          Check for drift without writing files (exit 1 if drift)
  --only <name>    Only regenerate one output (posts|archive|tags|tag-pages|rss|sitemap|home|article-pages)
  --root <path>    Project root (default: cwd)
  -h, --help       Show this help
`;
}

function parseArgs(argv) {
  const opts = { check: false, only: null, root: ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--only') { opts.only = argv[++i]; }
    else if (a === '--root') { opts.root = path.resolve(argv[++i]); }
    else if (a === '-h' || a === '--help') { opts.help = true; }
    else if (a.startsWith('--')) { /* unknown */ }
  }
  return opts;
}

function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { process.stdout.write(usage()); return 0; }
  const build = computeBuild(opts.root);
  const allNames = ['posts', 'archive', 'tags', 'tag-pages', 'rss', 'sitemap', 'home', 'article-pages'];

  let targets = allNames;
  if (opts.only) {
    if (!allNames.includes(opts.only)) {
      process.stderr.write(`Unknown --only target: ${opts.only}\nValid: ${allNames.join(', ')}\n`);
      return 2;
    }
    targets = [opts.only];
  }

  // Filter files in build by target
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
  return 0;
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
  defaultOgImage,
  scanOgImage,
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
  HOME_START_MARK,
  HOME_END_MARK,
  HOME_OG_MARK,
  RSS_LIMIT,
  HOME_LIMIT,
};