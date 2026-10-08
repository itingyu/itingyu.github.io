---
layout: post
title: "sing-box 代理搭建经验：从 0 到稳定上网"
date: 2026-09-26 12:00:00 +0800
tags: [sing-box, proxy, linux, network]
excerpt: "从机场订阅到 zashboard dashboard,完整记录 sing-box 1.14 代理配置、DNS fakeip、订阅自动更新、CORS 反代等实战经验。"
series: 其他
column: 其他
pinned: false
cover: null
draft: false
---

从机场订阅 → sing-box 1.14 稳定运行 → zashboard 可视化 → chromium 走代理，本文记录全过程踩过的坑。配置目标是：国内域名走直连、国外域名走最低延迟节点、节点失效自动切换、浏览器一键切换代理模式。

## 最终架构

```
┌──────────────────────────────────────────────────────────────┐
│ Chromium (cb-proxy)                                          │
│   --proxy-server=http://127.0.0.1:2080                       │
│   --proxy-bypass-list=loopback + 私网 + 本机端口                │
└──────────────────────────────────────────────────────────────┘
                            ↓ HTTP CONNECT
┌──────────────────────────────────────────────────────────────┐
│ sing-box 1.14.2 (2080 mixed-in)                              │
│   路由规则: geosite-cn/geoip-cn → direct                      │
│             其余 → 🚀节点选择 (selector)                        │
│             🚀节点选择.default → ♻️自动选择 (urltest)            │
│             DNS fakeip (198.18.0.0/15)                       │
└──────────────────────────────────────────────────────────────┘
                            ↓ 出站
┌──────────────────────────────────────────────────────────────┐
│ 机场订阅 (Clash YAML)  →  sb-update.py (每日 04:00 systemd)   │
│ 解析出 71 个节点 (vless×52 + hysteria2×17 + ss×2)              │
└──────────────────────────────────────────────────────────────┘

辅助：
  nginx 8090 (dashboard) + 9090 (clash-api 反代, 加 CORS 头)
  zashboard (sing-box 专用前端)
  /usr/local/bin/cb-proxy (chromium 启动包装 + 自检 + bypass-list)
```

## 基础配置

sing-box 配置文件 `/etc/sing-box/config.json` 核心片段：

```json
{
  "log": { "level": "warn" },
  "experimental": {
    "cache_file": { "enabled": true, "store_fakeip": true },
    "clash_api": {
      "external_controller": "127.0.0.1:9091",
      "default_mode": "rule"
    }
  },
  "inbounds": [{
    "type": "mixed",
    "listen": "127.0.0.1",
    "listen_port": 2080,
    "sniff": true,
    "domain_strategy": "prefer_ipv4"
  }],
  "outbounds": [
    { "type": "direct", "tag": "direct" },
    { "type": "block",   "tag": "block" },
    { "type": "selector", "tag": "🚀节点选择",
      "outbounds": [/* 30+ 节点 */, "♻️自动选择"],
      "default": "♻️自动选择" },
    { "type": "urltest", "tag": "♻️自动选择",
      "outbounds": [/* 全部 71 节点 */],
      "url": "http://cp.cloudflare.com/generate_204",
      "interval": "30m",
      "tolerance": 500 }
  ],
  "route": {
    "final": "🚀节点选择",
    "rules": [
      { "action": "sniff" },
      { "domain_suffix": [...本地域名...], "outbound": "direct" },
      { "rule_set": ["geoip-cn", "geosite-cn"], "outbound": "direct" }
    ],
    "rule_set": [
      { "type": "local", "tag": "geosite-cn",
        "format": "binary", "path": "/var/lib/sing-box/geosite-cn.srs" },
      { "type": "local", "tag": "geoip-cn",
        "format": "binary", "path": "/var/lib/sing-box/geoip-cn.srs" }
    ]
  },
  "dns": {
    "servers": [
      { "type": "udp", "tag": "ali-dns", "server": "223.5.5.5" },
      { "type": "udp", "tag": "dnspod-dns", "server": "119.29.29.8" },
      { "tag": "fakeip-global", "type": "fakeip",
        "inet4_range": "198.18.0.0/15" }
    ],
    "rules": [{ "rule_set": "geosite-cn", "server": "ali-dns" }],
    "final": "fakeip-global",
    "strategy": "prefer_ipv4",
    "independent_cache": true
  }
}
```

### 关键设计

- **DNS fakeip**：国外域名返回 `198.18.0.0/15` 段 IP，让 sing-box 出口时再发起真实 DNS 请求，绕过 DNS 污染
- **rule_set 路由**：geosite-cn + geoip-cn 命中即 direct，否则走 🚀节点选择
- **urltest 间隔 30m / tolerance 500**：避免探测频率过高触发机场限流
- **log level = warn**：减少磁盘 IO

## 订阅自动更新

机场订阅 URL 返回 Clash YAML，需要解析成 sing-box outbounds。`/usr/local/bin/sb-update.py` 完成三件事：

1. 解析 Clash proxies → sing-box vless/hysteria2/ss 配置（保留 `reality` / `utls` / `ws-opts`）
2. 合并到当前 cfg，保留 selector/urltest 的 default 引用
3. 语法检查 + 写候选文件 → apply 模式覆盖生产

由 systemd timer 每日 04:00 自动跑：

```ini
# /etc/systemd/system/sb-update.timer
[Timer]
OnCalendar=*-*-* 04:00:00
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
```

## Dashboard

Clash 系前端我用过两个：

- **metacubexd**（gh-pages）：UI 漂亮，但 _nuxt chunk 经常 404，要写 nginx 反代 jsdelivr 兜底
- **zashboard**（gh-pages）：sing-box 专用，结构简单，单个 index.html + 12 个 assets/* 即可

最后选了 **zashboard**。部署到 nginx：

```nginx
server {
  listen 8090 default_server;
  root /var/www/dashboard;
  index index.html;

  location / { try_files $uri $uri/ /index.html; }

  # clash-api 反代（CORS 头让浏览器能用 8090/api）
  location /api/ {
    proxy_pass http://127.0.0.1:9091/;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "*" always;
    if ($request_method = OPTIONS) { return 204; }
  }

  # sing-box 不支持的端点（v2ray 专属功能）
  location = /api/upgrade {
    default_type application/json;
    return 200 '{}';
  }

  # SSE 长连接（流量图 + 日志）
  location ~ ^/api/(traffic|logs)$ {
    proxy_pass http://127.0.0.1:9091/$1;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }
}
```

## Chromium 启动包装

Chromium 150 默认启用 DoH/ECH/AsyncDns，会绕过系统 DNS 直接走 DoH 拿污染 IP —— 即使配置了系统代理也连不上 Google。包装脚本必须禁用：

```bash
# /usr/local/bin/cb-proxy
#!/bin/bash
exec /usr/bin/chromium \
  --proxy-server="http://127.0.0.1:2080" \
  --proxy-bypass-list="<-loopback>,127.0.0.0/8,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.local,.lan" \
  --disable-features=AsyncDns,DnsOverHttps,EncryptedClientHello \
  --new-window --no-first-run --no-default-browser-check \
  --disable-session-crashed-bubble \
  --disable-features=InfiniteSessionRestore \
  "$@"
```

关键参数：

- `--disable-features=DnsOverHttps,EncryptedClientHello`：禁止 Chromium 自带 DNS / SNI 加密
- `--proxy-bypass-list=<-loopback>,...`：loopback / 私网 / 本地服务（2080/8090/9090）都跳过代理
- `--disable-features=InfiniteSessionRestore`：启动不恢复上次 tab

## 代理挂了自动降级

cb-proxy 加了健康检查 —— 如果 `2080` 不通就启动直连模式：

```bash
if curl -sx http://127.0.0.1:2080 --max-time 3 \
       -o /dev/null https://www.google.com; then
  # 代理活：走代理
  exec chromium --proxy-server=http://127.0.0.1:2080 ...
else
  # 代理挂：终端警告 + 直连模式（不加 --proxy-server）
  exec chromium ...
fi
```

## CORS 反代

sing-box clash-api 的 GET 请求不发 `Access-Control-Allow-Origin` 头（只有 OPTIONS 预检发），所以浏览器填 `127.0.0.1:9090` 必然 CORS 拒。

两条路：

1. dashboard 后端填 `http://127.0.0.1:8090/api`（同源，最稳）
2. 让 nginx 反代 9090 + 加 CORS 头（让 `127.0.0.1:9090` 也能用）

第二条配置：

```nginx
# sing-box clash-api 改到 9091（避免占 9090）
# /etc/nginx/sites-enabled/dashboard-direct
server {
  listen 9090 default_server;
  location / {
    proxy_pass http://127.0.0.1:9091;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "*" always;
    add_header Access-Control-Expose-Headers "*" always;
    if ($request_method = OPTIONS) { return 204; }
  }
}
```

zashboard 把 backend URL 存在 localStorage，更换 URL 时要 F12 Console 跑：

```js
localStorage.clear(); location.reload();
```

## 排查记录

**YouTube 测速显示"超时"**
真实情况是 sing-box `/delay` 端点返回 503（机场并发限流）。zashboard 看到 503 显示成"超时"。不影响实际代理使用。

**Chromium 直连 google.com 不通**
Chromium 150 默认启用了 DoH（DNS-over-HTTPS）。--disable-features=DnsOverHttps 关掉。

**system proxy 设置后 127.0.0.1:8090 也走代理，HTTP 502**
bypass-list 必须明确包含 loopback + 私网 + 本机服务端口。HTTP 代理协议对 bypass 支持不完善，必须显式列出。

**sing-box clash-api 在 9090 时浏览器访问 502**
nginx `default_server` 接管 9090，反代到 sing-box clash-api (9091) + CORS 头。

**YouTube "测速超时"**
71 个节点并发测，触发机场反爬。sing-box /delay 返回 503 被 zashboard 当成超时。单点测试是正常的（手动 `curl /proxies/<name>/delay`）。

## 常用命令

```bash
# 看 sing-box 状态
systemctl status sing-box
ss -tlnp | grep -E '2080|9091'

# dashboard API
curl http://127.0.0.1:8090/api/proxies | jq '.proxies.🚀节点选择.now'
curl http://127.0.0.1:9090/version

# 看出口 IP
curl -x http://127.0.0.1:2080 https://api.ipify.org

# 手动测单节点延迟
curl "http://127.0.0.1:9090/proxies/$(node_tag | urlencode)/delay?timeout=5000&url=http://cp.cloudflare.com/generate_204"

# 触发订阅更新
sudo /usr/local/bin/sb-update.py --apply

# 启动 chromium 走代理
cb-proxy https://www.google.com

# 切换 dashboard 后端 URL
F12 → localStorage.clear() → 强刷
```

## 经验

- **机场的 urltest 间隔尽量长**：默认 5min 容易触发限流，改 30min + tolerance 500ms 是稳妥配置
- **DNS 用 fakeip 是 sing-box 的核心优势**：不用 fakeip 也能跑，但 DNS 污染频繁时切换节点更慢
- **订阅 URL 提供 `User-Agent: clash-verge/2.0`**：很多机场只认这个 UA
- **避免本地脚本"健康检查"反复触发限流**：检测一次就够，循环探测会被机场风控
- **zashboard 比 metacubexd 简单**：单页 SPA，nginx 配置最少

---

> 说明：本文是基于一次实际配置过程的整理，重点是排查路径与设计取舍，不是完整配置手册。

