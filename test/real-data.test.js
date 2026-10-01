/**
 * The properties the reading feature rests on, asserted end to end.
 *
 * Steps 1-4 each brought tests for their own code. This file pins the claims
 * that span the whole path - validation, store, interpolation, frame - because
 * a property that only holds in a unit test of one layer is not a property of
 * the feature. Every check is deterministic: no clock, no timing, no randomness,
 * no dependence on how long the process has been running.
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { generateGrid, modelRmseDb } = require('../src/interpolate');
const { ReadingsStore, validatePayload } = require('../src/readings');

const ROOT = path.join(__dirname, '..');
const CONFIG = { roomWidth: 20, roomHeight: 15, minRssi: -100, maxRssi: -20 };

let portSeq = 0;
const nextPort = () => 20000 + ((process.pid * 13 + portSeq++) % 20000);

function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    const port = nextPort();
    const child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server did not start:\n${out}`));
    }, 15000);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('Server running')) {
        clearTimeout(timer);
        resolve({ port, stop: () => child.kill('SIGKILL') });
      }
    });
    child.stderr.on('data', (d) => (out += d));
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}:\n${out}`));
    });
  });
}

const post = (port, path_, body, headers = {}) =>
  fetch(`http://127.0.0.1:${port}${path_}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

async function waitForFrame(port, predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const r = await fetch(`http://127.0.0.1:${port}/api/export/frame.json`);
    if (r.status === 200) {
      last = await r.json();
      if (predicate(last)) return last;
    }
    await new Promise((res) => setTimeout(res, 80));
  }
  throw new Error(
    `frame never satisfied the predicate: ${JSON.stringify(last).slice(0, 200)}`
  );
}

/* ---- the headline property, through the whole stack ---- */

test('a grid cell on a sample carries that sample value, over HTTP', async () => {
  const s = await startServer();
  try {
    const readings = [
      { x: 4, y: 5, rssi: -61.5 },
      { x: 12, y: 9, rssi: -55.3 },
      { x: 17, y: 2, rssi: -70 },
    ];
    assert.strictEqual(
      (await post(s.port, '/api/readings', readings)).status,
      201
    );

    const frame = await waitForFrame(s.port, (f) => f.measured);
    const grid = frame.measured.grid;

    for (const r of readings) {
      const cell = grid.find((c) => c.x === r.x && c.y === r.y);
      assert.ok(cell, `no grid cell at ${r.x},${r.y}`);
      assert.strictEqual(cell.hasData, true);
      // Exact, at the grid's own precision. This is what lets the error figure
      // measure the model rather than the interpolator: a cell on a sample
      // carries that sample's number, not a blend of its neighbours.
      assert.strictEqual(
        cell.rssi,
        r.rssi,
        `cell ${r.x},${r.y} is ${cell.rssi}, sample is ${r.rssi}`
      );
    }
  } finally {
    s.stop();
  }
});

test('a two-decimal sample survives the grid to within its 0.1 dB precision', async () => {
  // Readings are stored at 2 dp, the grid is published at 1 dp - the same
  // precision as the model's own heatmap, so the two layers stay comparable.
  // The first version of the test above asserted exactness against -55.25 and
  // got -55.3, which read as the interpolator smearing the sample away.
  const s = await startServer();
  try {
    assert.strictEqual(
      (await post(s.port, '/api/readings', [{ x: 8, y: 6, rssi: -55.25 }]))
        .status,
      201
    );
    const frame = await waitForFrame(s.port, (f) => f.measured);
    const cell = frame.measured.grid.find((c) => c.x === 8 && c.y === 6);
    assert.ok(
      Math.abs(cell.rssi - -55.25) <= 0.05,
      `grid cell is ${cell.rssi}`
    );
    // The stored point keeps its full precision.
    assert.strictEqual(frame.measured.points[0].rssi, -55.25);
  } finally {
    s.stop();
  }
});

test('no-data cells in the served grid are beyond 3 m from every sample', async () => {
  const s = await startServer();
  try {
    await post(s.port, '/api/readings', [
      { x: 4, y: 5, rssi: -61.5 },
      { x: 16, y: 11, rssi: -58 },
    ]);
    const frame = await waitForFrame(s.port, (f) => f.measured);
    const samples = frame.measured.points;

    for (const cell of frame.measured.grid) {
      const nearest = Math.min(
        ...samples.map((p) => Math.hypot(cell.x - p.x, cell.y - p.y))
      );
      if (cell.hasData) {
        assert.ok(
          nearest <= 3 + 1e-6,
          `covered cell ${cell.x},${cell.y} is ${nearest.toFixed(2)} m out`
        );
      } else {
        assert.strictEqual(
          cell.rssi,
          null,
          `gap cell ${cell.x},${cell.y} still carries a value`
        );
        assert.ok(
          nearest > 3,
          `gap cell ${cell.x},${cell.y} is only ${nearest.toFixed(2)} m from a sample`
        );
      }
    }
  } finally {
    s.stop();
  }
});

/* ---- determinism ---- */

test('interpolation gives identical results on repeated calls', () => {
  const samples = [
    { x: 3, y: 4, rssi: -61.5 },
    { x: 11, y: 8, rssi: -52 },
    { x: 17, y: 2, rssi: -70 },
  ];
  const a = generateGrid(samples);
  const b = generateGrid(samples);
  assert.deepStrictEqual(a, b);
});

test('RMSE is identical on repeated calls', () => {
  const samples = [
    { x: 3, y: 4, rssi: -61.5 },
    { x: 11, y: 8, rssi: -52 },
  ];
  const model = () => -57.25;
  assert.strictEqual(modelRmseDb(samples, model), modelRmseDb(samples, model));
});

test('validation is pure: the input is not mutated', () => {
  const payload = [
    { x: 1, y: 2, rssi: -50 },
    { x: 3, y: 4, rssi: -60 },
  ];
  const snapshot = JSON.stringify(payload);
  validatePayload(payload, CONFIG);
  assert.strictEqual(JSON.stringify(payload), snapshot);
});

test('the store drops the oldest deterministically', () => {
  const build = () => {
    const store = new ReadingsStore(5);
    for (let i = 0; i < 12; i++) store.add([{ x: i, y: 0, rssi: -50 - i }]);
    return store.all();
  };
  assert.deepStrictEqual(build(), build());
  // And the survivors are the last five, in order.
  assert.deepStrictEqual(
    build().map((p) => p.x),
    [7, 8, 9, 10, 11]
  );
});

/* ---- the limits, named as the feature description states them ---- */

test('the documented limits are the ones enforced', () => {
  // NaN
  assert.ok(!validatePayload({ x: NaN, y: 1, rssi: -50 }, CONFIG).ok);
  // out of room
  assert.ok(!validatePayload({ x: 20.5, y: 1, rssi: -50 }, CONFIG).ok);
  // too many
  const many = Array.from({ length: 501 }, () => ({ x: 1, y: 1, rssi: -50 }));
  assert.ok(!validatePayload(many, CONFIG).ok);
  // non-array garbage
  for (const g of [1, 'x', null, true, {}]) {
    assert.ok(
      !validatePayload(g, CONFIG).ok,
      `${JSON.stringify(g)} should be rejected`
    );
  }
});

test('the sample file still validates against the current limits', () => {
  const csv = fs.readFileSync(
    path.join(ROOT, 'docs/examples/sample-readings.csv'),
    'utf8'
  );
  const rows = csv
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => {
      const [x, y, rssi] = l.split(',').map(Number);
      return { x, y, rssi };
    });
  const result = validatePayload(rows, CONFIG);
  assert.ok(result.ok, result.error);
  assert.strictEqual(result.points.length, rows.length);
});
