---
# scripts/validate-frontmatter.js 测试 fixture:
# cover 路径 posts/welcome/cover.svg 在 M6.5 落地后才会存在;
# 当前仅校验 frontmatter 契约(必填 / 类型 / typo),cover 不存在 = warn 级。
title: 欢迎来到新博客
slug: welcome
date: 2026-09-26
description: 原 itingyu.github.io 已清空，从这里重新搭建。这是第一篇占位文章，用来验证文章页模板、标签与归档。
tags: [note, life]
cover: posts/welcome/cover.svg
draft: false
author: itingyu
---

<!-- build:cover -->

这是新博客的开篇。第一篇占位文章。

<!-- build:related -->