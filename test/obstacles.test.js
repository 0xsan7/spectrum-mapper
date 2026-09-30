const test = require('node:test');
const assert = require('node:assert');
const Obstacles = require('../src/obstacles');
const PathLossModel = require('../src/pathLoss');
const RFSimulation = require('../src/simulation');
const { CONFIG } = require('../src/config/constants');

const STEADY = { fadingDb: 0, noiseFloor: -200 };

test('a wall between TX and RX attenuates the signal by its dB value', () => {
  // Vertical wall at x=10 spanning the room, 12 dB of drywall.
  const wall = {
    x1: 10,
    y1: 0,
    x2: 10,
    y2: 15,
    attenuation: 12,
    thickness: 0.2,
  };
  const obstacles = new Obstacles([wall]);
  const clear = PathLossModel.calculateRSSI(20, 5, STEADY);
  // The same 5 m path, but with the TX power reduced by the wall's 12 dB.
  const shadowed = PathLossModel.calculateRSSI(20 - 12, 5, STEADY);
  assert.ok(
    Math.abs(obstacles.attenuationBetween(2, 7, 18, 7) - 12) < 1e-9,
    'a path across the wall must pick up the full 12 dB'
  );
  assert.ok(shadowed < clear, 'a 12 dB wall must weaken the signal');
  assert.ok(
    Math.abs(shadowed - (clear - 12)) < 1e-9,
    `expected ${(clear - 12).toFixed(2)} dBm, got ${shadowed.toFixed(2)}`
  );
});

test('no attenuation when the path does not cross the wall', () => {
  const wall = {
    x1: 10,
    y1: 0,
    x2: 10,
    y2: 15,
    attenuation: 12,
    thickness: 0.2,
  };
  const obstacles = new Obstacles([wall]);

  // Both endpoints on the same side of x=10.
  assert.strictEqual(obstacles.attenuationBetween(2, 2, 8, 8), 0);
  assert.strictEqual(obstacles.attenuationBetween(12, 2, 18, 8), 0);
  // Collinear with the wall, but not crossing it.
  assert.strictEqual(obstacles.attenuationBetween(2, 3, 8, 3), 0);
});

test('two crossed walls stack their attenuation', () => {
  const obstacles = new Obstacles([
    { x1: 10, y1: 0, x2: 10, y2: 15, attenuation: 8, thickness: 0.2 },
    { x1: 0, y1: 7, x2: 20, y2: 7, attenuation: 5, thickness: 0.2 },
  ]);
  // A diagonal from corner to corner genuinely crosses both walls.
  assert.strictEqual(obstacles.attenuationBetween(2, 2, 18, 12), 13);
  // Crosses only the vertical wall.
  assert.strictEqual(obstacles.attenuationBetween(2, 3, 18, 3), 8);
  // Crosses only the horizontal wall.
  assert.strictEqual(obstacles.attenuationBetween(5, 2, 5, 12), 5);
  // Runs *along* the horizontal wall (both endpoints at y=7), so it never
  // passes through it: only the vertical wall is crossed. A path that grazes
  // a wall's length is not attenuated by it.
  assert.strictEqual(obstacles.attenuationBetween(2, 7, 18, 7), 8);
});

test('a thicker wall catches paths that miss the centre line', () => {
  const thin = new Obstacles([
    { x1: 10, y1: 5, x2: 10, y2: 9, attenuation: 10, thickness: 0 },
  ]);
  const thick = new Obstacles([
    { x1: 10, y1: 5, x2: 10, y2: 9, attenuation: 10, thickness: 4 },
  ]);

  // This path passes x=10 at y=4.5, above the wall's top end at y=5.
  assert.strictEqual(thin.attenuationBetween(2, 4.5, 18, 4.5), 0);
  assert.strictEqual(
    thick.attenuationBetween(2, 4.5, 18, 4.5),
    10,
    'a 4 m thick wall spans y=3 to y=11, so it must catch y=4.5'
  );
});

test('walls inside the room add a visible shadow on the grid', () => {
  const source = [{ id: 'a', x: 2, y: 7, txPower: 20 }];
  const clear = new Obstacles([]);
  const walled = new Obstacles([
    { x1: 10, y1: 0, x2: 10, y2: 15, attenuation: 20, thickness: 0.2 },
  ]);

  const opts = { ...STEADY, obstacles: clear };
  const optsWalled = { ...STEADY, obstacles: walled };

  const open = PathLossModel.calculateGridRSSI(18, 7, source, opts);
  const blocked = PathLossModel.calculateGridRSSI(18, 7, source, optsWalled);
  assert.ok(
    Math.abs(open - blocked - 20) < 1e-9,
    `expected a clean 20 dB shadow, got ${(open - blocked).toFixed(2)}`
  );
});

test('validate clamps coordinates to the room and rejects bad attenuation', () => {
  const wall = Obstacles.validate({
    x1: -5,
    y1: 99,
    x2: 3,
    y2: 4,
    attenuation: -8,
    thickness: -1,
  });
  assert.strictEqual(wall.x1, 0, 'x1 clamped into the room');
  assert.strictEqual(wall.y1, CONFIG.ROOM_HEIGHT, 'y1 clamped into the room');
  assert.strictEqual(
    wall.attenuation,
    0,
    'negative attenuation must not amplify'
  );
  assert.strictEqual(wall.thickness, 0);
  assert.strictEqual(wall.material, 'wall', 'material defaults');
});

test('validate throws on non-numeric geometry', () => {
  assert.throws(
    () =>
      Obstacles.validate({
        x1: 'a',
        y1: 0,
        x2: 1,
        y2: 1,
        attenuation: 5,
        thickness: 1,
      }),
    RangeError
  );
  assert.throws(
    () =>
      Obstacles.validate({
        x1: NaN,
        y1: 0,
        x2: 1,
        y2: 1,
        attenuation: 5,
        thickness: 1,
      }),
    RangeError
  );
  assert.throws(
    () =>
      Obstacles.validate({
        x1: Infinity,
        y1: 0,
        x2: 1,
        y2: 1,
        attenuation: 5,
        thickness: 1,
      }),
    RangeError
  );
});

test('addWall, removeWall and clear behave', () => {
  const obstacles = new Obstacles();
  const wall = { x1: 5, y1: 0, x2: 5, y2: 15, attenuation: 6, thickness: 0.2 };
  obstacles.addWall(wall);
  assert.strictEqual(obstacles.getWalls().length, 1);

  // getWalls must hand back copies, not the live objects.
  const fetched = obstacles.getWalls()[0];
  fetched.attenuation = 999;
  assert.strictEqual(obstacles.getWalls()[0].attenuation, 6, 'must be a copy');

  obstacles.removeWall(0);
  assert.strictEqual(obstacles.getWalls().length, 0);
  assert.strictEqual(
    obstacles.removeWall(5),
    null,
    'removing a bad index is a no-op'
  );

  obstacles.addWall(wall);
  obstacles.clear();
  assert.strictEqual(obstacles.getWalls().length, 0);
});

test('segmentsCross is symmetric and rejects parallel lines', () => {
  const { segmentsCross } = require('../src/obstacles');
  assert.strictEqual(
    segmentsCross(0, 0, 10, 10, 0, 10, 10, 0),
    true,
    'X crosses'
  );
  assert.strictEqual(
    segmentsCross(0, 0, 10, 0, 0, 5, 10, 5),
    false,
    'parallel'
  );
  assert.strictEqual(
    segmentsCross(0, 0, 5, 0, 10, 0, 20, 0),
    false,
    'collinear, disjoint'
  );
  assert.strictEqual(
    segmentsCross(0, 0, 10, 0, 20, -5, 20, 5),
    false,
    'never reaches'
  );
});

test('simulation wraps movement around the room instead of teleporting', () => {
  const sim = new RFSimulation();
  sim.sources = [{ id: 'T', x: 19.5, y: 5, vx: 1, vy: 0, txPower: 10 }];
  sim.updatePositions();
  assert.ok(
    sim.sources[0].x < 5,
    `expected a wrap near 0.5, got ${sim.sources[0].x}`
  );

  sim.sources = [{ id: 'T', x: 0.5, y: 5, vx: -1, vy: 0, txPower: 10 }];
  sim.updatePositions();
  assert.ok(
    sim.sources[0].x > 19,
    `expected a wrap near 19.5, got ${sim.sources[0].x}`
  );
});

test('a dragged source is pinned until released', () => {
  const sim = new RFSimulation();
  const target = sim.sources[2];
  const originalVx = target.vx;
  assert.ok(
    originalVx !== 0,
    'TX-3 should be a moving source for this to mean anything'
  );

  assert.strictEqual(sim.moveSource('TX-3', 7, 9), true);
  assert.strictEqual(target.x, 7);
  assert.strictEqual(target.y, 9);
  assert.strictEqual(sim.isPinned('TX-3'), true);

  const before = { x: target.x, y: target.y };
  sim.updatePositions();
  assert.deepStrictEqual(
    { x: target.x, y: target.y },
    before,
    'a pinned source must not drift'
  );

  assert.strictEqual(sim.releaseSource('TX-3'), true);
  sim.updatePositions();
  assert.notDeepStrictEqual(
    { x: target.x, y: target.y },
    before,
    'a released source resumes moving'
  );
});

test('moveSource clamps into the room and rejects unknown ids', () => {
  const sim = new RFSimulation();
  sim.moveSource('TX-1', 999, -20);
  const moved = sim.sources.find((s) => s.id === 'TX-1');
  assert.strictEqual(moved.x, CONFIG.ROOM_WIDTH);
  assert.strictEqual(moved.y, 0);

  assert.strictEqual(
    sim.moveSource('NOPE', 1, 1),
    false,
    'unknown id is rejected'
  );
});

test('moveSource rejects non-finite coordinates instead of snapping to a corner', () => {
  const sim = new RFSimulation();
  const before = { x: sim.sources[0].x, y: sim.sources[0].y };

  // A NaN coordinate must be refused outright. Clamping it would silently
  // place the node at (0, 0) and look like a successful drag.
  assert.strictEqual(sim.moveSource('TX-1', NaN, 5), false);
  assert.strictEqual(sim.moveSource('TX-1', 5, undefined), false);
  assert.strictEqual(sim.moveSource('TX-1', Infinity, 5), false);
  assert.deepStrictEqual(
    { x: sim.sources[0].x, y: sim.sources[0].y },
    before,
    'a rejected move must not touch the source'
  );
  assert.strictEqual(
    sim.isPinned('TX-1'),
    false,
    'a rejected move must not pin'
  );
});

test('receivers reject non-finite coordinates too', () => {
  const Receivers = require('../src/receivers');
  const receivers = new Receivers();
  const before = { ...receivers.getNodes()[0] };

  assert.strictEqual(receivers.move('RX-1', NaN, 2), false);
  assert.strictEqual(receivers.move('RX-1', 2, Infinity), false);
  assert.deepStrictEqual(receivers.getNodes()[0], before, 'unchanged');

  assert.strictEqual(receivers.move('RX-1', 5, 6), true);
  assert.deepStrictEqual(
    { x: receivers.getNodes()[0].x, y: receivers.getNodes()[0].y },
    { x: 5, y: 6 }
  );

  receivers.reset();
  assert.deepStrictEqual(receivers.getNodes()[0], before, 'reset restores');
});

test('getSources rounds to two decimals and reports the pinned flag', () => {
  const sim = new RFSimulation();
  sim.moveSource('TX-1', 1.23456, 2.98765);
  const source = sim.getSources().find((s) => s.id === 'TX-1');
  assert.strictEqual(source.x, 1.23);
  assert.strictEqual(source.y, 2.99);
  assert.strictEqual(source.pinned, true);
  assert.strictEqual(source.name, 'Router A', 'name is preserved');
  assert.strictEqual(source.txPower, 20, 'txPower is preserved');
});
