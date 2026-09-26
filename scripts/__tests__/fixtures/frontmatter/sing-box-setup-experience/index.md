---
# scripts/validate-frontmatter.js 测试 fixture:
# cover 路径 posts/sing-box-setup-experience/cover.svg 在 M6.5 落地后才会存在;
# 当前仅校验 frontmatter 契约(必填 / 类型 / typo),cover 不存在 = warn 级。
title: sing-box 代理搭建经验：从 0 到稳定上网
slug: sing-box-setup-experience
date: 2026-09-26
description: 从机场订阅到 zashboard dashboard，完整记录 sing-box 1.14 代理配置、DNS fakeip、订阅自动更新、CORS 反代等实战经验。
tags: [sing-box, proxy, linux, network]
cover: posts/sing-box-setup-experience/cover.svg
draft: false
author: itingyu
---

<!-- build:cover -->

从机场订阅 → sing-box 1.14 稳定运行 → zashboard 可视化 → chromium 走代理，本文记录全过程踩过的坑。

<!-- build:related -->