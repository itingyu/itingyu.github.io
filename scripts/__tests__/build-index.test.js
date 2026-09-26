'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const bi = require('../build-index.js');
const {
  scanPosts, sortPosts, sortPostsAsc,
  scanCover, computeRelated, injectArticlePageEnhancements,
  computePrevNext, buildPostNav,
  injectPrevNextHead, injectPostNav,
  extractArticleBody, stripTags,
  renderPostsIndex, renderArchive, renderTagsIndex, renderTagPage,
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
    const me = posts[0];
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

// ----- 40. AIWORK1-36 heading 深链 + 一键复制锚点 -----------------------

test('build: theme.js declares initHeadingAnchors with clipboard + slug + dedupe', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'theme.js'), 'utf8');
  assert.ok(/function initHeadingAnchors\b/.test(js), 'should declare initHeadingAnchors');
  assert.ok(/function ensureHeadingIds\b/.test(js), 'should extract ensureHeadingIds helper');
  assert.ok(/heading-anchor/.test(js), 'should inject .heading-anchor element');
  assert.ok(/navigator\.clipboard\.writeText/.test(js), 'should use clipboard API');
  assert.ok(/history\.replaceState/.test(js), 'should sync address bar hash');
  assert.ok(/while \(seen\[uniq\]\)/.test(js), 'should dedupe repeated slugs');
});

test('build: style.css declares .heading-anchor with hover/focus + reduced-motion', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'style.css'), 'utf8');
  assert.ok(/\.heading-anchor\s*\{/.test(css), 'should declare .heading-anchor');
  assert.ok(/h2:hover\s*>\s*\.heading-anchor/.test(css), 'should reveal on h2 hover');
  assert.ok(/\.heading-anchor\.is-flashed/.test(css), 'should declare flash state');
  assert.ok(/prefers-reduced-motion: reduce[\s\S]*\.heading-anchor\s*\{[^}]*transition:\s*none/.test(css),
    'should disable transition under prefers-reduced-motion');
});

// ----- 41. AIWORK1-33 prev/next: 边界 1 = 单篇(空集合) ------------------

test('build: prev/next with no posts → no links, no nav injected', () => {
  // 空集合 → 不应有 articlePages,也不应注入任何 prev/next 内容
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prevnext-empty-'));
  try {
    fs.mkdirSync(path.join(tmp, 'posts'), { recursive: true });
    const posts = scanPosts(tmp);
    assert.equal(posts.length, 0, 'should have no posts');
    const me = { slug: 'phantom', title: '幻', date: '2026-01-01', tags: [], warnings: [] };
    const { prev, next } = computePrevNext(me, posts);
    assert.equal(prev, null);
    assert.equal(next, null);
    assert.equal(buildPostNav(null, null), '', 'empty nav HTML');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ----- 42. AIWORK1-33 prev/next: 边界 2 = 单篇 ----------------------------

test('build: prev/next with single post → no rel=prev/next, no nav block', () => {
  const tmp = makeProject({ posts: ['minimal-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts[0];
    const { prev, next } = computePrevNext(me, posts);
    assert.equal(prev, null, 'single post must have no prev');
    assert.equal(next, null, 'single post must have no next');

    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');
    const out = injectArticlePageEnhancements(html, me, posts, tmp);
    assert.ok(!/<link\s+rel=["']prev["']/.test(out), 'single post should not inject rel="prev"');
    assert.ok(!/<link\s+rel=["']next["']/.test(out), 'single post should not inject rel="next"');
    assert.ok(!/class="post-nav/.test(out), 'single post should not inject post-nav block');
  } finally { cleanProject(tmp); }
});

// ----- 43. AIWORK1-33 prev/next: 边界 3 = 多篇首末 + 中间 ----------------

test('build: prev/next with multiple posts → first has only next, last has only prev, middle has both', () => {
  // minimal-post(2026-01-15) < multi-tag-post(2026-02-20) < edge-cases-post(2026-03-10)
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post', 'edge-cases-post'] });
  try {
    const posts = scanPosts(tmp);
    const sorted = sortPostsAsc(posts);
    assert.equal(sorted[0].slug, 'minimal-post');
    assert.equal(sorted[1].slug, 'multi-tag-post');
    assert.equal(sorted[2].slug, 'edge-cases-post');

    // 首篇:只有 next
    const first = computePrevNext(sorted[0], posts);
    assert.equal(first.prev, null);
    assert.ok(first.next && first.next.slug === 'multi-tag-post');

    // 中间:prev + next
    const mid = computePrevNext(sorted[1], posts);
    assert.ok(mid.prev && mid.prev.slug === 'minimal-post');
    assert.ok(mid.next && mid.next.slug === 'edge-cases-post');

    // 末篇:只有 prev
    const last = computePrevNext(sorted[2], posts);
    assert.ok(last.prev && last.prev.slug === 'multi-tag-post');
    assert.equal(last.next, null);

    // 首篇的 article HTML 验证:只有 next 链接 + post-nav-next-only
    const firstHtml = fs.readFileSync(path.join(tmp, 'posts', sorted[0].slug, 'index.html'), 'utf8');
    const firstOut = injectArticlePageEnhancements(firstHtml, sorted[0], posts, tmp);
    assert.ok(!/<link\s+rel=["']prev["']/.test(firstOut),
      'first post should not have rel="prev" in <head>');
    assert.ok(/<link\s+rel=["']next["']\s+href="\/posts\/multi-tag-post\/"\s*\/>/.test(firstOut),
      'first post should have rel="next" → multi-tag-post');
    assert.ok(/class="post-nav post-nav-next-only"/.test(firstOut),
      'first post nav should be next-only');
    assert.ok(!/post-nav-prev/.test(firstOut),
      'first post nav must not contain prev card');

    // 中间篇:prev + next 都有
    const midHtml = fs.readFileSync(path.join(tmp, 'posts', sorted[1].slug, 'index.html'), 'utf8');
    const midOut = injectArticlePageEnhancements(midHtml, sorted[1], posts, tmp);
    assert.ok(/<link\s+rel=["']prev["']\s+href="\/posts\/minimal-post\/"\s*\/>/.test(midOut),
      'middle post should have rel="prev" → minimal-post');
    assert.ok(/<link\s+rel=["']next["']\s+href="\/posts\/edge-cases-post\/"\s*\/>/.test(midOut),
      'middle post should have rel="next" → edge-cases-post');
    assert.ok(/class="post-nav(?:\s|")/.test(midOut) && !/post-nav-prev-only/.test(midOut) && !/post-nav-next-only/.test(midOut),
      'middle post nav should have both sides (no only-modifier)');

    // 末篇:只有 prev
    const lastHtml = fs.readFileSync(path.join(tmp, 'posts', sorted[2].slug, 'index.html'), 'utf8');
    const lastOut = injectArticlePageEnhancements(lastHtml, sorted[2], posts, tmp);
    assert.ok(/<link\s+rel=["']prev["']\s+href="\/posts\/multi-tag-post\/"\s*\/>/.test(lastOut),
      'last post should have rel="prev" → multi-tag-post');
    assert.ok(!/<link\s+rel=["']next["']/.test(lastOut),
      'last post should not have rel="next" in <head>');
    assert.ok(/class="post-nav post-nav-prev-only"/.test(lastOut),
      'last post nav should be prev-only');
    assert.ok(!/post-nav-next/.test(lastOut),
      'last post nav must not contain next card');
  } finally { cleanProject(tmp); }
});

// ----- 44. AIWORK1-33 prev/next: 幂等(连续 build 不重复注入) -------------

test('build: prev/next injection is idempotent across passes', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    const me = posts.find(p => p.slug === 'multi-tag-post');
    const html = fs.readFileSync(path.join(tmp, 'posts', me.slug, 'index.html'), 'utf8');

    const once = injectArticlePageEnhancements(html, me, posts, tmp);
    const twice = injectArticlePageEnhancements(once, me, posts, tmp);
    assert.equal(once, twice, 'second pass must be byte-equal (idempotent)');

    const linkMatches = (twice.match(/<link\s+rel=["']prev["']/g) || []).length;
    assert.equal(linkMatches, 1, 'rel="prev" should appear exactly once');
    const nextMatches = (twice.match(/<link\s+rel=["']next["']/g) || []).length;
    assert.equal(nextMatches, 0, 'multi-tag-post has no next, rel="next" must not appear');

    const navMatches = (twice.match(/class="post-nav(?:\s|")/g) || []).length;
    assert.equal(navMatches, 1, 'post-nav block should appear exactly once');
  } finally { cleanProject(tmp); }
});

// ----- 45. AIWORK1-33 prev/next: 排序按发布日期升序(同日期按 slug) -----

test('build: sortPostsAsc orders by date asc with slug as tie-breaker', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post', 'edge-cases-post'] });
  try {
    const posts = scanPosts(tmp);
    const asc = sortPostsAsc(posts);
    // 2026-01-15 / 2026-02-20 / 2026-03-10
    assert.equal(asc[0].slug, 'minimal-post');
    assert.equal(asc[1].slug, 'multi-tag-post');
    assert.equal(asc[2].slug, 'edge-cases-post');
  } finally { cleanProject(tmp); }
});

// ----- 46. AIWORK1-33 buildPostNav: HTML 结构正确 -----------------------

test('build: buildPostNav renders prev/next labels + title + date', () => {
  const prev = { slug: 'a', title: 'A 标题', date: '2026-01-15' };
  const next = { slug: 'b', title: 'B 标题', date: '2026-02-20' };
  const nav = buildPostNav(prev, next);
  assert.ok(/← 上一篇/.test(nav), 'prev label should be ← 上一篇');
  assert.ok(/下一篇 →/.test(nav), 'next label should be 下一篇 →');
  assert.ok(/A 标题/.test(nav));
  assert.ok(/B 标题/.test(nav));
  assert.ok(/datetime="2026-01-15"/.test(nav));
  assert.ok(/datetime="2026-02-20"/.test(nav));
  assert.ok(/rel="prev"/.test(nav));
  assert.ok(/rel="next"/.test(nav));
  assert.ok(!/post-nav-prev-only/.test(nav));
  assert.ok(!/post-nav-next-only/.test(nav));
});

// ----- 47. AIWORK1-33 injectPrevNextHead: fallback(无 canonical) -------

test('build: injectPrevNextHead falls back to </head> when no canonical link', () => {
  const html = `<!doctype html><html><head>
  <meta charset="utf-8" />
  <meta name="article:published_time" content="2026-01-15" />
</head><body></body></html>`;
  const prev = { slug: 'a', title: 'A', date: '2026-01-15' };
  const out = injectPrevNextHead(html, prev, null);
  assert.ok(/<link\s+rel="prev"\s+href="\/posts\/a\/"\s*\/>/.test(out));
  // 不应留空行(原始 </head> 前的 \n 与注入的 \n 合并产生双 \n = 空行)
  assert.ok(!/算法/.test(out) || !/\n\n  <link/.test(out));
  // 注入位置在 </head> 紧邻前一行(不应被插到 </head> 之后)
  const linkIdx = out.indexOf('<link rel="prev"');
  const headEndIdx = out.indexOf('</head>');
  assert.ok(linkIdx > 0 && headEndIdx > linkIdx, 'link should be before </head>');
});

// ----- 48. AIWORK1-33 --only prevnext: CLI 子模式可用 ------------------

test('build: --only prevnext runs without error and refreshes article pages', () => {
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'] });
  try {
    const build = computeBuild(tmp);
    writeBuild(build, tmp);
    // 再次执行 --only prevnext(模拟 PR 反馈后只跑这一档)
    const { spawnSync } = require('node:child_process');
    const r = spawnSync(process.execPath,
      [path.join(__dirname, '..', 'build-index.js'), '--only', 'prevnext', '--root', tmp],
      { encoding: 'utf8' });
    assert.equal(r.status, 0, `cli should exit 0, got ${r.status}: ${r.stderr}`);
    // 写盘后 checkDrift 应为空
    const drift = checkDrift(computeBuild(tmp), tmp);
    assert.deepEqual(drift, [],
      'drift should be empty after --only prevnext');
  } finally { cleanProject(tmp); }
});

// ----- 49. AIWORK1-42 buildPostNav: prev/next aria-label 注入语义 ---------

test('build: buildPostNav injects aria-label="上一篇:标题" / "下一篇:标题" on each <a>', () => {
  const prev = { slug: 'a', title: 'A 标题', date: '2026-01-15' };
  const next = { slug: 'b', title: 'B 标题', date: '2026-02-20' };
  const nav = buildPostNav(prev, next);
  // 每个 <a class="post-nav-prev"> 与 <a class="post-nav-next"> 都应携带 aria-label,
  // 屏幕阅读器 Tab 进卡片时能听到完整上下文("上一篇: A 标题"),与可见 label 互补
  assert.ok(/<a\s+class="post-nav-prev"[^>]*aria-label="上一篇:A 标题"/.test(nav),
    'prev <a> should declare aria-label="上一篇:A 标题"');
  assert.ok(/<a\s+class="post-nav-next"[^>]*aria-label="下一篇:B 标题"/.test(nav),
    'next <a> should declare aria-label="下一篇:B 标题"');
});

test('build: buildPostNav aria-label survives full injectArticlePageEnhancements pipeline', () => {
  // 端到端:经 injectArticlePageEnhancements 注入到文章 HTML 后,aria-label 必须仍在
  const tmp = makeProject({ posts: ['minimal-post', 'multi-tag-post'] });
  try {
    const posts = scanPosts(tmp);
    // 末篇 multi-tag-post 应只剩 prev(中间排序后有 prev + next,这里取末篇验证 prev-only 路径)
    const sorted = sortPostsAsc(posts);
    const last = sorted[sorted.length - 1];
    const html = fs.readFileSync(path.join(tmp, 'posts', last.slug, 'index.html'), 'utf8');
    const out = injectArticlePageEnhancements(html, last, posts, tmp);
    assert.ok(/aria-label="上一篇:[^"]+"/.test(out),
      'last post nav should carry aria-label="上一篇:<title>" for prev card');
    // 末篇没有 next 卡片,故不应出现 "下一篇:"
    assert.ok(!/aria-label="下一篇:/.test(out),
      'last post should not declare next aria-label');
  } finally { cleanProject(tmp); }
});
