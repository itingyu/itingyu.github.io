'use strict';

/*
 * scripts/markdown.js
 *
 * Self-implemented Markdown → HTML renderer for itingyu.github.io.
 * Implements the 17-feature grammar set defined in design-v2.md §5.2.6 + 附 A.
 *
 * Public API:
 *   renderMarkdown(mdText, { sourcePath? } = {}) → string (HTML)
 *
 * Constraints (per §11):
 *   - NO third-party markdown library (marked / markdown-it / micromark all banned).
 *   - NO new npm deps (Node built-ins only).
 *   - Reject <script> / <style> blocks.
 *   - Reject javascript: / data: / vbscript: URLs.
 *   - HTML escape all output.
 */

const path = require('node:path');

// --------------------------------------------------------------------------
// HTML safety primitives
// --------------------------------------------------------------------------

const AMP  = String.fromCharCode(38);
const LT   = String.fromCharCode(60);
const GT   = String.fromCharCode(62);
const QUOT = String.fromCharCode(34);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, AMP + 'amp;')
    .replace(/</g, AMP + 'lt;')
    .replace(/>/g, AMP + 'gt;')
    .replace(/"/g, AMP + 'quot;');
}

function isSafeUrl(url) {
  if (url == null) return false;
  const u = String(url).trim();
  if (u === '') return false;
  if (/^(https?:)?\/\//i.test(u)) return true;
  if (u.startsWith('/')) return true;
  if (u.startsWith('mailto:')) return true;
  if (u.startsWith('#')) return true;
  if (u.startsWith('?')) return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return true;
  return false;
}

// --------------------------------------------------------------------------
// Backslash escape table — placeholder-based so escaped chars survive
// later inline regex passes.
// --------------------------------------------------------------------------

const ESCAPABLE = /\\([\\`*_{}\[\]()#+\-.!>~|])/g;

function applyBackslashEscapes(s) {
  const stash = [];
  const out = s.replace(ESCAPABLE, (_, ch) => {
    const idx = stash.length;
    stash.push(ch);
    return `\u0001ESC${idx}\u0001`;
  });
  return { out, stash };
}

function restoreEscapes(s, stash) {
  if (!stash || !stash.length) return s;
  return s.replace(/\u0001ESC(\d+)\u0001/g, (_, idx) => stash[Number(idx)]);
}

// --------------------------------------------------------------------------
// Inline rendering.
// --------------------------------------------------------------------------

function renderInline(text, opts) {
  const sourcePath = (opts && opts.sourcePath) || null;

  const esc = applyBackslashEscapes(text);
  let s = esc.out;

  const codeStash = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = codeStash.length;
    codeStash.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  s = escapeHtml(s);

  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => codeStash[Number(idx)]);

  s = s.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (m, alt, src) => {
    if (!isSafeUrl(src)) return m;
    const resolved = resolveImageSrc(src, sourcePath);
    return `<img alt="${escapeHtml(alt)}" src="${escapeHtml(resolved)}" loading="lazy" />`;
  });

  s = s.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (m, label, url) => {
    if (!isSafeUrl(url)) return m;
    return `<a href="${escapeHtml(url)}">${label}</a>`;
  });

  s = s.split(/(<a [^>]*>[\s\S]*?<\/a>)/g).map((seg) => {
    if (seg.startsWith('<a ')) return seg;
    return seg.replace(
      /(^|[\s(])(https?:\/\/[^\s<)\]]+)/g,
      (_, lead, url) => `${lead}<a href="${url}" target="_blank" rel="noopener">${url}</a>`,
    );
  }).join('');

  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\*\w])\*([^*\n]+)\*(?=[^\*\w]|$)/g, '$1<em>$2</em>');

  s = restoreEscapes(s, esc.stash);

  return s;
}

function resolveImageSrc(src, sourcePath) {
  if (!src) return src;
  if (/^(https?:)?\/\//i.test(src)) return src;
  if (src.startsWith('/')) return src;
  if (src.startsWith('data:')) return src;
  if (sourcePath) {
    const dir = path.dirname(sourcePath);
    const m = dir.replace(/\\/g, '/').match(/(posts\/[^/]+)/);
    if (m) {
      const slugDir = m[1];
      return `/${slugDir}/${src}`.replace(/\/+/g, '/');
    }
  }
  return src;
}

// --------------------------------------------------------------------------
// HTML-comment passthrough.
// We classify each comment as "block" (preceded by start-of-line) or
// "inline" (mid-line). Block comments get a sentinel line so the
// paragraph collector will not absorb them; inline comments keep the
// surrounding whitespace intact.
// --------------------------------------------------------------------------

function extractComments(src) {
  const stash = [];
  let placeholderSrc = '';
  let lastIdx = 0;
  const commentRe = /<!--[\s\S]*?-->/g;
  let m;
  while ((m = commentRe.exec(src)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const beforeChar = start === 0 ? '' : src[start - 1];
    const isBlock = start === 0 || beforeChar === '\n';
    if (isBlock) {
      // Flush text before.
      placeholderSrc += src.substring(lastIdx, start);
      // Sentinel line: empty content followed by the placeholder, so the
      // block parser sees the placeholder on its own line. We use a
      // zero-width marker so restoreComments can find it later.
      const idx = stash.length;
      stash.push(m[0]);
      placeholderSrc += `\u0000CMTBLOCK${idx}\u0000`;
    } else {
      placeholderSrc += src.substring(lastIdx, start);
      const idx = stash.length;
      stash.push(m[0]);
      placeholderSrc += `\u0000CMTINL${idx}\u0000`;
    }
    lastIdx = end;
  }
  placeholderSrc += src.substring(lastIdx);
  return { placeholderSrc, stash };
}

function restoreComments(html, stash) {
  html = html.replace(/\u0000CMTBLOCK(\d+)\u0000/g, (_, idx) => stash[Number(idx)]);
  html = html.replace(/\u0000CMTINL(\d+)\u0000/g, (_, idx) => stash[Number(idx)]);
  return html;
}

// --------------------------------------------------------------------------
// Reject dangerous HTML blocks (<script> / <style>).
// --------------------------------------------------------------------------

function rejectScriptStyle(src) {
  if (/<script\b[\s\S]*?<\/script\s*>/i.test(src)) {
    throw new Error('markdown: <script> blocks are not allowed');
  }
  if (/<style\b[\s\S]*?<\/style\s*>/i.test(src)) {
    throw new Error('markdown: <style> blocks are not allowed');
  }
}

// --------------------------------------------------------------------------
// Block-level renderer
// --------------------------------------------------------------------------

const BR_PLACEHOLDER = '\u0000BR\u0000';
const BLOCK_COMMENT_RE = /^\u0000CMTBLOCK\d+\u0000$/;
const INLINE_COMMENT_RE = /\u0000CMTINL\d+\u0000/g;

function renderBlocks(src, opts) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Standalone block-level comment — emit verbatim (restored later).
    if (BLOCK_COMMENT_RE.test(line.trim())) {
      out.push(line.trim());
      i++;
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    const fence = line.match(/^\s{0,3}(```+|~~~+)(.*)$/);
    if (fence) {
      const fenceChar = fence[1][0];
      const fenceLen = fence[1].length;
      const lang = (fence[2] || '').trim();
      const buf = [];
      i++;
      while (i < lines.length) {
        const closeMatch = lines[i].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
        if (
          closeMatch &&
          closeMatch[1][0] === fenceChar &&
          closeMatch[1].length >= fenceLen
        ) {
          i++;
          break;
        }
        buf.push(lines[i]);
        i++;
      }
      const code = escapeHtml(buf.join('\n'));
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${code}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      out.push(`<h${level}>${renderInline(text, opts)}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i++;
      }
      const inner = buf.join(' ');
      out.push(`<blockquote>${renderInline(inner, opts)}</blockquote>`);
      continue;
    }

    if (/^\s{0,3}[-*+]\s+/.test(line)) {
      const { html, nextIndex } = parseList(lines, i, opts, false);
      out.push(html);
      i = nextIndex;
      continue;
    }

    if (/^\s{0,3}\d+\.\s+/.test(line)) {
      const { html, nextIndex } = parseList(lines, i, opts, true);
      out.push(html);
      i = nextIndex;
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !BLOCK_COMMENT_RE.test(lines[i].trim()) &&
      !/^\s{0,3}#{1,6}\s+/.test(lines[i]) &&
      !/^\s{0,3}>\s?/.test(lines[i]) &&
      !/^\s{0,3}[-*+]\s+/.test(lines[i]) &&
      !/^\s{0,3}\d+\.\s+/.test(lines[i]) &&
      !/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
      !/^\s{0,3}(```+|~~~+)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      const joined = joinParagraphLines(para);
      out.push(`<p>${renderInline(joined, opts)}</p>`);
    }
  }

  return out.join('\n');
}

function joinParagraphLines(lines) {
  const buf = [];
  for (let k = 0; k < lines.length; k++) {
    const cur = lines[k];
    const next = lines[k + 1];
    const endsWithTwoSpaces = / {2,}$/.test(cur);
    if (endsWithTwoSpaces) {
      buf.push(cur.replace(/ {2,}$/, ''), BR_PLACEHOLDER);
    } else {
      buf.push(cur);
      if (next != null && next.trim() !== '') buf.push(' ');
    }
  }
  const joined = buf.join('');
  // Replace BR_PLACEHOLDER AFTER renderInline-equivalent processing so
  // the angle brackets are not escaped. The caller (renderBlocks paragraph
  // branch) calls renderInline on a string that already contains the BR
  // placeholder; we then do the substitution post-inline.
  return joined;
}

function applyBrPlaceholders(html) {
  return html.split(BR_PLACEHOLDER).join('<br>');
}

// --------------------------------------------------------------------------
// List parser. Mixed ordered/unordered nesting is supported via a generic
// list-item probe.
// --------------------------------------------------------------------------

const UL_ITEM = /^(\s*)([-*+])\s+(.*)$/;
const OL_ITEM = /^(\s*)(\d+\.)\s+(.*)$/;

function listItemMatch(line) {
  const ol = line.match(OL_ITEM);
  if (ol) return { indent: ol[1].length, ordered: true, content: ol[3] };
  const ul = line.match(UL_ITEM);
  if (ul) return { indent: ul[1].length, ordered: false, content: ul[3] };
  return null;
}

function parseList(lines, startIndex, opts, ordered) {
  const tag = ordered ? 'ol' : 'ul';

  const items = [];
  let i = startIndex;
  while (i < lines.length) {
    const m = listItemMatch(lines[i]);
    if (!m) break;
    const thisIndent = m.indent;
    if (items.length === 0) {
      const thisLines = [];
      thisLines.push(m.content);
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === '') break;
        const probe = listItemMatch(l);
        if (probe) {
          if (probe.indent > thisIndent) break;
          if (probe.indent === thisIndent) break;
        }
        const indentMatch = l.match(/^(\s*)(.*)$/);
        if (indentMatch && indentMatch[1].length >= thisIndent + 2) {
          thisLines.push(indentMatch[2]);
          j++;
          continue;
        }
        break;
      }
      items.push({ indent: thisIndent, content: thisLines, next: j });
      i = j;
      continue;
    }
    if (thisIndent > items[0].indent) {
      const sub = parseList(lines, i, opts, m.ordered);
      const last = items[items.length - 1];
      last.content.push(sub.html);
      i = sub.nextIndex;
      continue;
    }
    if (thisIndent < items[0].indent) break;
    const thisLines = [];
    thisLines.push(m.content);
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j];
      if (l.trim() === '') break;
      const probe = listItemMatch(l);
      if (probe) {
        if (probe.indent > thisIndent) break;
        if (probe.indent === thisIndent) break;
      }
      const indentMatch = l.match(/^(\s*)(.*)$/);
      if (indentMatch && indentMatch[1].length >= thisIndent + 2) {
        thisLines.push(indentMatch[2]);
        j++;
        continue;
      }
      break;
    }
    items.push({ indent: thisIndent, content: thisLines, next: j });
    i = j;
  }

  const inner = items
    .map((it) => {
      const text = joinItemContent(it.content);
      return `<li>${applyBrPlaceholders(text)}</li>`;
    })
    .join('');
  return { html: `<${tag}>${inner}</${tag}>`, nextIndex: i };
}

function joinItemContent(content) {
  const out = [];
  for (let k = 0; k < content.length; k++) {
    const cur = content[k];
    const next = content[k + 1];
    if (cur.startsWith('<ul') || cur.startsWith('<ol')) {
      if (out.length && out[out.length - 1] === BR_PLACEHOLDER) out.pop();
      out.push(cur);
      continue;
    }
    if (next != null && /^<(ul|ol)/.test(next)) {
      out.push(cur);
      continue;
    }
    if (/ {2,}$/.test(cur)) {
      out.push(cur.replace(/ {2,}$/, ''), BR_PLACEHOLDER);
    } else {
      out.push(cur);
      if (next != null && next !== '' && !/^<(ul|ol)/.test(next)) out.push(' ');
    }
  }
  return out.join('');
}

// --------------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------------

function renderMarkdown(mdText, opts) {
  if (typeof mdText !== 'string') {
    throw new TypeError('renderMarkdown: mdText must be a string');
  }
  const o = opts || {};
  const sourcePath = typeof o.sourcePath === 'string' ? o.sourcePath : null;

  rejectScriptStyle(mdText);

  const { placeholderSrc, stash } = extractComments(mdText);

  let html = renderBlocks(placeholderSrc, { sourcePath });

  html = restoreComments(html, stash);

  // Strip placeholder remnants if any escape mishap left them.
  html = html.split(BR_PLACEHOLDER).join('<br>');

  html = html.replace(/\n{3,}/g, '\n\n');

  return html.trim() + '\n';
}

module.exports = {
  renderMarkdown,
  escapeHtml,
  isSafeUrl,
  _applyBackslashEscapes: applyBackslashEscapes,
  _extractComments: extractComments,
  _renderInline: renderInline,
  BR_PLACEHOLDER,
};
