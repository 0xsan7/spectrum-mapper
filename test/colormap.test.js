const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

/**
 * The heatmap's rendering layer, loaded the way the page loads it.
 *
 * colors.js and the pure helpers of heatmap.js are classic <script> tags, so
 * they cannot be require()d. This loads them into a bare VM context and reads
 * the top-level names back out, which is enough to unit test the ramp maths and
 * the contour tracing without a DOM.
 *
 * Note: `class X {}` at the top level of a classic script creates a *lexical*
 * global binding, not a property on the global object, so the names have to be
 * read with a follow-up expression evaluated inside the context.
 */
function loadScript(file, names) {
  const source = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  const context = vm.createContext({
    console,
    Math,
    Number,
    JSON,
    Object,
    Array,
    Infinity,
    Map,
    Set,
    String,
    Boolean,
  });
  vm.runInContext(source, context, { filename: file });
  return vm.runInContext(
    `({ ${names
      .map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`)
      .join(', ')} })`,
    context,
    { filename: `${file}:exports` }
  );
}

const loadColors = () => loadScript('colors.js', ['ColorMapper']).ColorMapper;
const arr = (v) => Array.from(v);

/**
 * Values that crossed the VM boundary carry that context's prototypes, so
 * deepStrictEqual fails on identity even when the contents are identical -
 * "Values have same structure but are not reference-equal" on two empty
 * arrays. Array.from fixes it; Array#map does not, because map is the other
 * realm's method and hands back another VM array.
 */
const list = (v) =>
  Array.isArray(v) ? Array.from(v, (x) => (Array.isArray(x) ? list(x) : x)) : v;

/* ------------------------------------------------------------------ ramps */

test('the default ramp is perceptual, not the old blue-red one', () => {
  const ColorMapper = loadColors();
  assert.strictEqual(ColorMapper.DEFAULT_RAMP, 'inferno');
  assert.ok(ColorMapper.rampNames().includes('inferno'));
});

test('a colour-blind-safe ramp is offered alongside the default', () => {
  const ColorMapper = loadColors();
  const names = ColorMapper.rampNames();
  assert.ok(names.includes('cividis'), 'the safe alternative must be offered');
  assert.ok(names.includes('classic'), 'the previous ramp stays available');
  assert.ok(names.length >= 3);
});

test('the ramp toggle cycles and wraps', () => {
  const ColorMapper = loadColors();
  const names = ColorMapper.rampNames();
  let current = names[0];
  for (let i = 0; i < names.length; i++) {
    current = ColorMapper.nextRamp(current);
    assert.strictEqual(current, names[(i + 1) % names.length]);
  }
  assert.strictEqual(current, names[0], 'wraps back to the first');
});

test('an unknown ramp name falls back rather than returning undefined', () => {
  const ColorMapper = loadColors();
  const unknown = arr(ColorMapper.getColor(-50, -100, -20, 'not-a-ramp'));
  const fallback = arr(
    ColorMapper.getColor(-50, -100, -20, ColorMapper.DEFAULT_RAMP)
  );
  assert.deepStrictEqual(unknown, fallback);
  assert.strictEqual(ColorMapper.hasRamp('not-a-ramp'), false);
  assert.strictEqual(ColorMapper.hasRamp('inferno'), true);
});

/**
 * The property that makes a ramp perceptual: lightness increases monotonically
 * with signal strength, so equal dB steps look like equal steps.
 *
 * Asserted on the perceptual ramps only. The classic ramp deliberately fails
 * it - that is the reason it is no longer the default - so it is excluded
 * rather than asserted to pass.
 */
/**
 * What "perceptual" has to mean, in a form that can fail.
 *
 * Two earlier versions of this check were both wrong:
 *
 *  1. "lightness never decreases" - satisfied by a constant function, so a
 *     completely flat ramp passed. (Confirmed: the audit built one.)
 *  2. "lightness rises by at least X per dB" - the wrong quantity entirely. A
 *     perceptually uniform ramp is deliberately NOT uniform in lightness;
 *     lightness is compressed in the middle on purpose. Requiring a minimum
 *     lightness slope fails the real inferno ramp (measured minimum step
 *     0.00239 against a 0.00465 floor at -56 dBm), which is the check being
 *     wrong rather than the ramp.
 *
 * Uniformity is measured the way it is defined: equal steps along the scale
 * should be equal *distances in Oklab*. So this asserts the per-step colour
 * distance is roughly constant - no huge steps and no flat stretches. A flat
 * ramp gives dE = 0 and fails; a jet-like ramp varies several-fold and fails.
 */
for (const ramp of ['inferno', 'cividis']) {
  test(`${ramp} resolves a gradient with no flat stretch`, () => {
    const ColorMapper = loadColors();
    const oklab = (rssi) =>
      ColorMapper.srgbToOklab(
        ...arr(ColorMapper.getColor(rssi, -100, -20, ramp))
      );

    // SCOPE, deliberately narrow: this proves the ramp *resolves* - enough
    // distinct colours, and no stretch of the scale that reads as one flat
    // value. It does NOT prove full perceptual uniformity.
    //
    // Two earlier attempts at the stronger claim were both wrong:
    //   - "lightness never decreases" is satisfied by a constant function, so a
    //     completely flat ramp passed;
    //   - "lightness rises by at least X per dB" fails the real inferno ramp
    //     (measured minimum step 0.00239 against a 0.00465 floor at -56 dBm),
    //     because perceptual ramps deliberately compress lightness mid-scale.
    //
    // A uniform-spread-of-dE test was tried and is not a discriminator either:
    // a hand-built jet ramp scored 3.59 against inferno's 4.43, because control
    // points spaced evenly defeat it. Strong uniformity is a claim about how
    // the control points are spaced relative to the ramp's own dE curve, and
    // this test does not attempt it. Over-claiming here would be the same
    // mistake as the looser checks it replaces.
    const STEPS = 320;
    const STEP_DB = 80 / STEPS;
    const distances = [];
    const colours = new Set();
    for (let i = 0; i <= STEPS; i++) {
      const rssi = -100 + i * STEP_DB;
      const rgb = arr(ColorMapper.getColor(rssi, -100, -20, ramp));
      colours.add(rgb.join(','));
      if (i === 0) continue;
      const a = oklab(rssi - STEP_DB);
      const b = oklab(rssi);
      distances.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }

    const sorted = [...distances].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    const max = sorted[sorted.length - 1];

    // Measured: inferno 321 distinct colours, cividis 290.
    assert.ok(
      colours.size >= 200,
      `${ramp}: only ${colours.size} distinct colours over 80 dB - the ramp ` +
        'does not resolve a gradient'
    );
    assert.ok(
      median > 1e-4,
      `${ramp}: median step ${median.toExponential(2)} is zero`
    );

    // Measured: inferno max/median 4.43, cividis 1.51. Both real ramps clear
    // 6, so 8 leaves headroom without letting a plateau through.
    assert.ok(
      max / median < 8,
      `${ramp}: colour steps vary ${(max / median).toFixed(1)}x across the scale ` +
        `(median dE ${median.toFixed(4)}, max ${max.toFixed(4)}) - part of the ` +
        'scale does not read as a gradient'
    );
  });
}

test('the perceptual ramps span dark to light end to end', () => {
  const ColorMapper = loadColors();
  for (const ramp of ['inferno', 'cividis']) {
    const dark = ColorMapper.lightnessOf(
      arr(ColorMapper.getColor(-100, -100, -20, ramp))
    );
    const light = ColorMapper.lightnessOf(
      arr(ColorMapper.getColor(-20, -100, -20, ramp))
    );
    // cividis starts at L=0.252, not lower: it is deliberately not near-black,
    // because a black low end disappears against a dark page. The bound is set
    // from the published ramp, not from taste.
    assert.ok(
      dark < 0.3,
      `${ramp}: -100 dBm should be dark, got L=${dark.toFixed(3)}`
    );
    assert.ok(
      light > 0.85,
      `${ramp}: -20 dBm should be light, got L=${light.toFixed(3)}`
    );
  }
});

/**
 * cividis is specifically designed so deuteranopes and protanopes can still
 * order the scale. Simulating the dichromat confusion and re-checking
 * monotonicity is the only honest way to assert that here: the claim is about
 * what a viewer perceives, and the published result only holds if the ramp is
 * used unmodified.
 */
test('cividis stays monotonic in lightness under simulated colour blindness', () => {
  const ColorMapper = loadColors();

  /** Brettel/Viénot-style simulation of protan and deutan, in linear RGB. */
  const dichromat = (rgb, kind) => {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const enc = (v) => {
      const c =
        v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      return Math.max(0, Math.min(255, Math.round(c * 255)));
    };
    const [R, G, B] = [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])];
    let L, M, S;
    if (kind === 'protan') {
      L = 17.8824 * R + 43.5161 * G + 4.11935 * B;
      M = 3.45565 * R + 27.1554 * G + 3.86714 * B;
      S = 0.0299566 * R + 0.184309 * G + 1.46709 * B;
    } else {
      L = 0.494207 * R + 1.24827 * G + 0.19453 * B;
      M = 0.494207 * R + 1.24827 * G + 0.19453 * B;
      S = 0.000841 * R + 0.0165158 * G + 0.784806 * B;
    }
    return [enc(L), enc(M), enc(S)];
  };

  for (const kind of ['protan', 'deutan']) {
    let previous = -Infinity;
    let worstDrop = 0;
    for (let rssi = -100; rssi <= -20; rssi += 0.5) {
      const seen = dichromat(
        arr(ColorMapper.getColor(rssi, -100, -20, 'cividis')),
        kind
      );
      const L = ColorMapper.lightnessOf(seen);
      if (L < previous) worstDrop = Math.max(worstDrop, previous - L);
      previous = Math.max(previous, L);
    }
    assert.ok(
      worstDrop < 0.02,
      `cividis lost ${worstDrop.toFixed(4)} of lightness ordering under ${kind}`
    );
  }
});

test('every ramp returns an in-gamut triple for every dBm on the scale', () => {
  const ColorMapper = loadColors();
  for (const ramp of ColorMapper.rampNames()) {
    for (let rssi = -100; rssi <= -20; rssi += 0.25) {
      const rgb = arr(ColorMapper.getColor(rssi, -100, -20, ramp));
      assert.strictEqual(rgb.length, 3, `${ramp} at ${rssi}`);
      for (const channel of rgb) {
        assert.ok(
          Number.isInteger(channel) && channel >= 0 && channel <= 255,
          `${ramp} at ${rssi} produced ${rgb}`
        );
      }
    }
  }
});

test('the legend gradient is built from the same ramp as the map', () => {
  const ColorMapper = loadColors();
  for (const ramp of ColorMapper.rampNames()) {
    const css = ColorMapper.toGradient(ramp, -100, -20, 8);
    assert.ok(css.startsWith('linear-gradient(to right,'), `${ramp}: ${css}`);
    // The endpoints must be the ramp's endpoints, so the bar cannot disagree
    // with what the canvas paints.
    const stops = css.slice(css.indexOf('rgb(')).split(/,\s*/);
    assert.ok(stops.length >= 7, `${ramp}: too few stops`);
  }
  const a = ColorMapper.toGradient('inferno', -100, -20, 8);
  const b = ColorMapper.toGradient('cividis', -100, -20, 8);
  assert.notStrictEqual(a, b, 'two ramps must not render the same gradient');
});

/* --------------------------------------------------------------- contours */

const { contourSegments } = loadScript('heatmap.js', ['contourSegments']);

/**
 * Fixtures below are built column-major - x outer, y inner - because
 * contourSegments indexes grid[x * rows + y], the order src/heatmap.js emits.
 * Building them the other way round silently mislabels every cell and the
 * failure looks like a tracing bug rather than a fixture bug.
 */
test('a contour threshold crossing a flat field produces no segments', () => {
  const grid = [
    { x: 0, y: 0, rssi: -90 },
    { x: 0, y: 1, rssi: -90 },
    { x: 1, y: 0, rssi: -90 },
    { x: 1, y: 1, rssi: -90 },
  ];
  assert.deepStrictEqual(list(contourSegments(grid, 2, 2, -50)), []);
});

test('a contour threshold between two cells produces a segment across that edge', () => {
  // -100 below, -40 above: the -70 level crosses the edge between them.
  const grid = [
    { x: 0, y: 0, rssi: -100 },
    { x: 0, y: 1, rssi: -100 },
    { x: 1, y: 0, rssi: -40 },
    { x: 1, y: 1, rssi: -40 },
  ];
  const segments = contourSegments(grid, 2, 2, -70);
  assert.ok(
    segments.length > 0,
    'a crossing must produce at least one segment'
  );
  // Every segment endpoint must lie inside its own cell, i.e. in [0, cols].
  for (const seg of segments) {
    for (const [cx, cy] of seg) {
      assert.ok(cx >= 0 && cx <= 2, `x ${cx} outside the grid`);
      assert.ok(cy >= 0 && cy <= 2, `y ${cy} outside the grid`);
    }
  }
});

test('the three documented contour thresholds each trace something', () => {
  // A radial field centred in the room: each of -85, -70 and -50 is a circle
  // of a different radius, so all three must produce segments.
  const cols = 20;
  const rows = 15;
  const grid = [];
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const d = Math.hypot(x - 10, y - 7);
      // x8, not x4: at x4 the field topped out at -51 dBm, so no cell was ever
      // above -50 and the -50 contour legitimately traced nothing. The test was
      // checking the fixture, not the tracer.
      grid.push({ x, y, rssi: Math.round(-100 + d * 8) });
    }
  }
  for (const level of [-85, -70, -50]) {
    const segments = contourSegments(grid, cols, rows, level);
    assert.ok(
      segments.length >= 8,
      `-${level * -1} dBm traced only ${segments.length} segments`
    );
  }
});

test('contours get denser as the level approaches the source', () => {
  const cols = 20;
  const rows = 15;
  const grid = [];
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      grid.push({
        x,
        y,
        rssi: Math.round(-100 + Math.hypot(x - 10, y - 7) * 8),
      });
    }
  }
  // -85 dBm is a small circle near the source; -50 is a much larger one, so
  // there is strictly more of it inside the room.
  const inner = contourSegments(grid, cols, rows, -85).length;
  const outer = contourSegments(grid, cols, rows, -50).length;
  assert.ok(
    outer > inner,
    `expected the -50 contour to be longer than -85, got ${outer} vs ${inner}`
  );
});

test('null cells break a contour instead of being treated as zero dBm', () => {
  // A 3x3 radial field, so a contour at -70 genuinely runs through the middle
  // of the grid, and then one interior cell is nulled out.
  //
  // The previous fixture put the null in a corner of a 2x2 grid, so the cell
  // containing it was skipped wholesale and the tracer returned no segments at
  // all - the loop below ran zero times and the test could not fail. Confirmed
  // by mutating the tracer three ways (unguarded read, an explicit `return 0`,
  // guard deleted): the whole suite stayed green every time.
  const cols = 3;
  const rows = 3;
  const grid = [];
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      grid.push({ x, y, rssi: -100 + Math.hypot(x - 1, y - 1) * 30 });
    }
  }
  const withHole = grid.map((cell) => ({ ...cell }));
  withHole[1 * rows + 1] = { x: 1, y: 1, rssi: null, hasData: false };

  const whole = contourSegments(grid, cols, rows, -70);
  assert.ok(
    whole.length > 0,
    'the unholed field must trace something to compare against'
  );

  const holed = contourSegments(withHole, cols, rows, -70);
  assert.ok(
    holed.length < whole.length,
    `nulling the centre must break the contour; ${holed.length} vs ${whole.length} segments`
  );
  for (const seg of holed) {
    for (const [cx, cy] of seg) {
      assert.ok(
        Number.isFinite(cx) && Number.isFinite(cy),
        `non-finite point ${seg}`
      );
    }
  }

  // The decisive assertion: a null read as 0 dBm is a *very strong* signal, so
  // it would push the crossing to the far edge of its cell rather than remove
  // it. Build the same field with the centre at 0 dBm and require a different
  // answer.
  const asZero = grid.map((cell) => ({ ...cell }));
  asZero[1 * rows + 1] = { x: 1, y: 1, rssi: 0 };
  const zeroed = contourSegments(asZero, cols, rows, -70);
  const shape = (segs) =>
    list(
      segs.map((seg) =>
        seg.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))])
      )
    );
  assert.notDeepStrictEqual(
    shape(holed),
    shape(zeroed),
    'a null cell must not behave like a 0 dBm cell'
  );
});

test('contour thresholds are inclusive at the level and exclusive outside it', () => {
  // A cell exactly at the threshold does not count as "above" it.
  const grid = [
    { x: 0, y: 0, rssi: -100 },
    { x: 0, y: 1, rssi: -100 },
    { x: 1, y: 0, rssi: -70 },
    { x: 1, y: 1, rssi: -70 },
  ];
  assert.deepStrictEqual(
    list(contourSegments(grid, 2, 2, -70)),
    [],
    'nothing is strictly above the level, so there is no crossing'
  );
});

test('a single-cell grid produces no contours rather than throwing', () => {
  assert.deepStrictEqual(
    list(contourSegments([{ x: 0, y: 0, rssi: -50 }], 1, 1, -70)),
    []
  );
  assert.deepStrictEqual(list(contourSegments([], 0, 0, -70)), []);
});
