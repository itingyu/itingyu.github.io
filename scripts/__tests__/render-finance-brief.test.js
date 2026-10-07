'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseFrontmatter,
  renderMarkdown,
  renderPage,
  slugifyTagForFinance,
} = require('../render-finance-brief.js');

// =====================================================================
// §1 parseFrontmatter 单元测试 — YAML 子集
// =====================================================================

test('parseFrontmatter: 检测到 frontmatter 时返回 data 与 endLine', () => {
  const md = `---
title: "T"
date: 2026-09-28
---

# 正文
`;
  const { data, endLine } = parseFrontmatter(md);
  assert.ok(data, '应返回非 null data');
  assert.equal(data.title, 'T');
  // date 是 2026-09-28,数字字面量不能有前导 0 → 用字符串比
  assert.equal(String(data.date), '2026-09-28');
  assert.equal(typeof endLine, 'number');
  assert.ok(endLine >= 1);
});

test('parseFrontmatter: 没有 frontmatter 时返回 null', () => {
  const md = `# 标题

正文段落`;
  const { data, endLine } = parseFrontmatter(md);
  assert.equal(data, null);
  assert.equal(endLine, 0);
});

test('parseFrontmatter: inline 数组 — tags: ["a", "b"]', () => {
  const md = `---
tags: ["finance", "daily-brief", "a-share"]
---
正文`;
  const { data } = parseFrontmatter(md);
  assert.deepEqual(data.tags, ['finance', 'daily-brief', 'a-share']);
});

test('parseFrontmatter: 布尔与数字 — draft: false / date: 2026-09-28', () => {
  const md = `---
draft: false
date: 2026-09-28
---
`;
  const { data } = parseFrontmatter(md);
  assert.equal(data.draft, false);
  assert.equal(String(data.date), '2026-09-28');
});

test('parseFrontmatter: 引号字符串 — title: "每日金融简报 · 2026-09-28"', () => {
  const md = `---
title: "每日金融简报 · 2026-09-28"
---
`;
  const { data } = parseFrontmatter(md);
  assert.equal(data.title, '每日金融简报 · 2026-09-28');
});

test('parseFrontmatter: 单引号字符串 — title: \'金融简报\'', () => {
  const md = `---
title: '金融简报'
---
`;
  const { data } = parseFrontmatter(md);
  assert.equal(data.title, '金融简报');
});

test('parseFrontmatter: 引号字符串中允许中文 / 冒号 / 斜杠', () => {
  const md = `---
description: "2026-09-28 交易日简报：中美八点共识 / 美债 30Y 突破 5.5% / AI 与半导体主线"
---
`;
  const { data } = parseFrontmatter(md);
  assert.equal(
    data.description,
    '2026-09-28 交易日简报：中美八点共识 / 美债 30Y 突破 5.5% / AI 与半导体主线',
  );
});

test('parseFrontmatter: 闭合 fence 缺失 → 视为无 frontmatter', () => {
  const md = `---
title: "未闭合"
# 这是正文,不应被吞掉
`;
  const { data } = parseFrontmatter(md);
  assert.equal(data, null, '闭合 fence 缺失应回退为无 frontmatter');
});

test('parseFrontmatter: 第一行不是 --- 时返回 null', () => {
  const md = `> 引用

---
title: "被错认的开头"
---
`;
  const { data } = parseFrontmatter(md);
  assert.equal(data, null, '首行非 --- 不应触发 frontmatter 解析');
});

test('parseFrontmatter: inline 数组内单引号包裹,逗号不拆', () => {
  const md = `---
tags: ["hello, world", "a-share"]
---
`;
  const { data } = parseFrontmatter(md);
  assert.deepEqual(data.tags, ['hello, world', 'a-share']);
});

test('parseFrontmatter: 空 inline 数组 — tags: []', () => {
  const md = `---
tags: []
---
`;
  const { data } = parseFrontmatter(md);
  assert.deepEqual(data.tags, []);
});

// =====================================================================
// §2 renderMarkdown 行为 — 带 frontmatter 时剥离 frontmatter
// =====================================================================

const FM_MD = `---
title: "每日金融简报 · 2026-09-28（星期一 · 交易日）"
date: 2026-09-28
tags: ["finance", "daily-brief", "a-share"]
description: "2026-09-28 交易日简报：中美八点共识 / 美债 30Y 突破 5.5% / AI 与半导体主线 / 短线选股 4 只"
draft: false
---

## 中美八点共识

凌晨 **新华社** 发布 *八点共识*,美元 / 离岸人民币闻讯下挫。

| 代码 | 名称 | 收盘 | 涨跌 |
| --- | --- | --- | --- |
| 600519 | 贵州茅台 | 1620.00 | +1.23% |

> 风险提示:以上不构成投资建议。
`;

test('renderMarkdown: 带 frontmatter 时剥离 frontmatter,正文不含 <p>title:</p> 残留', () => {
  const { title, body, excerpt, frontmatter } = renderMarkdown(FM_MD);
  assert.equal(title, '每日金融简报 · 2026-09-28（星期一 · 交易日）',
    '应取 frontmatter.title 作为最终 title');
  assert.ok(!/title:\s/.test(body), '正文不应有 frontmatter 残留 key');
  assert.ok(!/<p>\s*title:/.test(body), '正文不应把 title 行渲成 <p>');
  assert.ok(!/<p>\s*date:/.test(body), '正文不应把 date 行渲成 <p>');
  assert.ok(!/<p>\s*tags:/.test(body), '正文不应把 tags 行渲成 <p>');
  assert.ok(!/<p>\s*description:/.test(body), '正文不应把 description 行渲成 <p>');
  assert.ok(!/<hr>\s*<p>title:/.test(body), '不应有 <hr><p>title: 视觉噪声');
  // frontmatter 字段正确
  assert.equal(frontmatter.title, '每日金融简报 · 2026-09-28（星期一 · 交易日）');
  assert.equal(String(frontmatter.date), '2026-09-28');
  assert.equal(frontmatter.draft, false);
  assert.deepEqual(frontmatter.tags, ['finance', 'daily-brief', 'a-share']);
  // 正文正常渲染
  assert.ok(/<h2>中美八点共识<\/h2>/.test(body), '正文 H2 应正常渲染');
  assert.ok(/<strong>新华社<\/strong>/.test(body), '粗体应正常');
  assert.ok(/<table class="brief-table">/.test(body), '表格应正常渲染');
  assert.ok(/<span class="ticker">600519<\/span>/.test(body), 'ticker 染色应正常');
});

test('renderMarkdown: 不带 frontmatter 时回退到 H1 + 正文首段 excerpt(回归 9/27 简报)', () => {
  // 模拟 9/27 简报风格:无 frontmatter,首行 H1,首段正文
  const md = `# 每日金融简报 · 2026-09-27(星期日 · 休市)

中秋假期,A 股休市,但外围市场仍波动。

## 港股

恒指收 17890.12,下跌 -0.45%。
`;
  const { title, body, excerpt, frontmatter } = renderMarkdown(md);
  assert.equal(title, '每日金融简报 · 2026-09-27(星期日 · 休市)',
    '应从首行 H1 提取 title');
  assert.ok(/<h2>港股<\/h2>/.test(body), 'H2 正常');
  assert.ok(!/<p>title:/.test(body), '无 frontmatter 时也不应有残留(本来就无)');
  assert.ok(excerpt && excerpt.includes('中秋'),
    'excerpt 应回退到正文首段');
  // frontmatter 应为空对象(便于调用方判断「缺省」)
  assert.deepEqual(frontmatter, {});
});

test('renderMarkdown: 带 frontmatter + 正文有 H1 时,frontmatter.title 不应覆盖 H1', () => {
  const md = `---
title: "frontmatter 标题"
---

# H1 标题

正文段落。
`;
  const { title } = renderMarkdown(md);
  assert.equal(title, 'H1 标题', '正文 H1 优先于 frontmatter.title');
});

test('renderMarkdown: 带 frontmatter 但正文无 H1 时,使用 frontmatter.title', () => {
  const md = `---
title: "仅有 frontmatter 标题"
---

正文段落,没有 H1。
`;
  const { title } = renderMarkdown(md);
  assert.equal(title, '仅有 frontmatter 标题');
});

// =====================================================================
// §3 renderPage — frontmatter 透传到 meta description / article:tag
// =====================================================================

test('renderPage: frontmatter.description 透传到 meta name="description"', () => {
  const html = renderPage({
    title: 'T',
    slug: 'finance-2026-09-28',
    date: '2026-09-28',
    excerpt: 'fallback excerpt',
    body: '<p>body</p>',
    tags: ['finance', 'daily-brief'],
  });
  // meta description 取 excerpt 字段(由 main() 注入 frontmatter.description)
  const m = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/);
  assert.ok(m, '应存在 <meta name="description">');
  // 本测试只验 renderPage 行为:excerpt 被原样写入 meta description
  assert.equal(m[1], 'fallback excerpt');
});

test('renderPage: frontmatter.tags 全部 → 多条 <meta property="article:tag">', () => {
  const html = renderPage({
    title: 'T',
    slug: 'finance-2026-09-28',
    date: '2026-09-28',
    excerpt: 'e',
    body: '<p>body</p>',
    tags: ['finance', 'daily-brief', 'a-share'],
  });
  // 每个 tag 一行
  assert.ok(/<meta\s+property=["']article:tag["']\s+content=["']finance["']/.test(html),
    '应渲染 finance meta tag');
  assert.ok(/<meta\s+property=["']article:tag["']\s+content=["']daily-brief["']/.test(html),
    '应渲染 daily-brief meta tag');
  assert.ok(/<meta\s+property=["']article:tag["']\s+content=["']a-share["']/.test(html),
    '应渲染 a-share meta tag');
  // 校验:总 article:tag 数量等于传入 tags 长度(3 条)
  const tagMatches = html.match(/<meta\s+property=["']article:tag["']/g) || [];
  assert.equal(tagMatches.length, 3, 'article:tag 数量应等于 frontmatter.tags 长度');
});

test('renderPage: tags 缺省 → 回退单 tag「金融」(向后兼容)', () => {
  const html = renderPage({
    title: 'T',
    slug: 'finance-2026-09-27',
    date: '2026-09-27',
    excerpt: 'e',
    body: '<p>body</p>',
    tags: null,
  });
  // 应有 1 条 article:tag = 金融
  const tagMatches = html.match(/<meta\s+property=["']article:tag["']\s+content=["']([^"']*)["']/g) || [];
  assert.equal(tagMatches.length, 1);
  assert.ok(tagMatches[0].includes('金融'));
});

test('renderPage: og:description 与 JSON-LD description 取 excerpt(frontmatter.description)', () => {
  const fmDesc = '2026-09-28 交易日简报：中美八点共识 / 美债 30Y 突破 5.5%';
  const html = renderPage({
    title: 'T',
    slug: 'finance-2026-09-28',
    date: '2026-09-28',
    excerpt: fmDesc,
    body: '<p>body</p>',
    tags: ['finance'],
  });
  assert.ok(/<meta\s+property=["']og:description["']\s+content=["'][^"']*中美八点共识[^"']*["']/.test(html),
    'og:description 应含 frontmatter.description 内容');
  assert.ok(/"description"\s*:\s*"2026-09-28 交易日简报/.test(html),
    'JSON-LD description 应含 frontmatter.description 内容');
});

test('renderPage: 主 chip 用 primary tag,href/data-tag 用 slugs', () => {
  const html = renderPage({
    title: 'T',
    slug: 'finance-2026-09-28',
    date: '2026-09-28',
    excerpt: 'e',
    body: '<p>body</p>',
    tags: ['金融', 'a-share'],
  });
  // 第一个 chip 应该是 金融 → finance slug
  assert.ok(/<a\s+class="chip"\s+href="\/tags\/finance\/"\s+data-tag="finance">金融<\/a>/.test(html),
    '主 chip 应是 金融 → /tags/finance/,data-tag=finance');
  // post-excerpt 应是 excerpt
  assert.ok(/<p class="post-excerpt">e<\/p>/.test(html));
});

// =====================================================================
// §4 端到端 — main() 行为通过解析整篇 md 验证
// =====================================================================

test('e2e: 带 frontmatter 的 md → excerpt/description 用 frontmatter.description', () => {
  // main() 里 excerpt 优先级:args.excerpt || fm.description || mdExcerpt || title
  // 模拟 main() 内部对 renderMarkdown 返回值的处理
  const fmDesc = '2026-09-28 交易日简报：中美八点共识';
  const md = `---
description: "${fmDesc}"
---

## 段一
正文段落。
`;
  const { excerpt, frontmatter } = renderMarkdown(md);
  const finalExcerpt = frontmatter.description || excerpt || 'fallback';
  assert.equal(finalExcerpt, fmDesc,
    '带 frontmatter.description 时,excerpt 应直接取该字段');
});

test('e2e: draft: true 的 frontmatter → renderMarkdown 仍解析,但 main() 会跳过(由调用方判断)', () => {
  const md = `---
draft: true
---

## 草稿

本条不应发布。
`;
  const { frontmatter } = renderMarkdown(md);
  assert.equal(frontmatter.draft, true,
    'renderMarkdown 应正确解析 draft: true;main() 据此跳过生成');
});

test('e2e: frontmatter 没闭合 → renderMarkdown 当作无 frontmatter,继续渲染正文', () => {
  const md = `---
draft: true

## 正文标题
`;
  const { title, body, frontmatter } = renderMarkdown(md);
  // 闭合 fence 缺失 → parseFrontmatter 返回 null → fm = {}
  assert.deepEqual(frontmatter, {});
  // 正文正常渲染
  assert.ok(/<h2>正文标题<\/h2>/.test(body));
});

// =====================================================================
// §5 slugifyTagForFinance — 与 build-index.js:slugifyTag 语义对齐
// =====================================================================

test('slugifyTagForFinance: 「金融」→ finance(历史兼容)', () => {
  assert.equal(slugifyTagForFinance('金融'), 'finance');
  assert.equal(slugifyTagForFinance('Finance'), 'finance');
  assert.equal(slugifyTagForFinance('FINANCE'), 'finance');
});

test('slugifyTagForFinance: 英文 tag', () => {
  assert.equal(slugifyTagForFinance('daily-brief'), 'daily-brief');
  assert.equal(slugifyTagForFinance('A-Share'), 'a-share');
});

test('slugifyTagForFinance: 含特殊字符 → 清洗', () => {
  assert.equal(slugifyTagForFinance('Daily Brief!'), 'daily-brief');
  assert.equal(slugifyTagForFinance('  --hello--  '), 'hello');
  assert.equal(slugifyTagForFinance('a / b'), 'a-b');
});

test('slugifyTagForFinance: 纯符号 → tag 兜底', () => {
  assert.equal(slugifyTagForFinance('!!!'), 'tag');
});