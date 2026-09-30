/**
 * Measure the numbers the README claims.
 *
 * Every figure in the README's performance section is produced here, from the
 * same code paths the server runs and the same default configuration the app
 * starts with. Run it and paste the output; do not estimate.
 *
 *   node scripts/benchmark.js
 */
const { performance } = require('node:perf_hooks');

const PathLossModel = require('../src/pathLoss');
const HeatmapGenerator = require('../src/heatmap');
const Trilateration = require('../src/trilateration');
const Receivers = require('../src/receivers');
const { CONFIG, RF_SOURCES } = require('../src/config/constants');
const { localisationErrors, OPTS } = require('./localisation-errors');

// The shipped defaults, not invented ones. A benchmark on a different layout
// measures a different program.
const SOURCES = RF_SOURCES.map((s) => ({ ...s }));
const RECEIVERS = new Receivers().getNodes();
// OPTS and the receiver layout come from the shared accuracy module, so the
// benchmark and verify:readme cannot drift apart on what they are measuring.

function time(label, iterations, fn) {
  // Batch sub-microsecond work: performance.now() has microsecond resolution
  // but carries per-call overhead, so timing one arithmetic operation on its
  // own reports 0.000ms and means nothing.
  const batch = fn.batchSize || 1;
  const rounds = Math.max(1, Math.floor(iterations / batch));

  for (let i = 0; i < batch; i++) fn(); // warm up, exclude JIT

  const samples = [];
  for (let r = 0; r < rounds; r++) {
    const start = performance.now();
    for (let i = 0; i < batch; i++) fn();
    samples.push((performance.now() - start) / batch);
  }

  samples.sort((a, b) => a - b);
  return {
    label,
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    median: samples[Math.floor(samples.length / 2)],
    p95: samples[Math.floor(samples.length * 0.95)],
  };
}

/** Microseconds below 1ms, milliseconds above. */
function fmt(ms) {
  return ms < 1 ? `${(ms * 1000).toFixed(2)}us` : `${ms.toFixed(3)}ms`;
}

function row(r) {
  return `  ${r.label.padEnd(34)} ${fmt(r.mean).padStart(9)} mean  ${fmt(
    r.median
  ).padStart(9)} median  ${fmt(r.p95).padStart(9)} p95`;
}

console.log(`node ${process.version} on ${process.platform}/${process.arch}`);
console.log('');

const grid = HeatmapGenerator.generate(SOURCES, OPTS);
console.log(
  `Room ${CONFIG.ROOM_WIDTH}x${CONFIG.ROOM_HEIGHT} m at ${CONFIG.GRID_RESOLUTION} m = ${grid.length} cells, ${SOURCES.length} sources, ${RECEIVERS.length} receivers`
);
console.log('');
console.log('Per-operation cost');

const rssiFn = () => PathLossModel.calculateRSSI(20, 12.5, OPTS);
rssiFn.batchSize = 1000;
const lossFn = () => PathLossModel.pathLoss(12.5, OPTS);
lossFn.batchSize = 1000;
const triFn = () =>
  Trilateration.leastSquares(
    RECEIVERS,
    RECEIVERS.map((r) => Math.hypot(r.x - 10, r.y - 7))
  );
triFn.batchSize = 1000;

const ops = [
  time('calculateRSSI (per call)', 200000, rssiFn),
  time('pathLoss (per call)', 200000, lossFn),
  time('generateHeatmap (per frame)', 500, () =>
    HeatmapGenerator.generate(SOURCES, OPTS)
  ),
  time('calculateStats (per frame)', 5000, () =>
    HeatmapGenerator.calculateStats(grid)
  ),
  time('leastSquares (per call)', 100000, triFn),
];
ops.forEach((r) => console.log(row(r)));

const frameMs = ops[2].mean + ops[3].mean + ops[4].mean;
console.log('');
console.log('Frame budget');
console.log(
  `  full frame (heatmap + stats + trilateration): ${frameMs.toFixed(3)}ms`
);
console.log(
  `  configured update interval:                ${CONFIG.UPDATE_RATE}ms`
);
console.log(
  `  headroom:                                   ${(CONFIG.UPDATE_RATE / frameMs).toFixed(0)}x`
);

// How far the grid can grow before the update interval becomes the limit.
const perCell = ops[2].mean / grid.length;
const maxCells = Math.floor(CONFIG.UPDATE_RATE / perCell);
const side = Math.floor(Math.sqrt(maxCells));
console.log(
  `  at ${fmt(perCell)}/cell, ${CONFIG.UPDATE_RATE}ms allows ~${maxCells.toLocaleString()} cells`
);
console.log(
  `  e.g. a ${side}x${Math.floor(maxCells / side)} m room at 1 m resolution`
);
console.log('');

/**
 * Localisation accuracy, on the shipped receiver layout, walking the tracked
 * transmitter the way the simulation does - so this is the figure a user sees
 * in the sidebar, not a favourable arrangement.
 */
console.log('Trilateration accuracy (shipped receiver layout)');
// The accuracy walk lives in scripts/localisation-errors.js so that
// verify:readme can check the README's accuracy figures in CI without
// running this timing script. Both read the same computation.
const acc = localisationErrors();
console.log(
  `  n=${acc.count} positions, ${OPTS.fadingDb} dB fading: mean ${acc.mean.toFixed(
    2
  )} m, median ${acc.median.toFixed(2)} m, p95 ${acc.p95.toFixed(2)} m, max ${acc.max.toFixed(2)} m`
);

console.log(
  `  with fading off the fit is an exact inverse (max ${acc.maxNoFading.toExponential(
    1
  )} m): the error above is fading, not solver error`
);

// The room-wide figure above is dominated by positions far from the receiver
// cluster, and the default simulation starts the tracked device near the
// centre. Breaking it down keeps the README honest about both.
console.log('  error vs distance from the middle of the room:');
for (const band of acc.bands) {
  console.log(
    `    ${band.lo}-${band.hi} m from centre: n=${String(band.n).padStart(
      4
    )}, mean ${band.mean.toFixed(2)} m`
  );
}
console.log('');

console.log('Startup and payload');
const t0 = performance.now();
require('../src/server');
console.log(
  `  require('../src/server'):  ${(performance.now() - t0).toFixed(1)}ms`
);
console.log(
  `  runtime dependencies:      ${Object.keys(
    require('../package.json').dependencies
  ).join(', ')}`
);
console.log(
  `  heatmap (${grid.length} cells):      ${JSON.stringify(grid).length} bytes`
);
console.log('');
console.log(
  'Re-run this script to reproduce. Numbers vary by machine and Node version.'
);
