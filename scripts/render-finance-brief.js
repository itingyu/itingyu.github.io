#!/usr/bin/env node
/* render-finance-brief.js
 *
 * 把金融小队产出的 Markdown 简报落地为 itingyu.github.io 的一篇博客文章的 v2 源文件
 * (`posts/<slug>/index.md`)。
 *
 * 设计目标(design-v2.md §5.2.6 + §9 M6.4):
 *   - 纯 Node 内置模块(无第三方依赖)。
 *   - 复用 `scripts/markdown.js` 同源:输入 body 必须能被共享渲染器解析
 *     (拒绝 <script>/<style>/javascript: 等安全违规,见 markdown.js),保证 build-index
 *     / preview / 后续静态生成拿到的 body 与本脚本同源。
 *   - 输出结构:头部 YAML frontmatter + raw Markdown body + 两个 v2 marker
 *     (`<!-- build:cover -->` 紧跟 # 标题后第一段正文后;
 *      `<!-- build:related -->` 文末)。
 *   - 装配职责(`renderPage` / `updatePostsIndex` / `updateArchiveIndex`)已移交给
 *     `scripts/build-index.js`,本脚本只产 .md,不写 HTML、不动索引页。
 *   - 不自动 commit / push。完成后打印 git 命令,让人 review。
 *   - 不调 multica CLI —— 这个脚本只吃本地 .md;取附件留给 finance-sync.sh / publish-finance-brief.sh。
 *
 * 用法:
 *   node scripts/render-finance-brief.js \
 *     --input path/to/brief.md \
 *     --date 2026-09-26 \
 *     --slug finance-2026-09-26 \
 *     [--title "金融每日简报 · 2026-09-26"] \
 *     [--excerpt "..."] \
 *     [--cover <name>] \
 *     [--out-dir <dir>] \
 *     [--help]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// M6.1 共享 Markdown 渲染器(M6.4 落地:复用同源,body 必须能被它解析)。
const sharedMarkdown = require('./markdown.js');

const TAG_SLUG = 'finance';
const DEFAULT_AUTHOR = 'itingyu';

const USAGE = `用法:
  node scripts/render-finance-brief.js \\
    --input <markdown-file> \\
    --date <YYYY-MM-DD> \\
    --slug <post-slug> \\
    [--title "<title>"] \\
    [--excerpt "<excerpt>"] \\
    [--cover <name>] \\
    [--out-dir <dir>]

参数:
  --input     金融小队产出的 Markdown 简报(必填)
  --date      发布日期,YYYY-MM-DD(必填)
  --slug      文章 slug,会生成 <slug>/index.md(必填)
  --title     文章标题;缺省取 md 第一行 # 标题
  --excerpt   摘要;缺省取 md 第一段正文
  --cover     封面图文件名(放在 <slug>/ 下,如 cover.svg,可选)
  --out-dir   输出根目录(默认仓根;测试可指 fixtures/)
  --help      输出本帮助

输出:
  <out-dir>/<slug>/index.md
    - 头部 YAML frontmatter(title / date / slug / description / tags / author / [cover] / draft)
    - MD body(原样保留简报正文;拒绝 <script>/<style> 等不安全块)
    - 内置 marker:
        <!-- build:cover -->   紧跟 # 标题后第一段正文后
        <!-- build:related --> 位于文末

注意:
  - 本脚本**不再**生成 index.html;HTML 装配由 build-index.js 完成。
  - 本脚本**不再**追加 posts/index.html / archive/index.html;索引装配归 build-index.js。

示例:
  node scripts/render-finance-brief.js \\
    --input brief-2026-09-26.md \\
    --date 2026-09-26 \\
    --slug finance-2026-09-26
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--input') {
      args.input = argv[++i];
    } else if (a === '--date') {
      args.date = argv[++i];
    } else if (a === '--slug') {
      args.slug = argv[++i];
    } else if (a === '--title') {
      args.title = argv[++i];
    } else if (a === '--excerpt') {
      args.excerpt = argv[++i];
    } else if (a === '--cover') {
      args.cover = argv[++i];
    } else if (a === '--out-dir') {
      args.outDir = argv[++i];
    } else if (a && a.startsWith('--')) {
      throw new Error(`未知参数: ${a}`);
    } else {
      args._.push(a);
    }
  }
  return args;
}

function die(msg) {
  process.stderr.write(`render-finance-brief: ${msg}\n`);
  process.exit(1);
}

function assertDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    die(`--date 必须是 YYYY-MM-DD 形式,得到: ${s}`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) die(`--date 不是合法日期: ${s}`);
  return s;
}

function assertSlug(s) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(s)) {
    die(`--slug 必须是小写字母/数字/短横线,得到: ${s}`);
  }
  return s;
}

/* YAML 双引号字符串转义:backslash + 双引号 + 换行 + 控制字符。 */
function yamlDoubleQuoted(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .replace(/\t/g, ' ');
}

/* 从 markdown 中提取第一条 H1 文本(供缺省 --title 使用)。 */
function extractFirstH1(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const m = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

/* 从 markdown 中提取首段正文(去掉 heading / 空行后的连续行)。
 *
 * 包容首段可以是段落 / 列表项 / 引用 / 表格 / Setext 划线 —— 任取其一,取首段可见文本
 * (剥掉 list 标记 / 引用 `> ` 前缀),作为 excerpt 候选。空输入返回 null。
 */
function extractFirstParagraph(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  // 跳过开头的空行
  while (i < lines.length && lines[i].trim() === '') i++;
  // 跳过首段 heading 块(连续 heading 行,允许 1-6 级 + Setext 划线)
  while (i < lines.length && /^\s{0,3}#{1,6}\s+/.test(lines[i])) {
    i++;
    if (i < lines.length && /^\s{0,3}=+\s*$|^\s{0,3}-+\s*$/.test(lines[i])) i++;
  }
  // 跳过空行
  while (i < lines.length && lines[i].trim() === '') i++;

  // 累积首段:把段落 / 列表项 / 引用 / 表格行的可见文本串起来,直到空行或新一级 block
  const buf = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') break;
    // 遇到下一个 heading / 围栏 / 段落式分隔线即停
    if (
      /^\s{0,3}#{1,6}\s+/.test(line) ||
      /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
      /^\s{0,3}(```+|~~~+)/.test(line)
    ) break;

    let text = line;
    // 列表标记剥离
    text = text.replace(/^\s{0,6}[-*+]\s+/, '');
    text = text.replace(/^\s{0,6}\d+\.\s+/, '');
    // 引用前缀剥离
    text = text.replace(/^\s{0,3}>\s?/, '');
    // 表格 cell 边界 `|` 暂不去掉(更接近原文片段即可,excerpt 不必精确)
    buf.push(text.trim());
    i++;
  }

  const joined = buf.join(' ').replace(/\s+/g, ' ').trim();
  return joined || null;
}

/* 在 body 的"标题后第一段正文后"插入 `<!-- build:cover -->` marker。
 *
 * 规则(design-v2.md §5.2.6):
 *   - 若 body 以 `# H1` 开头,跳过 H1 块,在紧随其后的首段正文段末插入。
 *   - 若 body 无 H1,把 marker 插在首段正文段末。
 *   - 若 body 无任何段落,marker 置于文末与 `<!-- build:related -->` 相邻。
 *
 * 已存在 `<!-- build:cover -->` / `<!-- build:related -->` marker 则不再插入(幂等)。
 */
function insertCoverMarker(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');

  // 找 marker 位置:跳过头部 H1 / Setext 划线 / 空行,在首段正文后插入
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  // 跳过 H1 块(支持多行 heading)
  if (i < lines.length && /^\s{0,3}#\s+/.test(lines[i])) {
    while (i < lines.length && /^\s{0,3}#{1,6}\s+/.test(lines[i])) {
      i++;
      if (i < lines.length && /^\s{0,3}=+\s*$|^\s{0,3}-+\s*$/.test(lines[i])) i++;
    }
  }
  // 跳过空行
  while (i < lines.length && lines[i].trim() === '') i++;
  // 找首段末尾:遇到空行 / heading / 列表 / 引用 / 分隔线 / 围栏 即停
  const paraStart = i;
  while (
    i < lines.length &&
    lines[i].trim() !== '' &&
    !/^\s{0,3}#{1,6}\s+/.test(lines[i]) &&
    !/^\s{0,3}>\s?/.test(lines[i]) &&
    !/^\s{0,3}[-*+]\s+/.test(lines[i]) &&
    !/^\s{0,3}\d+\.\s+/.test(lines[i]) &&
    !/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
    !/^\s{0,3}(```+|~~~+)/.test(lines[i])
  ) {
    i++;
  }
  const paraEnd = i; // exclusive

  // 已有 marker → 幂等返回
  if (body.includes('<!-- build:cover -->')) {
    return body;
  }

  if (paraEnd > paraStart) {
    // 在首段末(空行前)插入 marker 注释
    const before = lines.slice(0, paraEnd).join('\n');
    const after = lines.slice(paraEnd).join('\n');
    const sep = after.length > 0 && !after.startsWith('\n') ? '\n\n' : '\n';
    return before + '\n\n<!-- build:cover -->' + sep + after;
  }

  // 无首段正文:把 marker 加在 body 头部(紧随空行分隔)
  const tail = body.replace(/^\s+/, '');
  return '<!-- build:cover -->\n\n' + tail;
}

/* 文末追加 `<!-- build:related -->` marker(若已存在则幂等)。
 * 同时去除 body 末尾的多余空行,保证 marker 后只剩一个换行收尾。
 */
function appendRelatedMarker(body) {
  if (body.includes('<!-- build:related -->')) return body;
  const trimmed = body.replace(/\s+$/, '');
  return trimmed + '\n\n<!-- build:related -->\n';
}

/* 校验 body 可被共享 markdown.js 解析(同源契约)。
 * 不修改 body 也不消费结果,仅触发共享模块的安全/语法检查(<script> / <style> 拒绝)。
 */
function validateBodyAgainstShared(body) {
  // 触发 markdown.js 的安全规则与语法解析(失败抛错)。
  // 用空 sourcePath:image 解析走默认(/posts/<slug>/相对路径不会被使用,因为 finance brief 不带图)。
  sharedMarkdown.renderMarkdown(body, { sourcePath: null });
}

/* 把 briefJson 渲染成完整的 `index.md` 文本。
 *
 * briefJson 字段:
 *   title   {string}        文章标题(必填)
 *   date    {string}        YYYY-MM-DD(必填)
 *   slug    {string}        小写 slug(必填)
 *   excerpt {string}        摘要(必填,可与 title 同)
 *   body    {string}        简报 markdown 正文(必填)
 *   cover   {string|null}   封面文件名(可选,如 cover.svg)
 *   author  {string}        作者,默认 itingyu
 *   tags    {string[]}      标签数组,默认 ['finance']
 *   draft   {boolean}       默认 false(简报上线时直接 false;draft 状态归 build-index / publish.sh)
 *
 * 返回:
 *   string —— 完整 .md 文件内容(YAML frontmatter + MD body + 两个 marker)
 *
 * 不做装配(HTML / 索引页) —— 装配归 build-index.js。
 */
function renderMarkdown(briefJson) {
  if (!briefJson || typeof briefJson !== 'object') {
    throw new TypeError('renderMarkdown: briefJson 必须是对象');
  }
  const {
    title,
    date,
    slug,
    excerpt,
    body,
    cover = null,
    author = DEFAULT_AUTHOR,
    tags = [TAG_SLUG],
    draft = false,
  } = briefJson;

  if (typeof title !== 'string' || title.trim() === '') {
    throw new Error('renderMarkdown: 缺 title');
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('renderMarkdown: 缺 date(YYYY-MM-DD)');
  }
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) {
    throw new Error('renderMarkdown: 缺 slug(小写字母/数字/短横线)');
  }
  if (typeof excerpt !== 'string') {
    throw new Error('renderMarkdown: 缺 excerpt');
  }
  if (typeof body !== 'string' || body.trim() === '') {
    throw new Error('renderMarkdown: 缺 body');
  }
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error('renderMarkdown: tags 必须是非空数组');
  }

  // 1. 与 scripts/markdown.js 同源校验(让 <script>/<style>/不安全 URL 早爆)。
  validateBodyAgainstShared(body);

  // 2. body 注入两个 marker(幂等)
  let mdBody = insertCoverMarker(body);
  mdBody = appendRelatedMarker(mdBody);

  // 3. YAML frontmatter(顺序对齐 design-v2.md §3.2 + new-post.sh 模板)
  const fmLines = ['---'];
  fmLines.push(`title: "${yamlDoubleQuoted(title)}"`);
  fmLines.push(`date: ${date}`);
  fmLines.push(`slug: ${slug}`);
  fmLines.push(`description: "${yamlDoubleQuoted(excerpt)}"`);
  fmLines.push(`tags: [${tags.join(', ')}]`);
  fmLines.push(`author: ${author}`);
  if (cover) fmLines.push(`cover: ${cover}`);
  fmLines.push(`draft: ${draft ? 'true' : 'false'}`);
  fmLines.push('---');

  return fmLines.join('\n') + '\n\n' + mdBody;
}

/* ---------- main ---------- */

function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (!args.input || !args.date || !args.slug) {
    process.stderr.write(`缺少必填参数\n\n${USAGE}`);
    process.exit(2);
  }

  const date = assertDate(args.date);
  const slug = assertSlug(args.slug);
  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) die(`找不到输入文件: ${args.input}`);

  const md = fs.readFileSync(inputPath, 'utf8');
  const mdTitle = extractFirstH1(md);
  const mdExcerpt = extractFirstParagraph(md);
  const title = (args.title || mdTitle || '金融每日简报').slice(0, 200);
  const excerpt = (args.excerpt || mdExcerpt || title).slice(0, 240);

  const repoRoot = path.resolve(__dirname, '..');
  const outRoot = args.outDir ? path.resolve(args.outDir) : repoRoot;
  const outDir = path.join(outRoot, slug);
  const outFile = path.join(outDir, 'index.md');
  fs.mkdirSync(outDir, { recursive: true });

  // 封面图:仅在 outRoot == repoRoot 时复制到 posts/<slug>/ 下(测试模式不复制)
  let coverFile = null;
  if (args.cover) {
    if (outRoot !== repoRoot) {
      process.stderr.write(`warn: --out-dir 非仓根,跳过 --cover 复制(${args.cover})\n`);
    } else {
      const coverSrc = path.resolve(args.cover);
      if (!fs.existsSync(coverSrc)) die(`找不到封面图: ${args.cover}`);
      const coverName = path.basename(coverSrc);
      const coverDst = path.join(outDir, coverName);
      fs.copyFileSync(coverSrc, coverDst);
      coverFile = coverName;
    }
  }

  const briefJson = {
    title,
    date,
    slug,
    excerpt,
    body: md,
    cover: coverFile,
    author: DEFAULT_AUTHOR,
    tags: [TAG_SLUG],
    draft: false,
  };

  const out = renderMarkdown(briefJson);
  fs.writeFileSync(outFile, out);

  const rel = path.relative(repoRoot, outFile);
  process.stdout.write(`OK · 生成 ${rel}\n`);
  process.stdout.write(`(装配职责已移交给 scripts/build-index.js,本脚本只产 .md。)\n`);
  if (outRoot === repoRoot) {
    process.stdout.write(`下一步(review 后再 push):\n`);
    process.stdout.write(`  git add posts/${slug}/index.md\n`);
    process.stdout.write(`  git commit -m "post(finance-${date}): 上线 · ${title}"\n`);
    process.stdout.write(`  bash scripts/publish.sh ${slug}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { renderMarkdown, parseArgs };
