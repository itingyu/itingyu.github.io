'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KEYS_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'keys.js'), 'utf8');

function makeEnv({ reducedMotion = false } = {}) {
  const listeners = {};
  const targets = [];
  const appended = [];

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
    setTimeout, clearTimeout,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(KEYS_JS, sandbox);

  return { sandbox, listeners, targets, appended, body, location };
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

test('keys.js: ? opens help overlay and Esc closes it', () => {
  const env = makeEnv();
  fireKey(env, { key: '?' });
  assert.equal(env.appended.length >= 1, true, 'overlay appended on first ?');
  const overlay = env.appended[env.appended.length - 1];
  assert.equal(overlay.hidden, false, 'overlay visible after ?');
  assert.equal(overlay.attributes['role'], 'dialog');
  assert.equal(overlay.attributes['aria-modal'], 'true');

  fireKey(env, { key: 'Escape' });
  assert.equal(overlay.hidden, true, 'overlay hidden after Esc');

  fireKey(env, { key: '?' });
  assert.equal(overlay.hidden, false, '? toggles back open');
});

test('keys.js: isEditable skips shortcuts when target is input/textarea/select/contenteditable', () => {
  const env = makeEnv();
  const input = { tagName: 'INPUT', isContentEditable: false };
  const before = env.location._href;
  fireKey(env, { key: 's', target: input });
  fireKey(env, { key: '?', target: input });
  assert.equal(env.location._href, before, 'no nav from input');
  assert.equal(env.appended.length, 0, 'no overlay from input');

  const ta = { tagName: 'TEXTAREA', isContentEditable: false };
  fireKey(env, { key: 's', target: ta });
  assert.equal(env.location._href, before, 'no nav from textarea');

  const sel = { tagName: 'SELECT', isContentEditable: false };
  fireKey(env, { key: 's', target: sel });
  assert.equal(env.location._href, before, 'no nav from select');

  const ce = { tagName: 'DIV', isContentEditable: true };
  fireKey(env, { key: 's', target: ce });
  assert.equal(env.location._href, before, 'no nav from contenteditable');
});

test('keys.js: Ctrl/Meta/Alt modifiers bypass shortcuts', () => {
  const env = makeEnv();
  const ev = fireKey(env, { key: '?', ctrlKey: true });
  assert.equal(env.appended.length, 0, 'Ctrl+? does not open overlay');
  fireKey(env, { key: '?', metaKey: true });
  assert.equal(env.appended.length, 0, 'Meta+? does not open overlay');
  fireKey(env, { key: '?', altKey: true });
  assert.equal(env.appended.length, 0, 'Alt+? does not open overlay');
});

test('keys.js: j/k navigate via <link rel="next/prev">', () => {
  const env = makeEnv();
  env.body._linkRel = '/posts/welcome/';
  const ev1 = fireKey(env, { key: 'j' });
  assert.equal(env.location._href, '/posts/welcome/');
  assert.equal(ev1._prevented, true);

  env.body._linkRel = '/posts/finance-2026-09-26/';
  const ev2 = fireKey(env, { key: 'k' });
  assert.equal(env.location._href, '/posts/finance-2026-09-26/');
  assert.equal(ev2._prevented, true);
});

test('keys.js: j/k fall back to rel="previous" when rel="prev" missing', () => {
  const env = makeEnv();
  // Mock: querySelector('link[rel="prev"]') returns null, querySelector('link[rel="previous"]') returns the link
  const origQuery = env.sandbox.document.querySelector;
  env.sandbox.document.querySelector = function (sel) {
    if (sel === 'link[rel="prev"]') return null;
    if (sel === 'link[rel="previous"]') return { getAttribute: (a) => a === 'href' ? '/archive/' : null };
    return origQuery.call(this, sel);
  };
  fireKey(env, { key: 'k' });
  assert.equal(env.location._href, '/archive/');
});

test('keys.js: j without <link rel="next"> is a no-op', () => {
  const env = makeEnv();
  env.body._linkRel = null;
  const before = env.location._href;
  fireKey(env, { key: 'j' });
  assert.equal(env.location._href, before, 'no nav when no next link');
});

test('keys.js: g h / g p / g a / g t navigate', () => {
  for (const [key, expected] of [['h', '/'], ['p', '/posts/'], ['a', '/archive/'], ['t', '/tags/']]) {
    const env = makeEnv();
    fireKey(env, { key: 'g' });
    const ev = fireKey(env, { key });
    assert.equal(env.location._href, expected, `g ${key} → ${expected}`);
  }
});

test('keys.js: g + unmatched letter does not navigate', () => {
  const env = makeEnv();
  const before = env.location._href;
  fireKey(env, { key: 'g' });
  fireKey(env, { key: 'z' });
  assert.equal(env.location._href, before, 'g z is a no-op');
});

test('keys.js: s focuses [data-search-input] when present', () => {
  const env = makeEnv();
  const input = { tagName: 'INPUT', isContentEditable: false, _focused: false, focus() { this._focused = true; env.targets.push(this); }, select() {} };
  env.body._searchInput = input;
  const ev = fireKey(env, { key: 's' });
  assert.equal(input._focused, true);
  assert.equal(ev._prevented, true);
});

test('keys.js: s is a no-op without search input', () => {
  const env = makeEnv();
  const ev = fireKey(env, { key: 's' });
  assert.equal(ev._prevented, true, 'preventDefault is still called to avoid stray typing');
  assert.equal(env.targets.length, 0, 'no focus target');
});

test('keys.js: Shift+T clicks theme toggle; plain t does not', () => {
  const env = makeEnv();
  const btn = { tagName: 'BUTTON', isContentEditable: false, _clicked: false, click() { this._clicked = true; } };
  env.body._themeBtn = btn;

  fireKey(env, { key: 't', shiftKey: false });
  assert.equal(btn._clicked, false, 'plain t does not toggle theme');

  const ev = fireKey(env, { key: 'T', shiftKey: true });
  assert.equal(btn._clicked, true, 'Shift+T toggles theme');
  assert.equal(ev._prevented, true);
});

test('keys.js: prefers-reduced-motion — no animation triggered on overlay open', () => {
  const env = makeEnv({ reducedMotion: true });
  fireKey(env, { key: '?' });
  const overlay = env.appended[env.appended.length - 1];
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.style._props.animation, undefined, 'no animation set when reducedMotion');
});

test('keys.js: without reduced-motion, animation reset trick used on open', () => {
  const env = makeEnv({ reducedMotion: false });
  fireKey(env, { key: '?' });
  const overlay = env.appended[env.appended.length - 1];
  assert.equal(overlay.hidden, false);
  assert.equal(overlay.style._props.animation, '', 'animation reset to empty string after reflow trick');
});