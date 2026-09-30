const test = require('node:test');
const assert = require('node:assert');

// Requiring the server must not bind a port: server.js only listens when it is
// run directly, so this is a no-op import that gives us handleCommand.
const {
  handleCommand,
  simulation,
  obstacles,
  params,
  updateSimulation,
} = require('../src/server');

test('importing server.js does not start a listener', () => {
  // If this module had auto-listened, the handle would be truthy.
  assert.ok(
    !require('../src/server').server.listening,
    'server must not listen on require'
  );
});

test('setParam accepts values inside the documented range', () => {
  assert.strictEqual(
    handleCommand({ type: 'setParam', key: 'exponent', value: 3.2 }),
    null
  );
  assert.strictEqual(params.exponent, 3.2);

  assert.strictEqual(
    handleCommand({ type: 'setParam', key: 'frequency', value: 5000 }),
    null
  );
  assert.strictEqual(params.frequency, 5000);

  assert.strictEqual(
    handleCommand({ type: 'setParam', key: 'noise', value: 0 }),
    null
  );
  assert.strictEqual(params.noise, 0);
});

test('setParam clamps instead of accepting nonsense', () => {
  handleCommand({ type: 'setParam', key: 'exponent', value: 999 });
  assert.strictEqual(params.exponent, 5, 'clamped to the exponent maximum');

  handleCommand({ type: 'setParam', key: 'exponent', value: -50 });
  assert.strictEqual(params.exponent, 1, 'clamped to the exponent minimum');

  handleCommand({ type: 'setParam', key: 'frequency', value: 1 });
  assert.strictEqual(params.frequency, 100, 'clamped to the frequency minimum');
});

test('setParam rejects non-numbers and unknown keys', () => {
  const before = params.exponent;
  assert.match(
    handleCommand({ type: 'setParam', key: 'exponent', value: 'abc' }),
    /rejected/
  );
  assert.strictEqual(
    params.exponent,
    before,
    'value must be unchanged after a rejection'
  );

  assert.match(
    handleCommand({ type: 'setParam', key: 'nonsense', value: 1 }),
    /rejected/
  );
  assert.strictEqual(params.nonsense, undefined, 'no phantom param is created');
});

test('setParam cannot inject a prototype property', () => {
  assert.match(
    handleCommand({ type: 'setParam', key: '__proto__', value: 1 }),
    /rejected/
  );
  assert.strictEqual({}.polluted, undefined, 'Object.prototype must be clean');
});

test('addWall and clearWalls drive the obstacle list', () => {
  obstacles.clear();
  assert.strictEqual(
    handleCommand({
      type: 'addWall',
      wall: { x1: 5, y1: 0, x2: 5, y2: 15, attenuation: 9, thickness: 0.2 },
    }),
    null
  );
  assert.strictEqual(obstacles.getWalls().length, 1);

  assert.strictEqual(handleCommand({ type: 'clearWalls' }), null);
  assert.strictEqual(obstacles.getWalls().length, 0);
});

test('a malformed wall is rejected with a message, not a crash', () => {
  obstacles.clear();
  const error = handleCommand({
    type: 'addWall',
    wall: { x1: 'oops', y1: 0, x2: 5, y2: 15, attenuation: 9, thickness: 1 },
  });
  assert.match(error, /x1 must be a finite number/);
  assert.strictEqual(obstacles.getWalls().length, 0, 'no wall is stored');
});

test('moveSource and releaseSource are routed', () => {
  assert.strictEqual(
    handleCommand({ type: 'moveSource', id: 'TX-1', x: 3, y: 4 }),
    null
  );
  assert.strictEqual(simulation.sources[0].x, 3);

  assert.match(
    handleCommand({ type: 'moveSource', id: 'GHOST', x: 1, y: 1 }),
    /unknown source/
  );

  assert.strictEqual(
    handleCommand({ type: 'releaseSource', id: 'TX-1' }),
    null
  );
  assert.strictEqual(simulation.isPinned('TX-1'), false);
});

test('an unknown message type is reported', () => {
  assert.match(handleCommand({ type: 'dropTables' }), /unknown message type/);
  assert.match(handleCommand({}), /unknown message type: undefined/);
});

test('reset restores the default parameters and clears the scene', () => {
  simulation.moveSource('TX-1', 9, 9);
  obstacles.addWall({
    x1: 1,
    y1: 1,
    x2: 2,
    y2: 2,
    attenuation: 5,
    thickness: 1,
  });
  handleCommand({ type: 'setParam', key: 'exponent', value: 4.5 });

  assert.strictEqual(handleCommand({ type: 'reset' }), null);
  assert.strictEqual(params.exponent, 2.7, 'exponent back to default');
  assert.strictEqual(params.frequency, 2437, 'frequency back to default');
  assert.strictEqual(params.noise, 3, 'noise back to default');
  assert.strictEqual(obstacles.getWalls().length, 0, 'walls cleared');
  assert.strictEqual(simulation.isPinned('TX-1'), false, 'sources released');
});

test('the broadcast payload carries walls, params and limits', () => {
  obstacles.clear();
  simulation.releaseSource('TX-1');
  obstacles.addWall({
    x1: 10,
    y1: 0,
    x2: 10,
    y2: 15,
    attenuation: 12,
    thickness: 0.2,
  });

  const data = updateSimulation();
  assert.strictEqual(data.walls.length, 1, 'walls reach the client');
  assert.strictEqual(data.walls[0].attenuation, 12);
  assert.ok(data.params, 'params reach the client');
  assert.ok(data.limits.exponent, 'slider bounds reach the client');
  assert.strictEqual(data.heatmap.length, 300);
  assert.ok(data.timestamp, 'frame is timestamped');
  assert.strictEqual(
    data.sources[0].pinned,
    false,
    'sources report their pinned flag'
  );
});
