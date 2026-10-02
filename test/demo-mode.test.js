/**
 * Public demo mode.
 *
 * Almost every behaviour is tested against a real server in a child process,
 * because DEMO_MODE and friends are read from the environment at boot and cannot
 * be reconfigured mid-process. A test that set process.env and asserted against
 * the in-process app would pass while testing nothing - and did, once:
 * DEMO_RATE_LIMIT=5 in the test never reached the module, so every allowance
 * came back as the default 20.
 *
 * The rate limiter and the reset are additionally driven directly, because the
 * property under test is a counter, not a transport. Driving 20 commands a
 * second over a socket makes the test slow and wall-clock dependent. The idle
 * reset uses a short interval so no test waits ten minutes.
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'src/server.js');

let portSeq = 0;
const nextPort = () => 20000 + ((process.pid * 17 + portSeq++) % 20000);

function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    const port = nextPort();
    const child = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        // Off unless a test asks for it, so the rest of the suite is unaffected.
        DEMO_MODE: '0',
        ...env,
      },
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
        resolve({ port, child, stop: () => child.kill('SIGKILL') });
      }
    });
    child.stderr.on('data', (d) => (out += d));
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}:\n${out}`));
    });
  });
}

/** Connect, resolving with the socket or with a refusal descriptor. */
function connect(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('close', (code) => resolve({ closed: true, code, ws }));
  });
}

/**
 * Attempt a connection expected to be refused, and report how it failed.
 *
 * The refusals happen at the HTTP upgrade, so ws surfaces them as
 * 'unexpected-response'. Without listening for that the generic 'error' event
 * carries no status, and the test cannot tell a 403 from a refused connection to
 * a port nobody is listening on.
 */
function attempt(port, headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    const done = (how, status) => {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
      resolve({ how, status });
    };
    ws.once('unexpected-response', (req, res) => {
      res.resume();
      done('refused', res.statusCode);
    });
    ws.once('error', () => done('error'));
    ws.once('open', () => done('opened'));
    setTimeout(() => done('hung'), 3000);
  });
}

/** Run a snippet in a child with DEMO_* set, and parse its JSON output. */
function probe(source, env) {
  const out = execFileSync(
    process.execPath,
    ['-e', `const { CONFIG } = require('${SERVER}');\n${source}`],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } }
  );
  return JSON.parse(out.slice(out.indexOf('{')));
}

const post = (port, route, body, headers = {}) =>
  fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/** Read one frame off a socket. */
function nextFrame(ws, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no frame')), timeoutMs);
    ws.once('message', (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw));
    });
  });
}

const summary = (port) =>
  fetch(`http://127.0.0.1:${port}/api/summary`).then((r) => r.json());

/* ---- ingest is closed ---- */

test('demo mode refuses POST /api/readings with 403', async () => {
  const s = await startServer({ DEMO_MODE: '1' });
  try {
    const r = await post(s.port, '/api/readings', { x: 1, y: 1, rssi: -50 });
    assert.strictEqual(r.status, 403);
    assert.match((await r.json()).error, /disabled in demo mode/);
  } finally {
    s.stop();
  }
});

test('demo mode refuses CSV import with 403', async () => {
  const s = await startServer({ DEMO_MODE: '1' });
  try {
    const r = await fetch(
      `http://127.0.0.1:${s.port}/api/import/readings.csv`,
      {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: 'x,y,rssi\n1,1,-50\n',
      }
    );
    assert.strictEqual(r.status, 403);
  } finally {
    s.stop();
  }
});

test('a demo refuses ingest even with a correct token', async () => {
  // Closing the route is the point; a token must not become a way around it, or
  // "disabled in demo mode" is a misleading message.
  const s = await startServer({
    DEMO_MODE: '1',
    READINGS_TOKEN: 'right-token',
  });
  try {
    const r = await post(
      s.port,
      '/api/readings',
      { x: 1, y: 1, rssi: -50 },
      { authorization: 'Bearer right-token' }
    );
    assert.strictEqual(r.status, 403);
  } finally {
    s.stop();
  }
});

test('a refused ingest stores nothing', async () => {
  const s = await startServer({ DEMO_MODE: '1' });
  try {
    // Measured against the preloaded survey rather than against zero: a demo
    // starts with 42 points, so this proves the rejected POST was not added, not
    // that the store happened to be empty.
    const before = (
      await (await fetch(`http://127.0.0.1:${s.port}/healthz`)).json()
    ).readings;
    assert.ok(before > 0, 'the fixture should have a preloaded survey');

    await post(s.port, '/api/readings', { x: 1, y: 1, rssi: -50 });
    const after = (
      await (await fetch(`http://127.0.0.1:${s.port}/healthz`)).json()
    ).readings;
    assert.strictEqual(after, before, 'a 403 that still stored the reading');
  } finally {
    s.stop();
  }
});

test('ingest still works when demo mode is off', async () => {
  const s = await startServer({ DEMO_MODE: '0' });
  try {
    assert.strictEqual(
      (await post(s.port, '/api/readings', { x: 1, y: 1, rssi: -50 })).status,
      201
    );
  } finally {
    s.stop();
  }
});

/* ---- the frame announces demo mode ---- */

test('the frame reports demo mode, and false when it is off', async () => {
  const demo = await startServer({ DEMO_MODE: '1' });
  try {
    const ws = await connect(demo.port);
    assert.strictEqual((await nextFrame(ws)).demo, true);
    ws.close();
  } finally {
    demo.stop();
  }

  const plain = await startServer({ DEMO_MODE: '0' });
  try {
    const ws = await connect(plain.port);
    assert.strictEqual((await nextFrame(ws)).demo, false);
    ws.close();
  } finally {
    plain.stop();
  }
});

test('DEMO_MODE is only on for the exact value 1', () => {
  for (const value of ['0', 'true', 'yes', '']) {
    const r = probe(
      'process.stdout.write(JSON.stringify({ demo: CONFIG.DEMO_MODE }));',
      { DEMO_MODE: value }
    );
    assert.strictEqual(
      r.demo,
      false,
      `DEMO_MODE=${value} must not enable demo mode`
    );
  }
  const on = probe(
    'process.stdout.write(JSON.stringify({ demo: CONFIG.DEMO_MODE }));',
    { DEMO_MODE: '1' }
  );
  assert.strictEqual(on.demo, true);
});

/* ---- command rate limit ---- */

test('a socket client is cut off once it exceeds the limit', async () => {
  const s = await startServer({ DEMO_MODE: '1', DEMO_RATE_LIMIT: '20' });
  try {
    const ws = await connect(s.port);
    await nextFrame(ws);

    const errors = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'error' && /slow down/.test(m.message))
        errors.push(m.message);
    });

    // A slider drag fires a command per frame; well past the limit.
    for (let i = 0; i < 60; i++) {
      ws.send(JSON.stringify({ type: 'setParam', key: 'noise', value: 1 }));
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    ws.close();

    // The first 20 apply and the rest are refused, so refusals are expected -
    // the point is that they arrive and name themselves.
    assert.ok(
      errors.length > 0,
      'no refusals: the socket path is not enforcing the limit'
    );
    assert.match(errors[0], /20 commands per second/);
  } finally {
    s.stop();
  }
});

test('the limit is enforced per socket, not across the room', async () => {
  const s = await startServer({ DEMO_MODE: '1', DEMO_RATE_LIMIT: '5' });
  try {
    const a = await connect(s.port);
    const b = await connect(s.port);
    await nextFrame(a);
    await nextFrame(b);

    const seen = { a: 0, b: 0 };
    const watch = (ws, key) =>
      ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'error' && /slow down/.test(m.message)) seen[key]++;
      });
    watch(a, 'a');
    watch(b, 'b');

    // Hammer from a alone. b must never be refused: a shared budget would stop
    // one visitor from using the room at all.
    for (let i = 0; i < 30; i++) {
      a.send(JSON.stringify({ type: 'ping' }));
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    a.close();
    b.close();

    assert.ok(seen.a > 0, 'client a should have been throttled');
    assert.strictEqual(
      seen.b,
      0,
      `client b was refused ${seen.b} times by a's traffic`
    );
  } finally {
    s.stop();
  }
});

test('the rate limiter allows exactly the limit, then refuses', () => {
  const r = probe(
    `
    const { rateLimitOk, rateBuckets } = require('${SERVER}');
    const id = 'test-client';
    const now = 1700000000000;      // fixed clock: no wall time, no flake
    const allowed = [];
    for (let i = 0; i < 25; i++) allowed.push(rateLimitOk(id, now));
    const nextWindow = [];
    for (let i = 0; i < 3; i++) nextWindow.push(rateLimitOk(id, now + 1000));
    process.stdout.write(JSON.stringify({ allowed, nextWindow,
      buckets: rateBuckets.size }));
  `,
    { DEMO_MODE: '1', DEMO_RATE_LIMIT: '20' }
  );

  assert.strictEqual(
    r.allowed.filter(Boolean).length,
    20,
    'exactly 20 must be allowed'
  );
  assert.strictEqual(
    r.allowed[20],
    false,
    'the 21st command in a second must be refused'
  );
  // The window resets, so a client is not locked out for good.
  assert.deepStrictEqual(r.nextWindow, [true, true, true]);
  assert.ok(
    r.buckets <= 1,
    `one client should mean one bucket, got ${r.buckets}`
  );
});

test('the rate limiter keeps one budget per client', () => {
  const r = probe(
    `
    const { rateLimitOk } = require('${SERVER}');
    const now = 1700000000000;
    const a = [], b = [];
    for (let i = 0; i < 8; i++) a.push(rateLimitOk('client-a', now));
    for (let i = 0; i < 8; i++) b.push(rateLimitOk('client-b', now));
    process.stdout.write(JSON.stringify({ a, b }));
  `,
    { DEMO_MODE: '1', DEMO_RATE_LIMIT: '5' }
  );
  assert.strictEqual(r.a.filter(Boolean).length, 5);
  assert.strictEqual(
    r.b.filter(Boolean).length,
    5,
    'one client must not spend another budget'
  );
});

test('the rate limiter does nothing when demo mode is off', () => {
  const r = probe(
    `
    const { rateLimitOk, rateBuckets } = require('${SERVER}');
    const now = 1700000000000;
    const out = [];
    for (let i = 0; i < 50; i++) out.push(rateLimitOk('anyone', now));
    process.stdout.write(JSON.stringify({ allAllowed: out.every(Boolean),
      buckets: rateBuckets.size }));
  `,
    { DEMO_MODE: '0', DEMO_RATE_LIMIT: '2' }
  );
  assert.strictEqual(
    r.allAllowed,
    true,
    'a local install must not be throttled'
  );
  assert.strictEqual(r.buckets, 0, 'and must not accumulate state');
});

/* ---- concurrent clients ---- */

test('demo mode refuses connections past the client cap', async () => {
  const s = await startServer({ DEMO_MODE: '1', DEMO_MAX_CLIENTS: '2' });
  try {
    const a = await connect(s.port);
    const b = await connect(s.port);
    assert.ok(!a.closed && !b.closed, 'the first two clients are fine');

    const third = await attempt(s.port);
    assert.strictEqual(
      third.how,
      'refused',
      `expected a refusal, got ${third.how}`
    );
    // 503 rather than a completed handshake: the client sees a refusal instead
    // of a connection that opens and then closes.
    assert.strictEqual(third.status, 503);

    a.close();
    b.close();
  } finally {
    s.stop();
  }
});

test('the client cap does not apply when demo mode is off', async () => {
  const s = await startServer({ DEMO_MODE: '0', DEMO_MAX_CLIENTS: '1' });
  try {
    const a = await connect(s.port);
    const b = await connect(s.port);
    assert.ok(!a.closed && !b.closed, 'a local install must not run a cap');
    a.close();
    b.close();
  } finally {
    s.stop();
  }
});

/* ---- origin ---- */

test('a disallowed Origin is refused before the handshake completes', async () => {
  const s = await startServer({
    DEMO_MODE: '1',
    ALLOWED_ORIGINS: 'https://example.com',
  });
  try {
    const bad = await attempt(s.port, { origin: 'https://evil.example' });
    assert.strictEqual(
      bad.how,
      'refused',
      `expected a refused upgrade, got ${bad.how}`
    );
    assert.strictEqual(bad.status, 403);
  } finally {
    s.stop();
  }
});

test('a missing Origin is refused when an allowlist is set', async () => {
  // A script can connect without sending one. An allowlist that accepts a blank
  // Origin is an allowlist anyone can walk through.
  const s = await startServer({
    DEMO_MODE: '1',
    ALLOWED_ORIGINS: 'https://example.com',
  });
  try {
    const anon = await attempt(s.port);
    assert.strictEqual(anon.how, 'refused');
    assert.strictEqual(anon.status, 403);
  } finally {
    s.stop();
  }
});

test('an allowed Origin connects and receives frames', async () => {
  const s = await startServer({
    DEMO_MODE: '1',
    ALLOWED_ORIGINS: 'https://example.com, https://other.test',
  });
  try {
    const ws = await connect(s.port, { origin: 'https://other.test' });
    assert.ok(!ws.closed, 'an allowlisted origin must connect');
    assert.ok((await nextFrame(ws)).heatmap, 'and must receive a frame');
    ws.close();
  } finally {
    s.stop();
  }
});

test('no allowlist means no Origin check', async () => {
  const s = await startServer({ DEMO_MODE: '1', ALLOWED_ORIGINS: '' });
  try {
    const ws = await connect(s.port, { origin: 'https://anywhere.example' });
    assert.ok(!ws.closed);
    await nextFrame(ws);
    ws.close();
  } finally {
    s.stop();
  }
});

test('an Origin allowlist is ignored when demo mode is off', async () => {
  // Setting ALLOWED_ORIGINS on a local install would otherwise lock the
  // developer's own browser out of their own server.
  const s = await startServer({
    DEMO_MODE: '0',
    ALLOWED_ORIGINS: 'https://example.com',
  });
  try {
    const ws = await connect(s.port, { origin: 'https://elsewhere.test' });
    assert.ok(!ws.closed);
    await nextFrame(ws);
    ws.close();
  } finally {
    s.stop();
  }
});

/* ---- idle reset ---- */

test('the room resets after the idle interval', async () => {
  const s = await startServer({ DEMO_MODE: '1', DEMO_IDLE_RESET_MS: '700' });
  try {
    const ws = await connect(s.port);
    await nextFrame(ws);

    ws.send(JSON.stringify({ type: 'setParam', key: 'exponent', value: 5 }));
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(
      (await summary(s.port)).params.exponent,
      5,
      'the command landed'
    );

    // Past the idle window, with no commands at all.
    await new Promise((r) => setTimeout(r, 1600));
    assert.strictEqual(
      (await summary(s.port)).params.exponent,
      2.7,
      'the room should be back at its defaults'
    );
    ws.close();
  } finally {
    s.stop();
  }
});

test('activity pushes the reset back', async () => {
  const s = await startServer({ DEMO_MODE: '1', DEMO_IDLE_RESET_MS: '900' });
  try {
    const ws = await connect(s.port);
    await nextFrame(ws);

    // Keep issuing commands for longer than one idle window, with the exponent
    // changed so a stray reset would be visible.
    ws.send(JSON.stringify({ type: 'setParam', key: 'exponent', value: 4.2 }));
    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      ws.send(JSON.stringify({ type: 'ping' }));
      await new Promise((r) => setTimeout(r, 200));
    }
    const during = (await summary(s.port)).params.exponent;
    assert.strictEqual(
      during,
      4.2,
      `the room reset to ${during} while someone was still using it`
    );
    ws.close();
  } finally {
    s.stop();
  }
});

test('resetScene puts every parameter and the room back', () => {
  const r = probe(
    `
    const { params, resetScene, simulation, receivers, obstacles } = require('${SERVER}');
    params.exponent = 4.4; params.frequency = 5000; params.noise = 19; params.paused = 1;
    obstacles.addWall({ x1: 1, y1: 1, x2: 5, y2: 5, attenuation: 9, thickness: 0.2 });
    resetScene();
    process.stdout.write(JSON.stringify({ params, walls: obstacles.getWalls().length,
      sources: simulation.getSources().length, receivers: receivers.getNodes().length }));
  `,
    { DEMO_MODE: '1' }
  );
  assert.strictEqual(r.params.exponent, 2.7);
  assert.strictEqual(r.params.frequency, 2437);
  assert.strictEqual(r.params.noise, 3);
  assert.strictEqual(r.params.paused, 0, 'a paused demo must resume');
  assert.strictEqual(r.walls, 0, 'walls must not survive a reset');
  assert.ok(
    r.sources > 0 && r.receivers > 0,
    'the room keeps its transmitters'
  );
});

test('a manual reset command also uses resetScene', () => {
  const r = probe(
    `
    const { params, handleCommand } = require('${SERVER}');
    params.exponent = 3.3;
    const err = handleCommand({ type: 'reset' });
    process.stdout.write(JSON.stringify({ err, exponent: params.exponent }));
  `,
    { DEMO_MODE: '1' }
  );
  assert.strictEqual(r.err, null);
  assert.strictEqual(r.exponent, 2.7);
});

/* ---- healthz ---- */

test('GET /healthz answers before the first frame exists', async () => {
  const s = await startServer({ DEMO_MODE: '1' });
  try {
    // Asked straight away, so it cannot be relying on a broadcast having landed.
    const r = await fetch(`http://127.0.0.1:${s.port}/healthz`);
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.demo, true);
    assert.strictEqual(body.room.width, 20);
    assert.strictEqual(body.room.height, 15);
    // A demo preloads the sample survey, so this is 42 rather than 0.
    assert.strictEqual(body.readings, 42);
    assert.strictEqual(typeof body.uptimeSeconds, 'number');
  } finally {
    s.stop();
  }
});

test('/healthz answers when demo mode is off too', async () => {
  const s = await startServer({ DEMO_MODE: '0' });
  try {
    const body = await (
      await fetch(`http://127.0.0.1:${s.port}/healthz`)
    ).json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.demo, false);
  } finally {
    s.stop();
  }
});

test('/healthz does not leak the model', async () => {
  const s = await startServer();
  try {
    const body = await (
      await fetch(`http://127.0.0.1:${s.port}/healthz`)
    ).json();
    // A health check is fetched by a platform and often logged publicly.
    assert.deepStrictEqual(Object.keys(body).sort(), [
      'demo',
      'readings',
      'room',
      'status',
      'uptimeSeconds',
    ]);
  } finally {
    s.stop();
  }
});
test('a reset puts moved receivers and dragged sources back', () => {
  const r = probe(
    `
    const { resetScene, simulation, receivers, params } = require('${SERVER}');
    const beforeR = receivers.getNodes().map(n => [n.x, n.y]);
    const beforeS = simulation.getSources().map(n => [n.x, n.y]);
    const movedR = receivers.move(receivers.getNodes()[0].id, 1.5, 2.5);
    const movedS = simulation.moveSource(simulation.getSources()[0].id, 3.5, 4.5);
    const wasMoved = [!!movedR, !!movedS];
    resetScene();
    const afterR = receivers.getNodes().map(n => [n.x, n.y]);
    const afterS = simulation.getSources().map(n => [n.x, n.y]);
    process.stdout.write(JSON.stringify({ wasMoved, beforeR, afterR, beforeS, afterS,
      same: JSON.stringify(beforeR) === JSON.stringify(afterR)
            && JSON.stringify(beforeS) === JSON.stringify(afterS) }));
  `,
    { DEMO_MODE: '1' }
  );

  assert.deepStrictEqual(
    r.wasMoved,
    [true, true],
    'the fixture could not move anything'
  );
  assert.strictEqual(
    r.same,
    true,
    `reset left the room moved: receivers ${JSON.stringify(r.beforeR)} -> ${JSON.stringify(r.afterR)}, sources ${JSON.stringify(r.beforeS)} -> ${JSON.stringify(r.afterS)}`
  );
});

test('a reset unpins a dragged transmitter', () => {
  const r = probe(
    `
    const { simulation, resetScene } = require('${SERVER}');
    const id = simulation.getSources()[0].id;
    simulation.moveSource(id, 3.5, 4.5);
    simulation.pinned.add(id);
    const pinnedDuring = simulation.pinned.has(id);
    resetScene();
    process.stdout.write(JSON.stringify({ pinnedDuring, pinnedAfter: simulation.pinned.has(id) }));
  `,
    { DEMO_MODE: '1' }
  );
  assert.strictEqual(
    r.pinnedDuring,
    true,
    'the fixture could not pin a source'
  );
  assert.strictEqual(
    r.pinnedAfter,
    false,
    'a dragged transmitter stayed pinned after a reset'
  );
});

/* ---- the preloaded sample survey ---- */

test('a demo boots with the 42-point sample survey already loaded', () => {
  const r = probe(
    `
    const { readings } = require('${SERVER}');
    process.stdout.write(JSON.stringify({ size: readings.size }));
  `,
    { DEMO_MODE: '1' }
  );
  // Counted from the file rather than hard-coded, so regenerating the sample
  // does not fail a test for no reason - but asserted to be 42 as well, because
  // "42" is the number the demo claims to ship.
  const sample =
    require('fs')
      .readFileSync(
        path.join(ROOT, 'docs/examples/sample-readings.csv'),
        'utf8'
      )
      .trim()
      .split('\n').length - 1;
  assert.strictEqual(
    r.size,
    sample,
    `store holds ${r.size}, file has ${sample} rows`
  );
  assert.strictEqual(
    r.size,
    42,
    'the shipped sample survey should be 42 points'
  );
});

test('outside demo mode nothing is preloaded', () => {
  const r = probe(
    `
    const { readings } = require('${SERVER}');
    process.stdout.write(JSON.stringify({ size: readings.size }));
  `,
    { DEMO_MODE: '0' }
  );
  assert.strictEqual(r.size, 0, 'a local install must start empty');
});

test('the idle reset restores the survey instead of emptying it', () => {
  const r = probe(
    `
    const { readings, resetScene } = require('${SERVER}');
    const atBoot = readings.size;
    readings.clear();                       // as a visitor's Clear button would
    const afterClear = readings.size;
    resetScene();
    const afterReset = readings.size;
    process.stdout.write(JSON.stringify({ atBoot, afterClear, afterReset,
      firstAfterReset: readings.all()[0] }));
  `,
    { DEMO_MODE: '1' }
  );
  assert.strictEqual(r.afterClear, 0, 'the fixture could not clear the store');
  assert.strictEqual(
    r.afterReset,
    r.atBoot,
    'the reset did not put the survey back'
  );
  assert.ok(r.firstAfterReset, 'the restored store is empty');
});

test('the reset outside demo mode still empties the store', () => {
  const r = probe(
    `
    const { readings, resetScene } = require('${SERVER}');
    readings.add([{ x: 1, y: 1, rssi: -50 }, { x: 2, y: 2, rssi: -55 }]);
    const before = readings.size;
    resetScene();
    process.stdout.write(JSON.stringify({ before, after: readings.size }));
  `,
    { DEMO_MODE: '0' }
  );
  assert.strictEqual(r.before, 2);
  assert.strictEqual(
    r.after,
    0,
    'a local reset should not leave readings behind'
  );
});

test('the restored survey is the same survey, not a truncated one', () => {
  // "42 again" is not enough: a restore that dropped the oldest few would still
  // report 42. Compare against the file, point for point. The comparison
  // happens out here because __dirname inside the probe is the cwd, not the
  // repository.
  const fromFile = require('fs')
    .readFileSync(path.join(ROOT, 'docs/examples/sample-readings.csv'), 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(',').map(Number));

  const r = probe(
    `
    const { readings, resetScene } = require('${SERVER}');
    readings.clear();
    resetScene();
    // Wrapped: probe() slices from the first '{', so a bare array would be
    // parsed from its first element and throw.
    process.stdout.write(JSON.stringify({ points: readings.all() }));
  `,
    { DEMO_MODE: '1' }
  );

  assert.strictEqual(r.points.length, 42);
  assert.deepStrictEqual(
    r.points.map((pt) => [pt.x, pt.y, pt.rssi]),
    fromFile,
    'the restored survey differs from the file on disk'
  );
});

test('a demo still refuses ingest after preloading', () => {
  // Preloading must not have opened the door it went through.
  const r = probe(
    `
    const { readings } = require('${SERVER}');
    const before = readings.size;
    const added = readings.add([{ x: 5, y: 5, rssi: -42 }]);
    process.stdout.write(JSON.stringify({ before, after: readings.size, added }));
  `,
    { DEMO_MODE: '1' }
  );
  // The store itself has no notion of demo mode - the route is the gate. What
  // matters is that the preload went through add() too, so the API is identical.
  assert.strictEqual(r.before, 42);
  assert.ok(
    r.after > r.before,
    'the store should still accept; the route is the gate'
  );
});

test('a survey larger than the store cap is truncated, not overflowing', () => {
  // The shipped sample is far below the cap, so this drives the store directly
  // with an oversized survey. It guards the preload path: replaceAll goes
  // through add(), and add() is where the eviction happens.
  const r = probe(
    `
    const { readings, LIMITS } = require('${SERVER}');
    const many = [];
    for (let i = 0; i < LIMITS.MAX_POINTS + 10; i++) {
      many.push({ x: 1, y: 1, rssi: -50 - (i % 10) });
    }
    readings.replaceAll(many);
    process.stdout.write(JSON.stringify({ size: readings.size, cap: LIMITS.MAX_POINTS }));
  `,
    { DEMO_MODE: '1' }
  );
  assert.strictEqual(
    r.size,
    r.cap,
    `store held ${r.size} against a ${r.cap} cap`
  );
});

test('replaceAll discards what was there first', () => {
  // The survey is 42 points; prepending more must leave 42, not 42 + the
  // extra. A replaceAll that appends would still pass the "reset restores the
  // survey" test, because the survey is still in there.
  const r = probe(
    `
    const { readings, resetScene } = require('${SERVER}');
    readings.add([{ x: 1, y: 1, rssi: -11 }, { x: 2, y: 2, rssi: -22 }]);
    const afterAdd = readings.size;
    resetScene();
    process.stdout.write(JSON.stringify({ afterAdd, afterReset: readings.size }));
  `,
    { DEMO_MODE: '1' }
  );
  assert.strictEqual(r.afterAdd, 44, 'the fixture could not add anything');
  assert.strictEqual(
    r.afterReset,
    42,
    'replaceAll appended instead of replacing'
  );
});

test('replaceAll rewinds the dropped counter', () => {
  // A dropped count that only ever grows reports history that did not happen:
  // after a reset there is nothing dropped, because nothing was ever evicted.
  const r = probe(
    `
    const { readings, resetScene, LIMITS } = require('${SERVER}');
    const many = [];
    for (let i = 0; i < LIMITS.MAX_POINTS + 25; i++) {
      many.push({ x: 1, y: 1, rssi: -50 - (i % 10) });
    }
    readings.replaceAll(many);
    const afterOverflow = readings.dropped;
    resetScene();
    process.stdout.write(JSON.stringify({ afterOverflow, afterReset: readings.dropped,
      size: readings.size }));
  `,
    { DEMO_MODE: '1' }
  );
  assert.ok(r.afterOverflow > 0, 'the fixture did not overflow the store');
  assert.strictEqual(r.size, 42, 'the reset should put the survey back');
  assert.strictEqual(
    r.afterReset,
    0,
    `the dropped counter survived a reset at ${r.afterReset}`
  );
});

test('a corrupt sample file fails the boot rather than starting empty', () => {
  // A demo that silently starts with no readings looks exactly like one that
  // worked: the Measured panel just says "none". So a bad file has to be loud.
  // Mutating the real CSV is the only way to reach that path - a fixture file
  // would test the fixture.
  const csvPath = path.join(ROOT, 'docs/examples/sample-readings.csv');
  const fsx = require('fs');
  const original = fsx.readFileSync(csvPath, 'utf8');

  const bootFails = () =>
    assert.throws(
      () =>
        probe('process.stdout.write(JSON.stringify({ ok: true }));', {
          DEMO_MODE: '1',
        }),
      /sample-readings\.csv/i,
      'a broken sample file should fail the boot'
    );

  // Mutate by position rather than by value: the sample file is regenerated from
  // the path-loss model, so no particular row is stable across regenerations.
  try {
    // 1. A non-numeric coordinate.
    const lines = original.trim().split('\n');
    lines[3] = lines[3].replace(/^([^,]+)/, 'not-a-number');
    fsx.writeFileSync(csvPath, `${lines.join('\n')}\n`);
    bootFails();

    // 2. A row outside the room.
    fsx.writeFileSync(csvPath, `${original}999,999,-50\n`);
    bootFails();

    // 3. A missing header, so it does not parse as the documented format.
    fsx.writeFileSync(csvPath, original.trim().split('\n').slice(1).join('\n'));
    bootFails();
  } finally {
    fsx.writeFileSync(csvPath, original);
  }

  // 4. Restored, the boot is clean again - otherwise case 1 would "pass" by
  //    leaving the file broken for everything after it.
  assert.strictEqual(
    probe(
      `
      const { readings } = require('${SERVER}');
      process.stdout.write(JSON.stringify({ size: readings.size }));
    `,
      { DEMO_MODE: '1' }
    ).size,
    42,
    'the file was not restored'
  );
});
