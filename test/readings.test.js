/**
 * Reading ingest: validation and the bounded store.
 *
 * Deterministic and time-independent. The store's cap is a constructor
 * argument precisely so the eviction test can use a small number instead of
 * pushing 5000 points to observe the 5001st disappear.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  LIMITS,
  ReadingsStore,
  asArray,
  parseCsv,
  validatePayload,
} = require('../src/readings');

const CONFIG = { roomWidth: 20, roomHeight: 15, minRssi: -100, maxRssi: -20 };

test('accepts a single reading object', () => {
  const r = validatePayload({ x: 1, y: 2, rssi: -65 }, CONFIG);
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.points, [{ x: 1, y: 2, rssi: -65 }]);
});

test('accepts an array of readings', () => {
  const r = validatePayload(
    [
      { x: 1, y: 2, rssi: -65 },
      { x: 3, y: 4, rssi: -70 },
    ],
    CONFIG
  );
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.points.length, 2);
});

test('accepts the room corners and the RSSI bounds', () => {
  for (const p of [
    { x: 0, y: 0, rssi: -100 },
    { x: 20, y: 15, rssi: -20 },
  ]) {
    assert.ok(
      validatePayload(p, CONFIG).ok,
      `${JSON.stringify(p)} should be inside`
    );
  }
});

test('rejects NaN and Infinity', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const r = validatePayload({ x: bad, y: 2, rssi: -65 }, CONFIG);
    assert.ok(!r.ok, `${bad} must be rejected`);
    assert.match(r.error, /x must be a finite number/);
  }
  const r = validatePayload({ x: 1, y: 2, rssi: NaN }, CONFIG);
  assert.ok(!r.ok);
  assert.match(r.error, /rssi must be a finite number/);
});

test('rejects numeric strings rather than coercing them', () => {
  const r = validatePayload({ x: '4', y: 2, rssi: -65 }, CONFIG);
  assert.ok(!r.ok, '"4" is not a number');
  assert.match(r.error, /x must be a finite number/);
});

test('rejects coordinates outside the room', () => {
  const r = validatePayload([{ x: 25, y: 2, rssi: -65 }], CONFIG);
  assert.ok(!r.ok);
  assert.match(r.error, /x must be between 0 and 20/);

  const r2 = validatePayload([{ x: 2, y: -1, rssi: -65 }], CONFIG);
  assert.ok(!r2.ok);
  assert.match(r2.error, /y must be between 0 and 15/);
});

test('rejects RSSI outside the range, both directions', () => {
  assert.match(
    validatePayload({ x: 1, y: 1, rssi: -101 }, CONFIG).error,
    /rssi must be between -100 and -20/
  );
  assert.match(
    validatePayload({ x: 1, y: 1, rssi: -19 }, CONFIG).error,
    /rssi must be between -100 and -20/
  );
});

test('rejects the whole request when one item is bad, naming the index', () => {
  const r = validatePayload(
    [
      { x: 1, y: 1, rssi: -50 },
      { x: 2, y: 2, rssi: -50 },
      { x: 99, y: 2, rssi: -50 },
    ],
    CONFIG
  );
  assert.ok(!r.ok);
  assert.match(r.error, /reading 2: x must be between/);
});

test('rejects non-array garbage', () => {
  for (const garbage of [42, 'text', null, true]) {
    assert.ok(
      !validatePayload(garbage, CONFIG).ok,
      `${JSON.stringify(garbage)} must be rejected`
    );
  }
  assert.match(validatePayload(42, CONFIG).error, /expected an object/);
});

test('rejects a bare array of scalars', () => {
  assert.ok(!validatePayload([1, 2, 3], CONFIG).ok);
});

test('rejects an empty array and a null element', () => {
  assert.match(validatePayload([], CONFIG).error, /no readings supplied/);
  assert.ok(!validatePayload([{ x: 1, y: 1, rssi: -50 }, null], CONFIG).ok);
});

test('rejects more than the per-request limit', () => {
  const many = Array.from({ length: LIMITS.MAX_ITEMS + 1 }, () => ({
    x: 1,
    y: 1,
    rssi: -50,
  }));
  const r = validatePayload(many, CONFIG);
  assert.ok(!r.ok);
  assert.match(r.error, /too many readings: 501, the limit is 500/);
});

test('accepts exactly the per-request limit', () => {
  const many = Array.from({ length: LIMITS.MAX_ITEMS }, () => ({
    x: 1,
    y: 1,
    rssi: -50,
  }));
  assert.ok(validatePayload(many, CONFIG).ok);
});

test('the store drops the oldest past its cap', () => {
  const store = new ReadingsStore(5);
  store.add([{ x: 0, y: 0, rssi: -50 }]);
  store.add([{ x: 1, y: 0, rssi: -50 }]);
  assert.strictEqual(store.size, 2);

  // Six more into a cap of five: the oldest two go, the newest five stay.
  const added = store.add(
    Array.from({ length: 6 }, (_, i) => ({ x: i + 2, y: 0, rssi: -50 }))
  );
  assert.strictEqual(store.size, 5);
  assert.strictEqual(added.evicted, 3);
  assert.strictEqual(added.droppedTotal, 3);
  // The survivors are the five most recent, in order.
  assert.deepStrictEqual(
    store.all().map((p) => p.x),
    [3, 4, 5, 6, 7]
  );
});

test('the store cap never exceeds its maximum even in one large batch', () => {
  const store = new ReadingsStore(10);
  store.add(Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0, rssi: -50 })));
  assert.strictEqual(store.size, 10);
  assert.deepStrictEqual(
    store.all().map((p) => p.x),
    [40, 41, 42, 43, 44, 45, 46, 47, 48, 49]
  );
});

test('the default cap is the documented one', () => {
  assert.strictEqual(new ReadingsStore().maxPoints, LIMITS.MAX_POINTS);
  assert.strictEqual(LIMITS.MAX_POINTS, 5000);
  assert.strictEqual(LIMITS.MAX_BODY_BYTES, 102400);
});

test('asArray normalises the two accepted shapes', () => {
  assert.strictEqual(asArray({ x: 1 }).length, 1);
  assert.strictEqual(asArray([{ x: 1 }, { x: 2 }]).length, 2);
  assert.strictEqual(asArray('nope'), null);
});

test('CSV needs the x,y,rssi header', () => {
  assert.match(parseCsv('a,b,c\n1,2,3').error, /header must be x,y,rssi/);
  assert.ok(parseCsv('x,y,rssi\n1,2,-50').ok);
  // Header order and case are fixed but surrounding space is tolerated.
  assert.ok(parseCsv(' x , y , rssi \n1,2,-50').ok);
});

test('CSV parses rows and ignores blank lines', () => {
  const r = parseCsv('x,y,rssi\n1,2,-50\n\n3,4,-60\n');
  assert.ok(r.ok);
  assert.strictEqual(r.points.length, 2);
  assert.deepStrictEqual(r.points[1], { x: 3, y: 4, rssi: -60 });
});

test('CSV rejects a short row and names the line', () => {
  const r = parseCsv('x,y,rssi\n1,2,-50\n3,4');
  assert.ok(!r.ok);
  assert.match(r.error, /line 3: expected three columns/);
});

test('CSV rejects an empty file and a header-only file', () => {
  assert.match(parseCsv('').error, /empty/);
  assert.match(parseCsv('x,y,rssi\n').error, /no rows/);
});

test('CSV turns an empty cell into an invalid reading, not a zero', () => {
  const r = parseCsv('x,y,rssi\n1,, -50');
  assert.ok(r.ok, 'parsing succeeds; validation is the other half');
  assert.ok(Number.isNaN(r.points[0].y));
  // And it is then rejected with a message that does not say "y is 0".
  const v = validatePayload(r.points, CONFIG);
  assert.ok(!v.ok);
  assert.match(v.error, /y must be a finite number/);
});

test('a CSV round trip survives validation', () => {
  const rows = [
    [0, 0, -100],
    [20, 15, -20],
    [10.5, 7.25, -63.4],
  ];
  const csv = ['x,y,rssi', ...rows.map((r) => r.join(','))].join('\n');
  const parsed = parseCsv(csv);
  assert.ok(parsed.ok);
  const v = validatePayload(parsed.points, CONFIG);
  assert.ok(v.ok, v.error);
  assert.strictEqual(v.points.length, 3);
});
