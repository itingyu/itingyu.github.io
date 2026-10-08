'use strict';

// scripts/__tests__/preview-ws.test.js
// M7.1 · preview.js + WebSocket 热重载的契约测试矩阵
// 覆盖(DoD 要求 ≥ 4 条):
//   1. WS 握手 /hello 消息
//   2. WS 断开 + 重连(服务器侧不崩)
//   3. fs.watch 触发 {type:"reload", file:"..."} 广播
//   4. --include-draft 过滤(draft:true 默认 404,--include-draft 后 200)
//
// 设计:
//   - 每个 test 用独立 tmpDir(rootDir)避免串扰;tmpDir 下放精简 posts/<slug>/index.md
//   - 端口用 0 让 OS 分配空闲端口,startPreview 返回的 port 为实际端口
//   - WebSocket 客户端用 node 内置 WebSocket(node ≥ 22);否则回退到 ws@8 client

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const WebSocketImpl = (typeof WebSocket !== 'undefined')
  ? WebSocket
  : require('ws');

const { startPreview } = require('../preview.js');

const SAMPLE_MD = (overrides = {}) => {
  const fm = Object.assign({
    title: 'preview ws 测试',
    date: '2026-01-15',
    tags: '[note]',
    description: 'preview-ws 测试 fixture',
    draft: 'false',
    author: 'itingyu',
  }, overrides);
  return `---
title: ${fm.title}
date: ${fm.date}
tags: ${fm.tags}
description: ${fm.description}
draft: ${fm.draft}
author: ${fm.author}
---

## 正文

preview-ws 测试正文段落。
`;
};

const REPO_SCRIPTS = path.resolve(__dirname, '..');

function makeFixtureRoot({ withDraft = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-ws-'));
  fs.symlinkSync(REPO_SCRIPTS, path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'posts', 'sample'), { recursive: true });
  fs.writeFileSync(path.join(root, 'posts', 'sample', 'index.md'), SAMPLE_MD());
  if (withDraft) {
    fs.mkdirSync(path.join(root, 'posts', 'drafty'), { recursive: true });
    fs.writeFileSync(path.join(root, 'posts', 'drafty', 'index.md'), SAMPLE_MD({
      title: '草稿',
      draft: 'true',
      description: '未发布的草稿',
    }));
  }
  return root;
}

async function startPreviewOn(rootDir, opts = {}) {
  return startPreview(Object.assign(
    { rootDir, port: 0, host: '127.0.0.1' },
    opts,
  ));
}

function httpGet(host, port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host, port, path: urlPath, method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function openWs(host, port, wsPath = '/__ws') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(`ws://${host}:${port}${wsPath}`);
    const messages = [];
    let resolved = false;
    ws.addEventListener('message', (ev) => {
      let data = typeof ev.data === 'string' ? ev.data : '';
      try { messages.push(JSON.parse(data)); } catch (_) { messages.push(data); }
    });
    ws.addEventListener('error', (ev) => {
      if (!resolved) { resolved = true; reject(new Error('ws error')); }
    });
    ws.addEventListener('open', () => {
      resolved = true;
      resolve({ ws, messages });
    });
    setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error('ws open timeout')); }
    }, 3000);
  });
}

function waitForMessage(messages, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(
          `waitForMessage timeout; saw=${JSON.stringify(messages)}`,
        ));
      }
      setTimeout(tick, 30);
    };
    tick();
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 1. WS 握手 /hello 消息 ----------
test('preview-ws: WS 客户端连接后收到 {type:"hello"} 消息', async () => {
  const root = makeFixtureRoot();
  const server = await startPreviewOn(root);
  try {
    const { messages, ws } = await openWs(server.host, server.port);
    const hello = await waitForMessage(messages, (m) => m && m.type === 'hello');
    assert.equal(hello.type, 'hello');
    assert.equal(hello.file, 'preview-ws');
    ws.close();
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 2. WS 断开 → 重连成功(server 不崩) ----------
test('preview-ws: WS 客户端断开后,新连接仍能握手成功', async () => {
  const root = makeFixtureRoot();
  const server = await startPreviewOn(root);
  try {
    const first = await openWs(server.host, server.port);
    await waitForMessage(first.messages, (m) => m && m.type === 'hello');
    first.ws.close();
    await delay(150);
    const second = await openWs(server.host, server.port);
    const hello2 = await waitForMessage(second.messages, (m) => m && m.type === 'hello');
    assert.equal(hello2.type, 'hello');
    second.ws.close();
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 3. fs.watch 触发 {type:"reload", file:"..."} 广播 ----------
test('preview-ws: 修改 posts/<slug>/index.md 后,客户端收到 reload 广播', async () => {
  const root = makeFixtureRoot();
  const server = await startPreviewOn(root);
  let ws;
  try {
    const conn = await openWs(server.host, server.port);
    ws = conn.ws;
    await waitForMessage(conn.messages, (m) => m && m.type === 'hello');
    const mdPath = path.join(root, 'posts', 'sample', 'index.md');
    fs.writeFileSync(mdPath, SAMPLE_MD({ title: 'preview ws 测试 v2' }));
    const msg = await waitForMessage(
      conn.messages,
      (m) => m && m.type === 'reload' && m.file && m.file.includes('sample/index.md'),
      5000,
    );
    assert.equal(msg.type, 'reload');
    assert.match(msg.file, /^posts\/sample\/index\.md$/);
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 4. --include-draft 过滤 ----------
test('preview-ws: draft:true 默认 404,--include-draft 后 200', async () => {
  const root = makeFixtureRoot({ withDraft: true });
  const server = await startPreviewOn(root, { includeDraft: false });
  try {
    const r1 = await httpGet(server.host, server.port, '/posts/drafty/');
    assert.equal(r1.status, 404, `默认应 404,实得 status=${r1.status}`);
    const r2 = await httpGet(server.host, server.port, '/posts/sample/');
    assert.equal(r2.status, 200, `普通文章应 200,实得 status=${r2.status}`);
  } finally {
    await server.close();
  }

  const server2 = await startPreviewOn(root, { includeDraft: true });
  try {
    const r3 = await httpGet(server2.host, server2.port, '/posts/drafty/');
    assert.equal(r3.status, 200, `开启 --include-draft 应 200,实得 status=${r3.status}`);
    assert.match(r3.body, /草稿/, '页面应包含草稿标题');
  } finally {
    await server2.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- 5. (附赠) / 路由 + /posts/<slug>/index.html → 301 ----------
test('preview-ws: /posts/<slug>/index.html 标准化 301 到 /posts/<slug>/', async () => {
  const root = makeFixtureRoot();
  const server = await startPreviewOn(root);
  try {
    const r = await httpGet(server.host, server.port, '/posts/sample/index.html');
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, '/posts/sample/');
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
