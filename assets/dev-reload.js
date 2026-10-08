'use strict';

/*
 * assets/dev-reload.js
 *
 * itingyu.github.io local preview WebSocket client.
 *
 * 行为:
 *   - 仅在 localhost / 127.0.0.1 域名下激活;其他域名立即 noop(防止生产误连)。
 *   - 连接 ws://<host>:<port>/__ws(preview.js 端点)
 *   - 收到 {type:"reload", file:"..."}:
 *       .md      → location.reload()          (rebuild 后整页刷新最安全)
 *       .html    → fetch(file) + 替换 <main> 内容(局部 swap)
 *       .js      → location.reload()          (脚本不能简单 DOM swap,需要重新执行)
 *       其他     → location.reload()          (保守)
 *   - WS 断线 1s 后重连
 *   - 同一文件短时间内多次 reload 80ms 防抖
 */

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') {
    return;
  }

  if (window.__previewDevReloadInjected) return;
  window.__previewDevReloadInjected = true;

  var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url = proto + '//' + window.location.host + '/__ws';

  var ws = null;
  var reloadTimer = null;

  function debouncedReload(file) {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () { reload(file); }, 80);
  }

  function reload(file) {
    if (!file) { window.location.reload(); return; }
    var f = String(file);
    if (f.endsWith('.md')) { window.location.reload(); return; }
    if (f.endsWith('.html') || f.endsWith('.htm')) {
      swapMain(f);
      return;
    }
    if (f.endsWith('.js')) {
      window.location.reload();
      return;
    }
    window.location.reload();
  }

  function swapMain(file) {
    var main = document.querySelector('main');
    if (!main) { window.location.reload(); return; }
    fetch(file, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var fresh = doc.querySelector('main');
        if (fresh) {
          main.innerHTML = fresh.innerHTML;
          if (typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('preview:soup-swapped', { detail: { file: file } }));
          }
        } else {
          window.location.reload();
        }
      })
      .catch(function () { window.location.reload(); });
  }

  function connect() {
    try {
      ws = new WebSocket(url);
    } catch (_) { scheduleReconnect(); return; }

    ws.addEventListener('message', function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg && msg.type === 'reload') debouncedReload(msg.file);
    });
    ws.addEventListener('close', scheduleReconnect);
    ws.addEventListener('error', function () {
      try { ws && ws.close(); } catch (_) {}
    });
  }

  function scheduleReconnect() {
    setTimeout(function () {
      if (!ws || ws.readyState === WebSocket.CLOSED) connect();
    }, 1000);
  }

  connect();
})();
