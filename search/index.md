---
layout: page
title: 搜索
permalink: /search/
description: 在所有文章中搜索关键词。
---
<h1>搜索</h1>
<p class="search-hint">输入关键词搜索标题、标签、描述与正文。支持空格分隔多个关键词。</p>

<div class="search-box">
  <input type="search" data-search-input
         placeholder="试试搜索:金融 / 算法 / 厨房..."
         aria-label="搜索关键词"
         autocomplete="off" autocorrect="off" autocapitalize="off"
         spellcheck="false" />
  <p class="search-status" data-search-status aria-live="polite">正在加载索引…</p>
</div>

<ul class="search-results" data-search-results aria-label="搜索结果"></ul>

<script defer src="/assets/search.js"></script>
