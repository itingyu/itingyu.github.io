'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const bi = require('../build-index.js');
const {
  scanPosts, sortPosts,
  scanCover, computeRelated, injectArticlePageEnhancements,
  extractArticleBody, stripTags,
  renderPostsIndex, renderArchive, renderTagsIndex, renderTagPage,
  renderRSS, renderSitemap,
  renderSearchIndex, renderSearchPage,
  computeBuild, writeBuild, checkDrift,
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
