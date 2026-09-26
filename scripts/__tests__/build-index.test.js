'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const bi = require('../build-index.js');
const {
  scanPosts, sortPosts,
  renderPostsIndex, renderArchive, renderTagsIndex, renderTagPage,
  renderRSS, renderSitemap,
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
    // counts: each tag has count 1
    assert.ok(html.match(/·\s*1/), 'should have count 1');
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