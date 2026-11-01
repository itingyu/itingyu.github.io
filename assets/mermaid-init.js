// assets/mermaid-init.js — 把 kramdown 渲染的 <pre><code class="language-mermaid"> 换成 <div class="mermaid">
// github-pages safe 模式不能加 plugin,改走 JS 运行时
(function() {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function transform() {
    // 找所有 <pre><code class="language-mermaid">
    const codes = document.querySelectorAll('pre > code.language-mermaid');
    if (codes.length === 0) return;

    const placeholders = [];
    codes.forEach((code, idx) => {
      const pre = code.parentElement;
      const text = code.textContent;
      const id = 'mermaid-' + Date.now() + '-' + idx;
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.id = id;
      div.textContent = text;
      pre.replaceWith(div);
      placeholders.push(div);
    });

    // 等 mermaid 库就绪再 init
    if (window.mermaid && typeof window.mermaid.run === 'function') {
      runMermaid();
    } else {
      const check = setInterval(() => {
        if (window.mermaid && typeof window.mermaid.run === 'function') {
          clearInterval(check);
          runMermaid();
        }
      }, 100);
      // 5 秒超时保护
      setTimeout(() => clearInterval(check), 5000);
    }

    function runMermaid() {
      try {
        const theme = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'dark' : 'default';
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
        placeholders.forEach(p => {
          p.style.color = 'red';
          p.textContent = '⚠ Mermaid 渲染失败: ' + e.message;
        });
      }
    }
  }

  ready(transform);
})();
