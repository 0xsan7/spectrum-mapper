/**
 * The sidebar tab strip has to hold five labels without truncating.
 *
 * At 19rem the strip is ~61px per tab, and "Measured" is the longest label. It
 * overflowed by 6px at both 1440x800 and 1366x768 - visible as an ellipsis
 * eating the last letter, which looks like a rendering fault rather than a
 * layout one.
 *
 * These are layout facts, so they are checked against the stylesheet's actual
 * numbers rather than by re-measuring in a browser: the harness that found the
 * 6px is outside CI, and a check that only runs there is a check that rots.
 * The arithmetic below is the same one the browser agreed with.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/** The labels, in order, straight from the markup. */
function labels() {
  return [...html.matchAll(/role="tab"[\s\S]{0,260}?>\s*([A-Za-z]+)\s*</g)].map(
    (m) => m[1]
  );
}

/**
 * The `.tab` rule's declared values.
 * @param {RegExp} prop property name
 */
function tabRule(prop) {
  const block = css.slice(css.indexOf('.tab {'), css.indexOf('.tab:hover'));
  const m = new RegExp(`(?:^|\\n)\\s*${prop}:\\s*([^;]+);`).exec(block);
  return m ? m[1].trim() : null;
}

/** Every --token in :root, resolved to px. */
const TOKENS = (() => {
  const root = css.slice(
    css.indexOf(':root {'),
    css.indexOf('}', css.indexOf(':root {'))
  );
  const out = {};
  for (const m of root.matchAll(/--([\w-]+):\s*([\d.]+)(px|rem)\s*;/g)) {
    const value = parseFloat(m[2]);
    out[`--${m[1]}`] = m[3] === 'rem' ? value * 16 : value;
  }
  return out;
})();

/** Resolve a length that may be px, rem, or a var() referring to either. */
function resolve(token) {
  if (token === undefined || token === null) return null;
  const text = String(token).trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(text);
  if (ref) return TOKENS[ref[1]] ?? null;
  const m = /^([\d.]+)(px|rem)$/.exec(text);
  if (!m) return null;
  const value = parseFloat(m[1]);
  return m[2] === 'rem' ? value * 16 : value;
}

/**
 * A CSS shorthand's four side lengths, expanded from 1, 2, 3 or 4 tokens.
 * Returns null if any side cannot be resolved, so a caller never silently
 * treats an unknown value as zero.
 */
function boxSides(shorthand) {
  const parts = String(shorthand).trim().split(/\s+/);
  let top;
  let right;
  let bottom;
  let left;
  if (parts.length === 1)
    [top, right, bottom, left] = [parts[0], parts[0], parts[0], parts[0]];
  else if (parts.length === 2)
    [top, right, bottom, left] = [parts[0], parts[1], parts[0], parts[1]];
  else if (parts.length === 3)
    [top, right, bottom, left] = [parts[0], parts[1], parts[2], parts[1]];
  else [top, right, bottom, left] = parts;
  const sides = [top, right, bottom, left].map(resolve);
  return sides.some((v) => v === null) ? null : sides;
}

test('every tab label is distinct and non-empty', () => {
  const names = labels();
  assert.strictEqual(names.length, 5);
  assert.strictEqual(new Set(names).size, 5, 'labels must be unique');
  for (const n of names)
    assert.ok(n.length > 2, `"${n}" is too short to be a tab label`);
});

test('the longest label fits its tab, with the sidebar width it actually has', () => {
  const sidebar = /^\.info-section\s*\{([\s\S]*?)\n\}/m.exec(css);
  assert.ok(sidebar, 'could not find .info-section');
  const widthRem = /width:\s*([\d.]+rem)/.exec(sidebar[1]);
  assert.ok(widthRem, '.info-section must declare a width');
  const sidebarPx = resolve(widthRem[1]);

  const fontPx = resolve(tabRule('font-size'));
  const trackingEm = parseFloat(tabRule('letter-spacing')) || 0;
  const sides = boxSides(tabRule('padding'));
  assert.ok(sides, `could not resolve the tab padding "${tabRule('padding')}"`);

  assert.ok(
    fontPx,
    `could not resolve the tab font size "${tabRule('font-size')}"`
  );

  // Mono glyphs are ~0.6em wide; the widest label sets the requirement.
  const names = labels();
  const longest = Math.max(...names.map((n) => n.length));
  const textPx = longest * fontPx * 0.6 * (1 + trackingEm);
  const neededPx = textPx + sides[1] + sides[3];
  const availablePx = sidebarPx / names.length;

  assert.ok(
    neededPx <= availablePx,
    `the longest label ("${names.find((n) => n.length === longest)}", ${longest} chars) ` +
      `needs about ${neededPx.toFixed(1)}px including padding, but a tab in a ` +
      `${sidebarPx}px sidebar is only ${availablePx.toFixed(1)}px wide. It ` +
      'truncates to an ellipsis, which reads as a rendering fault.'
  );
});

test('the tab padding is tight enough for the labels to fit', () => {
  // The regression guard, stated as the property rather than the number: if a
  // future change widens the inline padding or the tracking, this fails before
  // anyone sees an ellipsis.
  const sides = boxSides(tabRule('padding'));
  assert.ok(sides, 'the tab padding must resolve to lengths');
  assert.ok(
    sides[1] <= 4,
    `inline tab padding is ${tabRule('padding')}; anything above 4px pushes "Measured" ` +
      'into an ellipsis at 19rem'
  );
  const tracking = parseFloat(tabRule('letter-spacing'));
  assert.ok(
    !(tracking > 0.04),
    `letter-spacing ${tabRule('letter-spacing')} is wider than the labels can afford`
  );
});

test('the selected tab is marked by an underline, not a fill colour alone', () => {
  // A colour-only indicator fails anyone who cannot distinguish the hues, and
  // aria-selected carries the state for assistive tech; the underline is what
  // makes it visible.
  const selected = /\.tab\[aria-selected='true'\]\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(selected, 'there must be a rule for the selected tab');
  assert.ok(
    /border-bottom-color:\s*var\(--accent\)/.test(selected[1]),
    'the selected tab needs a visible underline, not only a text colour change'
  );
  assert.ok(
    /border-bottom-width:\s*2px/.test(
      css.slice(css.indexOf('.tab {'), css.indexOf('.tab:hover'))
    ),
    'the underline must be thick enough to be seen against the strip'
  );
});

test('the tab strip has no rounded corners, to match the instrument panels', () => {
  const radius = tabRule('border-radius');
  assert.ok(
    radius === '0' || radius === null,
    `the tab strip has border-radius: ${radius}; the panels are square-cornered ` +
      'and the tabs should match'
  );
});

test('the reconnect notice is positioned against the map, not the page', () => {
  // absolute, so it overlays the map rather than being pushed into the flow
  // and moving the layout when the socket drops.
  const block = /\.reconnect\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(block, 'could not find .reconnect');
  assert.ok(
    /position:\s*absolute/.test(block[1]),
    'the notice must not enter the flow'
  );
  assert.ok(
    /\[hidden\]\s*\{[\s\S]*?display:\s*none/.test(css),
    'hidden must hide it'
  );
});

test('the sheet closes from the keyboard, not only the mouse', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'public', 'shortcuts.js'),
    'utf8'
  );
  assert.ok(
    /event\.key === 'Escape'/.test(src),
    'Escape must close the sheet, or a keyboard user is trapped in a modal'
  );
  // And it must actually call close(), not merely notice the key.
  const escapeArm = src.slice(src.indexOf("event.key === 'Escape'"));
  const arm = escapeArm.slice(0, escapeArm.indexOf('return;'));
  assert.ok(
    /sheet\.close\(\)/.test(arm),
    'the Escape branch must close the sheet'
  );
});
