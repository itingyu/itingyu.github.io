/*!
 * Mini Prism · 6 languages · zero deps · ~5KB
 *   - JS / TS / Python / Bash / JSON / Diff
 *   - 单文件本地化 · 禁 CDN · 禁 npm
 *   - DOMContentLoaded 后自动 hook pre > code[class~="language-*"]
 *   - 输出 span.token.<kind>,主题色由 assets/style.css 覆盖
 *
 * 与官方 Prism 行为对齐:
 *   - <pre><code class="language-bash">…</code></pre>
 *     → 自动给 <pre> 加 class="language-bash"
 *     → 给 <code> 加 class="language-bash prism-code"
 *     → 把 token 拆分到 <span class="token keyword"> 等
 *
 * 加载方式(defer + body 末,与 theme.js 同模式):
 *   <script defer src="/assets/prism.js"></script>
 */
(function () {
  'use strict';

  // ---------- HTML escape ----------
  function escapeHTML(s) {
    return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
  }

  // ---------- tokenize: 对 escapeHTML 后的 code 串,按 patterns 顺序包裹 ----------
  // 占位策略:每命中一条 pattern,用 \x01<letters>\x02 替换。纯字母不会被
  // number / keyword / function / variable / decorator 等 pattern 误匹配;
  // 末尾按 Spreadsheet 列号风格解码为 0-based 索引还原。
  function placeholderEncode(n) {
    var s = '';
    n = n + 1;
    while (n > 0) {
      n--;
      s = String.fromCharCode(97 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  }
  function placeholderDecode(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 96);
    }
    return n - 1;
  }
  function applyPatterns(escaped, patterns) {
    var placeholders = [];
    var result = escaped;
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i];
      result = result.replace(p.re, function (m) {
        var idx = placeholders.length;
        placeholders.push('<span class="token ' + p.name + '">' + m + '</span>');
        return '\u0001' + placeholderEncode(idx) + '\u0002';
      });
    }
    return result.replace(/\u0001([a-z]+)\u0002/g, function (_, letters) {
      return placeholders[placeholderDecode(letters)];
    });
  }

  // ---------- 6 个语言 grammar ----------
  // 关键字常量放在前部,便于将来扩语言
  var JS_KEYWORDS = ('break case catch class const continue debugger default delete do else export extends '
    + 'finally function if import in instanceof let new return super switch this throw try typeof var void '
    + 'while with yield async await from of static as').split(' ');
  var TS_KEYWORDS = JS_KEYWORDS.concat('type interface enum public private protected readonly namespace declare '
    + 'abstract implements keyof infer never unknown any void'.split(' '));
  var PY_KEYWORDS = ('False None True and as assert async await break class continue def del elif else except '
    + 'finally for from global if import in is lambda nonlocal not or pass raise return try while with yield '
    + 'match case').split(' ');
  var BASH_KEYWORDS = ('if then else elif fi case esac for while until do done function return in break continue '
    + 'export local readonly declare alias source eval set unset').split(' ');

  function kwRe(words) {
    return new RegExp('\\b(?:' + words.join('|') + ')\\b', 'g');
  }

  var NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;
  var OPERATOR_RE = /[+\-*/%=<>!&|^~?]+/g;
  var FUNC_RE = /\b[a-zA-Z_$][\w$]*(?=\s*\()/g;

  // ---------- 字符串模板(JS/TS) ----------
  function jsStringRe() {
    return /(?:\u0027(?:\u005C.|[^\u005C\u0027])*\u0027)|(?:"(?:\u005C.|[^"\\\n])*")|(?:`(?:\$\{[^}]*\}|[^`\\])*`)|(?:\/(?:[^\/\\\n]|\\.)+\/[gimsuy]*)/g;
  }

  // ---------- comment patterns ----------
  var COMMENT_LINE_JS = /\/\/[^\n]*/g;
  var COMMENT_BLOCK_JS = /\/\*[\s\S]*?\*\//g;
  var COMMENT_LINE_PY = /#[^\n]*/g;
  var COMMENT_LINE_BASH = /#[^\n]*/g;

  // ---------- grammars ----------
  var LANGS = {
    javascript: [
      { name: 'comment', re: COMMENT_BLOCK_JS },
      { name: 'comment', re: COMMENT_LINE_JS },
      { name: 'string',  re: jsStringRe() },
      { name: 'regex',   re: /\/(?:[^\/\n\\\[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[gimsuy]*/g },
      { name: 'keyword', re: kwRe(JS_KEYWORDS) },
      { name: 'boolean', re: /\b(?:true|false|null|undefined|NaN|Infinity)\b/g },
      { name: 'function',re: FUNC_RE },
      { name: 'number',  re: NUMBER_RE },
      { name: 'operator',re: OPERATOR_RE },
      { name: 'punctuation', re: /[{}[\]();,.]/g },
    ],
    js: null,
    typescript: [
      { name: 'comment', re: COMMENT_BLOCK_JS },
      { name: 'comment', re: COMMENT_LINE_JS },
      { name: 'string',  re: jsStringRe() },
      { name: 'regex',   re: /\/(?:[^\/\n\\\[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[gimsuy]*/g },
      { name: 'keyword', re: kwRe(TS_KEYWORDS) },
      { name: 'boolean', re: /\b(?:true|false|null|undefined|NaN|Infinity)\b/g },
      { name: 'function',re: FUNC_RE },
      { name: 'number',  re: NUMBER_RE },
      { name: 'operator',re: OPERATOR_RE },
      { name: 'punctuation', re: /[{}[\]();,.]/g },
    ],
    ts: null,
    python: [
      { name: 'comment', re: COMMENT_LINE_PY },
      { name: 'string',  re: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g },
      { name: 'decorator', re: /@[a-zA-Z_][\w.]*/g },
      { name: 'keyword', re: kwRe(PY_KEYWORDS) },
      { name: 'boolean', re: /\b(?:True|False|None)\b/g },
      { name: 'function',re: /\b[a-zA-Z_][\w]*(?=\s*\()/g },
      { name: 'number',  re: NUMBER_RE },
      { name: 'operator',re: OPERATOR_RE },
      { name: 'punctuation', re: /[{}[\]():,.]/g },
    ],
    py: null,
    bash: [
      { name: 'comment', re: COMMENT_LINE_BASH },
      { name: 'string',  re: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g },
      { name: 'variable',re: /\$\{?[a-zA-Z_][\w]*\}?/g },
      { name: 'keyword', re: kwRe(BASH_KEYWORDS) },
      { name: 'number',  re: NUMBER_RE },
      { name: 'function',re: /\b[a-zA-Z_][\w]*(?=\s*\(\))/g },
      { name: 'operator',re: OPERATOR_RE },
      { name: 'punctuation', re: /[{}[\]();,.|&]/g },
    ],
    sh: null,
    json: [
      { name: 'string',  re: /"(?:\\.|[^"\\\n])*"(?=\s*:)/g },
      { name: 'string',  re: /"(?:\\.|[^"\\\n])*"/g },
      { name: 'number',  re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g },
      { name: 'boolean', re: /\b(?:true|false|null)\b/g },
      { name: 'punctuation', re: /[{}[\],:]/g },
    ],
    diff: [
      { name: 'comment', re: /^[ \t]*#.*$/gm },
      { name: 'deleted', re: /^[ \t]*-[^\n]*/gm },
      { name: 'inserted',re: /^[ \t]*\+[^\n]*/gm },
      { name: 'header',  re: /^@@.*$/gm },
      { name: 'punctuation', re: /^[ \t]*(?:---|\+\+\+|Index|Diff).*$/gm },
    ],
  };
  LANGS.js = LANGS.javascript;
  LANGS.ts = LANGS.typescript;
  LANGS.py = LANGS.python;
  LANGS.sh = LANGS.bash;

  function highlight(code, lang) {
    var escaped = escapeHTML(code);
    var grammar = LANGS[lang];
    if (!grammar) grammar = LANGS.js;
    return applyPatterns(escaped, grammar);
  }

  function hook() {
    var nodes = document.querySelectorAll('pre > code[class*="language-"]');
    for (var i = 0; i < nodes.length; i++) {
      var code = nodes[i];
      if (code.classList.contains('prism-code')) continue;
      var m = (code.className || '').match(/language-([\w-]+)/);
      if (!m) continue;
      var lang = m[1];
      var text = code.textContent || '';
      var html = highlight(text, lang);
      code.innerHTML = html;
      code.classList.add('prism-code');
      code.classList.add('language-' + lang);
      if (code.parentNode && code.parentNode.tagName === 'PRE') {
        code.parentNode.classList.add('language-' + lang);
      }
    }
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.Prism = { highlight: highlight, languages: Object.keys(LANGS) };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hook);
  } else {
    hook();
  }
})();