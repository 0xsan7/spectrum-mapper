/**
 * Interpolation from measured readings onto the grid.
 *
 * The two properties that carry the feature are asserted directly rather than
 * through the renderer: a sample's own value must survive, and a cell with no
 * nearby sample must come back as no data rather than a number.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  IDW,
  interpolateAt,
  generateGrid,
  modelRmseDb,
} = require('../src/interpolate');

const at = (x, y, rssi) => ({ x, y, rssi });

test('a cell sitting on a sample returns that sample exactly', () => {
  const samples = [at(3, 4, -61.5), at(9, 7, -55.25)];
  const r = interpolateAt(samples, 3, 4);
  assert.ok(r.hasData);
  // Exact, not "close": a survey walker reading their own coordinates must get
  // their own number back, or the error figure is measuring the interpolator.
  assert.strictEqual(r.rssi, -61.5);
});

test('a sample point is exact for every sample in a set', () => {
  const samples = [
    at(1, 1, -70),
    at(5, 5, -50),
    at(12, 9, -44.5),
    at(19, 14, -80),
  ];
  for (const s of samples) {
    assert.strictEqual(interpolateAt(samples, s.x, s.y).rssi, s.rssi);
  }
});

test('a cell far from every sample is no data, never a number', () => {
  const samples = [at(1, 1, -50)];
  const r = interpolateAt(samples, 18, 13);
  assert.strictEqual(r.hasData, false);
  assert.strictEqual(r.rssi, null, 'must not extrapolate');
  assert.strictEqual(r.neighbours, 0);
});

test('the no-data boundary is the configured distance', () => {
  const samples = [at(10, 7.5, -60)];
  // Exactly at the limit counts as covered; just beyond does not.
  const edge = interpolateAt(samples, 10 + IDW.MAX_DISTANCE, 7.5);
  assert.ok(edge.hasData, 'exactly at the limit should count');
  const beyond = interpolateAt(samples, 10 + IDW.MAX_DISTANCE + 0.01, 7.5);
  assert.strictEqual(beyond.hasData, false);
});

test('no readings at all is no data everywhere', () => {
  const r = interpolateAt([], 5, 5);
  assert.strictEqual(r.hasData, false);
  assert.strictEqual(r.rssi, null);
});

test('IDW averages the nearest neighbours, nearest weighted highest', () => {
  // One sample at distance 1, one at distance 3. With power 2 the weights are
  // 1 and 1/9, so the result sits much closer to the near one.
  const samples = [at(0, 0, -40), at(4, 0, -80)];
  const r = interpolateAt(samples, 1, 0);
  assert.ok(r.hasData);
  const expected = (1 / 1 ** 2) * -40 + (1 / 3 ** 2) * -80;
  const want = expected / (1 / 1 ** 2 + 1 / 3 ** 2);
  assert.ok(Math.abs(r.rssi - want) < 1e-9, `${r.rssi} vs ${want}`);
  assert.ok(r.rssi < -40 && r.rssi > -80, 'must lie between the two samples');
});

test('the result stays inside the range of the samples used', () => {
  // IDW with positive weights cannot overshoot. Worth pinning: a version that
  // returned a raw sum instead of a weighted mean would produce -300 dBm.
  const samples = [at(2, 2, -50), at(4, 2, -70), at(3, 4, -60)];
  const r = interpolateAt(samples, 3, 3);
  const lo = Math.min(...samples.map((s) => s.rssi));
  const hi = Math.max(...samples.map((s) => s.rssi));
  assert.ok(
    r.rssi >= lo - 1e-9 && r.rssi <= hi + 1e-9,
    `${r.rssi} outside ${lo}..${hi}`
  );
});

test('at most the nearest N samples vote', () => {
  // A line of nine samples with falling RSSI, queried off-sample so the
  // coincident-point short circuit does not fire and the neighbour limit is
  // actually reached. The first version queried on a sample, returned early
  // with one neighbour, and then gave every sample the same RSSI - so the two
  // counts it compared could not have differed even if the limit were ignored.
  const samples = [];
  for (let i = 1; i <= 9; i++) samples.push(at(i, 0, -40 - i));

  const eight = interpolateAt(samples, 1.5, 0, { nearest: 8 });
  const nine = interpolateAt(samples, 1.5, 0, { nearest: 9 });

  assert.strictEqual(eight.neighbours, 8, 'only 8 samples should vote');
  assert.strictEqual(nine.neighbours, 9);
  assert.notStrictEqual(
    eight.rssi,
    nine.rssi,
    'dropping the 9th sample made no difference, so the limit is not applied'
  );
});

test('the store is not reordered by interpolation', () => {
  const samples = [at(1, 1, -50), at(2, 2, -50), at(3, 3, -50)];
  const order = samples.map((s) => `${s.x},${s.y}`);
  interpolateAt(samples, 2, 2);
  generateGrid(samples);
  assert.deepStrictEqual(
    samples.map((s) => `${s.x},${s.y}`),
    order,
    'the caller array must not be sorted in place'
  );
});

test('the grid marks every cell and covers the room', () => {
  const grid = generateGrid([at(10, 7, -60)]);
  // 20x15 at 1 m resolution.
  assert.strictEqual(grid.length, 20 * 15);
  assert.ok(grid.every((c) => typeof c.hasData === 'boolean'));
  const covered = grid.filter((c) => c.hasData).length;
  assert.ok(
    covered > 0 && covered < grid.length,
    'some cells covered, some not'
  );
  assert.strictEqual(grid[0].x, 0);
  assert.strictEqual(grid[0].y, 0);
});

test('every covered grid cell is within the max distance of a sample', () => {
  const samples = [at(5, 5, -60), at(15, 10, -70)];
  for (const cell of generateGrid(samples)) {
    if (!cell.hasData) continue;
    const nearest = Math.min(
      ...samples.map((s) => Math.hypot(cell.x - s.x, cell.y - s.y))
    );
    assert.ok(
      nearest <= IDW.MAX_DISTANCE + 1e-6,
      `cell ${cell.x},${cell.y} claims data but its nearest sample is ${nearest.toFixed(2)} m`
    );
  }
});

test('RMSE is zero when the model matches the measurements exactly', () => {
  const samples = [at(1, 1, -50), at(5, 5, -60)];
  // The model has to return each sample's own value. A constant -55 model
  // against these two samples is 5 dB out, not zero - the first version of
  // this test asserted zero against a model that did not match anything.
  const rmse = modelRmseDb(samples, (x, y) => {
    const s = samples.find((p) => p.x === x && p.y === y);
    return s.rssi;
  });
  assert.strictEqual(rmse, 0);
});

test('RMSE of a constant offset is that offset', () => {
  const samples = [at(1, 1, -50), at(5, 5, -60)];
  // Model always 3 dB above the measurement.
  const rmse = modelRmseDb(samples, (x, y) => {
    const s = samples.find((p) => p.x === x && p.y === y);
    return s.rssi + 3;
  });
  assert.ok(Math.abs(rmse - 3) < 1e-9, `got ${rmse}`);
});

test('RMSE is null with nothing to compare, not zero', () => {
  assert.strictEqual(
    modelRmseDb([], () => -50),
    null
  );
  // A model that returns nothing usable everywhere is also "no comparison".
  assert.strictEqual(
    modelRmseDb([at(1, 1, -50)], () => NaN),
    null
  );
});

test('the documented IDW defaults are the ones used', () => {
  assert.strictEqual(IDW.POWER, 2);
  assert.strictEqual(IDW.NEAREST, 8);
  assert.strictEqual(IDW.MAX_DISTANCE, 3);
  // And they are the defaults, not just constants nothing calls.
  const r = interpolateAt([at(0, 0, -50), at(0.5, 0, -50)], 0.25, 0);
  assert.strictEqual(r.neighbours, 2);
});
test('RMSE divides by the number of samples compared', () => {
  // Three samples, model 5 dB above each: every residual is 5, so the RMSE
  // must be 5. The earlier tests all used two samples, where a divisor of 2
  // happens to be correct - so `sum / 2` passed as the sample count. Three
  // samples turns a hardcoded divisor into a 6.12 instead of a 5.
  const samples = [at(1, 1, -50), at(2, 2, -50), at(3, 3, -50)];
  assert.strictEqual(
    modelRmseDb(samples, () => -45),
    5
  );
});

test('RMSE over an uneven set still uses its own count', () => {
  // Four samples compared and one skipped as non-finite: the divisor is 4, not
  // 5 and not 1.
  const samples = [at(1, 1, -50), at(2, 2, -50), at(3, 3, -50), at(4, 4, -50)];
  let calls = 0;
  const rmse = modelRmseDb(samples, () => (calls++ === 0 ? NaN : -55));
  assert.strictEqual(rmse, 5);
});
