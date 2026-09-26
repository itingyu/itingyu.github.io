'use strict';

// AIWORK1-38 · spec v1.2 增量(idea 2.1)
//   「代码语法高亮(prism.js 单文件本地引入)」的契约测试套件
// 覆盖 spec ef15b50 锁定的 5 条契约:
//   1. assets/prism.{js,css} 存在 + 非空
//   2. 文章页 HTML 含 <link rel="stylesheet" href="/assets/prism.css">
//   3. <pre><code class="language-bash">…</code></pre> 经 npm run build 后 class 保留
//      (本测试只覆盖"文章页模板 + 注入后端"两步;build 流程整体保留见
//       build-index.test.js 第 40 条)
//   4. style.css 含 [data-theme="dark"] .token.keyword { color: var(--accent); }
//   5. WCAG AA:深 / 浅主题下 .token.keyword 对比度 ≥ 4.5:1

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const PRISM_JS_PATH = path.join(ROOT, 'assets', 'prism.js');
const PRISM_CSS_PATH = path.join(ROOT, 'assets', 'prism.css');
const STYLE_CSS_PATH = path.join(ROOT, 'assets', 'style.css');
const POST_TEMPLATE_PATH = path.join(ROOT, 'scripts', 'templates', 'post.html');

const PRISM_JS = fs.readFileSync(PRISM_JS_PATH, 'utf8');
const PRISM_CSS = fs.readFileSync(PRISM_CSS_PATH, 'utf8');
const STYLE_CSS = fs.readFileSync(STYLE_CSS_PATH, 'utf8');
const POST_TEMPLATE = fs.readFileSync(POST_TEMPLATE_PATH, 'utf8');

// ----- helpers -----------------------------------------------------------

// 模拟 design.md §4.3 表里的 token(避免把整个 style.css 都解析一遍;取权威表)
function tokenForCSSVar(style, varName) {
  const re = new RegExp('--' + varName + '\\s*:\\s*(#[0-9a-fA-F]{3,8})', 'm');
  const m = style.match(re);
  return m ? m[1] : null;
}

// WCAG 2.1 relative luminance
function relLuminance(hex) {
  const h = hex.replace('#', '');
  let r, g, b;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  const srgb = [r, g, b].map(v => {
    const f = v / 255;
    return f <= 0.03928 ? f / 12.92 : Math.pow((f + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrast(a, b) {
  const l1 = relLuminance(a);
  const l2 = relLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// 抽 prism.css 中默认(浅主题) .token.keyword 的色值
function pickHex(css, selector) {
  // 简单匹配:  selector { color: #xxxxxx; ... }
  const re = new RegExp('\\' + selector + '\\s*\\{[^}]*color:\\s*(#[0-9a-fA-F]{3,8})', 'm');
  const m = css.match(re);
  return m ? m[1] : null;
}

// 用 vm 把 prism.js 在受控沙箱里跑一遍,避免 document 引用报 ReferenceError
function loadPrismSandbox() {
  const sandbox = {
    document: {
      readyState: 'loading',
      addEventListener() {},         // 不真正注册;后续 fixture 直接触发
      querySelectorAll() { return []; },
    },
    setTimeout, clearTimeout, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(PRISM_JS, sandbox);
  return sandbox;
}

// 用 vm 触发 hook:在沙箱里塞 <pre><code>,再执行 hook(摘出暴露的高亮函数)
function tokenizeViaSandbox(code, lang) {
  const sandbox = loadPrismSandbox();
  // 把 highlight() 取出后绑定到 vm 上下文
  vm.runInContext(
    'globalThis.__highlight = highlight;',
    sandbox
  );
  return sandbox.__highlight(code, lang);
}

// ----- 1. assets/prism.{js,css} 存在 + 非空 ------------------------------

test('prism: assets/prism.js + assets/prism.css exist and non-empty', () => {
  assert.ok(fs.existsSync(PRISM_JS_PATH), 'assets/prism.js must exist');
  assert.ok(fs.existsSync(PRISM_CSS_PATH), 'assets/prism.css must exist');

  const jsSize = fs.statSync(PRISM_JS_PATH).size;
  const cssSize = fs.statSync(PRISM_CSS_PATH).size;
  assert.ok(jsSize > 100, `assets/prism.js must be non-empty (got ${jsSize} bytes)`);
  assert.ok(cssSize > 100, `assets/prism.css must be non-empty (got ${cssSize} bytes)`);

  // sanity: 没有引入任何 CDN / 远端脚本
  assert.ok(!/https?:\/\//.test(PRISM_JS), 'prism.js must not reference any http(s) URL');
  assert.ok(!/https?:\/\//.test(PRISM_CSS), 'prism.css must not reference any http(s) URL');

  // sanity: 顶层 IIFE 包住,挂载入口明确
  assert.ok(/\(function\s*\(\)\s*\{[\s\S]*'use strict'/.test(PRISM_JS),
    'prism.js should be wrapped in an IIFE with use strict');
  assert.ok(/DOMContentLoaded/.test(PRISM_JS),
    'prism.js must hook on DOMContentLoaded (or run immediately when DOM ready)');
});

// ----- 2. 文章页 HTML 含 prism.css link -----------------------------------

test('prism: post.html template injects <link rel="stylesheet" href="/assets/prism.css">', () => {
  assert.ok(
    /<link\s+rel=["']stylesheet["']\s+href=["']\/assets\/prism\.css["']\s*\/?>/.test(POST_TEMPLATE),
    'post.html must reference /assets/prism.css'
  );
});

// ----- 3. 文章页 HTML 含 prism.js script (defer,body 末) ------------------

test('prism: post.html template injects <script defer src="/assets/prism.js"></script>', () => {
  assert.ok(
    /<script\s+defer\s+src=["']\/assets\/prism\.js["']\s*><\/script>/.test(POST_TEMPLATE),
    'post.html must load prism.js via defer'
  );
});

// ----- 3b. 注入后的文章页 HTML 仍含 prism 标记(模拟 new-post.sh 渲染) -----

test('prism: rendered article HTML preserves prism.css link + prism.js script', () => {
  // 用模板 + 占位符填一份完整的文章页 HTML,验证 build 注入后仍含两个标记
  const rendered = POST_TEMPLATE
    .replace(/\{\{TITLE\}\}/g, '最小示例')
    .replace(/\{\{DESCRIPTION\}\}/g, '最小化的 fixture 文章。')
    .replace(/\{\{SLUG\}\}/g, 'minimal-post')
    .replace(/\{\{DATE\}\}/g, '2026-01-15')
    .replace(/\{\{AUTHOR\}\}/g, 'itingyu')
    .replace(/\{\{TAGS_HTML\}\}/g, '')
    .replace(/\{\{OG_IMAGE\}\}/g, '')
    .replace(/\{\{POSTMETA_TAGS\}\}/g, '')
    .replace(/\{\{BODY\}\}/g, '<p>正文</p>')
    .replace(/\{\{COVER_HTML\}\}/g, '')
    .replace(/\{\{RELATED_HTML\}\}/g, '');
  assert.ok(/<link\s+rel=["']stylesheet["']\s+href=["']\/assets\/prism\.css["']/.test(rendered),
    'rendered article page must reference prism.css');
  assert.ok(/<script\s+defer\s+src=["']\/assets\/prism\.js["']/.test(rendered),
    'rendered article page must load prism.js');
});

// ----- 4. style.css 含 [data-theme="dark"] .token.keyword 覆盖 ------------

test('prism: style.css has [data-theme="dark"] .token.keyword { color: var(--accent); } override', () => {
  const re = /:root\[data-theme=["']dark["']\]\s+\.token\.keyword\s*\{[^}]*color:\s*var\(--accent\)/;
  assert.ok(re.test(STYLE_CSS),
    'style.css must declare [data-theme="dark"] .token.keyword { color: var(--accent); }');
});

// ----- 5. WCAG AA:.token.keyword 深 / 浅主题下对比度 ≥ 4.5:1 --------------

test('prism: .token.keyword meets WCAG AA contrast ≥ 4.5:1 in both themes', () => {
  // 浅主题:.token.keyword 在 prism.css 里取默认色;背景为 --code-bg(--code-bg 默认值)
  const lightKeyword = pickHex(PRISM_CSS, '.token.keyword');
  assert.ok(lightKeyword, 'prism.css must declare .token.keyword color (default theme)');
  const lightBg = tokenForCSSVar(STYLE_CSS, 'code-bg');
  assert.ok(lightBg, 'style.css must declare --code-bg');
  const lightRatio = contrast(lightKeyword, lightBg);
  assert.ok(lightRatio >= 4.5,
    `light theme: contrast(${lightKeyword} on ${lightBg}) = ${lightRatio.toFixed(2)}:1, must ≥ 4.5`);

  // 深主题:.token.keyword 覆写为 var(--accent);找深主题下 --accent 的实际值
  // spec v1.2 §4.3 暗色 --accent = #a78bfa(在 [data-theme="dark"] 块)
  const darkAccentMatch = STYLE_CSS.match(/:root\[data-theme=["']dark["']\]\s*\{[\s\S]*?--accent:\s*(#[0-9a-fA-F]{3,8})/);
  assert.ok(darkAccentMatch, 'style.css must declare --accent inside [data-theme="dark"] block');
  const darkAccent = darkAccentMatch[1];
  // 深主题 --code-bg 也在 dark 块内
  const darkCodeBgMatch = STYLE_CSS.match(/:root\[data-theme=["']dark["']\]\s*\{[\s\S]*?--code-bg:\s*(#[0-9a-fA-F]{3,8})/);
  assert.ok(darkCodeBgMatch, 'style.css must declare --code-bg inside [data-theme="dark"] block');
  const darkBg = darkCodeBgMatch[1];
  const darkRatio = contrast(darkAccent, darkBg);
  assert.ok(darkRatio >= 4.5,
    `dark theme: contrast(${darkAccent} on ${darkBg}) = ${darkRatio.toFixed(2)}:1, must ≥ 4.5`);
});

// ----- 5b. (补充)prism.js 实际能产出 <span class="token keyword"> ----------

test('prism: highlight() wraps a keyword with <span class="token keyword">', () => {
  // vm 沙箱跑 prism.js;trigger DOMContentLoaded callback 之前先暴露 highlight()
  const sandbox = loadPrismSandbox();
  const out = sandbox.Prism.highlight('const foo = 1;', 'javascript');
  assert.ok(/<span class="token keyword">const<\/span>/.test(out),
    `expected const to be wrapped as keyword; got: ${out}`);
  assert.ok(/<span class="token number">1<\/span>/.test(out),
    `expected 1 to be wrapped as number; got: ${out}`);
});

// ----- 5c. (补充)bash 关键字(issue 明确要求的 language) -------------------

test('prism: highlight() handles language-bash', () => {
  const sandbox = loadPrismSandbox();
  const out = sandbox.Prism.highlight('if [ $x -eq 1 ]; then echo yes; fi', 'bash');
  assert.ok(/<span class="token keyword">if<\/span>/.test(out),
    `if should be tokenized as bash keyword; got: ${out}`);
  assert.ok(/<span class="token keyword">then<\/span>/.test(out),
    `then should be tokenized as bash keyword; got: ${out}`);
});

// ----- 6. AIWORK1-38 spec 文档自检 ---------------------------------------

test('prism: post template top comment mentions language-* usage', () => {
  // 模板顶部的注释是新人入门的唯一指引;确保它仍然存在并指向正确 API
  assert.ok(/language-(bash|javascript|python|json|typescript|diff)/.test(POST_TEMPLATE),
    'post.html must document a known language class');
  assert.ok(/prism\.js/.test(POST_TEMPLATE),
    'post.html usage comment must reference prism.js');
});