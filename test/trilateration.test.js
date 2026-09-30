const test = require('node:test');
const assert = require('node:assert');
const Trilateration = require('../src/trilateration');
const PathLossModel = require('../src/pathLoss');
const { RF_SOURCES, RECEIVER_NODES } = require('../src/config/constants');

/** The mobile transmitter: the thing we try to locate. */
const MOBILE = RF_SOURCES.find((s) => s.id === 'TX-3');
const TX_OPTIONS = {
  txPower: MOBILE.txPower,
  exponent: 2.7,
  frequency: 2437,
  attenuation: 0,
};

test('rssiToDistance inverts the path loss model', () => {
  // Feed a known distance through the forward model, then invert it. If the
  // two are not exact inverses, no estimate built on top can be trusted.
  for (const distance of [2, 5, 10, 18]) {
    const rssi = PathLossModel.calculateRSSI(MOBILE.txPower, distance, {
      fadingDb: 0,
      noiseFloor: -200,
      exponent: 2.7,
      frequency: 2437,
    });
    const recovered = Trilateration.rssiToDistance(rssi, TX_OPTIONS);
    assert.ok(
      Math.abs(recovered - distance) < 1e-9,
      `${distance} m should round-trip, got ${recovered}`
    );
  }
});

test('rssiToDistance returns NaN at or below the noise floor', () => {
  assert.ok(Number.isNaN(Trilateration.rssiToDistance(-100, TX_OPTIONS)));
  assert.ok(Number.isNaN(Trilateration.rssiToDistance(-120, TX_OPTIONS)));
  assert.ok(Number.isNaN(Trilateration.rssiToDistance(NaN, TX_OPTIONS)));
  // Just above the floor there is range information again.
  assert.ok(Number.isFinite(Trilateration.rssiToDistance(-99, TX_OPTIONS)));
});

test('a reading stronger than the reference distance clamps to d0', () => {
  // 10 dBm at 1 m on 2.4 GHz is impossible; the model cannot express d < d0.
  const distance = Trilateration.rssiToDistance(9, TX_OPTIONS);
  assert.strictEqual(
    distance,
    1,
    'must clamp to the 1 m reference, not go negative'
  );
});

test('wall attenuation is added back before inverting', () => {
  const rssi = PathLossModel.calculateRSSI(MOBILE.txPower, 8, {
    fadingDb: 0,
    noiseFloor: -200,
    exponent: 2.7,
    frequency: 2437,
  });
  const seenThroughWall = rssi - 15; // 15 dB of drywall

  const naive = Trilateration.rssiToDistance(seenThroughWall, TX_OPTIONS);
  const corrected = Trilateration.rssiToDistance(seenThroughWall, {
    ...TX_OPTIONS,
    attenuation: 15,
  });
  assert.ok(naive > corrected, 'ignoring the wall overestimates the distance');
  assert.ok(
    Math.abs(corrected - 8) < 1e-9,
    `expected the 8 m truth back, got ${corrected}`
  );
});

test('leastSquares recovers a known position from exact ranges', () => {
  const truth = { x: 12.5, y: 4.25 };
  const receivers = [
    { x: 2, y: 2 },
    { x: 18, y: 2 },
    { x: 10, y: 13 },
  ];
  const ranges = receivers.map((r) => Math.hypot(truth.x - r.x, truth.y - r.y));

  const result = Trilateration.leastSquares(receivers, ranges);
  assert.ok(result, 'must produce a solution');
  assert.ok(Math.abs(result.x - truth.x) < 1e-9, `x: got ${result.x}`);
  assert.ok(Math.abs(result.y - truth.y) < 1e-9, `y: got ${result.y}`);
  assert.ok(
    result.errorMetres < 1e-9,
    'residual error is zero for exact input'
  );
  assert.strictEqual(result.method, 'least-squares');
  assert.strictEqual(result.used, 3);
});

test('two receivers report the ambiguity and both candidate positions', () => {
  const truth = { x: 7, y: 3 };
  const receivers = [
    { x: 2, y: 2 },
    { x: 18, y: 2 },
  ];
  const ranges = receivers.map((r) => Math.hypot(truth.x - r.x, truth.y - r.y));

  const result = Trilateration.leastSquares(receivers, ranges);
  assert.strictEqual(result.method, 'two-receiver');
  assert.strictEqual(result.ambiguous, true, 'two circles give two positions');
  assert.ok(result.alternative, 'the mirror solution must be reported');

  // One of the two candidates is the truth; the other is its reflection about
  // the receiver baseline at y = 2.
  const candidates = [result, result.alternative];
  const mirrored = { x: 7, y: 1 };
  const best = Math.min(
    ...candidates.map((c) =>
      Math.min(
        Math.hypot(c.x - truth.x, c.y - truth.y),
        Math.hypot(c.x - mirrored.x, c.y - mirrored.y)
      )
    )
  );
  assert.ok(
    best < 1e-6,
    `expected the truth among the candidates, got ${JSON.stringify(candidates)}`
  );
});

test('circles that cannot meet return no solution', () => {
  // Ranges too short to reach each other.
  assert.deepStrictEqual(
    Trilateration.circleIntersection(
      { x: 0, y: 0, range: 1 },
      { x: 10, y: 0, range: 1 }
    ),
    []
  );
  // One circle entirely inside the other without touching.
  assert.deepStrictEqual(
    Trilateration.circleIntersection(
      { x: 0, y: 0, range: 1 },
      { x: 0.5, y: 0, range: 5 }
    ),
    []
  );
  // Identical centres have no defined radical line.
  assert.deepStrictEqual(
    Trilateration.circleIntersection(
      { x: 2, y: 2, range: 3 },
      { x: 2, y: 2, range: 3 }
    ),
    []
  );
});

test('tangent circles meet in exactly one point', () => {
  const solutions = Trilateration.circleIntersection(
    { x: 0, y: 0, range: 5 },
    { x: 10, y: 0, range: 5 }
  );
  assert.strictEqual(
    solutions.length,
    1,
    'external tangency is a single point'
  );
  assert.ok(Math.abs(solutions[0].x - 5) < 1e-9);
  assert.ok(Math.abs(solutions[0].y) < 1e-9);
});

test('a single receiver is undetermined, not a guess', () => {
  const result = Trilateration.leastSquares([{ x: 2, y: 2 }], [5]);
  assert.strictEqual(result, null);
});

test('coincident receivers cannot localise and return null', () => {
  // Every receiver at the same coordinates: the system is singular and there
  // is no geometric information at all, so the honest answer is "no solution".
  const result = Trilateration.leastSquares(
    [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ],
    [3, 3, 3]
  );
  assert.strictEqual(result, null);
});

test('collinear receivers are reported as degenerate, not a wild guess', () => {
  // Three receivers in a line: the position is solvable along the line but not
  // across it, so the fit is singular. It must be reported, not divided by ~0.
  const result = Trilateration.leastSquares(
    [
      { x: 0, y: 7 },
      { x: 5, y: 7 },
      { x: 10, y: 7 },
    ],
    [4, 5, 6]
  );
  assert.ok(result, 'must return a result rather than throwing');
  assert.strictEqual(result.degenerate, true);
  assert.strictEqual(result.method, 'degenerate');
  assert.ok(Number.isFinite(result.x) && Number.isFinite(result.y));
});

test('NaN ranges are dropped rather than poisoning the fit', () => {
  const truth = { x: 10, y: 7 };
  const receivers = [
    { x: 2, y: 2 },
    { x: 18, y: 2 },
    { x: 10, y: 13 },
    { x: 4, y: 12 },
  ];
  // Second receiver is under the noise floor and carries no range. Three
  // usable receivers remain, enough for a unique least-squares fit.
  const ranges = [
    Math.hypot(truth.x - 2, truth.y - 2),
    NaN,
    Math.hypot(truth.x - 10, truth.y - 13),
    Math.hypot(truth.x - 4, truth.y - 12),
  ];

  const result = Trilateration.leastSquares(receivers, ranges);
  assert.ok(Math.abs(result.x - truth.x) < 1e-9, `x: got ${result.x}`);
  assert.ok(Math.abs(result.y - truth.y) < 1e-9, `y: got ${result.y}`);
  assert.strictEqual(result.used, 3, 'the NaN receiver must not count');
});

test('fading shows up as a non-zero residual, and shrinks as it goes', () => {
  const truth = { x: 11, y: 6 };
  const receivers = [
    { x: 2, y: 2 },
    { x: 18, y: 2 },
    { x: 10, y: 13 },
  ];

  const measure = (fading) =>
    receivers.map((r) =>
      PathLossModel.calculateRSSI(
        MOBILE.txPower,
        Math.hypot(truth.x - r.x, truth.y - r.y),
        { fadingDb: fading, noiseFloor: -200, exponent: 2.7, frequency: 2437 }
      )
    );

  const clean = Trilateration.estimate(receivers, measure(0), TX_OPTIONS);
  const noisy = Trilateration.estimate(receivers, measure(6), TX_OPTIONS);

  const cleanError = Trilateration.positionError(clean, truth);
  const noisyError = Trilateration.positionError(noisy, truth);

  assert.ok(
    cleanError < 0.01,
    `no fading should be near-exact, got ${cleanError}`
  );
  assert.ok(
    noisyError > cleanError,
    `6 dB of fading must move the estimate: ${noisyError} vs ${cleanError}`
  );
  assert.ok(
    noisyError < 10,
    'but not wildly: 6 dB of fading is not 10 m of error'
  );
  assert.ok(
    noisy.ranges.every((r) => Number.isFinite(r)),
    'all ranges valid'
  );
});

test('estimate reports insufficient data when most receivers are deaf', () => {
  const receivers = [
    { x: 2, y: 2 },
    { x: 18, y: 2 },
    { x: 10, y: 13 },
  ];
  const result = Trilateration.estimate(
    receivers,
    [-100, -100, -100],
    TX_OPTIONS
  );
  assert.strictEqual(result.x, null);
  assert.strictEqual(result.method, 'insufficient');
  assert.ok(result.ranges.every((r) => Number.isNaN(r)));
});

test('positionError is null when there is no estimate', () => {
  assert.strictEqual(Trilateration.positionError(null, { x: 1, y: 1 }), null);
  assert.strictEqual(
    Trilateration.positionError({ x: null, y: null }, { x: 1, y: 1 }),
    null
  );
  assert.strictEqual(
    Trilateration.positionError({ x: 3, y: 4 }, { x: 3, y: 4 }),
    0
  );
});

test('it locates the mobile transmitter using the room receivers', () => {
  // End to end with the real receiver layout and the mobile TX's real power.
  const truth = { x: 13, y: 5 };
  const readings = RECEIVER_NODES.map((r) =>
    PathLossModel.calculateRSSI(
      MOBILE.txPower,
      Math.hypot(truth.x - r.x, truth.y - r.y),
      { fadingDb: 0, noiseFloor: -200, exponent: 2.7, frequency: 2437 }
    )
  );

  const estimate = Trilateration.estimate(RECEIVER_NODES, readings, TX_OPTIONS);
  const error = Trilateration.positionError(estimate, truth);

  assert.ok(
    error < 0.5,
    `expected sub-metre accuracy on exact input, got ${error} m`
  );
  assert.strictEqual(estimate.used, 4);
  assert.ok(
    estimate.x >= 0 && estimate.x <= 20 && estimate.y >= 0 && estimate.y <= 15,
    `estimate (${estimate.x}, ${estimate.y}) must be inside the room`
  );
});
