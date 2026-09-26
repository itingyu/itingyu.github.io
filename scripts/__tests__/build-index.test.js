'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const bi = require('../build-index.js');
const {
  scanPosts, sortPosts,
  scanCover, computeRelated, injectArticlePageEnhancements,
  extractArticleBody, stripTags,
  renderPostsIndex, renderArchive, renderTagsIndex, renderTagPage,
  renderSeriesIndex, renderSeriesPage, collectSeries,
  renderRSS, renderSitemap,
  renderSearchIndex, renderSearchPage,
  computeBuild, writeBuild, checkDrift,
  renderBreadcrumbListJSONLD, renderCollectionPageJSONLD, renderBlogJSONLD,
  injectJSONLDIntoHead, postURL,
} = bi;

const FIX = path.join(__dirname, 'fixtures');

// ----- helpers -----------------------------------------------------------

function makeProject(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-index-test-'));
  const posts = opts.posts || ['minimal-post'];
  fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
  for (const slug of posts) {
    const src = path.join(FIX, slug, 'index.html');
    const dst = path.join(tmp, 'posts', slug, 'index.html');
    fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  if (opts.homeWithMarkers) {
    fs.writeFileSync(path.join(tmp, 'index.html'),
      `<!doctype html><html><head><title>Home</title></head><body>
  <main>
    <section class="hero">HERO</section>
    <!-- build:posts-start -->
    <!-- build:posts-end -->
  </main>
</body></html>
`);
  }
  return tmp;
}

function cleanProject(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ----- 6. single post → posts/index.html contains its link ----------------

test('build: single post appears in posts/index.html', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    const build = computeBuild(tmp);
    writeBuild(build, tmp);
    const out = fs.readFileSync(path.join(tmp, 'posts', 'index.html'), 'utf8');
    assert.ok(out.includes('/posts/minimal-post/'), 'should contain post link');
    assert.ok(out.includes('最小示例'), 'should contain post title');
  } finally { cleanProject(tmp); }
});

// ----- 7. multiple posts sorted by date desc -----------------------------

test('build: multiple posts sorted by date desc', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post', 'edge-cases-post'] });
  try {
    const posts = scanPosts(tmp);
    const sorted = sortPosts(posts);
    assert.equal(sorted[0].slug, 'edge-cases-post'); // 2026-03-10
    assert.equal(sorted[1].slug, 'multi-tag-post');  // 2026-02-20
    assert.equal(sorted[2].slug, 'minimal-post');     // 2026-01-15

    const html = renderPostsIndex(posts);
    const i1 = html.indexOf('/posts/edge-cases-post/');
    const i2 = html.indexOf('/posts/multi-tag-post/');
    const i3 = html.indexOf('/posts/minimal-post/');
    assert.ok(i1 > 0 && i2 > 0 && i3 > 0);
    assert.ok(i1 < i2 && i2 < i3, 'edge < multi < minimal in rendered HTML');
  } finally { cleanProject(tmp); }
});

// ----- 8. multi-tag → tags/index.html lists all tags + correct counts ----

test('build: tags/index.html lists all tags with counts', () => {
  const tmp = makeProject({ posts: ['multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = renderTagsIndex(posts);
    assert.ok(html.includes('/tags/note/'), 'should link note');
    assert.ok(html.includes('/tags/finance/'), 'should link finance');
    assert.ok(html.includes('/tags/algorithm/'), 'should link algorithm');
    // counts: 每个 tag 在 tag-count span 里
    assert.ok(/class="tag-count">1<\/span>/.test(html), 'each tag count should be 1');
  } finally { cleanProject(tmp); }
});

// ----- 9. new tag → tags/<slug>/index.html auto-created -----------------

test('build: new tag directory is created on write', () => {
  const tmp = makeProject({ posts: ['multi-tag-post'] });
  try {
    const build = computeBuild(tmp);
    writeBuild(build, tmp);
    assert.ok(fs.existsSync(path.join(tmp, 'tags', 'note', 'index.html')));
    assert.ok(fs.existsSync(path.join(tmp, 'tags', 'finance', 'index.html')));
    assert.ok(fs.existsSync(path.join(tmp, 'tags', 'algorithm', 'index.html')));
  } finally { cleanProject(tmp); }
});

// ----- 10. removed tag → tags/<slug>/index.html deleted if empty -------

test('build: removed tag page is deleted on write', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  // Pre-create a stale tag page that should be pruned.
  fs.mkdirSync(path.join(tmp, 'tags', 'orphan'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tags', 'orphan', 'index.html'), 'stale');
  try {
    const build = computeBuild(tmp);
    const result = writeBuild(build, tmp);
    assert.ok(result.removed.includes('tags/orphan/index.html'),
      'orphan tag page should be in removed list');
    assert.ok(!fs.existsSync(path.join(tmp, 'tags', 'orphan', 'index.html')),
      'orphan tag file should be gone');
  } finally { cleanProject(tmp); }
});

// ----- 11. rss.xml: <item> count == posts (top 20) ----------------------

test('build: rss.xml has <item> per post (top 20)', () => {
  const slugs = [];
  for (let i = 0; i < 25; i++) slugs.push(`p${String(i).padStart(2, '0')}`);
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    for (let i = 0; i < 25; i++) {
      const slug = `p${String(i).padStart(2, '0')}`;
      fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'posts', slug, 'index.html'),
        `<!doctype html><html><head>
          <title>T${i}</title>
          <meta name="description" content="D${i}" />
          <meta property="article:published_time" content="2026-${String((i % 9) + 1).padStart(2, '0')}-15" />
        </head><body></body></html>`);
    }
    const posts = scanPosts(tmp);
    const rss = renderRSS(posts);
    const itemCount = (rss.match(/<item>/g) || []).length;
    assert.equal(itemCount, 20, 'rss should cap at 20 items');
  } finally { cleanProject(tmp); }
});

// ----- 12. sitemap.xml: every post URL + <lastmod> -----------------------

test('build: sitemap.xml contains each post URL with lastmod', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post', 'edge-cases-post'] });
  try {
    const posts = scanPosts(tmp);
    const xml = renderSitemap(posts);
    assert.ok(xml.includes('<loc>https://itingyu.github.io/posts/minimal-post/</loc>'));
    assert.ok(xml.includes('<loc>https://itingyu.github.io/posts/multi-tag-post/</loc>'));
    assert.ok(xml.includes('<loc>https://itingyu.github.io/posts/edge-cases-post/</loc>'));
    assert.ok(/minimal-post[^<]*<\/loc><lastmod>2026-01-15/.test(xml));
    assert.ok(/multi-tag-post[^<]*<\/loc><lastmod>2026-02-20/.test(xml));
  } finally { cleanProject(tmp); }
});

// ----- 13. --check detects drift on modified posts/index.html -----------

test('build: --check detects drift after manual edit', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    const build = computeBuild(tmp);
    writeBuild(build, tmp);
    // Now drift by editing posts/index.html
    const idxPath = path.join(tmp, 'posts', 'index.html');
    const before = fs.readFileSync(idxPath, 'utf8');
    fs.writeFileSync(idxPath, before + '\n<!-- tampered -->\n');
    // Recompute drift on the dirty tree
    const drift = checkDrift(computeBuild(tmp), tmp);
    assert.ok(drift.some(d => d.rel === 'posts/index.html'), 'should detect posts/index.html drift');
  } finally { cleanProject(tmp); }
});

// ----- 14. archive/index.html groups by month ----------------------------

test('build: archive/index.html groups posts by year-month', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post', 'edge-cases-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = renderArchive(posts);
    assert.ok(html.includes('2026 年 1 月'), 'should have 2026-01 group');
    assert.ok(html.includes('2026 年 2 月'), 'should have 2026-02 group');
    assert.ok(html.includes('2026 年 3 月'), 'should have 2026-03 group');
    assert.ok(html.indexOf('2026 年 3 月') < html.indexOf('2026 年 2 月'));
    assert.ok(html.indexOf('2026 年 2 月') < html.indexOf('2026 年 1 月'));
  } finally { cleanProject(tmp); }
});

// ----- 15. Chinese tag names: URL slug separate from display ------------

test('build: Chinese tag display name keeps English URL slug', () => {
  const tmp = makeProject({ posts: ['multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const build = computeBuild(tmp);
    writeBuild(build, tmp);

    // tags/index.html shows Chinese display name
    const tagsIdx = fs.readFileSync(path.join(tmp, 'tags', 'index.html'), 'utf8');
    assert.ok(tagsIdx.includes('金融'), 'display name should be 金融');
    assert.ok(tagsIdx.includes('/tags/finance/'), 'URL should be /tags/finance/');

    // tags/finance/index.html exists and shows 金融 in title
    const tagPage = fs.readFileSync(path.join(tmp, 'tags', 'finance', 'index.html'), 'utf8');
    assert.ok(tagPage.includes('金融'), 'tag page title should contain 金融');
    assert.ok(tagPage.includes('multi-tag-post'), 'tag page should list the post');
  } finally { cleanProject(tmp); }
});

// ----- bonus: home page marker replacement ------------------------------

test('build: home page posts section is replaced between markers', () => {
  const tmp = makeProject({ posts: ['minimal-post'], homeWithMarkers: true });
  try {
    const build = computeBuild(tmp);
    writeBuild(build, tmp);
    const home = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
    assert.ok(home.includes('HERO'), 'hero region must be preserved');
    assert.ok(home.includes('build:posts-start'));
    assert.ok(home.includes('build:posts-end'));
    assert.ok(home.includes('最小示例'), 'replacement should contain post');
  } finally { cleanProject(tmp); }
});

// ----- bonus: drift detection returns empty when fresh -----------------

test('build: checkDrift returns empty on a fresh build', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'] });
  try {
    const build = computeBuild(tmp);
    writeBuild(build, tmp);
    const drift = checkDrift(build, tmp);
    assert.deepEqual(drift, []);
  } finally { cleanProject(tmp); }
});
// ----- 16. scanCover: returns URL when cover.{svg,jpg,...} exists ---------

test('build: scanCover finds posts/<slug>/cover.{svg,jpg,...}', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    fs.writeFileSync(path.join(tmp, 'posts', 'minimal-post', 'cover.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"/>');
    const url = scanCover('minimal-post', tmp);
    assert.equal(url, 'https://itingyu.github.io/posts/minimal-post/cover.svg');

    // 不存在的 slug 返回 null
    assert.equal(scanCover('nope', tmp), null);
  } finally { cleanProject(tmp); }
});

test('build: scanCover prefers svg > jpg > png order', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    fs.writeFileSync(path.join(tmp, 'posts', 'minimal-post', 'cover.png'), 'png');
    fs.writeFileSync(path.join(tmp, 'posts', 'minimal-post', 'cover.svg'), 'svg');
    const url = scanCover('minimal-post', tmp);
    assert.equal(url, 'https://itingyu.github.io/posts/minimal-post/cover.svg');
  } finally { cleanProject(tmp); }
});

// ----- 17. computeRelated: same-tag first, exclude self, fill by date ----

test('build: computeRelated prefers same tag, excludes self, fills by date', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post', 'edge-cases-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts.find(p => p.slug === 'multi-tag-post');
    const related = computeRelated(me, posts);
    assert.ok(Array.isArray(related));
    assert.ok(related.length >= 1, 'should have at least one related');
    assert.ok(!related.find(p => p.slug === 'multi-tag-post'), 'must exclude self');

    // minimal-post 没有标签 → 不会被排进 sameTag
    // multi-tag-post 自身的标签集 {note, finance, algorithm},其他 fixture 都没共享 → sameTag 为空
    // 所以走 others,按日期降序: edge-cases-post (2026-03-10) 排第一
    assert.equal(related[0].slug, 'edge-cases-post',
      'non-same-tag posts fall back to date-desc ordering');
  } finally { cleanProject(tmp); }
});

test('build: computeRelated puts same-tag posts first when tags overlap', () => {
  // 自建 fixture: A、C 共享 "shared" tag;B 不共享;期望 related(A) 顶部是 C
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'related-test-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    function mkPost(slug, date, tags) {
      fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
      const tagHTML = tags.map(t => `<a class="chip" href="/tags/${t}/" data-tag="${t}">${t}</a>`).join('');
      const tagMeta = tags.map(t => `  <meta property="article:tag" content="${t}" />`).join('\n');
      fs.writeFileSync(path.join(tmp, 'posts', slug, 'index.html'),
        `<!doctype html><html><head>
          <title>${slug}</title>
          <meta property="article:published_time" content="${date}" />
${tagMeta}
        </head><body><main><article><div class="post-meta">${tagHTML}</div></article></main></body></html>`);
    }
    mkPost('post-a', '2026-01-01', ['shared', 'note']);
    mkPost('post-b', '2026-02-01', ['other']);
    mkPost('post-c', '2025-12-01', ['shared']);

    const posts = scanPosts(tmp);
    const me = posts.find(p => p.slug === 'post-a');
    const related = computeRelated(me, posts);
    assert.equal(related[0].slug, 'post-c',
      'same-tag (post-c) should rank above non-same-tag (post-b) even when post-b is newer');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ----- 18. injectArticlePageEnhancements: idempotent + multi-aspect -----

test('build: injectArticlePageEnhancements is idempotent', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts[0];
    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');
    const once = injectArticlePageEnhancements(html, me, posts, tmp);
    const twice = injectArticlePageEnhancements(once, me, posts, tmp);
    assert.equal(once, twice, 'second injection must be byte-equal');
  } finally { cleanProject(tmp); }
});

test('build: injectArticlePageEnhancements injects progress + related + reading-time', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts.find(p => p.slug === 'minimal-post');
    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');
    const out = injectArticlePageEnhancements(html, me, posts, tmp);

    assert.ok(/class="reading-progress"\s+data-reading-progress/.test(out),
      'should inject reading-progress bar');
    assert.ok(/data-reading-time/.test(out),
      'should mark reading-time span');
    assert.ok(/<aside class="related"\s+aria-label="相关文章">/.test(out),
      'should inject related section');
  } finally { cleanProject(tmp); }
});

test('build: injectArticlePageEnhancements injects cover when present', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    fs.writeFileSync(path.join(tmp, 'posts', 'minimal-post', 'cover.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const posts = scanPosts(tmp);
    const me = posts[0];
    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');
    const out = injectArticlePageEnhancements(html, me, posts, tmp);

    assert.ok(/<img class="post-cover"\s+src="[^"]*cover\.svg"/.test(out),
      'should inject post-cover img');
    assert.ok(/<meta property="og:image"\s+content="[^"]*cover\.svg"/.test(out),
      'should inject og:image meta');
  } finally { cleanProject(tmp); }
});

// ----- 19. computeBuild emits articlePages map + writeBuild is idempotent ----

test('build: articlePages map covers every post and writeBuild is idempotent', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'] });
  try {
    const build = computeBuild(tmp);
    assert.ok(build.articlePages);
    assert.ok(build.articlePages['posts/minimal-post/index.html']);
    assert.ok(build.articlePages['posts/multi-tag-post/index.html']);

    writeBuild(build, tmp);
    // First write should mutate file (inject progress + related).
    const before = fs.readFileSync(path.join(tmp, 'posts', 'minimal-post', 'index.html'), 'utf8');

    // Recompute build on the patched tree; second writeBuild must be no-op for articles.
    const build2 = computeBuild(tmp);
    const beforeWritten = [];
    const writtenProxy = new Proxy({}, {
      get(_, k) { return beforeWritten[k]; },
    });
    const spyWritten = [];
    const realWriteFileSync = fs.writeFileSync;
    const realReadFileSync = fs.readFileSync;
    fs.readFileSync = (p, enc) => {
      if (typeof p === 'string' && p.includes('posts/') && p.endsWith('index.html')) {
        return before;
      }
      return realReadFileSync.call(fs, p, enc);
    };
    try {
      writeBuild(build2, tmp);
    } finally {
      fs.readFileSync = realReadFileSync;
    }
    // computeBuild again to verify output is stable
    const build3 = computeBuild(tmp);
    assert.deepEqual(build2.articlePages['posts/minimal-post/index.html'],
                     build3.articlePages['posts/minimal-post/index.html'],
                     'articlePages must be stable across recomputations');
  } finally { cleanProject(tmp); }
});

// ----- 20. extractArticleBody: keep body, strip article-header + related --

test('build: extractArticleBody keeps article body, strips header/related', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = fs.readFileSync(path.join(tmp, 'posts', posts[0].slug, 'index.html'), 'utf8');
    const body = extractArticleBody(html);
    assert.ok(/<h2>第一段<\/h2>/.test(body), 'should keep article h2');
    assert.ok(/正文。/.test(body), 'should keep paragraph text');
    assert.ok(!/article-header/.test(body), 'should strip article-header');
    assert.ok(!/class="related"/.test(body), 'should strip related aside');
    assert.ok(!/<h1>最小示例<\/h1>/.test(body), 'should strip article-header h1');
  } finally { cleanProject(tmp); }
});

// ----- 21. renderRSS: full body in <content:encoded> + xmlns:content NS -----

test('build: rss.xml content:encoded contains full article body (CDATA)', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    const posts = scanPosts(tmp);
    const xml = renderRSS(posts, null, tmp);
    assert.ok(/xmlns:content="http:\/\/purl\.org\/rss\/1\.0\/modules\/content\/"/.test(xml),
      'should declare content namespace');
    assert.ok(/<content:encoded><!\[CDATA\[[\s\S]*?<h2>第一段<\/h2>[\s\S]*?\]\]><\/content:encoded>/.test(xml),
      'should embed full body in content:encoded CDATA');
    assert.ok(/正文。/.test(xml), 'body text must appear in RSS');
  } finally { cleanProject(tmp); }
});

test('build: rss.xml content:encoded strips header / footer / related', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    const posts = scanPosts(tmp);
    const xml = renderRSS(posts, null, tmp);
    // 提取第一个 item 中的 CDATA 区段
    const m = xml.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/);
    assert.ok(m, 'should have CDATA section');
    const inner = m[1];
    assert.ok(!/article-header/.test(inner), 'CDATA must not contain article-header');
    assert.ok(!/article-footer/.test(inner), 'CDATA must not contain article-footer');
    assert.ok(!/class="related"/.test(inner), 'CDATA must not contain related aside');
    assert.ok(!/<h1>最小示例<\/h1>/.test(inner), 'CDATA must not contain header h1');
  } finally { cleanProject(tmp); }
});

// ----- 22. stripTags: 剥 HTML + 解码常见实体 + 折叠空白 -------------------

test('build: stripTags removes tags and decodes entities, collapses whitespace', () => {
  const html = '<p>Hello&nbsp;<strong>world</strong> & <ok> "q"</p>';
  const out = stripTags(html);
  assert.equal(out, 'Hello world & "q"');
});

// ----- 23. renderSearchIndex: JSON with all posts, sorted, no HTML -------

test('build: renderSearchIndex produces sorted JSON with excerpts (no HTML)', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const json = renderSearchIndex(posts, tmp);
    const parsed = JSON.parse(json);
    assert.ok(parsed.generated, 'should have generated date');
    assert.equal(parsed.posts.length, 2);
    // 按日期降序
    assert.equal(parsed.posts[0].slug, 'multi-tag-post');
    assert.equal(parsed.posts[1].slug, 'minimal-post');
    // excerpt 必须无 HTML
    assert.ok(!/<[a-z][^>]*>/i.test(parsed.posts[0].excerpt),
      'excerpt must be stripped of HTML tags');
    // multi-tag-post 应包含正文中的关键词
    assert.ok(parsed.posts[0].excerpt.length > 0);
    // tags 是字符串数组
    assert.ok(Array.isArray(parsed.posts[0].tags));
    assert.ok(parsed.posts[0].tags.includes('金融'));
  } finally { cleanProject(tmp); }
});

// ----- 24. renderSearchPage: 含搜索框 + 加载 search.js -------------------

test('build: renderSearchPage contains search input, status, results, search.js script', () => {
  const html = renderSearchPage();
  assert.ok(/data-search-input/.test(html), 'must contain search input');
  assert.ok(/data-search-status/.test(html), 'must contain status region');
  assert.ok(/data-search-results/.test(html), 'must contain results region');
  assert.ok(/\/assets\/search\.js/.test(html), 'must reference search.js');
  assert.ok(/aria-current="page"/.test(html), 'search nav should be marked current');
});

// ----- 25. computeBuild emits search-index.json + search/index.html ------

test('build: computeBuild emits search index + search page; --check stays green', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'] });
  try {
    const build = computeBuild(tmp);
    assert.ok(build.files['assets/search-index.json'], 'should emit search-index.json');
    assert.ok(build.files['search/index.html'], 'should emit search/index.html');

    // 写入后 drift 检测应为空(无任何外部修改)
    writeBuild(build, tmp);
    const drift = checkDrift(computeBuild(tmp), tmp);
    assert.deepEqual(drift, []);

    // 索引文件能被 parse 且含所有文章
    const idx = JSON.parse(fs.readFileSync(path.join(tmp, 'assets', 'search-index.json'), 'utf8'));
    assert.equal(idx.posts.length, 2);
  } finally { cleanProject(tmp); }
});

// ----- 26. style.css dark theme tokens & reduced-motion -------------------

test('build: style.css has both light + dark token sets with key new vars', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'style.css'), 'utf8');

  // 浅色默认 token
  for (const k of ['--fg', '--bg', '--bg-elev', '--accent', '--code-inline-bg', '--code-inline-fg', '--scrollbar']) {
    assert.ok(css.includes(k + ':'), `must declare ${k} (light)`);
  }

  // dark 主题两处覆盖(prefers-color-scheme 与 [data-theme="dark"])
  const darkMentions = (css.match(/data-theme="dark"/g) || []).length;
  assert.ok(darkMentions >= 2, 'should cover dark via both [data-theme] and prefers-color-scheme');

  // prefers-reduced-motion 存在且覆盖 transition
  assert.ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css),
    'should declare prefers-reduced-motion guard');
  assert.ok(/transition-duration:\s*\.001ms/.test(css),
    'should clamp transition-duration under reduced motion');

  // scrollbar 自适应
  assert.ok(/scrollbar-color:\s*var\(--scrollbar\)/.test(css),
    'should theme scrollbar via scrollbar-color');

  // code-inline 与 accent 解耦(避免暗色 accent 紫与代码 chip 混淆)
  assert.ok(/background:\s*var\(--code-inline-bg\)/.test(css),
    'inline code should use --code-inline-bg, not --bg-soft');
  assert.ok(/color:\s*var\(--code-inline-fg\)/.test(css),
    'inline code should use --code-inline-fg, not --accent');

  // table 斑马纹
  assert.ok(/tbody tr:nth-child\(odd\)/.test(css),
    'table should have zebra striping');

  // color-scheme 切换
  assert.ok(/color-scheme:\s*dark/.test(css), 'dark mode should set color-scheme: dark');
  assert.ok(/color-scheme:\s*light/.test(css), 'explicit light mode should set color-scheme: light');

  // print 段合并(v5.1 段)
  const printBlocks = (css.match(/@media print/g) || []).length;
  assert.equal(printBlocks, 1, 'should have exactly one print media block');
});

// ----- 27. C3 tag cloud: 字号权重 inline style 注入 ---------------------

test('build: renderTagsIndex emits tag cloud with --tag-size on each chip', () => {
  const tmp = makeProject({ posts: ['multi-tag-post', 'edge-cases-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = renderTagsIndex(posts);
    assert.ok(/class="tag-cloud"/.test(html), 'should use .tag-cloud container');
    assert.ok(/--tag-size:\s*[\d.]+rem/.test(html), 'should inject --tag-size per chip');
    assert.ok(/class="tag-count">\d+<\/span>/.test(html), 'should display per-tag count');
  } finally { cleanProject(tmp); }
});

test('build: tag cloud orders tags by count desc (largest first)', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = renderTagsIndex(posts);
    // multi-tag-post 有 3 个 tag,multi-tag-post 的 tag 总出现次数最多;
    // minimal-post 无 tag。期望云里至少含 note/finance/algorithm(各 1 次)
    assert.ok(html.indexOf('note') >= 0);
    assert.ok(html.indexOf('finance') >= 0);
    assert.ok(html.indexOf('algorithm') >= 0);
  } finally { cleanProject(tmp); }
});

// ----- 28. C11 word count injection in article meta ---------------------

test('build: injectArticlePageEnhancements adds data-word-count after data-reading-time', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts[0];
    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');
    const out = injectArticlePageEnhancements(html, me, posts, tmp);

    assert.ok(/data-word-count/.test(out), 'should inject word count placeholder');
    assert.ok(/class="word-count"/.test(out), 'should use .word-count class');
    // 应紧跟在 reading-time 后
    const iTime = out.indexOf('data-reading-time');
    const iWord = out.indexOf('data-word-count');
    assert.ok(iTime > 0 && iWord > 0 && iWord > iTime, 'word count must follow reading time');
  } finally { cleanProject(tmp); }
});

// ----- 29. C11 idempotency: data-word-count only added once --------------

test('build: word-count injection is idempotent', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts[0];
    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');
    const once = injectArticlePageEnhancements(html, me, posts, tmp);
    const twice = injectArticlePageEnhancements(once, me, posts, tmp);
    assert.equal(once, twice, 'second pass must be no-op');
    const wordMatches = (twice.match(/data-word-count/g) || []).length;
    assert.equal(wordMatches, 1, 'data-word-count must appear exactly once');
  } finally { cleanProject(tmp); }
});

// ----- 30. C8 copy button CSS in style.css -------------------------------

test('build: style.css declares .copy-btn with hover/focus/copied states', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'style.css'), 'utf8');
  assert.ok(/\.copy-btn\s*\{/.test(css), 'should declare .copy-btn');
  assert.ok(/article pre:hover .copy-btn/.test(css), 'should reveal on pre hover');
  assert.ok(/\.copy-btn\.is-copied/.test(css), 'should declare copied state');
  assert.ok(/navigator\.clipboard|navigator\.clipboard|fallbackCopy/.test(
    fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'theme.js'), 'utf8'),
  ), 'theme.js should reference clipboard API + fallback');
});

// ----- 31. C11 reading-stats function replaces old estimateReadingTime -----

test('build: theme.js declares estimateReadingStats with word + char split', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'theme.js'), 'utf8');
  assert.ok(/function estimateReadingStats\b/.test(js), 'should rename to estimateReadingStats');
  assert.ok(/data-word-count/.test(js), 'should fill data-word-count');
  assert.ok(/data-reading-time/.test(js), 'should still fill data-reading-time');
  assert.ok(/[\u4e00-\u9fa5]/.test(js), 'should detect CJK characters');
});

// ----- 32. tag cloud: 单 count 数据下仍保持视觉层次(size + weight + tint)

test('build: tag cloud assigns --tag-size + --tag-weight per chip', () => {
  const tmp = makeProject({ posts: ['multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = renderTagsIndex(posts);
    // 每个 chip 必须带两个内联变量
    const chips = html.match(/<a class="chip"[^>]*>/g) || [];
    chips.forEach(c => {
      assert.ok(/--tag-size:\s*[\d.]+rem/.test(c), 'each chip should set --tag-size');
      assert.ok(/--tag-weight:\s*[\d.]+/.test(c), 'each chip should set --tag-weight');
    });
  } finally { cleanProject(tmp); }
});

test('build: tag cloud hint explains when counts are uniform', () => {
  const tmp = makeProject({ posts: ['multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = renderTagsIndex(posts);
    // multi-tag-post 含 3 个 tag,各 1 次 → count 全等 → 提示文案应包含「文章 ≥ 3 篇」
    assert.ok(/文章\s*≥\s*3\s*篇/.test(html),
      'should show 3-article threshold hint when counts uniform');
  } finally { cleanProject(tmp); }
});

test('build: tag cloud hint shows weight range when counts vary', () => {
  // 自建 2 个 tag,A=2 篇,B=1 篇 → count 不等
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tagcloud-vary-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    function mkPost(slug, date, tag) {
      fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'posts', slug, 'index.html'),
        `<!doctype html><html><head>
          <title>${slug}</title>
          <meta property="article:published_time" content="${date}" />
          <meta property="article:tag" content="${tag}" />
        </head><body><main><article><div class="post-meta"><a class="chip" href="/tags/${tag}/" data-tag="${tag}">${tag}</a></div></article></main></body></html>`);
    }
    mkPost('p1', '2026-01-01', 'hot');
    mkPost('p2', '2026-01-02', 'hot');
    mkPost('p3', '2026-01-03', 'cold');
    const posts = scanPosts(tmp);
    const html = renderTagsIndex(posts);
    // count:hot=2, cold=1 → hint 应包含「最多 2 篇,最少 1 篇」
    assert.ok(/最多\s*2\s*篇.*最少\s*1\s*篇/.test(html),
      'should show weight range when counts differ');
    // size 应有差异(不等)
    const sizes = [...html.matchAll(/--tag-size:\s*([\d.]+rem)/g)].map(m => m[1]);
    assert.equal(new Set(sizes).size, 2, 'sizes should differ between hot and cold tags');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ----- 33. search.js: 默认展示全部文章(不输入也可见) -------------------

test('build: search.js renders all posts by default when no query', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'search.js'), 'utf8');
  assert.ok(/function renderDefault\b/.test(js), 'should define renderDefault');
  assert.ok(/renderDefault\(\)/.test(js), 'should call renderDefault on initial load (no ?q=)');
  assert.ok(/localeCompare/.test(js), 'should sort by date desc');
});

// ----- 34. search.js: Esc 清空恢复默认 ---------------------------------

test('build: search.js Esc handler falls back to renderDefault', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'search.js'), 'utf8');
  assert.ok(/e\.key\s*===\s*['"]Escape['"]/.test(js), 'should listen for Escape');
  assert.ok(/renderDefault\(\)/.test(js), 'Escape should reset to default list');
});

// ----- 35. search.js: 输入空字符串回到默认(不是显示空状态) -------------

test('build: search.js empty token list falls back to renderDefault not empty state', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'search.js'), 'utf8');
  // 在 renderHits 里,有 tokens.length === 0 时调用 renderDefault,而不是 setEmpty
  const block = js.match(/function renderHits\b([\s\S]*?)\n  \}/);
  assert.ok(block, 'should have renderHits function');
  assert.ok(/renderDefault\(\)/.test(block[1]),
    'renderHits should call renderDefault on empty token list');
});

// ----- 36. AIWORK1-37 JSON-LD: 文章页 BreadcrumbList(Home › Tag › Article)

function extractJSONLDBlocks(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    try { out.push(JSON.parse(m[1])); }
    catch (_) { out.push({ __parseError: m[1].slice(0, 80) }); }
  }
  return out;
}

test('build: article page injects BreadcrumbList JSON-LD with 3 ListItems', () => {
  const tmp = makeProject({ posts: ['multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts.find(p => p.slug === 'multi-tag-post');
    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');
    const out = injectArticlePageEnhancements(html, me, posts, tmp);

    const blocks = extractJSONLDBlocks(out);
    const breadcrumb = blocks.find(b => b['@type'] === 'BreadcrumbList');
    assert.ok(breadcrumb, 'should inject BreadcrumbList JSON-LD');
    assert.equal(breadcrumb['@context'], 'https://schema.org');
    assert.equal(breadcrumb['@type'], 'BreadcrumbList');
    assert.ok(Array.isArray(breadcrumb.itemListElement), 'itemListElement must be array');
    assert.equal(breadcrumb.itemListElement.length, 3, 'must be Home › Tag › Article');

    const [i1, i2, i3] = breadcrumb.itemListElement;
    assert.equal(i1['@type'], 'ListItem');
    assert.equal(i1.position, 1);
    assert.equal(i1.name, '首页');
    assert.equal(i1.item, 'https://itingyu.github.io/');
    assert.equal(i2.position, 2);
    assert.equal(i2.item, 'https://itingyu.github.io/tags/note/',
      'Tag link should use first tag slug');
    assert.equal(i3.position, 3);
    assert.equal(i3.item, 'https://itingyu.github.io/posts/multi-tag-post/');
    // 所有字段必须非空
    for (const it of breadcrumb.itemListElement) {
      assert.ok(it.name && it.item, `ListItem name+item non-empty (got ${JSON.stringify(it)})`);
    }
  } finally { cleanProject(tmp); }
});

test('build: article page BreadcrumbList falls back to /tags/ when post has no tags', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts[0]; // minimal-post 无标签
    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');
    const out = injectArticlePageEnhancements(html, me, posts, tmp);
    const breadcrumb = extractJSONLDBlocks(out).find(b => b['@type'] === 'BreadcrumbList');
    assert.ok(breadcrumb, 'should inject BreadcrumbList');
    assert.equal(breadcrumb.itemListElement[1].item, 'https://itingyu.github.io/tags/',
      'no-tag post should fall back to /tags/ index');
  } finally { cleanProject(tmp); }
});

test('build: article page BreadcrumbList injection is idempotent', () => {
  const tmp = makeProject({ posts: ['multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts[0];
    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');
    const once = injectArticlePageEnhancements(html, me, posts, tmp);
    const twice = injectArticlePageEnhancements(once, me, posts, tmp);
    assert.equal(once, twice, 'second pass must be byte-equal');
    const blocks = extractJSONLDBlocks(twice);
    const breadcrumbCount = blocks.filter(b => b['@type'] === 'BreadcrumbList').length;
    assert.equal(breadcrumbCount, 1, 'BreadcrumbList must appear exactly once');
  } finally { cleanProject(tmp); }
});

// ----- 37. AIWORK1-37 JSON-LD: 标签页 / 归档页 CollectionPage ------------

test('build: tag page emits CollectionPage JSON-LD with non-empty hasPart', () => {
  const tmp = makeProject({ posts: ['multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = renderTagPage('note', '随笔', posts);

    const blocks = extractJSONLDBlocks(html);
    const collection = blocks.find(b => b['@type'] === 'CollectionPage');
    assert.ok(collection, 'should emit CollectionPage JSON-LD');
    assert.equal(collection['@context'], 'https://schema.org');
    assert.equal(collection.name, '随笔 · itingyu');
    assert.equal(collection.url, 'https://itingyu.github.io/tags/note/');
    assert.ok(Array.isArray(collection.hasPart), 'hasPart must be array');
    assert.ok(collection.hasPart.length >= 1, 'hasPart non-empty');
    const first = collection.hasPart[0];
    assert.equal(first['@type'], 'BlogPosting');
    assert.ok(first.headline && first.url, 'each BlogPosting has headline + url');
    assert.equal(first.url, 'https://itingyu.github.io/posts/multi-tag-post/');
  } finally { cleanProject(tmp); }
});

test('build: archive page emits CollectionPage JSON-LD with all posts', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post', 'edge-cases-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = renderArchive(posts);

    const blocks = extractJSONLDBlocks(html);
    const collection = blocks.find(b => b['@type'] === 'CollectionPage');
    assert.ok(collection, 'should emit CollectionPage JSON-LD');
    assert.equal(collection.url, 'https://itingyu.github.io/archive/');
    assert.ok(Array.isArray(collection.hasPart), 'hasPart must be array');
    assert.equal(collection.hasPart.length, 3, 'archive should list every post');
    // 每条都是 BlogPosting 且字段非空
    for (const ref of collection.hasPart) {
      assert.equal(ref['@type'], 'BlogPosting');
      assert.ok(ref.headline && ref.url, 'each ref has headline + url');
    }
    // 按日期降序:edge-cases-post (2026-03-10) → multi-tag-post (2026-02-20) → minimal-post (2026-01-15)
    assert.equal(collection.hasPart[0].url, 'https://itingyu.github.io/posts/edge-cases-post/');
    assert.equal(collection.hasPart[1].url, 'https://itingyu.github.io/posts/multi-tag-post/');
    assert.equal(collection.hasPart[2].url, 'https://itingyu.github.io/posts/minimal-post/');
  } finally { cleanProject(tmp); }
});

// ----- 38. AIWORK1-37 JSON-LD: 首页 Blog(叠加在现有 Person 之上) -----

test('build: home page injects Blog JSON-LD with blogPost list', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'], homeWithMarkers: true });
  try {
    const build = computeBuild(tmp);
    const out = build.homeReplacement;
    assert.ok(out, 'should have homeReplacement when markers present');

    const blocks = extractJSONLDBlocks(out);
    const blog = blocks.find(b => b['@type'] === 'Blog');
    assert.ok(blog, 'should emit Blog JSON-LD');
    assert.equal(blog['@context'], 'https://schema.org');
    assert.equal(blog.url, 'https://itingyu.github.io/');
    assert.ok(blog.name && blog.description, 'Blog name + description non-empty');
    assert.ok(Array.isArray(blog.blogPost), 'blogPost must be array');
    assert.equal(blog.blogPost.length, 2, 'blogPost should list every post');
    for (const ref of blog.blogPost) {
      assert.equal(ref['@type'], 'BlogPosting');
      assert.ok(ref.headline && ref.url, 'each blogPost has headline + url');
    }
  } finally { cleanProject(tmp); }
});

test('build: home page Blog JSON-LD stacks above existing Person JSON-LD', () => {
  // 模拟真实首页 — 已含 Person JSON-LD;注入 Blog 后两者并存
  const tmp = makeProject({ posts: ['minimal-post'], homeWithMarkers: true });
  try {
    const homeFile = path.join(tmp, 'index.html');
    const orig = fs.readFileSync(homeFile, 'utf8');
    // 注入 Person JSON-LD(模拟真实首页)
    const withPerson = orig.replace(
      /<title>([^<]*)<\/title>/,
      `<title>$1</title>
  <script type="application/ld+json">
  { "@context": "https://schema.org", "@type": "Person", "name": "itingyu", "url": "https://itingyu.github.io/" }
  </script>
  <script>
    (function(){ try { document.documentElement.setAttribute('data-theme', 'light'); } catch (_) {} })();
  </script>`
    );
    fs.writeFileSync(homeFile, withPerson);

    const build = computeBuild(tmp);
    const out = build.homeReplacement;
    assert.ok(out, 'should have homeReplacement');

    const blocks = extractJSONLDBlocks(out);
    const types = blocks.map(b => b['@type']);
    assert.ok(types.includes('Person'), 'should keep existing Person');
    assert.ok(types.includes('Blog'), 'should add Blog');
  } finally { cleanProject(tmp); }
});

test('build: updateHomePage Blog JSON-LD injection is idempotent', () => {
  const tmp = makeProject({ posts: ['minimal-post'], homeWithMarkers: true });
  try {
    const posts = scanPosts(tmp);
    const original = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
    // 现有 home 已经包含 Person JSON-LD(JSON-LD 注释块);这里先模拟一次注入
    const once = (function injectFromHelper(html) {
      let out = html;
      const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"\s*:\s*"Blog"/i;
      if (!re.test(out)) {
        const blogScript = renderBlogJSONLD({
          name: 'itingyu · 博客',
          description: 'x',
          url: 'https://itingyu.github.io/',
          posts: [],
        });
        out = injectJSONLDIntoHead(out, blogScript);
      }
      return out;
    })(original);
    const twice = (function injectFromHelper(html) {
      let out = html;
      const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"\s*:\s*"Blog"/i;
      if (!re.test(out)) {
        const blogScript = renderBlogJSONLD({
          name: 'itingyu · 博客',
          description: 'x',
          url: 'https://itingyu.github.io/',
          posts: [],
        });
        out = injectJSONLDIntoHead(out, blogScript);
      }
      return out;
    })(once);
    assert.equal(once, twice, 'second pass must be byte-equal');
    const blocks = extractJSONLDBlocks(twice);
    const blogCount = blocks.filter(b => b['@type'] === 'Blog').length;
    assert.equal(blogCount, 1, 'Blog JSON-LD must appear exactly once');
  } finally { cleanProject(tmp); }
});

// ----- 39. AIWORK1-37 JSON-LD: --check stays green after JSON-LD injection

test('build: --check stays green after JSON-LD injection on all 4 page types', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'], homeWithMarkers: true });
  try {
    const build = computeBuild(tmp);
    writeBuild(build, tmp);
    // 重算并比对 — 没有 drift 说明 JSON-LD 完全幂等
    const drift = checkDrift(computeBuild(tmp), tmp);
    assert.deepEqual(drift, [], 'no drift after writing + recomputing');
  } finally { cleanProject(tmp); }
});

// ============================================================
// AIWORK1-39 / spec v1.2 · article:section + /series/ 端到端契约
// ============================================================

// 40. AIWORK1-39 #3: 新 fixture sectioned-post 存在并可解析
test('build: sectioned-post fixture exists and parses with article:section', () => {
  const html = fs.readFileSync(path.join(FIX, 'sectioned-post', 'index.html'), 'utf8');
  const fm = bi.parseFrontmatter(html, 'sectioned-post');
  assert.ok(fm.section, 'sectioned-post fixture must expose fm.section');
  assert.equal(fm.section.name, '金融市场观察');
  assert.equal(fm.section.slug, '金融市场观察');
});

// 41. AIWORK1-39 #4: build 产出 series/index.html 含全部 series + 计数
test('build: series/index.html lists all series with counts and chips', () => {
  const tmp = makeProject({ posts: ['sectioned-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = renderSeriesIndex(posts);
    // sectioned-post 隶属「金融市场观察」
    assert.ok(/href="\/series\/金融市场观察\/"/.test(html),
      'must link to series by original-text slug (Chinese preserved)');
    assert.ok(/data-section="金融市场观察"/.test(html),
      'chip must carry data-section attribute');
    assert.ok(/<span class="tag-count">1<\/span>/.test(html),
      'count = 1 for single series');
  } finally { cleanProject(tmp); }
});

test('build: computeBuild writes series/index.html on disk', () => {
  const tmp = makeProject({ posts: ['sectioned-post'] });
  try {
    const build = computeBuild(tmp);
    writeBuild(build, tmp);
    assert.ok(fs.existsSync(path.join(tmp, 'series', 'index.html')),
      'series/index.html must be written');
    const html = fs.readFileSync(path.join(tmp, 'series', 'index.html'), 'utf8');
    assert.ok(/金融市场观察/.test(html));
  } finally { cleanProject(tmp); }
});

// 42. AIWORK1-39 #5: build 产出 series/<slug>/index.html,仅含该系列文章
test('build: series/<slug>/index.html lists only that series posts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'series-page-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    // 两个同系列 + 一个不同系列 + 一个无 section
    const mkPost = (slug, date, tag, section) => {
      fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
      const secMeta = section ? `  <meta property="article:section" content="${section}" />\n` : '';
      fs.writeFileSync(path.join(tmp, 'posts', slug, 'index.html'),
        `<!doctype html><html><head>
          <title>${slug}</title>
          <meta name="description" content="d" />
          <meta property="article:published_time" content="${date}" />
          <meta property="article:tag" content="${tag}" />
${secMeta}
        </head><body><main><article></article></main></body></html>`);
    };
    mkPost('a-1', '2026-04-01', 'finance', '金融市场观察');
    mkPost('a-2', '2026-04-02', 'finance', '金融市场观察');
    mkPost('b-1', '2026-05-01', 'note', 'SDD 实战笔记');
    mkPost('c-1', '2026-06-01', 'note', null);

    const build = computeBuild(tmp);
    writeBuild(build, tmp);

    const seriesA = fs.readFileSync(path.join(tmp, 'series', '金融市场观察', 'index.html'), 'utf8');
    assert.ok(seriesA.includes('/posts/a-1/'), 'series page must include a-1');
    assert.ok(seriesA.includes('/posts/a-2/'), 'series page must include a-2');
    assert.ok(!seriesA.includes('/posts/b-1/'),
      'series page must not include posts from other series');
    assert.ok(!seriesA.includes('/posts/c-1/'),
      'series page must not include posts without any section');

    const seriesB = fs.readFileSync(path.join(tmp, 'series', 'sdd-实战笔记', 'index.html'), 'utf8');
    assert.ok(seriesB.includes('/posts/b-1/'), 'series B page must include b-1');
    assert.ok(!seriesB.includes('/posts/a-1/'), 'series B page must exclude other series');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 43. AIWORK1-39 #6: 无 section 文章不出现 series/index.html(防泄漏)
test('build: posts without article:section are excluded from series/index.html', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'series-leak-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    function mkPost(slug, date, section) {
      fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
      const secMeta = section ? `  <meta property="article:section" content="${section}" />\n` : '';
      fs.writeFileSync(path.join(tmp, 'posts', slug, 'index.html'),
        `<!doctype html><html><head>
          <title>${slug}</title>
          <meta property="article:published_time" content="${date}" />
${secMeta}
        </head><body><main><article></article></main></body></html>`);
    }
    mkPost('with-sec', '2026-04-01', '金融市场观察');
    mkPost('no-sec-1', '2026-04-02', null);
    mkPost('no-sec-2', '2026-04-03', null);

    const posts = scanPosts(tmp);
    const html = renderSeriesIndex(posts);
    assert.ok(/金融市场观察/.test(html), 'series index should list the one section');
    assert.ok((html.match(/<a class="chip" href="\/series/g) || []).length === 1,
      'must contain exactly 1 series chip');
    // 无 section 的文章不应被提及
    assert.ok(!/no-sec-1/.test(html), 'posts without section must NOT leak into series index');
    assert.ok(!/no-sec-2/.test(html), 'posts without section must NOT leak into series index');

    // 也校验 computeBuild 输出
    const build = computeBuild(tmp);
    writeBuild(build, tmp);
    const onDisk = fs.readFileSync(path.join(tmp, 'series', 'index.html'), 'utf8');
    assert.ok(!/no-sec-1/.test(onDisk) && !/no-sec-2/.test(onDisk),
      'on-disk series/index.html must not leak unsectioned posts');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 44. AIWORK1-39 #7: section 名去重 + 计数正确(同系列多篇只一行 + 准确计数)
test('build: section names are deduped with accurate per-section counts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'series-dedup-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    function mkPost(slug, date, section) {
      fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
      const secMeta = section ? `  <meta property="article:section" content="${section}" />\n` : '';
      fs.writeFileSync(path.join(tmp, 'posts', slug, 'index.html'),
        `<!doctype html><html><head>
          <title>${slug}</title>
          <meta property="article:published_time" content="${date}" />
${secMeta}
        </head><body><main><article></article></main></body></html>`);
    }
    // Section A: 3 篇;Section B: 2 篇;无 section: 1 篇
    mkPost('a1', '2026-04-01', 'Section A');
    mkPost('a2', '2026-04-02', 'Section A');
    mkPost('a3', '2026-04-03', 'Section A');
    mkPost('b1', '2026-04-04', 'Section B');
    mkPost('b2', '2026-04-05', 'Section B');
    mkPost('n1', '2026-04-06', null);

    const posts = scanPosts(tmp);
    const map = collectSeries(posts);
    assert.equal(map.size, 2, 'should have exactly 2 distinct series');
    const slugs = Array.from(map.keys()).sort();
    assert.deepEqual(slugs, ['section-a', 'section-b']);
    assert.equal(map.get('section-a').posts.length, 3);
    assert.equal(map.get('section-b').posts.length, 2);

    const idx = renderSeriesIndex(posts);
    // 按文章数降序:Section A (3) 在 Section B (2) 之前
    assert.ok(idx.indexOf('Section A') < idx.indexOf('Section B'),
      'larger series first');
    assert.ok(/<span class="tag-count">3<\/span>/.test(idx),
      'Section A count = 3');
    assert.ok(/<span class="tag-count">2<\/span>/.test(idx),
      'Section B count = 2');

    // 各系列下页面只列该系列文章
    const aPage = renderSeriesPage('section-a', 'Section A', posts);
    assert.ok(aPage.includes('a1') && aPage.includes('a2') && aPage.includes('a3'));
    assert.ok(!aPage.includes('b1') && !aPage.includes('n1'),
      'Section A page must exclude non-Section A posts');

    const bPage = renderSeriesPage('section-b', 'Section B', posts);
    assert.ok(bPage.includes('b1') && bPage.includes('b2'));
    assert.ok(!bPage.includes('a1') && !bPage.includes('n1'),
      'Section B page must exclude non-Section B posts');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 45. AIWORK1-39 #8: --only series 子命令存在 + 可独立构建 series
test('build: --only series writes series index + pages but skips tag indices', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'series-only-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    function mkPost(slug, date, tag, section) {
      fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
      const secMeta = section ? `  <meta property="article:section" content="${section}" />\n` : '';
      const tagMeta = tag ? `  <meta property="article:tag" content="${tag}" />\n` : '';
      fs.writeFileSync(path.join(tmp, 'posts', slug, 'index.html'),
        `<!doctype html><html><head>
          <title>${slug}</title>
          <meta property="article:published_time" content="${date}" />
${tagMeta}${secMeta}
        </head><body><main><article></article></main></body></html>`);
    }
    mkPost('a1', '2026-04-01', 'finance', 'Section A');
    mkPost('b1', '2026-04-02', 'note', 'Section B');

    // Pre-create existing files that should NOT be touched (--only 边界):
    // posts/index.html / tags/index.html / tags/<slug>/index.html 都应是 sentinel
    fs.writeFileSync(path.join(tmp, 'posts', 'index.html'), 'posts-untouched');
    fs.mkdirSync(path.join(tmp, 'tags'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'tags', 'index.html'), 'tags-untouched');
    fs.mkdirSync(path.join(tmp, 'tags', 'finance'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'tags', 'finance', 'index.html'), 'tag-page-untouched');

    // Run with --only series via subprocess to assert CLI binding (exits 0, scope correct)
    const result = spawnSync('node', [
      path.join(__dirname, '..', 'build-index.js'),
      '--only', 'series', '--root', tmp,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, `series-only should exit 0: ${result.stderr}`);
    // series/index.html should be written
    assert.ok(fs.existsSync(path.join(tmp, 'series', 'index.html')),
      'series/index.html should be created by --only series');
    // posts/index.html should NOT be re-written (untouched)
    assert.ok(fs.readFileSync(path.join(tmp, 'posts', 'index.html'), 'utf8') === 'posts-untouched',
      '--only series must NOT touch posts/index.html');
    // tags/* should NOT be created/touched
    assert.ok(fs.readFileSync(path.join(tmp, 'tags', 'index.html'), 'utf8') === 'tags-untouched',
      '--only series must NOT touch tags/index.html');

    // --only series-pages covers per-section pages
    const result2 = spawnSync('node', [
      path.join(__dirname, '..', 'build-index.js'),
      '--only', 'series-pages', '--root', tmp,
    ], { encoding: 'utf8' });
    assert.equal(result2.status, 0, `series-pages-only should exit 0: ${result2.stderr}`);
    assert.ok(fs.existsSync(path.join(tmp, 'series', 'section-a', 'index.html')),
      'section-a page should be created by --only series-pages');
    assert.ok(fs.existsSync(path.join(tmp, 'series', 'section-b', 'index.html')),
      'section-b page should be created by --only series-pages');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 46. AIWORK1-39 #9 / DoD #10: sitemap 注入 series 页 + 站首页
test('build: sitemap.xml lists /series/ index and per-section pages with percent-encoded URLs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'series-sitemap-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    function mkPost(slug, date, section) {
      fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
      const secMeta = section ? `  <meta property="article:section" content="${section}" />\n` : '';
      fs.writeFileSync(path.join(tmp, 'posts', slug, 'index.html'),
        `<!doctype html><html><head>
          <title>${slug}</title>
          <meta property="article:published_time" content="${date}" />
${secMeta}
        </head><body><main><article></article></main></body></html>`);
    }
    mkPost('cn-1', '2026-04-01', '金融市场观察');
    mkPost('ascii-1', '2026-04-02', 'Section A');

    const posts = scanPosts(tmp);
    const xml = renderSitemap(posts);

    // 站首页
    assert.ok(/<loc>https:\/\/itingyu\.github\.io\/series\/<\/loc>/.test(xml),
      'sitemap must include /series/ index page');
    // 中文 section 用 percent-encoded(规范 RFC 3986)
    assert.ok(/<loc>https:\/\/itingyu\.github\.io\/series\/%E9%87%91%E8%9E%8D[^<]*<\/loc>/.test(xml),
      'sitemap must percent-encode Chinese series slug');
    // ASCII section 直接出现
    assert.ok(/<loc>https:\/\/itingyu\.github\.io\/series\/section-a\/<\/loc>/.test(xml),
      'sitemap must include ASCII slug series page');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 47. AIWORK1-39 #11 / DoD #11: 文章页 .post-meta 在 tags 之后追加 series chip
test('build: article page injects series chip in post-meta between tags and reading-time', () => {
  const tmp = makeProject({ posts: ['sectioned-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts[0];
    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');
    const out = injectArticlePageEnhancements(html, me, posts, tmp);

    // 必须有 series chip,带 data-section
    assert.ok(/<a class="chip" href="\/series\/金融市场观察\/" data-section="金融市场观察">金融市场观察<\/a>/.test(out),
      'must inject series chip with data-section');
    // 位置:在 tags chip 之后,在 reading-time 之前
    const idxTag = out.search(/<a class="chip" href="\/tags\/finance\/"/);
    const idxSection = out.search(/<a class="chip" href="\/series\/金融市场观察\/"/);
    const idxTime = out.search(/<span[^>]*data-reading-time/);
    assert.ok(idxTag > 0 && idxSection > 0 && idxTime > 0, 'all markers must be present');
    assert.ok(idxTag < idxSection, 'series chip must come after tag chip');
    assert.ok(idxSection < idxTime, 'series chip must come before reading-time');

    // 幂等:二次注入字节级一致
    const twice = injectArticlePageEnhancements(out, me, posts, tmp);
    assert.equal(out, twice, 'series chip injection must be idempotent');
    const dataSectionCount = (twice.match(/data-section=/g) || []).length;
    assert.equal(dataSectionCount, 1, 'data-section must appear exactly once');
  } finally { cleanProject(tmp); }
});

// 48. AIWORK1-39 #12 / DoD #12: --check 全绿(端到端无 drift)
test('build: --check stays green for series aggregation end-to-end', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'series-drift-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    function mkPost(slug, date, section) {
      fs.mkdirSync(path.join(tmp, 'posts', slug), { recursive: true });
      const secMeta = section ? `  <meta property="article:section" content="${section}" />\n` : '';
      fs.writeFileSync(path.join(tmp, 'posts', slug, 'index.html'),
        `<!doctype html><html><head>
          <title>${slug}</title>
          <meta property="article:published_time" content="${date}" />
${secMeta}
        </head><body><main><article></article></main></body></html>`);
    }
    mkPost('s1', '2026-04-01', '金融市场观察');
    mkPost('s2', '2026-04-02', 'SDD 实战笔记');
    mkPost('s3', '2026-04-03', null);

    // 写入 + 重算 → 不应有 drift
    const build = computeBuild(tmp);
    writeBuild(build, tmp);
    const drift = checkDrift(computeBuild(tmp), tmp);
    assert.deepEqual(drift, [], 'no drift after series aggregation end-to-end');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 49. AIWORK1-39: nav 显示 /series/ + series 页 aria-current
test('build: site nav exposes /series/ link and series index marks it current', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'series-nav-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'posts', 'sectioned-post'), { recursive: true });
    fs.copyFileSync(path.join(FIX, 'sectioned-post', 'index.html'),
      path.join(tmp, 'posts', 'sectioned-post', 'index.html'));

    const posts = scanPosts(tmp);
    const idx = renderSeriesIndex(posts);

    // nav 含 data-nav="series"
    assert.ok(/<a\s+href="\/series\/"\s+data-nav="series"/.test(idx),
      'header nav must expose /series/ with data-nav="series"');
    // 当前页应当被标 aria-current
    assert.ok(/<a\s+href="\/series\/"\s+data-nav="series"[^>]*aria-current="page"/.test(idx),
      'series index itself should be marked aria-current=page');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 50. AIWORK1-39: prune 行为 — 删除某系列后,旧 series/<slug>/index.html 应被剪除
test('build: writeBuild prunes orphaned series/<slug>/index.html', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'series-prune-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'posts', 'a'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'posts', 'a', 'index.html'),
      `<!doctype html><html><head>
        <title>a</title>
        <meta property="article:published_time" content="2026-04-01" />
        <meta property="article:section" content="活跃系列" />
      </head><body></body></html>`);

    // Pre-create a stale series page that should be pruned.
    fs.mkdirSync(path.join(tmp, 'series', 'orphan-series'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'series', 'orphan-series', 'index.html'), 'stale');

    const build = computeBuild(tmp);
    const result = writeBuild(build, tmp);

    assert.ok(result.removed.includes('series/orphan-series/index.html'),
      'orphan series page must be in removed list');
    assert.ok(!fs.existsSync(path.join(tmp, 'series', 'orphan-series', 'index.html')),
      'orphan series file must be gone');
    assert.ok(fs.existsSync(path.join(tmp, 'series', '活跃系列', 'index.html')),
      'active series file must remain');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// 51. AIWORK1-39: series 页面含 CollectionPage JSON-LD
test('build: series page emits CollectionPage JSON-LD with non-empty hasPart', () => {
  const tmp = makeProject({ posts: ['sectioned-post'] });
  try {
    const posts = scanPosts(tmp);
    const html = renderSeriesPage('金融市场观察', '金融市场观察', posts);

    const blocks = extractJSONLDBlocks(html);
    const collection = blocks.find(b => b['@type'] === 'CollectionPage');
    assert.ok(collection, 'series page must emit CollectionPage JSON-LD');
    assert.equal(collection['@context'], 'https://schema.org');
    assert.equal(collection.name, '金融市场观察 · itingyu');
    assert.equal(collection.url, 'https://itingyu.github.io/series/金融市场观察/');
    assert.ok(Array.isArray(collection.hasPart));
    assert.ok(collection.hasPart.length >= 1, 'hasPart non-empty');
    collection.hasPart.forEach(ref => {
      assert.equal(ref['@type'], 'BlogPosting');
      assert.ok(ref.headline && ref.url);
    });
  } finally { cleanProject(tmp); }
});
