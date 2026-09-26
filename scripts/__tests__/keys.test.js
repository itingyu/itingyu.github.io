'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KEYS_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'keys.js'), 'utf8');

function makeEnv({ reducedMotion = false, fakeTimers = false } = {}) {
  const listeners = {};
  const targets = [];
  const appended = [];
  const timerCallbacks = [];
  let nextTimerId = 1;
  const activeTimers = new Map();

  const matchMedia = () => ({ matches: reducedMotion });

  const mkEl = (tag, attrs = {}) => {
    const el = {
      tagName: (tag || 'DIV').toUpperCase(),
      children: [],
      attributes: { ...attrs },
      _text: '',
      hidden: false,
      isContentEditable: false,
      _class: attrs.class || '',
      classList: {
        add(c) { el._class = (el._class + ' ' + c).trim(); },
        remove(c) { el._class = el._class.replace(c, '').trim(); },
        contains(c) { return el._class.split(/\s+/).includes(c); },
      },
      setAttribute(k, v) { el.attributes[k] = v; },
      getAttribute(k) { return el.attributes[k]; },
      appendChild(c) { el.children.push(c); appended.push(c); return c; },
      addEventListener(t, cb) { listeners[t] = cb; },
      removeEventListener(t) { delete listeners[t]; },
      focus() { targets.push(el); },
      select() {},
      click() { el._clicked = true; },
      querySelector(sel) {
        if (sel.startsWith('link[rel="')) {
          return el._linkRel ? { getAttribute: (a) => a === 'href' ? el._linkRel : null } : null;
        }
        if (sel === '[data-search-input]') return el._searchInput || null;
        if (sel === '[data-theme-toggle]') return el._themeBtn || null;
        if (sel === '.post-nav-next' || sel === '.post-nav-prev') {
          return el._postNavCard || null;
        }
        return null;
      },
      get style() {
        if (!el._style) {
          el._style = {
            _props: {},
            set animation(v) { this._props.animation = v; },
            get animation() { return this._props.animation; },
          };
        }
        return el._style;
      },
      offsetWidth: 0,
    };
    return el;
  };

  const body = mkEl('body');
  const document = {
    body,
    addEventListener(type, cb) { listeners[type] = cb; },
    removeEventListener(type) { delete listeners[type]; },
    querySelector(sel) {
      if (sel.startsWith('link[rel="')) {
        return body._linkRel ? { getAttribute: (a) => a === 'href' ? body._linkRel : null } : null;
      }
      if (sel === '[data-search-input]') return body._searchInput || null;
      if (sel === '[data-theme-toggle]') return body._themeBtn || null;
      if (sel === '.post-nav-next' || sel === '.post-nav-prev') {
        return body._postNavCard || null;
      }
      return null;
    },
    createElement(tag) { return mkEl(tag); },
  };

  const location = { _href: '', get href() { return this._href; }, set href(v) { this._href = v; } };

  const sandbox = {
    window: { matchMedia, location },
    document,
    matchMedia,
    location,
    setTimeout: fakeTimers
      ? (cb, ms) => { const id = nextTimerId++; timerCallbacks.push({ cb, ms, id }); activeTimers.set(id, { cb, ms }); return id; }
      : setTimeout,
    clearTimeout: fakeTimers
      ? (id) => { activeTimers.delete(id); }
      : clearTimeout,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(KEYS_JS, sandbox);

  let virtualTime = 0;
  function advanceTimers(ms) {
    virtualTime += ms;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const t of [...timerCallbacks]) {
        if (t.ms <= virtualTime) {
          activeTimers.delete(t.id);
          const idx = timerCallbacks.indexOf(t);
          if (idx !== -1) timerCallbacks.splice(idx, 1);
          t.cb();
          progressed = true;
        }
      }
    }
  }

  return { sandbox, listeners, targets, appended, body, location, advanceTimers };
}

function fireKey(env, opts) {
  const keydown = env.listeners.keydown;
  if (!keydown) throw new Error('no keydown listener registered');
  const ev = {
    key: opts.key,
    target: opts.target || env.body,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    altKey: !!opts.altKey,
    shiftKey: !!opts.shiftKey,
    preventDefault() { ev._prevented = true; },
  };
  keydown(ev);
  return ev;
}

function makePostNavCard() {
  const classes = new Set();
  return {
    tagName: 'A',
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
      _all() { return [...classes]; },
    },
  };
}

// =============================================================
// §1 a11y 焦点契约 — isEditable() 边界(用例 A–F)
// =============================================================

test('A. focus <input type="text"> — j/k/?/s/Shift+T 全部不触发 + 无 preventDefault', () => {
  const env = makeEnv();
  env.body._linkRel = '/posts/welcome/';
  env.body._searchInput = { tagName: 'INPUT', isContentEditable: false, focus() {} };
  env.body._themeBtn = { tagName: 'BUTTON', isContentEditable: false, click() {} };
  const input = { tagName: 'INPUT', isContentEditable: false, type: 'text' };

  for (const [key, opts] of [
    ['j', {}],
    ['k', {}],
    ['?', {}],
    ['s', {}],
    ['T', { shiftKey: true }],
  ]) {
    const before = env.location._href;
    const ev = fireKey(env, { key, target: input, ...opts });
    assert.equal(ev._prevented, undefined, `${key} 在 input 上不应 preventDefault`);
    assert.equal(env.location._href, before, `${key} 在 input 上不应跳转`);
  }
  assert.equal(env.appended.length, 0, '? 在 input 上不应创建 overlay');
  assert.equal(env.body._themeBtn._clicked, undefined, 'Shift+T 在 input 上不应切主题');
});

test('B. focus <textarea> — j/k/?/s/Shift+T 全部不触发 + 无 preventDefault', () => {
  const env = makeEnv();
  const ta = { tagName: 'TEXTAREA', isContentEditable: false };
  for (const key of ['j', 'k', '?', 's']) {
    const ev = fireKey(env, { key, target: ta });
    assert.equal(ev._prevented, undefined, `${key} 在 textarea 上不应 preventDefault`);
  }
  const ev2 = fireKey(env, { key: 'T', target: ta, shiftKey: true });
  assert.equal(ev2._prevented, undefined, 'Shift+T 在 textarea 上不应 preventDefault');
});

test('C. focus [contenteditable="true"] — j/k/?/s/Shift+T 全部不触发 + 无 preventDefault', () => {
  const env = makeEnv();
  const ce = { tagName: 'ARTICLE', isContentEditable: true };
  for (const key of ['j', 'k', '?', 's']) {
    const ev = fireKey(env, { key, target: ce });
    assert.equal(ev._prevented, undefined, `${key} 在 contenteditable 上不应 preventDefault`);
  }
});

test('D. focus <select> — j/k/?/s/Shift+T 全部不触发 + 无 preventDefault', () => {
  const env = makeEnv();
  const sel = { tagName: 'SELECT', isContentEditable: false };
  for (const [key, opts] of [['j', {}], ['k', {}], ['?', {}], ['s', {}], ['T', { shiftKey: true }]]) {
    const ev = fireKey(env, { key, target: sel, ...opts });
    assert.equal(ev._prevented, undefined, `${key} 在 select 上不应 preventDefault(键盘可能切换 option)`);
  }
});

test('E. focus 普通 <a> / <div> — j/k 正常触发(若 link 存在)', () => {
  const env = makeEnv({ fakeTimers: true });
  env.body._linkRel = '/posts/welcome/';
  env.body._postNavCard = makePostNavCard();
  const a = { tagName: 'A', isContentEditable: false };
  const div = { tagName: 'DIV', isContentEditable: false };

  const ev1 = fireKey(env, { key: 'j', target: a });
  assert.equal(ev1._prevented, true, 'j 在 a 上应 preventDefault');
  env.advanceTimers(200);
  assert.equal(env.location._href, '/posts/welcome/', 'j flash 200ms 后应跳转');

  env.body._linkRel = '/posts/finance-2026-09-26/';
  const ev2 = fireKey(env, { key: 'k', target: div });
  assert.equal(ev2._prevented, true, 'k 在 div 上应 preventDefault');
  env.advanceTimers(200);
  assert.equal(env.location._href, '/posts/finance-2026-09-26/', 'k flash 200ms 后应跳转');
});

test('F. focus 在 overlay 内 <kbd> — Esc 必须关闭', () => {
  const env = makeEnv();
  fireKey(env, { key: '?' });
  const overlay = env.appended[env.appended.length - 1];
  assert.equal(overlay.hidden, false, 'overlay 先打开');

  const kbd = { tagName: 'KBD', isContentEditable: false };
  kbd._inside = overlay;

  const overlayBefore = overlay;
  const ev = fireKey(env, { key: 'Escape', target: kbd });
  assert.equal(ev._prevented, true, 'Esc 在 kbd 上应 preventDefault');
  assert.equal(overlayBefore.hidden, true, 'Esc 关闭 overlay');
});

// =============================================================
// §2 prefers-reduced-motion(用例 G–H)
// =============================================================

test('G. reduced-motion=true → toggleHelp() 不给 overlay 设 style.animation', () => {
  const env = makeEnv({ reducedMotion: true });
  fireKey(env, { key: '?' });
  const overlay = env.appended[env.appended.length - 1];
  assert.equal(overlay.hidden, false, 'overlay 仍打开');
  assert.equal(overlay.style._props.animation, undefined, 'reduced-motion 下 style.animation 未被设值');

  fireKey(env, { key: '?' });
  fireKey(env, { key: '?' });
  assert.equal(overlay.style._props.animation, undefined, '多次 toggle 后仍未设值');
});

test('H. reduced-motion=true → 浮层瞬现,style.animation 永远 undefined', () => {
  const env = makeEnv({ reducedMotion: true });
  fireKey(env, { key: '?' });
  const overlay = env.appended[env.appended.length - 1];
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.style._props.animation, undefined, 'reduced-motion 路径完全不触发 animation 重置分支');
});

test('non-reduced-motion 对照 — animation 重置分支触发(style.animation="")', () => {
  const env = makeEnv({ reducedMotion: false });
  fireKey(env, { key: '?' });
  const overlay = env.appended[env.appended.length - 1];
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.style._props.animation, '', '非 reduced-motion 路径 animation 重置为 ""');
});

// =============================================================
// §3 修饰键契约(用例 I)
// =============================================================

test('I. Ctrl 按下时 j / ? / s 全部不触发 + 不 preventDefault', () => {
  const env = makeEnv();
  env.body._linkRel = '/posts/welcome/';

  for (const key of ['j', '?', 's']) {
    const before = env.location._href;
    const ev = fireKey(env, { key, ctrlKey: true });
    assert.equal(ev._prevented, undefined, `Ctrl+${key} 不应 preventDefault`);
    assert.equal(env.location._href, before, `Ctrl+${key} 不应跳转/focus`);
  }
  assert.equal(env.appended.length, 0, 'Ctrl+? 不开 overlay');
});

test('Meta / Alt 任一修饰键按下 → 同样跳过', () => {
  const env = makeEnv();
  for (const modifier of ['metaKey', 'altKey']) {
    const ev = fireKey(env, { key: '?', [modifier]: true });
    assert.equal(ev._prevented, undefined, `${modifier}+? 不应 preventDefault`);
  }
  assert.equal(env.appended.length, 0, '修饰键 + ? 都不应开 overlay');
});

// =============================================================
// §4 g* 超时契约(用例 J–K)
// =============================================================

test('J. g 后 1.2s 内连按 h → 跳转首页', () => {
  const env = makeEnv({ fakeTimers: true });
  fireKey(env, { key: 'g' });
  env.advanceTimers(1100);
  fireKey(env, { key: 'h' });
  assert.equal(env.location._href, '/', '1.2s 内连按 g h 应跳转首页');
});

test('J(bis). g 后 1.2s 内连按 p / a / t 同样跳转', () => {
  for (const [key, expected] of [['p', '/posts/'], ['a', '/archive/'], ['t', '/tags/']]) {
    const env = makeEnv({ fakeTimers: true });
    fireKey(env, { key: 'g' });
    env.advanceTimers(1100);
    fireKey(env, { key });
    assert.equal(env.location._href, expected, `1.2s 内 g ${key} → ${expected}`);
  }
});

test('K. g 后超过 1.2s 再按 h → 不跳转,状态清空', () => {
  const env = makeEnv({ fakeTimers: true });
  const before = env.location._href;
  fireKey(env, { key: 'g' });
  env.advanceTimers(1300);
  fireKey(env, { key: 'h' });
  assert.equal(env.location._href, before, 'g 超时后 h 不应触发跳转');
});

test('K(bis). g 后超过 1.2s 再按其它字母也不跳转', () => {
  for (const key of ['h', 'p', 'a', 't', 'z']) {
    const env = makeEnv({ fakeTimers: true });
    const before = env.location._href;
    fireKey(env, { key: 'g' });
    env.advanceTimers(1300);
    fireKey(env, { key });
    assert.equal(env.location._href, before, `g 超时后 ${key} 不应跳转`);
  }
});

test('K(边界). g 后 1.2s 整 — setTimeout 阈值精确边界', () => {
  const env = makeEnv({ fakeTimers: true });
  fireKey(env, { key: 'g' });
  env.advanceTimers(1200);
  const before = env.location._href;
  fireKey(env, { key: 'h' });
  assert.equal(env.location._href, before, '恰好 1200ms 超时后 h 应被认作新事件');
});

// =============================================================
// §5 兜底契约
// =============================================================

test('Esc 在无 overlay 时 不 preventDefault', () => {
  const env = makeEnv();
  const ev = fireKey(env, { key: 'Escape' });
  assert.equal(ev._prevented, undefined, '无 overlay 时 Esc 不应 preventDefault');
});

test('? toggle 是双向的(open → close → open)', () => {
  const env = makeEnv();
  fireKey(env, { key: '?' });
  const overlay = env.appended[env.appended.length - 1];
  assert.equal(overlay.hidden, false);
  fireKey(env, { key: '?' });
  assert.equal(overlay.hidden, true, '再按 ? 应关闭');
  fireKey(env, { key: '?' });
  assert.equal(overlay.hidden, false, '再按 ? 应打开');
});

test('Shift+T 而非裸 t — 避免触屏主题冲突', () => {
  const env = makeEnv();
  const btn = { tagName: 'BUTTON', isContentEditable: false, _clicked: false, click() { this._clicked = true; } };
  env.body._themeBtn = btn;

  fireKey(env, { key: 't' });
  assert.equal(btn._clicked, false, '裸 t 不切主题');

  const ev = fireKey(env, { key: 'T', shiftKey: true });
  assert.equal(btn._clicked, true, 'Shift+T 切主题');
  assert.equal(ev._prevented, true);
});

test('s 在无 [data-search-input] 时 仍 preventDefault 但不报错', () => {
  const env = makeEnv();
  const ev = fireKey(env, { key: 's' });
  assert.equal(ev._prevented, true, 's 仍 preventDefault 防止浏览器把 s 输入到焦点元素');
  assert.equal(env.targets.length, 0, '无搜索框时无 focus 目标');
});

test('j 在无 <link rel="next"> 时 不 preventDefault', () => {
  const env = makeEnv();
  env.body._linkRel = null;
  const ev = fireKey(env, { key: 'j' });
  assert.equal(ev._prevented, undefined, '无 next link 时 j 不应 preventDefault');
});

// =============================================================
// §6 post-nav flash preview(AIWORK1-42 — 给 j/k 加 200ms 视觉反馈)
// =============================================================

test('L. j 在非 reduced-motion 下 → 先 .flash 再跳转(必须先看到 flash 再跳)', () => {
  const env = makeEnv({ fakeTimers: true });
  env.body._linkRel = '/posts/finance-2026-09-26/';
  const card = makePostNavCard();
  env.body._postNavCard = card;

  const ev = fireKey(env, { key: 'j' });
  assert.equal(ev._prevented, true, 'j 应 preventDefault');
  assert.ok(card.classList.contains('flash'), '按 j 立即应给 .post-nav-next 加 .flash');
  assert.equal(env.location._href, '', 'flash 期间不应立即跳转');

  env.advanceTimers(199);
  assert.equal(env.location._href, '', '199ms 时仍未跳转');
  assert.ok(card.classList.contains('flash'), '199ms 时 .flash 仍在');

  env.advanceTimers(1);
  assert.equal(env.location._href, '/posts/finance-2026-09-26/', '200ms 后应跳转');
  assert.equal(card.classList.contains('flash'), false, '跳转后 .flash 已移除');
});

test('M. j 在无对应 .post-nav-next 卡片时 → 既不 flash 也不跳转(单篇 / 首末篇边界)', () => {
  const env = makeEnv({ fakeTimers: true });
  env.body._linkRel = '/posts/finance-2026-09-26/';
  // 故意不设 _postNavCard —— 模拟 link 存在但 nav 卡片不存在的边界

  const ev = fireKey(env, { key: 'j' });
  assert.equal(ev._prevented, true, 'j 仍 preventDefault(用户预期有反馈)');
  env.advanceTimers(250);
  assert.equal(env.location._href, '', '无卡片 → 不应跳转,避免「无反馈导航」');
});

test('N. reduced-motion=true → j 直接跳转,无 flash', () => {
  const env = makeEnv({ reducedMotion: true, fakeTimers: true });
  env.body._linkRel = '/posts/finance-2026-09-26/';
  const card = makePostNavCard();
  env.body._postNavCard = card;

  const ev = fireKey(env, { key: 'j' });
  assert.equal(ev._prevented, true, 'j 仍 preventDefault');
  assert.equal(card.classList.contains('flash'), false, 'reduced-motion 下不加 .flash');
  assert.equal(env.location._href, '/posts/finance-2026-09-26/', 'reduced-motion 下立即跳转');
});