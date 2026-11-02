// assets/mermaid-init.js — 把 kramdown 渲染的 <pre><code class="language-mermaid"> 换成 <div class="mermaid">
// github-pages safe 模式不能加 plugin,改走 JS 运行时
//
// 关键:库没到位之前不动 DOM。否则会先把 mermaid 源码当正文画出来,
// 渲染成 SVG 后又缩回去,一次加载里高度变两次(CDN 慢时尤其明显)。
(function() {
  'use strict';

  var WAIT_MS = 8000;      // 等库上限
  var POLL_MS = 100;
  var placeholders = [];

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function libReady() {
    return window.mermaid && typeof window.mermaid.run === 'function';
  }

  function runMermaid() {
    try {
      var theme = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'dark' : 'default';
      window.mermaid.initialize({
        startOnLoad: false,
        theme: theme,
        securityLevel: 'loose',
        fontFamily: 'inherit',
        flowchart: { useMaxWidth: true, htmlLabels: true }
      });
      window.mermaid.run({ nodes: placeholders });
    } catch (e) {
      console.error('Mermaid init failed:', e);
      placeholders.forEach(function(p) {
        p.style.color = 'var(--danger, #b91c1c)';
        p.textContent = '⚠ Mermaid 渲染失败: ' + e.message;
      });
    }
  }

  // 库就绪后才换 DOM:替换与渲染放在同一个 tick 里,尽量只让浏览器看到最终形态
  function swapAndRender(codes) {
    Array.prototype.forEach.call(codes, function(code, idx) {
      var pre = code.parentElement;
      if (!pre) return;
      var div = document.createElement('div');
      div.className = 'mermaid';
      div.id = 'mermaid-' + Date.now() + '-' + idx;
      div.textContent = code.textContent;
      pre.replaceWith(div);
      placeholders.push(div);
    });
    runMermaid();
  }

  function transform() {
    var codes = document.querySelectorAll('pre > code.language-mermaid');
    if (codes.length === 0) return;

    if (libReady()) {
      swapAndRender(codes);
      return;
    }

    var waited = 0;
    var timer = setInterval(function() {
      waited += POLL_MS;
      if (libReady()) {
        clearInterval(timer);
        swapAndRender(codes);   // 用同一批节点,避免 DOM 已变动导致选择器落空
      } else if (waited >= WAIT_MS) {
        clearInterval(timer);   // 库挂了就保留原始代码块,不制造空壳
      }
    }, POLL_MS);
  }

  ready(transform);
})();
