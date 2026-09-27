'use strict';

/*
 * scripts/preview.js
 *
 * itingyu.github.io local preview server.
 *
 * Public API:
 *   startPreview({ port = 8080, includeDraft = false, rootDir?, host = '127.0.0.1' })
 *     -> Promise<{ httpServer, wss, watcher, close }>
 *
 * CLI:
 *   node scripts/preview.js [--port N] [--include-draft]
 *   PORT=8080 INCLUDE_DRAFT=1 npm run preview
 *
 * Constraints (per design-v2.md §5.2.4 + §6.6):
 *   - Listen on 127.0.0.1 only (no LAN exposure).
 *   - Node built-ins + `ws@8` devDep only — NO marked / markdown-it / chokidar.
 *   - Default strict: draft:true posts return 404.
 *   - `--include-draft` / INCLUDE_DRAFT=1 → render drafts.
 *   - Hot reload: fs.watch(rootDir, {recursive: true}) + ws@8 /ws.
 *
 * 浏览器 WS 客户端由本文件注入到 HTML 响应(`<!-- preview:ws-client -->` marker,幂等)。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const { WebSocketServer } = require('ws');

const ROOT_DEFAULT = path.resolve(__dirname, '..');

const POSTS_RE = /^\/posts\/([^/]+)\/?$/;
const POSTS_INDEX_HTML_RE = /^\/posts\/([^/]+)\/index\.html$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
};

const WS_CLIENT_MARKER = '<!-- preview:ws-client -->';
const WS_CLIENT_SCRIPT = `${WS_CLIENT_MARKER}
<script>
(function(){
  if (window.__previewWsInjected) return;
  window.__previewWsInjected = true;
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url = proto + '//' + location.host + '/ws';
  var ws = null;
  var reloadTimer = null;
  function connect() {
    try {
      ws = new WebSocket(url);
    } catch (_) { scheduleReconnect(); return; }
    ws.addEventListener('message', function(ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg && msg.t === 'reload') {
          if (reloadTimer) clearTimeout(reloadTimer);
          reloadTimer = setTimeout(function(){ location.reload(); }, 80);
        }
      } catch (_) {}
    });
    ws.addEventListener('close', scheduleReconnect);
    ws.addEventListener('error', function() { try { ws.close(); } catch(_){} });
  }
  function scheduleReconnect() {
    setTimeout(function(){
      if (!ws || ws.readyState === WebSocket.CLOSED) connect();
    }, 1000);
  }
  connect();
})();
</script>`;

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function safeJoin(rootDir, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (_) { return null; }
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const full = path.join(rootDir, normalized);
  const rootWithSep = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
  if (full !== rootDir && !full.startsWith(rootWithSep)) return null;
  return full;
}

function injectWsClient(html) {
  if (!html || typeof html !== 'string') return html;
  if (html.includes(WS_CLIENT_MARKER)) return html;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return html + WS_CLIENT_SCRIPT;
  return html.slice(0, idx) + WS_CLIENT_SCRIPT + html.slice(idx);
}

async function renderPostPage({ slug, rootDir, allPosts, includeDraft, bi, md }) {
  const slugSafe = String(slug).replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!slugSafe) throw Object.assign(new Error('bad slug'), { statusCode: 400 });

  const mdPath = path.join(rootDir, 'posts', slugSafe, 'index.md');
  const mdText = fs.readFileSync(mdPath, 'utf8');

  const fm = bi.parseYamlFrontmatter(mdText, slugSafe);
  if (fm && fm.draft && !includeDraft) {
    throw Object.assign(new Error('draft not included'), { statusCode: 404 });
  }

  const post = {
    slug: slugSafe,
    title: fm.title || slugSafe,
    date: fm.date || '',
    description: fm.description || fm.excerpt || '',
    excerpt: fm.excerpt || fm.description || '',
    tags: Array.isArray(fm.tags) ? fm.tags.map(t => ({ slug: t, name: t })) : [],
    cover: fm.cover || null,
    series: fm.series || null,
    pinned: !!fm.pinned,
    draft: !!fm.draft,
    author: fm.author || 'itingyu',
    canonical: fm.canonical || null,
    sourceFormat: 'md',
    sourcePath: mdPath,
    mdText,
  };

  const html = bi.buildArticlePageFromMd(post, allPosts, rootDir);
  return injectWsClient(html);
}

async function serveStatic({ rootDir, urlPath, res, req }) {
  const fullPath = safeJoin(rootDir, urlPath);
  if (!fullPath) {
    res.writeHead(400); res.end('bad path'); return;
  }

  let stat;
  try { stat = fs.statSync(fullPath); } catch (_) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 not found');
    return;
  }

  if (stat.isDirectory()) {
    const indexPath = path.join(fullPath, 'index.html');
    try {
      const idxStat = fs.statSync(indexPath);
      if (idxStat.isFile()) {
        await sendFile({ fullPath: indexPath, res, req });
        return;
      }
    } catch (_) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 not found');
      return;
    }
  } else if (stat.isFile()) {
    await sendFile({ fullPath, res, req });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404 not found');
}

function sendFile({ fullPath, res, req }) {
  return new Promise((resolve) => {
    if (path.extname(fullPath).toLowerCase() === '.md') {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('403 raw .md forbidden — preview renders .md to HTML');
      return resolve();
    }
    const ext = path.extname(fullPath).toLowerCase();
    const isHtml = ext === '.html' || ext === '.htm';
    res.setHeader('content-type', mimeFor(fullPath));
    res.setHeader('cache-control', 'no-store');
    if (isHtml) {
      fs.readFile(fullPath, 'utf8', (err, data) => {
        if (err) {
          res.writeHead(500); res.end('read error'); return resolve();
        }
        const out = injectWsClient(data);
        res.end(out);
        resolve();
      });
      return;
    }
    const stream = fs.createReadStream(fullPath);
    stream.on('error', () => { res.writeHead(500); res.end('read error'); resolve(); });
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

async function handleHttpRequest({ req, res, rootDir, allPosts, includeDraft, bi }) {
  const parsed = url.parse(req.url);
  let pathname = parsed.pathname || '/';
  if (pathname.includes('\0')) {
    res.writeHead(400); res.end('bad path'); return;
  }

  if (pathname === '/') pathname = '/index.html';

  // 1) /posts/<slug>/  (with trailing slash)
  const postDirMatch = pathname.match(POSTS_RE);
  if (postDirMatch) {
    const slug = postDirMatch[1];
    const mdPath = path.join(rootDir, 'posts', slug, 'index.md');
    if (fs.existsSync(mdPath)) {
      try {
        const html = await renderPostPage({
          slug, rootDir, allPosts, includeDraft, bi,
        });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        const code = err && err.statusCode ? err.statusCode : 500;
        res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`${code} ${err.message}`);
      }
      return;
    }
    const htmlPath = path.join(rootDir, 'posts', slug, 'index.html');
    if (fs.existsSync(htmlPath)) {
      await sendFile({ fullPath: htmlPath, res, req });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 not found');
    return;
  }

  // 2) /posts/<slug>/index.html  → redirect to /posts/<slug>/
  const postIdxMatch = pathname.match(POSTS_INDEX_HTML_RE);
  if (postIdxMatch) {
    const slug = postIdxMatch[1];
    res.writeHead(301, { location: `/posts/${slug}/` });
    res.end();
    return;
  }

  // 3) 静态资源
  await serveStatic({ rootDir, urlPath: pathname, res, req });
}

function createRequestHandler(opts) {
  const { rootDir, allPosts, includeDraft, bi, onReload } = opts;
  return async function onRequest(req, res) {
    try {
      await handleHttpRequest({ req, res, rootDir, allPosts, includeDraft, bi });
    } catch (err) {
      try {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('500 internal');
      } catch (_) {}
      process.stderr.write(`preview req error: ${err && err.stack || err}\n`);
    }
  };
}

function parseArgs(argv) {
  const out = { port: null, includeDraft: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port' || a === '-p') {
      out.port = Number(argv[++i]);
    } else if (a === '--include-draft') {
      out.includeDraft = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  if (out.port == null || !Number.isFinite(out.port)) {
    const envPort = Number(process.env.PORT);
    if (Number.isFinite(envPort) && envPort > 0) out.port = envPort;
  }
  if (out.port == null) out.port = 8080;
  if (!out.includeDraft) {
    out.includeDraft = process.env.INCLUDE_DRAFT === '1'
      || process.env.INCLUDE_DRAFT === 'true';
  }
  return out;
}

function showHelp() {
  process.stdout.write(`Usage: node scripts/preview.js [--port N] [--include-draft]

Options:
  --port, -p       TCP port (default: env PORT or 8080)
  --include-draft  Include draft:true posts (default: env INCLUDE_DRAFT=1)
  --help, -h       Show this help

Examples:
  npm run preview
  npm run preview -- --port 9090
  npm run preview -- --include-draft
  INCLUDE_DRAFT=1 PORT=9000 npm run preview
`);
}

function startPreview(opts = {}) {
  const port = Number.isFinite(opts.port) && opts.port > 0 ? opts.port : 8080;
  const host = opts.host || '127.0.0.1';
  const includeDraft = !!opts.includeDraft;
  const rootDir = path.resolve(opts.rootDir || ROOT_DEFAULT);

  const bi = require(path.join(rootDir, 'scripts', 'build-index.js'));
  let allPosts;
  try {
    allPosts = bi.scanPosts(rootDir);
  } catch (err) {
    return Promise.reject(err);
  }

  const onRequest = createRequestHandler({
    rootDir, allPosts, includeDraft, bi,
    onReload: () => {},
  });

  const httpServer = http.createServer(onRequest);

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // per-file debounce:同一文件 100ms 内多次事件合并为一次广播
  const debounceMap = new Map();
  const DEBOUNCE_MS = 100;

  const watcher = fs.watch(rootDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const f = String(filename).split(path.sep).join('/');
    if (!/\.md$/i.test(f)) return;
    if (!/(^|\/)posts\/[^/]+\/index\.md$/i.test(f)) return;

    const key = f;
    if (debounceMap.has(key)) clearTimeout(debounceMap.get(key));
    debounceMap.set(key, setTimeout(() => {
      debounceMap.delete(key);
      const payload = JSON.stringify({ t: 'reload', p: key });
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          try { client.send(payload); } catch (_) {}
        }
      }
    }, DEBOUNCE_MS));
  });

  wss.on('connection', (ws) => {
    try { ws.send(JSON.stringify({ t: 'hello', p: 'preview-ws' })); } catch (_) {}
  });

  return new Promise((resolve, reject) => {
    const onError = (err) => {
      httpServer.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.removeListener('error', onError);
      const addr = httpServer.address();
      const actualPort = addr && typeof addr === 'object' ? addr.port : port;
      process.stderr.write(
        `preview listening on http://${host}:${actualPort}` +
        (includeDraft ? ' (include-draft)' : '') + '\n' +
        `  root: ${rootDir}\n`
      );
      resolve({
        httpServer,
        wss,
        watcher,
        port: actualPort,
        host,
        rootDir,
        includeDraft,
        close() {
          try { wss.close(); } catch (_) {}
          try { watcher.close(); } catch (_) {}
          return new Promise((r) => httpServer.close(() => r()));
        },
      });
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(port, host);
  });
}

function runCli() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { showHelp(); return 0; }
  startPreview({
    port: args.port,
    includeDraft: args.includeDraft,
    rootDir: ROOT_DEFAULT,
  }).catch((err) => {
    process.stderr.write(`preview failed to start: ${err && err.message || err}\n`);
    if (err && err.code === 'EADDRINUSE') {
      process.stderr.write(
        `  hint: port ${args.port} is in use. try --port <other> or set PORT.\n`,
      );
    }
    process.exit(1);
  });
  return null;
}

module.exports = {
  startPreview,
  parseArgs,
  _internals: {
    injectWsClient,
    safeJoin,
    mimeFor,
    renderPostPage,
  },
};

if (require.main === module) {
  runCli();
}