const test = require('node:test');
const assert = require('node:assert');
const PathLossModel = require('../src/pathLoss');

/** Deterministic options: no random fading, so every assertion is exact. */
const STEADY = { fadingDb: 0, noiseFloor: -200 };

test('referenceLoss matches the free-space formula', () => {
  // PL(d0) = 20*log10(4*pi*d0*f/c). At 1 m and 1 GHz the textbook value is
  // 32.44 dB, so the 2.4 GHz case must be 32.44 + 20*log10(2.4).
  const at1GHz = PathLossModel.referenceLoss(1, 1000);
  assert.ok(
    Math.abs(at1GHz - 32.44) < 0.01,
    `expected ~32.44 dB at 1m/1GHz, got ${at1GHz.toFixed(2)}`
  );

  const at2p4GHz = PathLossModel.referenceLoss(1, 2437);
  const expected = 32.44 + 20 * Math.log10(2.437);
  assert.ok(
    Math.abs(at2p4GHz - expected) < 0.05,
    `expected ${expected.toFixed(2)} dB, got ${at2p4GHz.toFixed(2)}`
  );
});

test('referenceLoss rises with frequency', () => {
  const low = PathLossModel.referenceLoss(1, 900);
  const high = PathLossModel.referenceLoss(1, 2400);
  assert.ok(
    high > low,
    `2.4GHz (${high.toFixed(1)}) must exceed 900MHz (${low.toFixed(1)})`
  );

  // Free-space loss scales as 20*log10(f), so 2.4 GHz is 20*log10(2400/900)
  // = 8.52 dB worse at 1 m than 900 MHz.
  const delta = 20 * Math.log10(2400 / 900);
  assert.ok(
    Math.abs(high - low - delta) < 1e-9,
    `expected a ${delta.toFixed(2)} dB spread, got ${(high - low).toFixed(2)}`
  );
});

test('pathLoss is exactly the exponent law beyond the reference distance', () => {
  const opts = { referenceDistance: 1, frequency: 2437, exponent: 2.7 };
  for (const d of [2, 5, 10, 25, 50]) {
    const expected =
      PathLossModel.referenceLoss(1, 2437) + 10 * 2.7 * Math.log10(d / 1);
    const actual = PathLossModel.pathLoss(d, opts);
    assert.ok(
      Math.abs(actual - expected) < 1e-9,
      `at ${d}m: expected ${expected.toFixed(3)}, got ${actual.toFixed(3)}`
    );
  }
});

test('a higher exponent means faster decay', () => {
  const free = PathLossModel.pathLoss(20, { exponent: 2.0 });
  const indoor = PathLossModel.pathLoss(20, { exponent: 3.0 });
  assert.ok(
    indoor > free,
    `n=3 (${indoor.toFixed(1)}) must exceed n=2 (${free.toFixed(1)})`
  );

  // The gap must equal 10*log10(20) = 13.01 dB, since only the exponent differs.
  assert.ok(Math.abs(indoor - free - 10 * Math.log10(20)) < 1e-9);
});

test('exponent is configurable per call', () => {
  const a = PathLossModel.calculateRSSI(20, 10, { ...STEADY, exponent: 2.0 });
  const b = PathLossModel.calculateRSSI(20, 10, { ...STEADY, exponent: 3.5 });
  assert.notStrictEqual(a, b);
  assert.ok(b < a, 'higher exponent must give lower RSSI at the same distance');
});

test('RSSI falls as distance grows', () => {
  const opts = { ...STEADY, exponent: 2.7 };
  const near = PathLossModel.calculateRSSI(20, 1, opts);
  const mid = PathLossModel.calculateRSSI(20, 10, opts);
  const far = PathLossModel.calculateRSSI(20, 30, opts);
  assert.ok(near > mid && mid > far, `${near} > ${mid} > ${far}`);
});

test('minimum distance is clamped so log10 never sees a non-positive value', () => {
  const atZero = PathLossModel.calculateRSSI(20, 0, STEADY);
  const atRef = PathLossModel.calculateRSSI(20, 1, STEADY);
  assert.strictEqual(
    atZero,
    atRef,
    '0 m must clamp to the 1 m reference distance'
  );

  // Negative distances must not produce NaN.
  const negative = PathLossModel.calculateRSSI(20, -5, STEADY);
  assert.ok(
    Number.isFinite(negative),
    `expected a finite value, got ${negative}`
  );
  assert.strictEqual(negative, atRef);
});

test('RSSI at the reference distance equals txPower minus referenceLoss', () => {
  const rssi = PathLossModel.calculateRSSI(20, 1, STEADY);
  const expected = 20 - PathLossModel.referenceLoss(1, 2437);
  assert.ok(
    Math.abs(rssi - expected) < 1e-9,
    `expected ${expected.toFixed(3)}, got ${rssi.toFixed(3)}`
  );
});

test('fading is applied as a subtraction and is bounded by the fading range', () => {
  const steady = PathLossModel.calculateRSSI(20, 10, { ...STEADY });
  const faded = PathLossModel.calculateRSSI(20, 10, {
    fadingDb: 3,
    noiseFloor: -200,
  });
  assert.ok(
    Math.abs(faded - (steady - 3)) < 1e-9,
    `a 3 dB fade must cost 3 dB: ${steady.toFixed(2)} -> ${faded.toFixed(2)}`
  );

  // A random draw must stay inside +/- fading/2 of the steady value.
  const half = 1.5;
  for (let i = 0; i < 200; i++) {
    const rssi = PathLossModel.calculateRSSI(20, 10, {
      fading: 3,
      noiseFloor: -200,
    });
    assert.ok(
      Math.abs(steady - rssi) <= half + 1e-9,
      `random draw ${rssi} drifted more than ${half} dB from ${steady}`
    );
  }
});

test('RSSI is floored at the noise level', () => {
  const rssi = PathLossModel.calculateRSSI(10, 100000, {
    fadingDb: 0,
    noiseFloor: -100,
  });
  assert.strictEqual(rssi, -100, 'must clamp at the noise floor, not run away');
});

test('per-source pathLossOptions override the grid-wide options', () => {
  const sources = [
    { id: 'a', x: 0, y: 0, txPower: 20, pathLossOptions: { exponent: 2.0 } },
  ];
  const asN2 = PathLossModel.calculateGridRSSI(10, 0, sources, {
    ...STEADY,
    exponent: 3.0,
  });
  const plain = PathLossModel.calculateGridRSSI(
    10,
    0,
    [{ id: 'a', x: 0, y: 0, txPower: 20 }],
    {
      ...STEADY,
      exponent: 2.0,
    }
  );
  assert.ok(
    Math.abs(asN2 - plain) < 1e-9,
    'a source-level exponent must win over the grid-level one'
  );
});

test('distance is Euclidean', () => {
  assert.strictEqual(PathLossModel.distance(0, 0, 3, 4), 5);
  assert.strictEqual(PathLossModel.distance(2, 2, 2, 2), 0);
  assert.strictEqual(PathLossModel.distance(5, 5, 0, 0), Math.sqrt(50));
});

test('dBm and milliwatt conversions round-trip', () => {
  for (const dbm of [-100, -70, -30, 0, 20]) {
    const round = PathLossModel.milliwattsToDbm(
      PathLossModel.dbmToMilliwatts(dbm)
    );
    assert.ok(
      Math.abs(round - dbm) < 1e-9,
      `${dbm} dB did not round-trip (got ${round})`
    );
  }
  assert.strictEqual(PathLossModel.dbmToMilliwatts(0), 1, '0 dBm is 1 mW');
  assert.strictEqual(PathLossModel.dbmToMilliwatts(10), 10, '10 dBm is 10 mW');
});

test('grid RSSI sums sources in linear power, not by averaging dBm', () => {
  // Two identical sources double the received power, which is 10*log10(2) =
  // 3.0103 dB. Averaging dBm would return the single-source value unchanged.
  const one = [{ id: 'a', x: 0, y: 0, txPower: 20 }];
  const two = [
    { id: 'a', x: 0, y: 0, txPower: 20 },
    { id: 'b', x: 0, y: 0, txPower: 20 },
  ];
  const single = PathLossModel.calculateGridRSSI(10, 0, one, STEADY);
  const doubled = PathLossModel.calculateGridRSSI(10, 0, two, STEADY);
  const expected = single + 10 * Math.log10(2);
  assert.ok(
    Math.abs(doubled - expected) < 1e-9,
    `expected ${expected.toFixed(4)} dBm (+3.01 dB for a second equal source), got ${doubled.toFixed(4)}`
  );
});

test('grid RSSI returns the noise floor when there are no sources', () => {
  assert.strictEqual(PathLossModel.calculateGridRSSI(5, 5, [], STEADY), -100);
  assert.strictEqual(PathLossModel.calculateGridRSSI(5, 5, null, STEADY), -100);
});
