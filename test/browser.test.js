const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

/**
 * The browser files are classic <script> tags, not modules, so they cannot be
 * require()d. This loads one into a bare VM context and hands back whatever
 * top-level names it declared, which is enough to unit test the pure logic
 * (colour mapping, coverage bucketing) without a DOM.
 *
 * Note the second evaluate: `class X {}` at the top level of a classic script
 * creates a *lexical* global binding, not a property on the global object. So
 * `context.ColorMapper` is undefined even after the script runs, and the names
 * have to be read from inside the context with a follow-up expression. That is
 * the same scoping rule eslint.config.mjs documents for the real page.
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
  });
  vm.runInContext(source, context, { filename: file });
  const exported = vm.runInContext(
    `({ ${names.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ')} })`,
    context,
    { filename: `${file}:exports` }
  );
  return exported;
}

/**
 * Copy an array out of the VM realm into this one.
 *
 * Objects created inside a vm context use that context's Array.prototype, so
 * assert.deepStrictEqual rejects them on a prototype mismatch even when the
 * contents are identical. Spreading in the host realm produces a real Array.
 */
function hostArray(value) {
  return Array.from(value);
}

test('ColorMapper spans blue to red across the configured range', () => {
  const { ColorMapper } = loadScript('colors.js', ['ColorMapper']);

  const weakest = hostArray(ColorMapper.getColor(-100, -100, -20));
  const strongest = hostArray(ColorMapper.getColor(-20, -100, -20));

  assert.deepStrictEqual(weakest, [0, 102, 255], '-100 dBm is the blue end');
  assert.deepStrictEqual(strongest, [255, 0, 0], '-20 dBm is the red end');
});

test('ColorMapper clamps out-of-range values to the end colours', () => {
  const { ColorMapper } = loadScript('colors.js', ['ColorMapper']);
  assert.deepStrictEqual(
    hostArray(ColorMapper.getColor(-500, -100, -20)),
    [0, 102, 255],
    'below the floor clamps to blue'
  );
  assert.deepStrictEqual(
    hostArray(ColorMapper.getColor(50, -100, -20)),
    [255, 0, 0],
    'above the ceiling clamps to red'
  );
});

test('ColorMapper ramps blue to red with a single green peak', () => {
  const { ColorMapper } = loadScript('colors.js', ['ColorMapper']);
  // Blue -> green -> yellow -> red. Red only ever increases; green is
  // unimodal: it climbs to one peak on the way to yellow, then falls away to 0
  // at the red end. Asserting "green never rises" would be wrong, and so would
  // asserting it never falls.
  const samples = [];
  for (let rssi = -100; rssi <= -20; rssi += 1) {
    samples.push({
      rssi,
      rgb: hostArray(ColorMapper.getColor(rssi, -100, -20)),
    });
  }

  // Red is monotonic non-decreasing.
  for (let i = 1; i < samples.length; i++) {
    assert.ok(
      samples[i].rgb[0] >= samples[i - 1].rgb[0],
      `red fell at ${samples[i].rssi} dBm: ${samples[i - 1].rgb[0]} -> ${samples[i].rgb[0]}`
    );
  }
  assert.strictEqual(samples.at(-1).rgb[0], 255, 'the top of the range is red');

  // Green rises, then falls, with exactly one turn.
  const greens = samples.map((s) => s.rgb[1]);
  const peakIndex = greens.indexOf(Math.max(...greens));
  assert.ok(
    peakIndex > 0 && peakIndex < greens.length - 1,
    'the green peak must be interior'
  );
  for (let i = 1; i <= peakIndex; i++) {
    assert.ok(
      greens[i] >= greens[i - 1],
      `green dipped before the peak at index ${i}`
    );
  }
  for (let i = peakIndex + 1; i < greens.length; i++) {
    assert.ok(
      greens[i] <= greens[i - 1],
      `green rose again after the peak at index ${i}`
    );
  }
  assert.strictEqual(greens.at(-1), 0, 'the top of the range has no green');
});

test('ColorMapper survives a degenerate range instead of dividing by zero', () => {
  const { ColorMapper } = loadScript('colors.js', ['ColorMapper']);
  assert.deepStrictEqual(
    hostArray(ColorMapper.getColor(-50, -50, -50)),
    [0, 0, 0],
    'a zero-width range returns black rather than NaN'
  );
  hostArray(ColorMapper.getColor(-60, -60, -60)).forEach((channel) =>
    assert.ok(Number.isFinite(channel), 'no channel may be NaN')
  );
});

test('coverage bands partition the grid with no gaps or double counting', () => {
  const { SpectrumAnalyzer, spectrumAnalyzer } = loadScript(
    'spectrum-analysis.js',
    ['SpectrumAnalyzer', 'spectrumAnalyzer']
  );
  assert.ok(SpectrumAnalyzer.BANDS, 'bands are exposed');

  // A grid deliberately spread across every bucket, including the boundaries.
  const heatmap = [
    { rssi: -95 },
    { rssi: -80 },
    { rssi: -75 },
    { rssi: -70 },
    { rssi: -65 },
    { rssi: -60 },
    { rssi: -55 },
    { rssi: -50 },
    { rssi: -40 },
    { rssi: -20 },
  ];

  const report = spectrumAnalyzer.analyze(heatmap);
  const counted = report.bars.reduce((sum, b) => sum + b.count, 0);
  assert.strictEqual(
    counted,
    heatmap.length,
    'every cell must land in exactly one band'
  );
  const percentTotal = report.bars.reduce((sum, b) => sum + b.percent, 0);
  assert.ok(
    Math.abs(percentTotal - 100) < 1e-9,
    `bar widths must total 100%, got ${percentTotal}`
  );
});

test('band widths are percentages of the room, not count/3', () => {
  const { spectrumAnalyzer } = loadScript('spectrum-analysis.js', [
    'spectrumAnalyzer',
  ]);
  // Every cell in one band. The old code sized bars as count/3, which would
  // be 333% wide.
  const heatmap = Array.from({ length: 100 }, () => ({ rssi: -40 }));
  const report = spectrumAnalyzer.analyze(heatmap);
  const excellent = report.bars.find((b) => b.label === 'excellent');
  assert.strictEqual(excellent.count, 100);
  assert.strictEqual(excellent.percent, 100);
  report.bars.forEach((b) => {
    assert.ok(
      b.percent <= 100,
      `${b.label} at ${b.percent}% must not overflow`
    );
  });
});

test('coverage and dead zones use the documented bands', () => {
  const { spectrumAnalyzer, SpectrumAnalyzer } = loadScript(
    'spectrum-analysis.js',
    ['spectrumAnalyzer', 'SpectrumAnalyzer']
  );
  // 6 usable, 4 dead.
  const heatmap = [
    ...Array.from({ length: 6 }, () => ({ rssi: -45 })), // good
    ...Array.from({ length: 4 }, () => ({ rssi: -85 })), // unusable
  ];
  const report = spectrumAnalyzer.analyze(heatmap);
  assert.strictEqual(report.coverage, '60.0');
  assert.strictEqual(report.deadZones, '40.0');
  assert.ok(SpectrumAnalyzer.STRONG_BANDS.includes('good'));
  assert.ok(SpectrumAnalyzer.STRONG_BANDS.includes('excellent'));
});

test('an empty grid does not produce NaN percentages', () => {
  const { spectrumAnalyzer } = loadScript('spectrum-analysis.js', [
    'spectrumAnalyzer',
  ]);
  const report = spectrumAnalyzer.analyze([]);
  assert.strictEqual(report.coverage, '0.0');
  assert.strictEqual(report.deadZones, '0.0');
  report.bars.forEach((b) => assert.ok(Number.isFinite(b.percent)));
});
