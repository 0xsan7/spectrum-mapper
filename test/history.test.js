const test = require('node:test');
const assert = require('node:assert');
const History = require('../src/history');
const CSV = require('../src/csv');

/** A frame shaped like the real payload, with the fields History reads. */
function frame(overrides = {}) {
  return {
    timestamp: '2026-10-01T00:00:00.000Z',
    stats: {
      avgRSSI: '-45.20',
      maxRSSI: '-30.10',
      minRSSI: '-70.00',
      hotspotCount: 42,
    },
    heatmap: [{ x: 1, y: 1, rssi: -45.2 }],
    sources: [
      { id: 'TX-1', x: 1, y: 2 },
      { id: 'TX-2', x: 3, y: 4 },
    ],
    tracking: {
      estimate: { x: 5, y: 6 },
      errorMetres: 1.25,
    },
    ...overrides,
  };
}

/* ---------------- history ---------------- */

test('push records numeric stats, not the string forms', () => {
  const history = new History(10);
  const sample = history.push(frame());

  // calculateStats returns strings for display. A chart that summed or
  // compared them would coerce per operation and silently produce NaN in
  // places, so they are converted on the way in.
  assert.strictEqual(typeof sample.avgRSSI, 'number');
  assert.strictEqual(sample.avgRSSI, -45.2);
  assert.strictEqual(sample.hotspotCount, 42);
});

test('the buffer drops the oldest samples past capacity', () => {
  const history = new History(3);
  for (let i = 0; i < 10; i++) {
    history.push(
      frame({
        stats: {
          avgRSSI: String(-40 - i),
          maxRSSI: '-30',
          minRSSI: '-70',
          hotspotCount: i,
        },
      })
    );
  }
  assert.strictEqual(history.samples.length, 3);
  // The last three pushed were -47, -48, -49.
  assert.deepStrictEqual(
    history.samples.map((s) => s.avgRSSI),
    [-47, -48, -49]
  );
});

test('series is oldest to newest and carries the plot fields', () => {
  const history = new History(5);
  history.push(
    frame({
      stats: {
        avgRSSI: '-50',
        maxRSSI: '-30',
        minRSSI: '-70',
        hotspotCount: 1,
      },
    })
  );
  history.push(
    frame({
      stats: {
        avgRSSI: '-40',
        maxRSSI: '-30',
        minRSSI: '-70',
        hotspotCount: 2,
      },
    })
  );

  const series = history.series();
  assert.strictEqual(series.length, 2);
  assert.deepStrictEqual(
    series.map((s) => s.avgRSSI),
    [-50, -40]
  );
  assert.deepStrictEqual(
    series.map((s) => s.index),
    [0, 1]
  );
  assert.ok('errorMetres' in series[0]);
});

test('since() keeps working after the buffer starts evicting', () => {
  const history = new History(5);
  for (let i = 0; i < 20; i++) {
    history.push(
      frame({
        stats: {
          avgRSSI: String(-40 - i),
          maxRSSI: '-30',
          minRSSI: '-70',
          hotspotCount: i,
        },
      })
    );
  }

  assert.strictEqual(history.samples.length, 5, 'buffer is capped');

  // A cursor at the newest sequence must still return the sample pushed after
  // it. An index-based cursor would be pinned at `capacity` and return nothing,
  // which is the bug that froze the client chart after two minutes.
  const lastSeq = history.samples[history.samples.length - 1].seq;
  history.push(frame());

  const delta = history.since(lastSeq);
  assert.strictEqual(delta.length, 1, 'delta must not stall after eviction');
  assert.strictEqual(delta[0].seq, lastSeq + 1);
});

test('since() returns everything after an old cursor, bounded by eviction', () => {
  const history = new History(5);
  for (let i = 0; i < 12; i++) history.push(frame());
  // A cursor older than the surviving window can only return what is left.
  assert.strictEqual(history.since(0).length, 5);
  assert.strictEqual(history.since(9999).length, 0);
});

test('trail returns the position history for one source only', () => {
  const history = new History(5);
  history.push(
    frame({
      sources: [
        { id: 'TX-1', x: 1, y: 1 },
        { id: 'TX-2', x: 9, y: 9 },
      ],
    })
  );
  history.push(
    frame({
      sources: [
        { id: 'TX-1', x: 2, y: 1 },
        { id: 'TX-2', x: 8, y: 9 },
      ],
    })
  );

  const trail = history.trail('TX-1');
  assert.deepStrictEqual(trail, [
    { id: 'TX-1', x: 1, y: 1 },
    { id: 'TX-1', x: 2, y: 1 },
  ]);
  assert.deepStrictEqual(history.trail('NOPE'), []);
});

test('summary on an empty buffer reports nulls rather than NaN', () => {
  const summary = new History(5).summary();
  assert.strictEqual(summary.samples, 0);
  assert.strictEqual(summary.avgRSSIMean, null);
  assert.strictEqual(summary.errorMean, null);
});

test('summary averages only the finite errors', () => {
  const history = new History(10);
  history.push(frame({ tracking: { estimate: {}, errorMetres: 1 } }));
  history.push(frame({ tracking: { estimate: {}, errorMetres: 3 } }));
  // No tracking at all: must not drag the mean to NaN.
  history.push(frame({ tracking: null }));

  const summary = history.summary();
  assert.strictEqual(summary.samples, 3);
  assert.strictEqual(summary.errorMean, 2);
  assert.strictEqual(summary.errorMax, 3);
});

test('clear empties the buffer', () => {
  const history = new History(5);
  history.push(frame());
  history.clear();
  assert.strictEqual(history.samples.length, 0);
});

/* ---------------- csv ---------------- */

test('csvField leaves plain values unquoted and quotes when it must', () => {
  assert.strictEqual(CSV.csvField(42), '42');
  assert.strictEqual(CSV.csvField(-45.2), '-45.2');
  assert.strictEqual(CSV.csvField(null), '');
  assert.strictEqual(CSV.csvField(undefined), '');
  // A source name or note with a comma would otherwise shift every column.
  assert.strictEqual(CSV.csvField('a,b'), '"a,b"');
  assert.strictEqual(CSV.csvField('say "hi"'), '"say ""hi"""');
  assert.strictEqual(CSV.csvField('line\nbreak'), '"line\nbreak"');
});

test('seriesToCsv has a header and one row per sample', () => {
  const history = new History(5);
  history.push(frame());
  history.push(frame());
  const csv = CSV.seriesToCsv(history.series());
  const lines = csv.split('\n');

  assert.strictEqual(lines.length, 3);
  assert.strictEqual(
    lines[0],
    'sample,timestamp,avg_rssi_dbm,max_rssi_dbm,min_rssi_dbm,error_m'
  );
  assert.strictEqual(lines.length, 3);
  // sample is an integer, then the ISO timestamp.
  assert.match(lines[1], /^0,\d{4}-\d{2}-\d{2}T/);
  assert.ok(lines[1].endsWith('1.25'));
});

test('seriesToCsv leaves the error cell empty when there is no estimate', () => {
  const history = new History(5);
  history.push(frame({ tracking: null }));
  const lines = CSV.seriesToCsv(history.series()).split('\n');
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[1].endsWith(','));
});

test('heatmapToCsv emits every cell with a source column per transmitter', () => {
  const csv = CSV.heatmapToCsv({
    heatmap: [
      { x: 0, y: 0, rssi: -30 },
      { x: 1, y: 0, rssi: -55 },
    ],
    sources: [
      { id: 'TX-1', x: 2, y: 3 },
      { id: 'TX-2', x: 4, y: 5 },
    ],
  });
  const lines = csv.split('\n');

  assert.strictEqual(
    lines[0],
    'x_m,y_m,rssi_dbm,TX-1_x_m,TX-1_y_m,TX-2_x_m,TX-2_y_m'
  );
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[1], '0,0,-30,2,3,4,5');
  assert.strictEqual(lines[2], '1,0,-55,2,3,4,5');
});

test('readingsToCsv includes the wall loss and range per receiver', () => {
  const csv = CSV.readingsToCsv({
    readings: [
      { id: 'RX-1', rssi: -56.5, wallLoss: 0, range: 9.43 },
      { id: 'RX-2', rssi: -65.6, wallLoss: 12, range: 8.2 },
    ],
  });
  const lines = csv.split('\n');
  assert.strictEqual(lines[0], 'receiver,rssi_dbm,wall_loss_db,range_m');
  assert.strictEqual(lines[1], 'RX-1,-56.5,0,9.43');
  assert.strictEqual(lines[2], 'RX-2,-65.6,12,8.2');
});

test('readingsToCsv still emits a header when nothing was localised', () => {
  const csv = CSV.readingsToCsv(null);
  assert.strictEqual(csv, 'receiver,rssi_dbm,wall_loss_db,range_m');
});

test('an empty history exports a header-only CSV', () => {
  assert.strictEqual(
    CSV.seriesToCsv([]),
    'sample,timestamp,avg_rssi_dbm,max_rssi_dbm,min_rssi_dbm,error_m'
  );
});
