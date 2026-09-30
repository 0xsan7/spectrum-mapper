const test = require('node:test');
const assert = require('node:assert');
const HeatmapGenerator = require('../src/heatmap');
const PathLossModel = require('../src/pathLoss');
const {
  CONFIG,
  RF_SOURCES,
  RECEIVER_NODES,
} = require('../src/config/constants');

const STEADY = { fadingDb: 0, noiseFloor: -200 };

test('generate covers the room at the configured grid resolution', () => {
  const grid = HeatmapGenerator.generate(RF_SOURCES, STEADY);
  const expectedX = Math.ceil(CONFIG.ROOM_WIDTH / CONFIG.GRID_RESOLUTION);
  const expectedY = Math.ceil(CONFIG.ROOM_HEIGHT / CONFIG.GRID_RESOLUTION);
  assert.strictEqual(grid.length, expectedX * expectedY);
  assert.strictEqual(
    grid.length,
    300,
    '20x15 m at 1 m resolution is 300 cells'
  );
});

test('every cell is inside the room bounds', () => {
  const grid = HeatmapGenerator.generate(RF_SOURCES, STEADY);
  for (const cell of grid) {
    assert.ok(
      cell.x >= 0 && cell.x < CONFIG.ROOM_WIDTH,
      `x ${cell.x} out of bounds`
    );
    assert.ok(
      cell.y >= 0 && cell.y < CONFIG.ROOM_HEIGHT,
      `y ${cell.y} out of bounds`
    );
  }
});

test('cells are rounded to one decimal place', () => {
  const grid = HeatmapGenerator.generate(RF_SOURCES, STEADY);
  for (const cell of grid) {
    assert.strictEqual(
      cell.rssi,
      Number(cell.rssi.toFixed(1)),
      `rssi ${cell.rssi} not rounded`
    );
    assert.strictEqual(
      cell.x,
      Number(cell.x.toFixed(1)),
      `x ${cell.x} not rounded`
    );
    assert.strictEqual(
      cell.y,
      Number(cell.y.toFixed(1)),
      `y ${cell.y} not rounded`
    );
  }
});

test('RSSI is strongest nearest a transmitter', () => {
  const source = [{ id: 'TX-1', name: 'Router A', txPower: 20, x: 5, y: 5 }];
  const grid = HeatmapGenerator.generate(source, STEADY);

  const rssiAt = (x, y) => grid.find((c) => c.x === x && c.y === y).rssi;

  assert.ok(
    rssiAt(5, 5) > rssiAt(10, 5),
    `at the source (${rssiAt(5, 5)}) must beat 5 m away (${rssiAt(10, 5)})`
  );
  assert.ok(
    rssiAt(5, 5) > rssiAt(19, 14),
    `at the source (${rssiAt(5, 5)}) must beat the far corner (${rssiAt(19, 14)})`
  );
});

test('grid cells agree with a direct RSSI calculation', () => {
  const source = [{ id: 'TX-1', name: 'Router A', txPower: 20, x: 3, y: 11 }];
  const grid = HeatmapGenerator.generate(source, STEADY);
  const cell = grid.find((c) => c.x === 7 && c.y === 4);
  const expected = PathLossModel.calculateRSSI(
    20,
    PathLossModel.distance(7, 4, 3, 11),
    STEADY
  );
  assert.ok(
    Math.abs(cell.rssi - Number(expected.toFixed(1))) < 1e-9,
    `cell ${cell.rssi} vs direct ${expected.toFixed(1)}`
  );
});

test('calculateStats reports the real min, max and mean of the grid', () => {
  const grid = HeatmapGenerator.generate(RF_SOURCES, STEADY);
  const stats = HeatmapGenerator.calculateStats(grid);
  const values = grid.map((c) => c.rssi);

  assert.strictEqual(Number(stats.maxRSSI), Math.max(...values));
  assert.strictEqual(Number(stats.minRSSI), Math.min(...values));
  assert.strictEqual(
    Number(stats.avgRSSI),
    Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1))
  );
});

test('hotspotCount matches the cells above the threshold', () => {
  const grid = HeatmapGenerator.generate(RF_SOURCES, STEADY);
  const stats = HeatmapGenerator.calculateStats(grid);
  const expected = grid.filter((c) => c.rssi > CONFIG.HOTSPOT_THRESHOLD).length;
  assert.strictEqual(stats.hotspotCount, expected);
  assert.ok(
    stats.hotspotCount > 0,
    'four 20/15/10/5 dBm sources must create hotspots'
  );
  assert.ok(
    stats.hotspotCount < grid.length,
    'not every cell can be a hotspot: a 20x15 m room has shadowed corners'
  );
});

test('stats come back as strings so the payload shape is stable', () => {
  const stats = HeatmapGenerator.calculateStats(
    HeatmapGenerator.generate(RF_SOURCES, STEADY)
  );
  for (const key of ['maxRSSI', 'minRSSI', 'avgRSSI']) {
    assert.strictEqual(typeof stats[key], 'string', `${key} must be a string`);
  }
  assert.strictEqual(typeof stats.hotspotCount, 'number');
});

test('a bigger exponent lowers the mean RSSI across the room', () => {
  const free = HeatmapGenerator.generate(RF_SOURCES, {
    ...STEADY,
    exponent: 2.0,
  });
  const cluttered = HeatmapGenerator.generate(RF_SOURCES, {
    ...STEADY,
    exponent: 3.5,
  });
  const freeAvg = Number(HeatmapGenerator.calculateStats(free).avgRSSI);
  const clutteredAvg = Number(
    HeatmapGenerator.calculateStats(cluttered).avgRSSI
  );
  assert.ok(
    clutteredAvg < freeAvg,
    `n=3.5 (${clutteredAvg}) must be weaker than n=2.0 (${freeAvg})`
  );
});

test('a higher carrier frequency lowers the mean RSSI', () => {
  const at900 = HeatmapGenerator.generate(RF_SOURCES, {
    ...STEADY,
    frequency: 900,
  });
  const at2400 = HeatmapGenerator.generate(RF_SOURCES, {
    ...STEADY,
    frequency: 2400,
  });
  const low = Number(HeatmapGenerator.calculateStats(at900).avgRSSI);
  const high = Number(HeatmapGenerator.calculateStats(at2400).avgRSSI);
  assert.ok(high < low, `2.4GHz (${high}) must be weaker than 900MHz (${low})`);
});

test('the same inputs give the same grid when fading is disabled', () => {
  const a = HeatmapGenerator.generate(RF_SOURCES, STEADY);
  const b = HeatmapGenerator.generate(RF_SOURCES, STEADY);
  assert.deepStrictEqual(
    a,
    b,
    'the model must be deterministic without fading'
  );
});

test('getReceiverNodes returns id/x/y only', () => {
  const nodes = HeatmapGenerator.getReceiverNodes();
  assert.strictEqual(nodes.length, RECEIVER_NODES.length);
  for (const node of nodes) {
    assert.deepStrictEqual(Object.keys(node).sort(), ['id', 'x', 'y']);
  }
});
