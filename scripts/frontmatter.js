#!/usr/bin/env node
/* frontmatter.js —— front matter 解析 / 序列化的唯一实现。
 *
 * 被 validate-frontmatter.js 与 import-md.js 共用，避免两套解析逻辑漂移。
 * 支持的子集就是本仓库用到的 YAML 子集：
 *   标量（字符串 / true / false / null） + 块状列表(- item) + 行内列表([a, b])
 */

'use strict';

const crypto = require('node:crypto');

function unquote(s) {
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function parseFrontmatter(md) {
  const m = md.match(/^\uFEFF?\s*---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!m) {
    return { fm: null, body: md, raw: '', frontmatterError: '缺少 front matter `---` 包裹' };
  }
  const raw = m[1];
  const body = m[2];
  const fm = Object.create(null);
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const km = lines[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!km) { i++; continue; }
    const k = km[1];
    const v = km[2];
    if (v === '') {
      const items = [];
      i++;
      while (i < lines.length) {
        const lm = lines[i].match(/^\s*-\s*(.*)$/);
        if (lm) { items.push(unquote(lm[1].trim())); i++; } else break;
      }
      fm[k] = items;
    } else if (v.trim().startsWith('[') && v.trim().endsWith(']')) {
      fm[k] = v.trim().slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
      i++;
    } else {
      const t = v.trim();
      if (t === 'true') fm[k] = true;
      else if (t === 'false') fm[k] = false;
      else if (t === 'null' || t === '~') fm[k] = null;
      else fm[k] = unquote(t);
      i++;
    }
  }
  return { fm, body, raw, frontmatterError: '' };
}

function yamlString(s) {
  const str = String(s);
  // 含 YAML 特殊起始字符 / 冒号 / 引号时用双引号包裹
  if (/^[\s>|*&!%#@`{}\[\],-]|:\s|["'\n]/.test(str) || str === '') {
    return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return str;
}

const FIELD_ORDER = [
  'layout', 'slug', 'title', 'date', 'column', 'series',
  'tags', 'excerpt', 'description', 'pinned', 'cover', 'draft', 'permalink',
];

function stringifyFrontmatter(fm) {
  const keys = [
    ...FIELD_ORDER.filter((k) => fm[k] !== undefined),
    ...Object.keys(fm).filter((k) => !FIELD_ORDER.includes(k) && fm[k] !== undefined),
  ];
  const out = ['---'];
  for (const k of keys) {
    const v = fm[k];
    if (Array.isArray(v)) {
      if (v.length === 0) { out.push(`${k}: []`); continue; }
      out.push(`${k}:`);
      for (const item of v) out.push(`  - ${yamlString(item)}`);
    } else if (v === null) {
      out.push(`${k}: null`);
    } else if (typeof v === 'boolean' || typeof v === 'number') {
      out.push(`${k}: ${v}`);
    } else {
      out.push(`${k}: ${yamlString(v)}`);
    }
  }
  out.push('---', '');
  return out.join('\n');
}

function slugify(name) {
  const base = String(name)
    .replace(/\.(md|markdown|txt)$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '')
    .toLowerCase();
  const ascii = base
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (ascii.replace(/-/g, '').length >= 2) return ascii;
  // 纯中文文件名无法转写：退回稳定短哈希，URL 可访问且可复现
  const h = crypto.createHash('sha1').update(base).digest('hex').slice(0, 8);
  return `post-${h}`;
}

function plainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeExcerpt(body, limit = 160) {
  const noHeadings = body.replace(/^#{1,6}\s+.*$/gm, '');
  const paras = noHeadings.split(/\r?\n\s*\r?\n/);
  for (const p of paras) {
    const t = plainText(p);
    if (t.length >= 20) return t.slice(0, limit).replace(/["\n]/g, ' ').trim();
  }
  return plainText(noHeadings).slice(0, limit).replace(/["\n]/g, ' ').trim();
}

function firstHeading(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

module.exports = {
  parseFrontmatter,
  stringifyFrontmatter,
  slugify,
  makeExcerpt,
  firstHeading,
  yamlString,
};
