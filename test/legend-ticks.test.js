/**
 * The legend's level ticks must not go stale when the ramp changes.
 *
 * renderTicks() used to be a separate call that only onFrame made, so
 * cycleRamp() - which repaints the bar - left the ticks alone. That was
 * invisible while the ticks were ramp-independent, which they are: positioned
 * from dBm, styled from CSS. But nothing enforced it, so the first tick style
 * that did depend on the ramp would have gone stale on every switch with no
 * test failing.
 *
 * Two things are pinned here:
 *   1. render() draws the ticks as well as the bar, so there is one entry
 *      point and no caller can half-update the legend.
 *   2. The tick geometry really is ramp-independent, measured across all three
 *      ramps rather than assumed from reading the code.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

/** A DOM stub with just enough for LegendBar: elements, createElement, style. */
function makeDom() {
  const makeEl = (tag) => ({
    tagName: tag,
    children: [],
    _innerHTML: '',
    // renderTicks() clears with innerHTML = '' before repopulating. A stub that
    // ignores that leaves the previous ticks in place and they pile up, which
    // looks exactly like a stale-tick bug.
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(value) {
      this._innerHTML = String(value);
      if (this._innerHTML === '') this.children = [];
    },
    dataset: {},
    style: {},
    title: '',
    _text: '',
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
    },
    // A real settable textContent; a getter-only one throws the moment the
    // legend writes a label.
    get textContent() {
      return this._text || this.children.map((c) => c.textContent).join('');
    },
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    },
  });
  return {
    createElement: makeEl,
    makeEl,
  };
}

function loadLegend() {
  const src = fs.readFileSync(path.join(PUBLIC, 'legend.js'), 'utf8');
  const dom = makeDom();
  const ColorMapper = {
    DEFAULT_RAMP: 'inferno',
    RAMPS: {
      inferno: { label: 'inferno' },
      cividis: { label: 'cividis' },
      classic: { label: 'classic' },
    },
    nextRamp: (r) =>
      ({ inferno: 'cividis', cividis: 'classic', classic: 'inferno' })[r] || r,
    getColor: () => [1, 2, 3],
    toGradient: (ramp) => `linear-gradient(0deg, ramp-${ramp})`,
  };
  const sandbox = vm.createContext({
    Math,
    Number,
    JSON,
    Object,
    Array,
    String,
    Boolean,
    document: dom,
    ColorMapper,
    console,
  });
  vm.runInContext(src, sandbox);
  return { LegendBar: vm.runInContext('LegendBar', sandbox), dom };
}

const RAMPS = ['inferno', 'cividis', 'classic'];
const LEVELS = [-85, -70, -50];

function newLegend() {
  const { LegendBar, dom } = loadLegend();
  const legend = new LegendBar(
    dom.makeEl('div'),
    dom.makeEl('div'),
    dom.makeEl('div')
  );
  legend.levels = LEVELS;
  return legend;
}

/** Every tick's position and level, as plain values. */
function tickGeometry(legend) {
  return legend.ticks.children.map((t) => ({
    left: t.style.left,
    level: t.dataset.level,
    inlineStyle: Object.keys(t.style).sort().join(','),
  }));
}

test('render() draws the ticks, so no caller can repaint only the bar', () => {
  const legend = newLegend();
  legend.render(-100, -20, 'inferno');
  assert.deepStrictEqual(
    tickGeometry(legend).map((t) => t.level),
    ['-85', '-70', '-50'],
    'render() must place every configured level'
  );
});

test('the ticks survive a ramp switch without going stale', () => {
  const legend = newLegend();
  legend.render(-100, -20, 'inferno');
  const before = tickGeometry(legend);
  assert.ok(before.length > 0, 'the first render must have placed ticks');

  // What cycleRamp() does: change the ramp and re-render the legend.
  for (const ramp of ['cividis', 'classic', 'inferno']) {
    legend.render(-100, -20, ramp);
    assert.deepStrictEqual(
      tickGeometry(legend),
      before,
      `ticks changed or disappeared after switching to ${ramp}`
    );
  }
});

test('the tick geometry is ramp-independent, measured across all three ramps', () => {
  const seen = new Map();
  for (const ramp of RAMPS) {
    const legend = newLegend();
    legend.render(-100, -20, ramp);
    seen.set(ramp, tickGeometry(legend));
  }
  const [firstRamp, first] = [...seen.entries()][0];
  for (const [ramp, geometry] of seen) {
    if (ramp === firstRamp) continue;
    assert.deepStrictEqual(
      geometry,
      first,
      `ticks differ on ${ramp}; they are positioned from dBm and styled from ` +
        'CSS, so the ramp must not reach them. If this now fails, the ticks ' +
        'have become ramp-dependent and every ramp switch needs a repaint'
    );
  }
  // And the bar itself must have changed, or the test above proves nothing.
  const gradients = new Set(
    RAMPS.map((ramp) => {
      const legend = newLegend();
      legend.render(-100, -20, ramp);
      return legend.bar.style.background;
    })
  );
  assert.strictEqual(
    gradients.size,
    RAMPS.length,
    'each ramp must paint a distinct bar'
  );
});

test('a tick is styled by the stylesheet, not inline', () => {
  // This is what makes the ramp-independence above structural: the only inline
  // style a tick carries is its position.
  const legend = newLegend();
  legend.render(-100, -20, 'inferno');
  for (const tick of tickGeometry(legend)) {
    assert.strictEqual(
      tick.inlineStyle,
      'left',
      `a tick carries inline styles [${tick.inlineStyle}]; a colour here would ` +
        'not update on a ramp switch'
    );
  }
});

test('the tick colour lives in CSS, where a ramp-aware style would go', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  const block = css.slice(css.indexOf('.legend-ticks i {'));
  assert.ok(block.length > 0, 'could not locate the .legend-ticks i rule');
  assert.ok(
    /background:\s*var\(--accent\)/.test(block.slice(0, block.indexOf('}'))),
    'the tick colour must come from a custom property, so it is changeable in ' +
      'one place rather than per-tick'
  );
});

test('out-of-range levels are dropped rather than pinned to the end', () => {
  const legend = newLegend();
  legend.render(-80, -20, 'inferno');
  assert.deepStrictEqual(
    tickGeometry(legend).map((t) => t.level),
    ['-70', '-50'],
    '-85 is below this range and must not be clamped onto the bar'
  );
});

test('no levels configured means no ticks, not a guess', () => {
  const { LegendBar, dom } = loadLegend();
  const legend = new LegendBar(
    dom.makeEl('div'),
    dom.makeEl('div'),
    dom.makeEl('div')
  );
  legend.render(-100, -20, 'inferno');
  assert.deepStrictEqual(
    tickGeometry(legend),
    [],
    'until the dashboard sets the levels, render() must place none'
  );
});

test('onFrame no longer sequences the ticks separately from the bar', () => {
  // The structural half: if a future change re-adds a standalone renderTicks()
  // call, the coupling is back and nothing else would notice.
  const src = fs.readFileSync(path.join(PUBLIC, 'dashboard.js'), 'utf8');
  const calls = [...src.matchAll(/legend\.renderTicks\(/g)];
  assert.strictEqual(
    calls.length,
    0,
    'dashboard.js must not call legend.renderTicks() directly; render() owns ' +
      'the ticks so a ramp switch cannot skip them'
  );
  assert.ok(
    /this\.legend\.levels\s*=\s*CONTOUR_LEVELS/.test(src),
    'the dashboard must tell the legend which levels to mark, once'
  );
});
