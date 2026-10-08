(function () {
  'use strict';
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  var port = location.port || '';
  var url = 'ws://' + location.hostname + (port ? ':' + port : '') + '/__reload';
  function connect() {
    var ws;
    try { ws = new WebSocket(url); } catch (_) { return; }
    ws.addEventListener('message', function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg && msg.type === 'reload') location.reload();
      } catch (_) {}
    });
    ws.addEventListener('close', function () {
      setTimeout(connect, 1500);
    });
  }
  connect();
})();