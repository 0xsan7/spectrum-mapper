/**
 * Marching squares on the two saddle cases.
 *
 * When a cell's corners alternate above/below the level — cases 5 and 10 — the
 * contour has two valid pairings, and only one is right. The decision belongs
 * to the cell's centre value: if the centre is above the level, the two
 * above-level corners are joined through it and the contour separates the two
 * below-level corners; if the centre is below, the join is the other way.
 *
 * Both pairings yield exactly two segments, so counting them cannot tell the
 * resolutions apart. These tests read the endpoints, and check that the pairing
 * actually flips with the centre value rather than being hardcoded.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

function loadScript(name, exports) {
  const src = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
  const context = vm.createContext({
    Math,
    Number,
    JSON,
    Object,
    Array,
    Infinity,
  });
  vm.runInContext(src, context);
  const out = {};
  for (const key of exports) out[key] = vm.runInContext(key, context);
  return out;
}

const list = (v) => Array.from(v);
const { contourSegments } = loadScript('heatmap.js', ['contourSegments']);

const LEVEL = -50;

/**
 * A 2x2 cell, column-major: index = x * rows + y.
 *
 *   (0,0) tl   (1,0) tr
 *   (0,1) bl   (1,1) br
 */
function cell2x2(tl, tr, bl, br) {
  return [
    { x: 0, y: 0, rssi: tl },
    { x: 1, y: 0, rssi: tr },
    { x: 0, y: 1, rssi: bl },
    { x: 1, y: 1, rssi: br },
  ];
}

const round = (v) => Math.round(v * 1000) / 1000;

/** Each segment as a sorted, rounded 'x,y|x,y' key, for order-free comparison. */
function shape(segments) {
  return list(segments)
    .map((s) =>
      list(s)
        .map((p) => `${round(p[0])},${round(p[1])}`)
        .sort()
        .join('|')
    )
    .sort();
}

/** The mean of a cell's four corners — the saddle decider's input. */
const centreOf = (tl, tr, bl, br) => (tl + tr + bl + br) / 4;

test('case 5, centre above the level: the below-level corners are separated', () => {
  // Above -50: tr and bl. Centre mean = -37.5, above the level, so tr and bl
  // are joined through it and the contour cuts tl and br off individually.
  assert.ok(centreOf(-55, -20, -20, -55) > LEVEL);
  const segments = list(
    contourSegments(cell2x2(-55, -20, -20, -55), 2, 2, LEVEL)
  );
  assert.strictEqual(
    segments.length,
    2,
    'a saddle yields two segments either way'
  );
  assert.deepStrictEqual(
    shape(segments),
    // left->top and bottom->right: each isolates one below-level corner.
    ['0,0.143|0.143,0', '0.857,1|1,0.857'],
    'centre above the level, so the pairing must cut off tl and br separately'
  );
});

test('case 5, centre below the level: the above-level corners are separated', () => {
  // Above -50: tr and bl. Centre mean = -55, below the level.
  assert.ok(centreOf(-90, -20, -20, -90) < LEVEL);
  const segments = list(
    contourSegments(cell2x2(-90, -20, -20, -90), 2, 2, LEVEL)
  );
  assert.strictEqual(segments.length, 2);
  assert.deepStrictEqual(
    shape(segments),
    // top->right isolates tr; left->bottom isolates bl.
    ['0,0.571|0.429,1', '0.571,0|1,0.429'],
    'centre below the level, so the pairing must separate tr from bl'
  );
});

test('case 10, centre above the level: the below-level corners are separated', () => {
  // Above -50: tl and br. Centre mean = -37.5.
  assert.ok(centreOf(-20, -55, -55, -20) > LEVEL);
  const segments = list(
    contourSegments(cell2x2(-20, -55, -55, -20), 2, 2, LEVEL)
  );
  assert.strictEqual(segments.length, 2);
  assert.deepStrictEqual(
    shape(segments),
    ['0,0.857|0.143,1', '0.857,0|1,0.143'],
    'centre above the level, so the pairing must cut off tr and bl separately'
  );
});

test('case 10, centre below the level: the above-level corners are separated', () => {
  // Above -50: tl and br. Centre mean = -55.
  assert.ok(centreOf(-20, -90, -90, -20) < LEVEL);
  const segments = list(
    contourSegments(cell2x2(-20, -90, -90, -20), 2, 2, LEVEL)
  );
  assert.strictEqual(segments.length, 2);
  assert.deepStrictEqual(
    shape(segments),
    ['0,0.429|0.429,0', '0.571,1|1,0.571'],
    'centre below the level, so the pairing must separate tl from br'
  );
});

test('the pairing follows the centre, not a hardcoded branch', () => {
  // The point of the fix. These fixtures differ only in the two below-level
  // corners, and must produce different geometry. A hardcoded pairing returns
  // the same answer for both.
  const case5Above = shape(
    contourSegments(cell2x2(-55, -20, -20, -55), 2, 2, LEVEL)
  );
  const case5Below = shape(
    contourSegments(cell2x2(-90, -20, -20, -90), 2, 2, LEVEL)
  );
  assert.notDeepStrictEqual(
    case5Above,
    case5Below,
    'case 5 must resolve differently when the centre crosses the level'
  );

  const case10Above = shape(
    contourSegments(cell2x2(-20, -55, -55, -20), 2, 2, LEVEL)
  );
  const case10Below = shape(
    contourSegments(cell2x2(-20, -90, -90, -20), 2, 2, LEVEL)
  );
  assert.notDeepStrictEqual(
    case10Above,
    case10Below,
    'case 10 must resolve differently when the centre crosses the level'
  );
});

test('the decider averages all four corners, not the two above the level', () => {
  /* Two of every saddle cell's four corners are above the level, so a decider
     that averaged only those two would read a value that is above the level by
     construction and could never take the other branch. These are case 10
     fixtures (tl and br above) chosen so the two rules disagree about which
     side of the level the centre falls on:

       tl=-20, tr=-80, bl=-80, br=-20   four-corner mean = -50.0, exactly on
                                         the level; a two-corner mean of the
                                         above-level corners reads -20.
       tl=-20, tr=-80, bl=-80, br=-30   four-corner mean = -52.5, below; the
                                         two-corner mean still reads -20.
       tl=-20, tr=-80, bl=-80, br=-19   four-corner mean = -49.75, above.

     A two-corner mean calls all three the same. The four-corner mean separates
     them, which is what these assertions check.
  */
  const below = cell2x2(-20, -80, -80, -30);
  assert.ok(
    centreOf(-20, -80, -80, -30) < LEVEL,
    'mean -52.5 is below the level'
  );
  assert.deepStrictEqual(
    shape(contourSegments(below, 2, 2, LEVEL)),
    // below-level pairing for case 10: left->top, bottom->right
    ['0,0.5|0.5,0', '0.6,1|1,0.6'],
    'the pairing must follow the four-corner mean being below the level'
  );

  const above = cell2x2(-20, -80, -80, -19);
  assert.ok(
    centreOf(-20, -80, -80, -19) > LEVEL,
    'mean -49.75 is above the level'
  );
  assert.deepStrictEqual(
    shape(contourSegments(above, 2, 2, LEVEL)),
    // above-level pairing for case 10: top->right, left->bottom
    ['0,0.5|0.492,1', '0.5,0|1,0.492'],
    'the pairing must follow the four-corner mean being above the level'
  );

  // A mean exactly on the level is not above it, so it resolves as below. This
  // is the boundary the `>` comparison has to get right.
  const onLevel = cell2x2(-20, -80, -80, -20);
  assert.strictEqual(centreOf(-20, -80, -80, -20), LEVEL);
  assert.deepStrictEqual(
    shape(contourSegments(onLevel, 2, 2, LEVEL)),
    ['0,0.5|0.5,0', '0.5,1|1,0.5'],
    'a mean exactly on the level resolves as below, not above'
  );

  // A decider built from the extremes rather than the mean lands here too. The
  // four corners are -20, -80, -60, -30: the mean is -47.5, above the level,
  // but the midpoint of the extremes is exactly -50.0, so it takes the other
  // branch. This is the fixture that separates "average the four" from any
  // approximation that only looks at two of them.
  const skewed = cell2x2(-20, -80, -60, -30);
  assert.strictEqual(centreOf(-20, -80, -60, -30), -47.5);
  assert.deepStrictEqual(
    shape(contourSegments(skewed, 2, 2, LEVEL)),
    ['0,0.5|0.6,1', '0.75,0|1,0.333'],
    'the pairing must follow the mean of all four, not the extremes'
  );
});

test('a non-saddle cell is unaffected by the decider', () => {
  // Case 6: tr and br above, adjacent rather than diagonal. Traces a single
  // top->bottom segment and has no ambiguity to resolve.
  const segments = list(
    contourSegments(cell2x2(-70, -40, -70, -40), 2, 2, LEVEL)
  );
  assert.strictEqual(segments.length, 1);
  assert.deepStrictEqual(shape(segments), ['0,0.667|1,0.667']);

  // Case 9: tl and bl above, also adjacent.
  const other = list(contourSegments(cell2x2(-40, -70, -40, -70), 2, 2, LEVEL));
  assert.strictEqual(other.length, 1);
  assert.deepStrictEqual(shape(other), ['0,0.333|1,0.333']);
});

test('a cell entirely above or below the level traces nothing', () => {
  assert.deepStrictEqual(
    shape(contourSegments(cell2x2(-20, -20, -20, -20), 2, 2, LEVEL)),
    []
  );
  assert.deepStrictEqual(
    shape(contourSegments(cell2x2(-90, -90, -90, -90), 2, 2, LEVEL)),
    []
  );
});

test("the decider reads this cell's own corners, not the neighbours'", () => {
  // tr is barely above and bl is far above; tl and br are just below. The mean
  // is -44.75, above the level, so tl and br are the corners cut off:
  // tl by left->top, br by bottom->right.
  const segments = list(
    contourSegments(cell2x2(-55, -49, -20, -55), 2, 2, LEVEL)
  );
  assert.strictEqual(segments.length, 2);
  assert.deepStrictEqual(
    shape(segments),
    ['0,0.833|0.143,0', '0.167,1|1,0.857'],
    "the decider must read this cell's own four corners"
  );
});
