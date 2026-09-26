'use strict';

/*
 * scripts/__tests__/markdown-render.test.js
 *
 * Renders the 17-feature Markdown grammar matrix defined in
 * design-v2.md §5.2.6 + 附 A. All assertions are written as byte-exact
 * substring checks against the HTML output produced by the shared
 * `scripts/markdown.js` module. No third-party markdown library, no
 * npm deps (Node built-ins only).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const md = require('../markdown.js');

function render(src, opts) {
  return md.renderMarkdown(src, opts || {}).trim();
}

const LT  = String.fromCharCode(60);  // <
const GT  = String.fromCharCode(62);  // >
const AMP = String.fromCharCode(38);  // &
const QT  = String.fromCharCode(34);  // "
const LT_ENT = AMP + 'lt;';
const GT_ENT = AMP + 'gt;';
const AMP_ENT = AMP + 'amp;';
const QT_ENT = AMP + 'quot;';

// 1. H1-H6: all six heading levels render correctly.
test('h1-h6: all six heading levels render to h1..h6', () => {
  const src = '# A\n## B\n### C\n#### D\n##### E\n###### F';
  const html = render(src);
  assert.equal(html, '<h1>A</h1>\n<h2>B</h2>\n<h3>C</h3>\n<h4>D</h4>\n<h5>E</h5>\n<h6>F</h6>');
});

// 2. Paragraph: plain text wraps in <p>.
test('paragraph: plain text wraps in <p>', () => {
  assert.equal(render('Hello world'), '<p>Hello world</p>');
});

// 3. Bold: **text** → <strong>text</strong>.
test('bold: **text** becomes <strong>', () => {
  assert.equal(render('**bold**'), '<p><strong>bold</strong></p>');
  assert.equal(render('a **b** c'), '<p>a <strong>b</strong> c</p>');
});

// 4. Italic: *text* → <em>text</em>.
test('italic: *text* becomes <em>', () => {
  assert.equal(render('*italic*'), '<p><em>italic</em></p>');
  // Ensure * does not grab into surrounding word chars.
  assert.equal(render('a *b* c'), '<p>a <em>b</em> c</p>');
});

// 5. Inline code: `text` → <code>text</code>.
test('inline code: backtick text becomes <code>', () => {
  assert.equal(render('`code`'), '<p><code>code</code></p>');
  // Content is HTML-escaped: <b> inside the code span becomes <b>.
  assert.equal(
    render('`<b>x</b>`'),
    '<p><code>' + LT_ENT + 'b' + GT_ENT + 'x' + LT_ENT + '/b' + GT_ENT + '</code></p>',
  );
});

// 6. Link: [label](url) → <a href="url">label</a>.
test('link: [label](url) becomes anchor', () => {
  assert.equal(render('[a](https://b.com)'), '<p><a href="https://b.com">a</a></p>');
  // Internal / relative URL is allowed.
  assert.equal(render('[home](/posts/welcome/)'), '<p><a href="/posts/welcome/">home</a></p>');
});

// 7. Image: ![alt](src) → <img alt="..." src="..." loading="lazy" />.
test('image: ![alt](src) becomes <img loading=lazy>', () => {
  assert.equal(
    render('![alt](https://x.com/i.png)'),
    '<p><img alt="alt" src="https://x.com/i.png" loading="lazy" /></p>',
  );
});

// 8. Blockquote: > text → <blockquote>...</blockquote>.
test('blockquote: single-layer > text becomes blockquote', () => {
  assert.equal(render('> quoted'), '<blockquote>quoted</blockquote>');
  // Consecutive > lines merge into one blockquote.
  assert.equal(
    render('> line one\n> line two'),
    '<blockquote>line one line two</blockquote>',
  );
});

// 9. Unordered list: - items → <ul><li>.
test('unordered list: - items become <ul><li>', () => {
  assert.equal(render('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
});

// 10. Ordered list: 1. items → <ol><li>.
test('ordered list: 1. items become <ol><li>', () => {
  assert.equal(render('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
});

// 11. HR: --- → <hr>.
test('horizontal rule: ---, ***, ___ all become <hr>', () => {
  assert.equal(render('---'), '<hr>');
  assert.equal(render('***'), '<hr>');
  assert.equal(render('___'), '<hr>');
});

// 12. Fenced code: ```lang block ``` → <pre><code class="language-lang">.
test('fenced code: ```lang block ``` becomes pre/code with language class', () => {
  assert.equal(
    render('```js\nconst x = 1;\n```'),
    '<pre><code class="language-js">const x = 1;</code></pre>',
  );
  // No language hint — no class.
  assert.equal(
    render('```\nraw\n```'),
    '<pre><code>raw</code></pre>',
  );
  // Code body is HTML-escaped.
  assert.equal(
    render('```\n<b>x</b>\n```'),
    '<pre><code>' + LT_ENT + 'b' + GT_ENT + 'x' + LT_ENT + '/b' + GT_ENT + '</code></pre>',
  );
});

// 13. Nested list: indented - items → multi-level <ul><li>.
test('nested list: indented items produce nested <ul>', () => {
  assert.equal(
    render('- a\n  - a1\n  - a2\n- b'),
    '<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>',
  );
  // Mixed ordered + unordered.
  assert.equal(
    render('1. one\n   - x\n   - y\n2. two'),
    '<ol><li>one<ul><li>x</li><li>y</li></ul></li><li>two</li></ol>',
  );
});

// 14. Auto-link: bare http(s) URLs become <a target="_blank" rel="noopener">.
test('autolink: bare http(s) URL becomes anchor with target=_blank rel=noopener', () => {
  assert.equal(
    render('See https://example.com today'),
    '<p>See <a href="https://example.com" target="_blank" rel="noopener">https://example.com</a> today</p>',
  );
  // Multiple URLs in same line.
  assert.equal(
    render('a https://a.com b https://b.io c'),
    '<p>a <a href="https://a.com" target="_blank" rel="noopener">https://a.com</a> b <a href="https://b.io" target="_blank" rel="noopener">https://b.io</a> c</p>',
  );
});

// 15. Line continuation: trailing 2 spaces → <br>.
test('line continuation: 2 trailing spaces produce <br>', () => {
  assert.equal(
    render('line one  \nline two'),
    '<p>line one<br>line two</p>',
  );
  // Inside list items too.
  assert.equal(
    render('- first  \n  second\n- third'),
    '<ul><li>first<br>second</li><li>third</li></ul>',
  );
});

// 16. Backslash escape: \* → literal *, \` → literal `.
test('backslash escape: \\X becomes literal X and is inert to inline rules', () => {
  assert.equal(render('\\*not italic\\*'), '<p>*not italic*</p>');
  assert.equal(render('\\`not code\\`'), '<p>`not code`</p>');
  // Mixed: escaping one of two * keeps the other as italic.
  assert.equal(render('one \\* two *three*'), '<p>one * two <em>three</em></p>');
});

// 17. HTML-comment passthrough: <!-- ... --> survives verbatim, not wrapped in <p>.
test('htmlCommentPassthrough: <!-- build:* --> markers survive verbatim', () => {
  // Standalone comment line.
  assert.equal(
    render('<!-- build:cover -->\n\nparagraph'),
    '<!-- build:cover -->\n<p>paragraph</p>',
  );
  // Multi-line comment block.
  assert.equal(
    render('<!--\nmulti\nline\n-->\nbody'),
    '<!--\nmulti\nline\n-->\n<p>body</p>',
  );
  // Comment inside a paragraph stays inline.
  assert.equal(
    render('before <!-- inline --> after'),
    '<p>before <!-- inline --> after</p>',
  );
  // Multiple standalone markers.
  assert.equal(
    render('<!-- build:cover -->\n\nbody\n\n<!-- build:related -->'),
    '<!-- build:cover -->\n<p>body</p>\n<!-- build:related -->',
  );
});

// Bonus A. URL safety: javascript: / data: URLs are NOT linkified.
test('security: javascript: URL is not linkified', () => {
  assert.equal(
    render('[click](javascript:alert(1))'),
    '<p>[click](javascript:alert(1))</p>',
  );
});

test('security: data: URL is not linkified', () => {
  // Note: avoid `<script>` substring to prevent rejectScriptStyle throwing.
  assert.equal(
    render('[pic](data:image/png;base64,AAAA)'),
    '<p>[pic](data:image/png;base64,AAAA)</p>',
  );
});

// Bonus B. <script> / <style> blocks throw a hard error.
test('security: <script> block throws', () => {
  assert.throws(
    () => md.renderMarkdown('<script>alert(1)</script>'),
    /<script> blocks are not allowed/,
  );
});

test('security: <style> block throws', () => {
  assert.throws(
    () => md.renderMarkdown('<style>.x{color:red}</style>'),
    /<style> blocks are not allowed/,
  );
});

// Bonus C. sourcePath option resolves relative image src to /posts/<slug>/.
test('sourcePath: relative image src is resolved under posts/<slug>/', () => {
  const html = render('![a](pic.png)', {
    sourcePath: '/repo/posts/welcome/index.md',
  });
  assert.ok(
    html.includes('src="/posts/welcome/pic.png"'),
    'expected /posts/welcome/pic.png in ' + html,
  );
});

// Bonus D. HTML escape: <, >, &, " are escaped in body text.
test('escape: < > & " in body are entity-escaped', () => {
  const html = render('a < b & c > d "e"');
  assert.equal(
    html,
    '<p>a ' + LT_ENT + ' b ' + AMP_ENT + ' c ' + GT_ENT + ' d ' + QT_ENT + 'e' + QT_ENT + '</p>',
  );
});

// Bonus E. Idempotence on empty / whitespace-only input.
test('idempotence: empty / whitespace input returns empty string', () => {
  assert.equal(render(''), '');
  assert.equal(render('   \n\n  \n'), '');
});

// Bonus F. Multi-block composition: heading + para + list + code.
test('composition: heading + paragraph + list + fenced code together', () => {
  const src = [
    '# Title',
    '',
    'intro paragraph',
    '',
    '- one',
    '- two',
    '',
    '```',
    'raw',
    '```',
  ].join('\n');
  const html = render(src);
  assert.ok(html.startsWith('<h1>Title</h1>'), html);
  assert.ok(html.includes('<p>intro paragraph</p>'), html);
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'), html);
  assert.ok(html.includes('<pre><code>raw</code></pre>'), html);
});

// Bonus G. Inline renderer order: bold wraps italic (or vice versa) — both orderings valid.
test('composition: bold+italic combine without losing either', () => {
  const html = render('***both***');
  assert.ok(html.includes('<strong>'), html);
  assert.ok(html.includes('<em>'), html);
  assert.ok(html.includes('both'), html);
});
