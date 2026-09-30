/**
 * Deterministic localisation accuracy.
 *
 * Split out of scripts/benchmark.js because accuracy and speed are not the
 * same kind of claim. Accuracy here is pure geometry over a fixed walk of
 * positions: no clock, no randomness, no machine dependence. Verified identical
 * across 5 runs on Node 22 and 24, so verify:readme can keep checking the
 * README's error figures in CI.
 *
 * The benchmark's timing figures are the opposite - they move with the host
 * and the Node version, which is why they are local-only.
 *
 * benchmark.js imports this so both scripts describe the same computation.
 */
const PathLossModel = require('../src/pathLoss');
const Trilateration = require('../src/trilateration');
const Receivers = require('../src/receivers');
const { CONFIG, RF_SOURCES } = require('../src/config/constants');

const SOURCES = RF_SOURCES.map((s) => ({ ...s }));
const RECEIVERS = new Receivers().getNodes();
const OPTS = { exponent: 2.7, frequency: 2437, fadingDb: 3 };

// The walk the simulation performs: a Lissajous sweep of the room, 5000
// samples. Fixed by construction, so this returns the same numbers every run.
const WALK_STEPS = 5000;

/**
 * Mean/median/p95/max localisation error over the walked positions, plus the
 * same error bucketed by distance from the middle of the room.
 *
 * @returns {{count: number, mean: number, median: number, p95: number, max: number,
 *            maxNoFading: number, bands: Array<{lo: number, hi: number, n: number, mean: number}>}}
 */
function localisationErrors() {
  const tracked = SOURCES.find((s) => s.id === 'TX-3') || SOURCES[0];
  const errors = [];
  // Error paired with how far the target was from the middle of the room, so
  // the report can distinguish "good near the receivers" from "degraded at the
  // walls".
  const paired = [];

  for (let step = 0; step < WALK_STEPS; step++) {
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
  const pct = (q) => errors[Math.floor(errors.length * q)];

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

  const bands = [];
  for (const [lo, hi] of [
    [0, 2],
    [2, 4],
    [4, 6],
    [6, 20],
  ]) {
    const subset = paired.filter(({ r }) => r >= lo && r < hi);
    if (subset.length === 0) continue;
    bands.push({
      lo,
      hi,
      n: subset.length,
      mean: subset.reduce((acc, { e }) => acc + e, 0) / subset.length,
    });
  }

  return {
    count: errors.length,
    mean: errors.reduce((a, b) => a + b, 0) / errors.length,
    median: pct(0.5),
    p95: pct(0.95),
    max: pct(0.999),
    maxNoFading,
    bands,
  };
}

module.exports = { localisationErrors, OPTS };
