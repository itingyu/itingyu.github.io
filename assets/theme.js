(function () {
  'use strict';
  var KEY = 'itingyu-theme';
  var root = document.documentElement;

  // ---------- 主题 ----------

  function currentTheme() {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (_) {}
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
  }

  applyTheme(currentTheme());

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('[data-theme-toggle]');
    if (btn) {
      btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem(KEY, next); } catch (_) {}
      });
    }

    // 阅读进度条(只在文章页有效)
    initReadingProgress();

    // 字数估算(替换占位「约 N 分钟」)
    estimateReadingTime();

    // 文章页 TOC(扫 article h2/h3)
    initTOC();
  });

  // ---------- 阅读进度条 ----------

  function initReadingProgress() {
    var bar = document.querySelector('[data-reading-progress]');
    if (!bar) return;
    var article = document.querySelector('article');
    if (!article) return;

    var ticking = false;
    function update() {
      var rect = article.getBoundingClientRect();
      var viewport = window.innerHeight || document.documentElement.clientHeight;
      var total = rect.height - viewport;
      if (total <= 0) { bar.style.transform = 'scaleX(1)'; ticking = false; return; }
      var scrolled = -rect.top;
      var pct = Math.max(0, Math.min(1, scrolled / total));
      bar.style.transform = 'scaleX(' + pct + ')';
      ticking = false;
    }
    function onScroll() {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  // ---------- 阅读时长估算 ----------

  function estimateReadingTime() {
    var placeholders = document.querySelectorAll('[data-reading-time]');
    if (!placeholders.length) return;

    var article = document.querySelector('article');
    if (!article) return;

    // 统计字数(中英文分别计算)
    var text = (article.innerText || article.textContent || '').trim();
    var cnChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var enWords = (text.match(/[A-Za-z]+/g) || []).length;

    // 经验速度:中文 350 字/分钟,英文 220 词/分钟
    var minutes = Math.max(1, Math.ceil((cnChars / 350) + (enWords / 220)));

    placeholders.forEach(function (el) {
      el.textContent = '约 ' + minutes + ' 分钟';
    });
  }

  // ---------- 文章页 TOC ----------

  function initTOC() {
    var article = document.querySelector('article');
    if (!article) return;

    var headings = article.querySelectorAll('h2, h3');
    if (headings.length < 2) return; // 段落太少不显示 TOC

    // 给每个 heading 加 id(若已有则跳过)
    headings.forEach(function (h, i) {
      if (!h.id) {
        var slug = (h.textContent || '').trim()
          .toLowerCase()
          .replace(/[\s\u3000]+/g, '-')
          .replace(/[^\u4e00-\u9fa5a-z0-9-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        h.id = slug || ('section-' + (i + 1));
      }
    });

    // 构建 TOC DOM
    var aside = document.createElement('aside');
    aside.className = 'toc';
    aside.setAttribute('aria-label', '文章目录');
    aside.setAttribute('data-collapsed', 'false');

    var title = document.createElement('div');
    title.className = 'toc-title';
    title.textContent = '目录';
    aside.appendChild(title);

    var toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'toc-toggle';
    toggleBtn.setAttribute('data-toc-toggle', '');
    toggleBtn.textContent = '展开目录';
    aside.appendChild(toggleBtn);

    var list = document.createElement('ul');
    list.className = 'toc-list';

    headings.forEach(function (h) {
      var li = document.createElement('li');
      if (h.tagName === 'H3') li.className = 'toc-sub';
      var a = document.createElement('a');
      a.className = 'toc-link';
      a.href = '#' + h.id;
      a.textContent = h.textContent.replace(/^#+\s*/, '').trim();
      a.dataset.target = h.id;
      li.appendChild(a);
      list.appendChild(li);
    });

    aside.appendChild(list);
    article.parentNode.insertBefore(aside, article);

    // 移动端折叠
    toggleBtn.addEventListener('click', function () {
      var collapsed = aside.getAttribute('data-collapsed') === 'true';
      aside.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
      toggleBtn.textContent = collapsed ? '收起目录' : '展开目录';
    });
    // 默认移动端折叠
    if (window.matchMedia('(max-width: 1180px)').matches) {
      aside.setAttribute('data-collapsed', 'true');
      toggleBtn.textContent = '展开目录';
    }

    // IntersectionObserver 高亮当前
    if ('IntersectionObserver' in window) {
      var links = list.querySelectorAll('.toc-link');
      var byId = {};
      links.forEach(function (l) { byId[l.dataset.target] = l; });

      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var link = byId[entry.target.id];
          if (!link) return;
          if (entry.isIntersecting) {
            links.forEach(function (l) { l.classList.remove('is-active'); });
            link.classList.add('is-active');
          }
        });
      }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });

      headings.forEach(function (h) { observer.observe(h); });
    }
  }
})();
