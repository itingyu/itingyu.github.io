(function () {
  'use strict';
  var HELP_KEY = '?';
  var ESC_KEY = 'Escape';
  var GOTO_TIMEOUT = 1200;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isEditable(el) {
    if (!el || el === document.body) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function linkHref(rel) {
    var link = document.querySelector('link[rel="' + rel + '"]')
            || document.querySelector('link[rel="' + (rel === 'prev' ? 'previous' : 'next') + '"]');
    return link ? link.getAttribute('href') : null;
  }

  function flashNav(side, href) {
    var card = document.querySelector('.post-nav-' + side);
    if (!card) return;
    card.classList.add('flash');
    var timer = setTimeout(function () {
      card.classList.remove('flash');
      window.location.href = href;
    }, 200);
    return timer;
  }

  function buildOverlay() {
    var rows = [
      ['j / k', '下一篇 / 上一篇(文章页)'],
      ['g h', '首页'],
      ['g p', '文章'],
      ['g a', '归档'],
      ['g t', '标签'],
      ['s', 'focus 到搜索框'],
      ['Shift+T', '切换主题'],
      ['?', '显示 / 隐藏此帮助']
    ];
    var overlay = document.createElement('div');
    overlay.className = 'keyhelp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', '键盘快捷键');
    overlay.setAttribute('aria-modal', 'true');
    overlay.hidden = true;
    var html = '<h2 class="keyhelp-title">键盘快捷键</h2><table class="keyhelp-table"><tbody>';
    rows.forEach(function (r) {
      html += '<tr><th><kbd>' + r[0] + '</kbd></th><td>' + r[1] + '</td></tr>';
    });
    html += '</tbody></table><p class="keyhelp-hint">按 <kbd>Esc</kbd> 关闭</p>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    return overlay;
  }

  var overlay = null;
  function toggleHelp(force) {
    if (!overlay) overlay = buildOverlay();
    var show = force == null ? overlay.hidden : force;
    overlay.hidden = !show;
    if (show && !reducedMotion) {
      overlay.style.animation = 'none';
      void overlay.offsetWidth;
      overlay.style.animation = '';
    }
  }

  function focusSearch() {
    var input = document.querySelector('[data-search-input]');
    if (input) { input.focus(); input.select && input.select(); }
  }

  function toggleTheme() {
    var btn = document.querySelector('[data-theme-toggle]');
    if (btn) btn.click();
  }

  var gotoPending = null;
  var gotoTimer = null;

  function gotoPath(key) {
    var map = { h: '/', p: '/posts/', a: '/archive/', t: '/tags/' };
    var path = map[key];
    if (path) window.location.href = path;
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditable(e.target)) return;

    var key = e.key;

    if (key === ESC_KEY) {
      if (overlay && !overlay.hidden) { toggleHelp(false); e.preventDefault(); }
      return;
    }

    if (key === HELP_KEY) {
      toggleHelp();
      e.preventDefault();
      return;
    }

    if (key === 's' || key === 'S') {
      focusSearch();
      e.preventDefault();
      return;
    }

    if (key === 'T' && e.shiftKey) {
      toggleTheme();
      e.preventDefault();
      return;
    }

    if (key === 'j' || key === 'J') {
      var next = linkHref('next');
      if (next) {
        e.preventDefault();
        if (reducedMotion) {
          window.location.href = next;
        } else {
          flashNav('next', next);
        }
      }
      return;
    }
    if (key === 'k' || key === 'K') {
      var prev = linkHref('prev');
      if (prev) {
        e.preventDefault();
        if (reducedMotion) {
          window.location.href = prev;
        } else {
          flashNav('prev', prev);
        }
      }
      return;
    }

    if (key === 'g') {
      gotoPending = 'g';
      clearTimeout(gotoTimer);
      gotoTimer = setTimeout(function () { gotoPending = null; }, GOTO_TIMEOUT);
      return;
    }
    if (gotoPending === 'g') {
      var lower = key.toLowerCase();
      if (lower === 'h' || lower === 'p' || lower === 'a' || lower === 't') {
        gotoPath(lower);
        gotoPending = null;
        clearTimeout(gotoTimer);
        e.preventDefault();
      }
    }
  });
})();