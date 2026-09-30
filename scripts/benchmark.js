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

// The shipped defaults, not invented ones. A benchmark on a different layout
// measures a different program.
const SOURCES = RF_SOURCES.map((s) => ({ ...s }));
const RECEIVERS = new Receivers().getNodes();
const OPTS = { exponent: 2.7, frequency: 2437, fadingDb: 3 };

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
const tracked = SOURCES.find((s) => s.id === 'TX-3') || SOURCES[0];
const errors = [];
// Error paired with how far the target was from the middle of the room, so the
// report can distinguish "good near the receivers" from "degraded at the walls".
const paired = [];
for (let step = 0; step < 5000; step++) {
  const t = step / 40;
  const truth = {
    x: (CONFIG.ROOM_WIDTH / 2) * (1 + Math.sin(t) * 0.8),
    y: (CONFIG.ROOM_HEIGHT / 2) * (1 + Math.cos(t * 0.7) * 0.8),
  };
  const ranges = RECEIVERS.map((r) => {
    const d = Math.hypot(r.x - truth.x, r.y - truth.y);
    const rssi = PathLossModel.calculateRSSI(tracked.txPower, d, OPTS);
    return Trilateration.rssiToDistance(rssi, {
      txPower: tracked.txPower,
      exponent: OPTS.exponent,
      frequency: OPTS.frequency,
    });
  });
  const sol = Trilateration.leastSquares(RECEIVERS, ranges);
  if (sol) {
    const e = Trilateration.positionError(sol, truth);
    errors.push(e);
    paired.push({
      e,
      r: Math.hypot(
        truth.x - CONFIG.ROOM_WIDTH / 2,
        truth.y - CONFIG.ROOM_HEIGHT / 2
      ),
    });
  }
}
errors.sort((a, b) => a - b);
const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
const pct = (q) => errors[Math.floor(errors.length * q)];
console.log(
  `  n=${errors.length} positions, ${OPTS.fadingDb} dB fading: mean ${mean.toFixed(
    2
  )} m, median ${pct(0.5).toFixed(2)} m, p95 ${pct(0.95).toFixed(2)} m, max ${pct(
    0.999
  ).toFixed(2)} m`
);

// The same fit with fading off, to show what the number above is measuring.
let maxNoFading = 0;
for (let step = 0; step < 500; step++) {
  const truth = { x: 10, y: 7 };
  const ranges = RECEIVERS.map((r) => {
    const d = Math.hypot(r.x - truth.x, r.y - truth.y);
    const rssi = PathLossModel.calculateRSSI(tracked.txPower, d, {
      ...OPTS,
      fadingDb: 0,
    });
    return Trilateration.rssiToDistance(rssi, {
      txPower: tracked.txPower,
      exponent: OPTS.exponent,
      frequency: OPTS.frequency,
    });
  });
  const sol = Trilateration.leastSquares(RECEIVERS, ranges);
  if (sol) {
    maxNoFading = Math.max(
      maxNoFading,
      Trilateration.positionError(sol, truth)
    );
  }
}
console.log(
  `  with fading off the fit is an exact inverse (max ${maxNoFading.toExponential(
    1
  )} m): the error above is fading, not solver error`
);

// The room-wide figure above is dominated by positions far from the receiver
// cluster, and the default simulation starts the tracked device near the
// centre. Breaking it down keeps the README honest about both.
console.log('  error vs distance from the middle of the room:');
for (const band of [
  [0, 2],
  [2, 4],
  [4, 6],
  [6, 20],
]) {
  const [lo, hi] = band;
  const subset = paired.filter(({ r }) => r >= lo && r < hi);
  if (subset.length === 0) continue;
  const avg = subset.reduce((acc, { e }) => acc + e, 0) / subset.length;
  console.log(
    `    ${lo}-${hi} m from centre: n=${String(subset.length).padStart(
      4
    )}, mean ${avg.toFixed(2)} m`
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
