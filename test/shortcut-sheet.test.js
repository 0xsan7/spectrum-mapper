/**
 * The `?` shortcut sheet, and the reconnecting notice.
 *
 * The sheet exists because the shortcuts were implemented but only documented
 * in the README and in a hint at the bottom of a scrolling sidebar - below the
 * fold at 1440x800. A keyboard-only user had no way to find them.
 *
 * The point of generating it from ShortcutSheet.BINDINGS is that a help list
 * which can drift from the bindings is worse than none: it is confidently
 * wrong. These check the two halves agree, and that the notice only appears
 * while the socket is genuinely down.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

function makeEl(tag = 'div') {
  const el = {
    tagName: tag,
    children: [],
    attrs: {},
    dataset: {},
    style: {},
    _text: '',
    listeners: {},
    focused: false,
    get id() {
      return this.attrs.id;
    },
    set id(v) {
      this.attrs.id = v;
    },
    get className() {
      return this.attrs.class || '';
    },
    set className(v) {
      this.attrs.class = v;
    },
    setAttribute(k, v) {
      if (v === null) delete this.attrs[k];
      else this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return k in this.attrs ? this.attrs[k] : null;
    },
    hasAttribute(k) {
      return k in this.attrs;
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    append(...cs) {
      cs.forEach((c) => this.children.push(c));
    },
    addEventListener(type, fn) {
      (el.listeners[type] = el.listeners[type] || []).push(fn);
    },
    focus() {
      el.focused = true;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    get textContent() {
      return this._text;
    },
    set textContent(v) {
      this._text = String(v);
    },
    get innerHTML() {
      return this._innerHTML || '';
    },
    set innerHTML(v) {
      this._innerHTML = String(v);
      if (this._innerHTML === '') this.children = [];
    },
  };
  return el;
}

function loadApp() {
  const byId = {};
  const sheetSrc = fs.readFileSync(
    path.join(PUBLIC, 'shortcut-sheet.js'),
    'utf8'
  );
  const shortSrc = fs.readFileSync(path.join(PUBLIC, 'shortcuts.js'), 'utf8');
  const document = {
    activeElement: null,
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => makeEl(tag),
    addEventListener: () => {},
  };
  const sandbox = vm.createContext({
    Math,
    Number,
    JSON,
    Object,
    Array,
    String,
    Boolean,
    console,
    document,
    window: {},
  });
  vm.runInContext(sheetSrc, sandbox);
  const ShortcutSheet = vm.runInContext('ShortcutSheet', sandbox);
  vm.runInContext(shortSrc, sandbox);
  const KeyboardShortcuts = vm.runInContext('KeyboardShortcuts', sandbox);
  return { ShortcutSheet, KeyboardShortcuts, document, byId };
}

/* ---- the markup ---------------------------------------------------------- */

test('the sheet is a modal dialog, hidden until asked for', () => {
  assert.ok(
    html.includes('id="shortcutSheet"'),
    'the sheet element must exist'
  );
  assert.ok(/role="dialog"/.test(html), 'the sheet must be a dialog');
  assert.ok(/aria-modal="true"/.test(html), 'the sheet must be modal');
  assert.ok(
    /id="shortcutSheet"[\s\S]{0,400}?\shidden/.test(html) ||
      /hidden[\s\S]{0,400}?id="shortcutSheet"/.test(html),
    'the sheet must start hidden so it costs nothing and is not a tab stop'
  );
  assert.ok(
    /aria-labelledby="shortcutSheetTitle"/.test(html),
    'it needs an accessible name'
  );
});

test('the sheet has a focusable close control with a name', () => {
  assert.ok(
    html.includes('data-shortcut-close'),
    'a close control is required'
  );
  assert.ok(
    /aria-label="Close the shortcut list"/.test(html),
    'the close control is text, but it must still carry a name in case the ' +
      'label is ever dropped'
  );
});

test('the reconnect notice is a polite status region', () => {
  assert.ok(html.includes('id="reconnectNotice"'), 'the notice must exist');
  assert.ok(
    /role="status"/.test(html),
    'a status region, so it is announced politely'
  );
  assert.ok(
    /id="reconnectNotice"[\s\S]{0,300}?aria-live="polite"/.test(html),
    'aria-live=polite so it does not interrupt'
  );
});

test('the pulsing dot respects prefers-reduced-motion', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  assert.ok(css.includes('@keyframes reconnect-pulse'), 'the dot pulses');
  const reduce = css.slice(
    css.indexOf('@media (prefers-reduced-motion: reduce)')
  );
  assert.ok(
    /\.reconnect-dot\s*\{[^}]*animation:\s*none/.test(reduce),
    'the animation must be switched off under prefers-reduced-motion'
  );
});

/* ---- the sheet and the bindings must agree ------------------------------- */

test('every key in the sheet is bound, and every bound key is in the sheet', () => {
  const { ShortcutSheet, KeyboardShortcuts } = loadApp();
  // The table's key names ('Space', 'R') and the map's physical keys (' ', 'r')
  // are different vocabularies; compare what they resolve to, not their spelling.
  const advertised = new Set(
    ShortcutSheet.BINDINGS.flatMap((b) => b.keys.map((k) => k.toUpperCase()))
  );
  const bound = new Set(
    Object.values(KeyboardShortcuts.KEY_TO_BINDING).map((k) => k.toUpperCase())
  );

  for (const key of advertised) {
    if (key === 'TAB' || key === 'LEFT' || key === 'RIGHT') continue; // navigation, not shortcuts
    assert.ok(
      bound.has(key),
      `the sheet advertises "${key}" but nothing binds that key`
    );
  }
  for (const key of bound) {
    assert.ok(
      advertised.has(key.toUpperCase()),
      `"${key}" is bound to a shortcut but the sheet never mentions it`
    );
  }
});

test('every bound binding has a handler, or is navigation', () => {
  const { ShortcutSheet } = loadApp();
  for (const b of ShortcutSheet.BINDINGS) {
    const navigates = ['Tab', 'Left', 'Right'].some((k) => b.keys.includes(k));
    assert.ok(
      b.run || navigates,
      `the sheet lists ${b.keys.join('/')} but nothing implements it`
    );
  }
});

test('every binding says what it does', () => {
  const { ShortcutSheet } = loadApp();
  for (const b of ShortcutSheet.BINDINGS) {
    assert.ok(
      b.label && b.label.length > 5,
      `${b.keys.join('/')} has no description`
    );
  }
});

test('the sheet lists every shortcut the README documents', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const { ShortcutSheet } = loadApp();
  const advertised = new Set(
    ShortcutSheet.BINDINGS.flatMap((b) => b.keys.map((k) => k.toLowerCase()))
  );
  // The Controls table's Key column.
  const documented = [...readme.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) =>
    m[1].trim().toLowerCase()
  );
  for (const key of documented) {
    if (key === 'key' || key === 'arrow keys' || key === 'left / right')
      continue;
    const single = key
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const k of single) {
      if (!k || k.length > 3) continue;
      assert.ok(
        advertised.has(k),
        `the README documents the "${k}" key but the sheet omits it`
      );
    }
  }
});

/* ---- behaviour ----------------------------------------------------------- */

test('the sheet lists one row per available binding', () => {
  const { ShortcutSheet } = loadApp();
  const root = makeEl('div');
  const list = makeEl('div');
  root.querySelector = (sel) => (sel === '[data-shortcut-list]' ? list : null);
  const sheet = new ShortcutSheet(root);
  const n = sheet.render({});
  assert.strictEqual(n, ShortcutSheet.BINDINGS.length);
  assert.strictEqual(list.children.length, n);
  assert.strictEqual(
    list.children.filter((row) => row.children.length === 2).length,
    n,
    'each row is a key plus a description'
  );
});

test('every binding is available in the normal case', () => {
  const { ShortcutSheet } = loadApp();
  const root = makeEl('div');
  const list = makeEl('div');
  root.querySelector = (sel) => (sel === '[data-shortcut-list]' ? list : null);
  const sheet = new ShortcutSheet(root);

  // Nothing is mode-gated today, and that is a fact worth pinning: the sheet
  // must not quietly drop a row because a gate defaulted the wrong way.
  // Array.from: the array comes from a VM realm, and deepStrictEqual compares
  // prototypes, so a cross-realm [] is never equal to a host-realm one.
  const gated = Array.from(ShortcutSheet.BINDINGS).filter((b) => b.available);
  assert.deepStrictEqual(
    gated,
    [],
    'a binding may only be gated if there is a real mode that cannot honour it'
  );
  assert.strictEqual(sheet.available({}).length, ShortcutSheet.BINDINGS.length);
  assert.strictEqual(sheet.render({}), ShortcutSheet.BINDINGS.length);
});

test('opening and closing moves focus back to where it was', () => {
  const { ShortcutSheet, document } = loadApp();
  const root = makeEl('div');
  const list = makeEl('div');
  const close = makeEl('button');
  root.querySelector = (sel) => {
    if (sel === '[data-shortcut-list]') return list;
    if (sel === '[data-shortcut-close]') return close;
    return null;
  };
  const sheet = new ShortcutSheet(root);

  const opener = makeEl('button');
  document.activeElement = opener;

  sheet.show({});
  assert.ok(sheet.open, 'the sheet is open');
  assert.ok(!root.hasAttribute('hidden'), 'and not hidden');
  assert.ok(close.focused, 'focus moves into the sheet, onto the way out');

  sheet.close();
  assert.ok(!sheet.open);
  assert.ok(root.hasAttribute('hidden'), 'and hidden again');
  assert.ok(opener.focused, 'focus returns to whatever opened it');
});

test('closing when already closed does nothing', () => {
  const { ShortcutSheet } = loadApp();
  const root = makeEl('div');
  root.querySelector = () => null;
  const sheet = new ShortcutSheet(root);
  assert.strictEqual(sheet.close(), false);
});

test('clicking the backdrop closes, clicking the sheet does not', () => {
  const { ShortcutSheet } = loadApp();
  const root = makeEl('div');
  root.querySelector = () => null;
  const sheet = new ShortcutSheet(root);
  sheet.show({});

  root.listeners.click.forEach((fn) => fn({ target: root }));
  assert.ok(!sheet.open, 'the backdrop closes the sheet');

  sheet.show({});
  root.listeners.click.forEach((fn) => fn({ target: makeEl('div') }));
  assert.ok(sheet.open, 'a click inside the sheet must not close it');
});

test('the sheet loads before the code that constructs it', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(
    (m) => m[1]
  );
  assert.ok(
    scripts.indexOf('shortcut-sheet.js') < scripts.indexOf('dashboard.js'),
    'shortcut-sheet.js defines ShortcutSheet, which dashboard.js constructs'
  );
  assert.ok(
    scripts.indexOf('shortcut-sheet.js') < scripts.indexOf('shortcuts.js'),
    'shortcuts.js reads ShortcutSheet.BINDINGS at keydown time'
  );
});
