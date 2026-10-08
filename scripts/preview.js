'use strict';

/*
 * scripts/preview.js
 *
 * itingyu.github.io local preview server with WebSocket hot-reload.
 *
 * Public API:
 *   startPreview({ port = 4173, includeDraft = false, host = '127.0.0.1', rootDir? })
 *     -> Promise<{ httpServer, wss, watcher, port, host, rootDir, includeDraft, close() }>
 *
 * CLI:
 *   node scripts/preview.js [--port N] [--include-draft] [--host H]
 *   npm run preview
 *   npm run preview:draft
 *
 * 设计要点:
 *   - 监听 127.0.0.1 默认,仅 --host 0.0.0.0 显式开启 LAN 暴露
 *   - Node 内置 + ws@8 唯一第三方依赖(peerDependenciesMeta 可选 bufferutil / utf-8-validate 不装)
 *   - 路由:
 *       /                          → index.html
 *       /posts/<slug>/             → 优先 index.md (走 buildArticlePageFromMd),否则 index.html
 *       /posts/<slug>/index.html   → 301 到 /posts/<slug>/
 *       /archive/ /tags/ /series/ /search/ /assets/ /feeds/ /sitemap.xml /404.html → 静态
 *   - WS 端点 /__ws:广播 {type:"reload", file:"<相对 rootDir 路径>"}
 *   - 文件监听 fs.watch(rootDir,{recursive:true}) 过滤 posts/** + scripts/**
 *     100ms 防抖后广播
 *   - HTML 响应注入 <script src="/assets/dev-reload.js" defer></script>
 *     (marker 幂等),仅当 dev-reload.js 存在时注入;assets/dev-reload.js 内置
 *     localhost-only 短路,生产域名 noop。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const { WebSocketServer } = require('ws');

const ROOT_DEFAULT = path.resolve(__dirname, '..');

const DEFAULT_PORT = 4173;
const DEFAULT_HOST = '127.0.0.1';
const WS_PATH = '/__ws';

const POSTS_RE = /^\/posts\/([^/]+)\/?$/;
const POSTS_INDEX_HTML_RE = /^\/posts\/([^/]+)\/index\.html$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
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

const DEV_RELOAD_SRC = '/assets/dev-reload.js';
const DEV_RELOAD_MARKER = '<!-- preview:dev-reload -->';
const DEV_RELOAD_TAG =
  `${DEV_RELOAD_MARKER}<script src="${DEV_RELOAD_SRC}" defer></script>`;

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

function injectDevReload(html) {
  if (!html || typeof html !== 'string') return html;
  if (html.includes(DEV_RELOAD_MARKER)) return html;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return html + DEV_RELOAD_TAG;
  return html.slice(0, idx) + DEV_RELOAD_TAG + html.slice(idx);
}

async function renderPostPageMd({ slug, rootDir, allPosts, includeDraft, bi }) {
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
  return injectDevReload(html);
}

function sendFile({ fullPath, res }) {
  return new Promise((resolve) => {
    const ext = path.extname(fullPath).toLowerCase();
    if (ext === '.md') {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('403 raw .md forbidden — preview renders .md to HTML');
      return resolve();
    }
    res.setHeader('content-type', mimeFor(fullPath));
    res.setHeader('cache-control', 'no-store');
    if (ext === '.html' || ext === '.htm') {
      fs.readFile(fullPath, 'utf8', (err, data) => {
        if (err) {
          res.writeHead(500); res.end('read error'); return resolve();
        }
        res.end(injectDevReload(data));
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

async function serveStatic({ rootDir, urlPath, res }) {
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
        await sendFile({ fullPath: indexPath, res });
        return;
      }
    } catch (_) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 not found');
      return;
    }
  } else if (stat.isFile()) {
    await sendFile({ fullPath, res });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404 not found');
}

async function handleHttpRequest({ req, res, rootDir, allPosts, includeDraft, bi }) {
  const parsed = url.parse(req.url);
  let pathname = parsed.pathname || '/';
  if (pathname.includes('\0')) {
    res.writeHead(400); res.end('bad path'); return;
  }

  if (pathname === '/') pathname = '/index.html';

  const postDirMatch = pathname.match(POSTS_RE);
  if (postDirMatch) {
    const slug = postDirMatch[1];
    const mdPath = path.join(rootDir, 'posts', slug, 'index.md');
    if (fs.existsSync(mdPath)) {
      try {
        const html = await renderPostPageMd({
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
      await sendFile({ fullPath: htmlPath, res });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 not found');
    return;
  }

  const postIdxMatch = pathname.match(POSTS_INDEX_HTML_RE);
  if (postIdxMatch) {
    const slug = postIdxMatch[1];
    res.writeHead(301, { location: `/posts/${slug}/` });
    res.end();
    return;
  }

  await serveStatic({ rootDir, urlPath: pathname, res });
}

function createRequestHandler(opts) {
  const { rootDir, allPosts, includeDraft, bi } = opts;
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
  const out = { port: null, host: null, includeDraft: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port' || a === '-p') {
      out.port = Number(argv[++i]);
    } else if (a === '--host' || a === '-H') {
      out.host = String(argv[++i]);
    } else if (a === '--include-draft') {
      out.includeDraft = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  if (out.port == null || !Number.isFinite(out.port) || out.port <= 0) {
    const envPort = Number(process.env.PORT);
    if (Number.isFinite(envPort) && envPort > 0) out.port = envPort;
  }
  if (out.port == null) out.port = DEFAULT_PORT;
  if (out.host == null) out.host = process.env.HOST || DEFAULT_HOST;
  if (!out.includeDraft) {
    out.includeDraft = process.env.INCLUDE_DRAFT === '1'
      || process.env.INCLUDE_DRAFT === 'true';
  }
  return out;
}

function showHelp() {
  process.stdout.write(
`Usage: node scripts/preview.js [--port N] [--include-draft] [--host H]

Options:
  --port, -p       TCP port (default: env PORT or 4173)
  --host, -H       Listen host (default: 127.0.0.1; use 0.0.0.0 for LAN)
  --include-draft  Include draft:true posts (default: env INCLUDE_DRAFT=1)
  --help, -h       Show this help

Examples:
  npm run preview
  npm run preview -- --port 9090
  npm run preview -- --host 0.0.0.0
  npm run preview -- --include-draft
  INCLUDE_DRAFT=1 HOST=0.0.0.0 PORT=9000 npm run preview
`);
}

function shouldBroadcastFile(relPosix) {
  if (!relPosix) return false;
  if (relPosix.startsWith('posts/')) return true;
  if (relPosix.startsWith('scripts/')) return true;
  return false;
}

function startPreview(opts = {}) {
  const port = Number.isFinite(opts.port) && opts.port >= 0
    ? opts.port : DEFAULT_PORT;
  const host = opts.host || DEFAULT_HOST;
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
  });

  const httpServer = http.createServer(onRequest);
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  const debounceMap = new Map();
  const DEBOUNCE_MS = 100;

  const watcher = fs.watch(rootDir, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;
    const f = String(filename).split(path.sep).join('/');
    if (!shouldBroadcastFile(f)) return;

    if (debounceMap.has(f)) clearTimeout(debounceMap.get(f));
    debounceMap.set(f, setTimeout(() => {
      debounceMap.delete(f);
      const payload = JSON.stringify({ type: 'reload', file: f });
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          try { client.send(payload); } catch (_) {}
        }
      }
    }, DEBOUNCE_MS));
  });

  wss.on('connection', (ws) => {
    try {
      ws.send(JSON.stringify({ type: 'hello', file: 'preview-ws' }));
    } catch (_) {}
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
        `  ws:    ${WS_PATH}\n` +
        `  root:  ${rootDir}\n`
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
    host: args.host,
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
  showHelp,
  _internals: {
    injectDevReload,
    safeJoin,
    mimeFor,
    renderPostPageMd,
    shouldBroadcastFile,
    DEV_RELOAD_TAG,
    WS_PATH,
  },
};

if (require.main === module) {
  runCli();
}
