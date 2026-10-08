// assets/toc.js — 运行时从文章 H2/H3 构建右侧大纲
// github-pages safe 模式不让我加 Liquid toc filter,改走 JS
(function() {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  function buildTOC() {
    const sidebar = document.querySelector('[data-toc-sidebar]');
    const nav = document.querySelector('[data-toc-nav]');
    if (!sidebar || !nav) return;

    // 找文章正文 article(后置布局,可能嵌套在 .content-area > article)
    const article = document.querySelector('main article') || document.querySelector('article');
    if (!article) return;

    // 抽 h2 / h3
    const headings = article.querySelectorAll('h2, h3');
    if (headings.length === 0) {
      // 没标题 → 隐藏侧栏
      sidebar.classList.add('is-empty');
      nav.innerHTML = '<p class="article-toc-empty">本文无章节</p>';
      return;
    }

    const list = document.createElement('ol');
    list.className = 'article-toc-list';

    // theme.js 会在 H2/H3 注入 <a class="heading-anchor">🔗</a>
    // 取文本时克隆节点再去掉锚点,避免目录项被 🔗 污染
    function headingText(h) {
      const clone = h.cloneNode(true);
      clone.querySelectorAll('.heading-anchor').forEach(el => el.remove());
      return clone.textContent.replace(/^[\d.\s]+/, '').trim();
    }

    let currentH2 = null;
    headings.forEach(h => {
      // 保证 id(可能 kramdown 没生成)
      if (!h.id) {
        h.id = slugify(h.textContent);
      }
      if (h.tagName === 'H2') {
        const li = document.createElement('li');
        li.className = 'article-toc-item article-toc-h2';
        const a = document.createElement('a');
        a.href = '#' + h.id;
        a.textContent = headingText(h);
        a.className = 'article-toc-link';
        a.dataset.target = h.id;
        li.appendChild(a);
        list.appendChild(li);
        currentH2 = li;
      } else if (h.tagName === 'H3' && currentH2) {
        // H3 嵌套在最近 H2 下面
        let sub = currentH2.querySelector(':scope > ol');
        if (!sub) {
          sub = document.createElement('ol');
          sub.className = 'article-toc-sublist';
          currentH2.appendChild(sub);
        }
        const li = document.createElement('li');
        li.className = 'article-toc-item article-toc-h3';
        const a = document.createElement('a');
        a.href = '#' + h.id;
        a.textContent = headingText(h);
        a.className = 'article-toc-link';
        a.dataset.target = h.id;
        li.appendChild(a);
        sub.appendChild(li);
      }
    });

    nav.innerHTML = '';
    nav.appendChild(list);
    sidebar.classList.remove('is-empty');

    // 平滑滚动
    nav.addEventListener('click', (e) => {
      const link = e.target.closest('a[href^="#"]');
      if (!link) return;
      e.preventDefault();
      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target) {
        const top = target.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top, behavior: 'smooth' });
        history.replaceState(null, '', '#' + id);
      }
    });

    // 折叠按钮
    const toggleBtn = sidebar.querySelector('.article-toc-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        toggleBtn.setAttribute('aria-expanded', String(!expanded));
        sidebar.classList.toggle('is-collapsed', expanded);
        toggleBtn.textContent = expanded ? '▸' : '▾';
      });
    }

    // scroll-spy: 高亮当前可视标题
    const links = nav.querySelectorAll('a[data-target]');
    if ('IntersectionObserver' in window && links.length > 0) {
      const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            links.forEach(l => l.classList.remove('is-active'));
            const activeLink = nav.querySelector('a[data-target="' + entry.target.id + '"]');
            if (activeLink) {
              activeLink.classList.add('is-active');
              // 父 H2 也高亮
              const parentLi = activeLink.closest('.article-toc-item');
              if (parentLi) {
                const parentLink = parentLi.querySelector(':scope > a');
                if (parentLink && parentLink !== activeLink) {
                  parentLink.classList.add('is-active-parent');
                }
              }
            }
          }
        });
      }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
      headings.forEach(h => obs.observe(h));
    }
  }

  function slugify(s) {
    return s.trim().toLowerCase()
      .replace(/[\s]+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]/g, '')
      .replace(/^-+|-+$/g, '');
  }

  ready(buildTOC);
})();
