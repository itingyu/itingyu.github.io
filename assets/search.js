(function () {
  'use strict';
  var INDEX_URL = '/search/index.json';

  var inputEl = document.querySelector('[data-search-input]');
  var statusEl = document.querySelector('[data-search-status]');
  var resultsEl = document.querySelector('[data-search-results]');

  if (!inputEl || !resultsEl) return;

  var index = null;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  // 简单 HTML 转义(防 XSS,搜索结果显示用)
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"');
  }

  function tokenize(q) {
    return String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function score(post, tokens) {
    var titleLow = (post.title || '').toLowerCase();
    var descLow = (post.description || '').toLowerCase();
    var bodyLow = (post.content || '').toLowerCase();
    var tagsLow = (post.tags || []).join(' ').toLowerCase();
    var dateLow = (post.date || '').toLowerCase();
    var s = 0;
    tokens.forEach(function (t) {
      if (titleLow.indexOf(t) >= 0) s += 10;
      if (tagsLow.indexOf(t) >= 0) s += 6;
      if (dateLow.indexOf(t) >= 0) s += 1;
      if (descLow.indexOf(t) >= 0) s += 3;
      if (bodyLow.indexOf(t) >= 0) s += 1;
    });
    return s;
  }

  function snippet(text, tokens, len) {
    var t = String(text || '');
    if (!tokens.length) return t.slice(0, len);
    var lower = t.toLowerCase();
    var pos = -1;
    tokens.forEach(function (tok) {
      var i = lower.indexOf(tok);
      if (i >= 0 && (pos < 0 || i < pos)) pos = i;
    });
    if (pos < 0) return t.slice(0, len);
    var start = Math.max(0, pos - 30);
    var end = Math.min(t.length, start + len);
    var prefix = start > 0 ? '…' : '';
    var suffix = end < t.length ? '…' : '';
    return prefix + t.slice(start, end) + suffix;
  }

  function hitHTML(post, tokens) {
    var titleHTML = esc(post.title);
    var desc = (post.content || '').trim();
    var snip = esc(snippet(desc, tokens, 140));
    return '<li class="search-hit">'
      + '<h3 class="search-hit-title"><a href="' + esc(post.url) + '">' + titleHTML + '</a></h3>'
      + '<div class="search-hit-meta">'
      + '<time datetime="' + esc(post.date) + '">' + esc(post.date) + '</time>'
      + (post.tags && post.tags.length
        ? ' · <span class="search-hit-tags">' + post.tags.map(function (t) { return '<span class="chip-mini">' + esc(t) + '</span>'; }).join(' ') + '</span>'
        : '')
      + '</div>'
      + '<p class="search-hit-excerpt">' + snip + '</p>'
      + '</li>';
  }

  function emptyHTML(msg) {
    return '<li class="search-empty">' + esc(msg) + '</li>';
  }

  // 默认:按日期降序列出全部文章
  function renderDefault() {
    if (!index) { resultsEl.innerHTML = ''; return; }
    var sorted = index.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    setStatus('共 ' + index.length + ' 篇文章。输入关键词过滤。');
    resultsEl.innerHTML = sorted.map(function (p) { return hitHTML(p, []); }).join('');
  }

  // 搜索结果
  function renderHits(query) {
    if (!index) { resultsEl.innerHTML = ''; return; }
    var tokens = tokenize(query);
    if (!tokens.length) { renderDefault(); return; }

    var hits = [];
    index.forEach(function (p) {
      var s = score(p, tokens);
      if (s > 0) hits.push({ post: p, score: s });
    });
    hits.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (b.post.date || '').localeCompare(a.post.date || '');
    });

    setStatus('命中 ' + hits.length + ' 篇 · 关键词: ' + tokens.join(' '));

    if (!hits.length) {
      resultsEl.innerHTML = emptyHTML('没有匹配「' + query + '」的文章。换个关键词试试?');
      return;
    }
    resultsEl.innerHTML = hits.map(function (h) { return hitHTML(h.post, tokens); }).join('');
  }

  // 加载索引
  fetch(INDEX_URL, { credentials: 'omit' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      index = (data && data.posts) || [];
      var params = new URLSearchParams(window.location.search);
      var initial = params.get('q');
      if (initial) {
        inputEl.value = initial;
        renderHits(initial);
      } else {
        renderDefault();
      }
    })
    .catch(function (err) {
      setStatus('索引加载失败: ' + (err && err.message ? err.message : 'unknown'));
      resultsEl.innerHTML = emptyHTML('索引加载失败,请稍后重试。');
    });

  // 输入框防抖
  var timer = null;
  inputEl.addEventListener('input', function (e) {
    if (timer) clearTimeout(timer);
    var v = e.target.value;
    timer = setTimeout(function () { renderHits(v); }, 120);
  });

  // 键盘快捷键:Esc 清空
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && inputEl.value) {
      inputEl.value = '';
      renderDefault();
    }
  });
})();
