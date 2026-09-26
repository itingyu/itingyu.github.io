'use strict';

// scripts/__tests__/build-posts-workflow.test.js
// M7.2 · GH Actions workflow 契约测试(SDD测试工程师 · AIWORK1-63 · PR-CI 红线)
// 覆盖:
//   1. 文件存在 + YAML 可解析
//   2. 触发器:push(master)+ workflow_dispatch
//   3. push.paths 含 posts/、scripts/、workflow 自身
//   4. permissions.contents = write
//   5. job.build.runs-on = ubuntu-latest
//   6. 步骤顺序:checkout@v4 → setup-node@v4(node 20)→ npm ci → validate → npm test
//      → npm run build → git config → commit → push
//   7. if: 三条件子句各自存在(event_type / actor / auto-build 哨兵)
//   8. if: 空提交跳过
//   9. concurrency 防并发覆盖
//  10. if: 顶层 && 把表达式切成 3 段,每段命中一种 guard(spec DoD #3 严约束)
//      (此处规范示例是 "(A) && (B) && (C)",但允许 workflow_dispatch 演化为 "(A) && B && (C)";
//       只要按 顶层 && 切出 3 段、3 种 guard 全到位、未知段=0 即可)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = path.resolve(
  __dirname, '..', '..', '.github', 'workflows', 'build-posts.yml',
);

// ------------------------------------------------------------
// 极简 YAML 解析器(只为 workflow 文件的浅层键路径断言,避免引入 js-yaml)
// 支持:key: value / key:\n  nested / "..." / '...' / 标量 + 列表 "- item"
// 不支持:复杂锚点 / 多文档 / 块折叠标量,workflow 文件实际只用这些。
// ------------------------------------------------------------

class NoBoolYAML {
  constructor(text) {
    this.lines = text.split('\n');
    this.i = 0;
  }
  peek() { return this.lines[this.i]; }
  next() { return this.lines[this.i++]; }
  indentOf(line) {
    const m = /^(\s*)\S/.exec(line);
    return m ? m[1].length : -1;
  }
  stripInlineComment(line) {
    // 极简:不处理 "# 在引号内" 的边界 — workflow 文件内 # 注释都在独立行
    const idx = line.indexOf('#');
    if (idx < 0) return line;
    const before = line.slice(0, idx);
    // 保守:仅当 # 前是空白才算注释
    if (idx === 0) return '';
    const prev = line[idx - 1];
    if (prev === ' ' || prev === '\t') return before.replace(/\s+$/, '');
    return line;
  }
  parseScalar(raw) {
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    // flow-style inline list: [a, b, c]
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1).trim();
      if (inner === '') return [];
      return inner.split(',').map(s => {
        const t = s.trim();
        if ((t.startsWith('"') && t.endsWith('"')) ||
            (t.startsWith("'") && t.endsWith("'"))) {
          return t.slice(1, -1);
        }
        return t;
      });
    }
    return v;
  }
  parseBlock(baseIndent) {
    const out = {};
    while (this.i < this.lines.length) {
      const raw = this.next();
      const stripped = this.stripInlineComment(raw);
      if (stripped.trim() === '') continue;
      const indent = this.indentOf(stripped);
      if (indent < baseIndent) {
        this.i -= 1; // 回退一行给上层
        return out;
      }
      // 块列表项: "- 'item'" / "- item"
      if (stripped.trim().startsWith('- ')) {
        const items = [this.parseScalar(stripped.trim().slice(2))];
        const childIndent = indent;
        while (this.i < this.lines.length) {
          const ln = this.lines[this.i];
          if (ln.trim() === '') { this.i++; continue; }
          const ci = this.indentOf(ln);
          if (ci !== childIndent) break;
          if (!ln.trim().startsWith('- ')) break;
          items.push(this.parseScalar(ln.trim().slice(2)));
          this.i++;
        }
        // 找到列表项的父 key —— 上一行
        // 但此时上一行已是子块场景,父 key 已被 push 为数组。
        // 这种格式实际只在 inline-list 与 block-list 嵌套中出现,本 workflow 没用到。
        if (!('_list' in out)) out._list = [];
        out._list.push(...items);
        continue;
      }
      const m = /^(\s*)([^:]+):\s*(.*)$/.exec(stripped);
      if (!m) continue;
      const [, , key, rest] = m;
      if (rest === '') {
        // 子块 — 若下一行是 "- item" 则作为列表
        const peekLine = this.lines[this.i] || '';
        const peekStripped = this.stripInlineComment(peekLine);
        if (peekStripped.trim().startsWith('- ')) {
          const items = [];
          const childIndent = this.indentOf(peekLine);
          while (this.i < this.lines.length) {
            const ln = this.lines[this.i];
            if (ln.trim() === '') { this.i++; continue; }
            const ci = this.indentOf(ln);
            if (ci !== childIndent) break;
            if (!ln.trim().startsWith('- ')) break;
            items.push(this.parseScalar(ln.trim().slice(2)));
            this.i++;
          }
          out[key] = items;
        } else {
          out[key] = this.parseBlock(indent + 2);
        }
      } else if (rest.trim() === '|') {
        // literal block:读到下一个同级或更低缩进
        const blockLines = [];
        const childIndent = indent + 2;
        while (this.i < this.lines.length) {
          const ln = this.lines[this.i];
          if (ln.trim() === '') { this.i++; continue; }
          const ci = this.indentOf(ln);
          if (ci < childIndent) break;
          blockLines.push(ln.slice(childIndent));
          this.i++;
        }
        out[key] = blockLines.join('\n');
      } else {
        out[key] = this.parseScalar(rest);
      }
    }
    return out;
  }
  parse() {
    const root = {};
    while (this.i < this.lines.length) {
      const raw = this.next();
      const stripped = this.stripInlineComment(raw);
      if (stripped.trim() === '') continue;
      const m = /^(\s*)([^:]+):\s*(.*)$/.exec(stripped);
      if (!m) continue;
      const indent = m[1].length;
      if (indent !== 0) continue;
      const key = m[2];
      const rest = m[3];
      if (rest === '') {
        root[key] = this.parseBlock(2);
      } else {
        root[key] = this.parseScalar(rest);
      }
    }
    return root;
  }
}

function loadWorkflow() {
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  return { text, doc: new NoBoolYAML(text).parse() };
}

const STEP_ORDER = [
  { match: /actions\/checkout@v4/, label: 'checkout@v4' },
  { match: /actions\/setup-node@v4.*\n.*node-version.*20/s, label: 'setup-node@v4 (node 20)' },
  { match: /npm ci/, label: 'npm ci' },
  { match: /validate-frontmatter\.js/, label: 'validate frontmatter' },
  { match: /npm test/, label: 'npm test' },
  { match: /npm run build/, label: 'npm run build' },
  { match: /git config user\.name.*github-actions/, label: 'configure git author (bot)' },
  { match: /auto-build:/, label: 'commit with auto-build: sentinel' },
  { match: /git push origin master/, label: 'git push origin master' },
];

// 1. 文件存在
test('workflow file: exists', () => {
  assert.ok(fs.existsSync(WORKFLOW), `missing: ${WORKFLOW}`);
});

// 2. YAML 可解析
test('workflow file: YAML parses', () => {
  const { doc } = loadWorkflow();
  assert.equal(doc.name, 'build-posts');
});

// 3. 触发器
test('workflow triggers: push(master) + workflow_dispatch', () => {
  const { doc } = loadWorkflow();
  assert.ok(doc.on, 'no `on:` block');
  assert.ok(doc.on.push, 'no push trigger');
  assert.deepEqual(doc.on.push.branches, ['master']);
  assert.ok(doc.on.push.paths && Array.isArray(doc.on.push.paths), 'push.paths missing');
  assert.ok('workflow_dispatch' in doc.on, 'no workflow_dispatch trigger');
});

// 4. push.paths 覆盖
test('workflow push.paths: covers posts/, scripts/, self', () => {
  const { doc } = loadWorkflow();
  const paths = doc.on.push.paths;
  assert.ok(paths.some(p => /posts\/\*\*\/\*\.md/.test(p)), 'no posts/**/*.md');
  assert.ok(paths.some(p => /posts\/\*\*\/\*\.html/.test(p)), 'no posts/**/*.html');
  assert.ok(paths.some(p => /scripts\/\*\*/.test(p)), 'no scripts/**');
  assert.ok(paths.some(p => /build-posts\.yml/.test(p)), 'no self path');
});

// 5. permissions
test('workflow permissions: contents=write', () => {
  const { doc } = loadWorkflow();
  assert.equal(doc.permissions && doc.permissions.contents, 'write');
});

// 6. runs-on
test('workflow runs-on: ubuntu-latest', () => {
  const { doc } = loadWorkflow();
  assert.equal(doc.jobs.build['runs-on'], 'ubuntu-latest');
});

// 7. 步骤顺序 — 从原文中按出现顺序扫,每个正则必须命中且顺序正确
test('workflow steps: ordered per design-v2.md §9', () => {
  const { text } = loadWorkflow();
  let cursor = 0;
  for (const { match, label } of STEP_ORDER) {
    const found = text.slice(cursor).search(match);
    assert.ok(found >= 0, `step missing or out of order: ${label}`);
    cursor = found + 1;
  }
});

// 8. if: 三重防护
test('workflow if: three guards (event_type, actor, auto-build sentinel)', () => {
  const { doc } = loadWorkflow();
  const expr = doc.jobs.build.if;
  assert.ok(expr && typeof expr === 'string', 'no if: expression');
  // a) event_type 守门(push 或 workflow_dispatch)
  assert.match(expr, /github\.event_name\s*==\s*['"]push['"]\s*\|\|\s*github\.event_name\s*==\s*['"]workflow_dispatch['"]/);
  // b) actor != bot
  assert.match(expr, /github\.actor\s*!=\s*['"]github-actions\[bot\]['"]/);
  // c) auto-build 哨兵 — workflow_dispatch 短路或 push head_commit 不含 auto-build:
  assert.match(expr, /!contains\(github\.event\.head_commit\.message,\s*['"]auto-build:['"]\)/);
});

// 9. 空提交跳过
test('workflow commit step: skips empty commits via git diff --cached --quiet', () => {
  const { text } = loadWorkflow();
  assert.match(text, /git diff --cached --quiet/);
});

// 10. concurrency 防并发覆盖
test('workflow concurrency: group on ref, cancel-in-progress=false', () => {
  const { doc } = loadWorkflow();
  assert.ok(doc.concurrency, 'no concurrency block');
  assert.match(doc.concurrency.group, /build-posts-\$\{\{\s*github\.ref\s*\}\}/);
  assert.equal(doc.concurrency['cancel-in-progress'], 'false');
});

// 11. if: 顶层 && 把表达式切成 3 段,每段命中一种 guard
//      spec DoD #3 严约束:防 OR 错位 / 漏条件 / 误删 guard
//      实现可演化为 (A) && B && (C)(允许中间段不包括号,只要按 顶层 && 切出 3 段)
test('workflow if: top-level && joins exactly 3 sub-conditions (AND topology)', () => {
  const { doc } = loadWorkflow();
  const expr = doc.jobs.build.if;
  assert.ok(expr && typeof expr === 'string', 'no if: expression');

  const segments = splitTopLevelAnd(expr);
  assert.equal(
    segments.length, 3,
    `if: should have exactly 3 sub-conditions joined by top-level &&; got ${segments.length}\n` +
    segments.map((s, i) => `  [${i}] ${s}`).join('\n'),
  );

  const guards = segments.map(classifyGuard);
  const required = ['event_name', 'actor', 'sentinel'];
  for (const g of required) {
    assert.ok(
      guards.includes(g),
      `missing guard: ${g}\n` +
      `segments:\n${segments.map(s => '  - ' + s).join('\n')}\n` +
      `guards: [${guards.join(', ')}]`,
    );
  }
  // 不能有 unknown 段 — 多半是 OR 错位 / 漏 guard / 多余表达式
  assert.ok(
    guards.every(g => g !== 'unknown'),
    `unknown guard segment(s) — likely OR/AND structure drift:\n` +
    segments.map((s, i) => `  [${i}] ${s} → ${guards[i]}`).join('\n'),
  );
});

// helper:把 if: 表达式按 顶层 && 切分;() / [] / '...' / "..." 内的 && 不切
function splitTopLevelAnd(expr) {
  const out = [];
  let depth = 0;          // () 深度
  let bracketDepth = 0;   // [] 深度
  let inS = false, inD = false;
  let buf = '';
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inS) { buf += c; if (c === "'") inS = false; continue; }
    if (inD) { buf += c; if (c === '"') inD = false; continue; }
    if (c === "'") { inS = true; buf += c; continue; }
    if (c === '"') { inD = true; buf += c; continue; }
    if (c === '(') { depth++; buf += c; continue; }
    if (c === ')') { depth--; buf += c; continue; }
    if (c === '[') { bracketDepth++; buf += c; continue; }
    if (c === ']') { bracketDepth--; buf += c; continue; }
    if (depth === 0 && bracketDepth === 0 && expr.slice(i, i + 3) === ' &&') {
      out.push(buf.trim());
      buf = '';
      i += 2; // skip '&&'
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// helper:把 if: 子段分类成 event_name / actor / sentinel / unknown
// 顺序很关键 — sentinel 优先(因为它的子段也含 github.event_name == 'workflow_dispatch')
function classifyGuard(seg) {
  if (/!contains\(\s*github\.event\.head_commit\.message/.test(seg) &&
      /auto-build:/.test(seg)) {
    return 'sentinel';
  }
  if (/github\.actor\s*!=\s*['"]github-actions\[bot\]['"]/.test(seg)) {
    return 'actor';
  }
  if (/github\.event_name\s*==/.test(seg) &&
      (/['"]push['"]/.test(seg) || /['"]workflow_dispatch['"]/.test(seg))) {
    return 'event_name';
  }
  return 'unknown';
}