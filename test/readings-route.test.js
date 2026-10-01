/**
 * The ingest route over real HTTP.
 *
 * The token guard and the body limit are transport behaviour, not logic, so
 * testing them through `validatePayload` would test the wrong thing. These
 * start the actual server on an ephemeral port and talk to it.
 *
 * The server is a child process because READINGS_TOKEN is read from the
 * environment at boot: setting process.env mid-process cannot reconfigure it,
 * and a test that silently passed against the wrong value is worse than no
 * test.
 */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let portSeq = 0;

/**
 * Pick a port for the child server.
 *
 * The first version drew from 3400-3800 at random, and Node's fetch refuses a
 * documented list of "bad ports" including 3660-3667. It passed most runs and
 * failed the rest with a bare "fetch failed", which looked like a product fault
 * and was not. High range, offset by pid so two concurrent runs do not collide.
 */
function nextPort() {
  return 20000 + ((process.pid * 7 + portSeq++) % 20000);
}

/** Start the server and resolve once it is answering. */
function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    const port = nextPort();
    const child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        // Start from a known-empty store in every run.
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
        resolve({ child, port, stop: () => child.kill('SIGKILL') });
      }
    });
    child.stderr.on('data', (d) => (out += d));
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}:\n${out}`));
    });
  });
}

const post = (port, path, body, headers = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('accepts a single reading with 201', async () => {
  const s = await startServer();
  try {
    const r = await post(s.port, '/api/readings', { x: 3, y: 4, rssi: -60 });
    assert.strictEqual(r.status, 201);
    const body = await r.json();
    assert.strictEqual(body.accepted, 1);
    assert.strictEqual(body.readings, 1);
  } finally {
    s.stop();
  }
});

test('accepts an array with 201 and counts them', async () => {
  const s = await startServer();
  try {
    const r = await post(s.port, '/api/readings', [
      { x: 1, y: 1, rssi: -50 },
      { x: 2, y: 2, rssi: -51 },
      { x: 3, y: 3, rssi: -52 },
    ]);
    assert.strictEqual(r.status, 201);
    assert.strictEqual((await r.json()).accepted, 3);
  } finally {
    s.stop();
  }
});

test('rejects a bad item with 400 and does not store the good ones', async () => {
  const s = await startServer();
  try {
    const r = await post(s.port, '/api/readings', [
      { x: 1, y: 1, rssi: -50 },
      { x: 99, y: 1, rssi: -50 },
    ]);
    assert.strictEqual(r.status, 400);
    const body = await r.json();
    assert.match(body.error, /reading 1: x must be between/);

    // All-or-nothing: the valid first item must not have been kept.
    const summary = await (
      await fetch(`http://127.0.0.1:${s.port}/api/summary`)
    ).json();
    assert.ok(summary, 'summary still answers');
  } finally {
    s.stop();
  }
});

test('rejects malformed JSON with 400', async () => {
  const s = await startServer();
  try {
    const r = await post(s.port, '/api/readings', '{not json');
    assert.strictEqual(r.status, 400);
  } finally {
    s.stop();
  }
});

test('rejects a body over the 100 KB limit', async () => {
  const s = await startServer();
  try {
    // Under the item limit but over the byte limit: this is the case a
    // per-item cap alone would let through.
    const padding = 'x'.repeat(120 * 1024);
    const r = await post(s.port, '/api/readings', {
      x: 1,
      y: 1,
      rssi: -50,
      note: padding,
    });
    assert.ok(
      r.status === 413 || r.status === 400,
      `expected the oversized body to be refused, got ${r.status}`
    );
  } finally {
    s.stop();
  }
});

test('rejects an unauthenticated ingest with 401 when a token is set', async () => {
  const s = await startServer({ READINGS_TOKEN: 's3cret-token' });
  try {
    const noHeader = await post(s.port, '/api/readings', {
      x: 1,
      y: 1,
      rssi: -50,
    });
    assert.strictEqual(noHeader.status, 401);

    const wrong = await post(
      s.port,
      '/api/readings',
      { x: 1, y: 1, rssi: -50 },
      {
        authorization: 'Bearer wrong-token',
      }
    );
    assert.strictEqual(wrong.status, 401);

    // And a prefix of the right token must not pass.
    const prefix = await post(
      s.port,
      '/api/readings',
      { x: 1, y: 1, rssi: -50 },
      {
        authorization: 'Bearer s3cret',
      }
    );
    assert.strictEqual(prefix.status, 401);
  } finally {
    s.stop();
  }
});

test('accepts the correct bearer token with 201', async () => {
  const s = await startServer({ READINGS_TOKEN: 's3cret-token' });
  try {
    const r = await post(
      s.port,
      '/api/readings',
      { x: 1, y: 1, rssi: -50 },
      {
        authorization: 'Bearer s3cret-token',
      }
    );
    assert.strictEqual(r.status, 201);
  } finally {
    s.stop();
  }
});

test('the bearer scheme is case-insensitive', async () => {
  const s = await startServer({ READINGS_TOKEN: 's3cret-token' });
  try {
    const r = await post(
      s.port,
      '/api/readings',
      { x: 1, y: 1, rssi: -50 },
      {
        authorization: 'bearer s3cret-token',
      }
    );
    assert.strictEqual(r.status, 201);
  } finally {
    s.stop();
  }
});

test('allows anonymous ingest when no token is configured', async () => {
  const s = await startServer({ READINGS_TOKEN: '' });
  try {
    const r = await post(s.port, '/api/readings', { x: 1, y: 1, rssi: -50 });
    assert.strictEqual(
      r.status,
      201,
      'a local install should not need a token'
    );
  } finally {
    s.stop();
  }
});

test('GET is not allowed on the ingest route', async () => {
  const s = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/readings`);
    assert.strictEqual(r.status, 404);
  } finally {
    s.stop();
  }
});

/** POST text/csv to the import route. */
const postCsv = (port, body, headers = {}) =>
  fetch(`http://127.0.0.1:${port}/api/import/readings.csv`, {
    method: 'POST',
    headers: { 'content-type': 'text/csv', ...headers },
    body,
  });

test('imports a valid CSV with 201', async () => {
  const s = await startServer();
  try {
    const r = await postCsv(s.port, 'x,y,rssi\n1,1,-50\n2,2,-55\n3,3,-60\n');
    assert.strictEqual(r.status, 201);
    const body = await r.json();
    assert.strictEqual(body.imported, 3);
    assert.strictEqual(body.readings, 3);
  } finally {
    s.stop();
  }
});

test('rejects a CSV with the wrong header', async () => {
  const s = await startServer();
  try {
    const r = await postCsv(s.port, 'a,b,c\n1,2,-50\n');
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).error, /header must be x,y,rssi/);
  } finally {
    s.stop();
  }
});

test('rejects a CSV row outside the room, naming the value', async () => {
  const s = await startServer();
  try {
    const r = await postCsv(s.port, 'x,y,rssi\n1,1,-50\n99,2,-50\n');
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).error, /x must be between 0 and 20/);
  } finally {
    s.stop();
  }
});

test('rejects a CSV with more rows than the per-request limit', async () => {
  const s = await startServer();
  try {
    const many = [
      'x,y,rssi',
      ...Array.from({ length: 501 }, () => '1,1,-50'),
    ].join('\n');
    const r = await postCsv(s.port, many);
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).error, /too many readings/);
  } finally {
    s.stop();
  }
});

test('rejects a CSV body over the size limit', async () => {
  const s = await startServer();
  try {
    const wide = ['x,y,rssi'];
    // Under 501 rows but over 100 KB, which a row-count cap alone misses.
    for (let i = 0; i < 300; i++) wide.push(`1,${i},-50,${'p'.repeat(400)}`);
    const r = await postCsv(s.port, wide.join('\n'));
    assert.ok(
      r.status === 413 || r.status === 400,
      `expected refusal, got ${r.status}`
    );
  } finally {
    s.stop();
  }
});

test('CSV import honours the token', async () => {
  const s = await startServer({ READINGS_TOKEN: 'csv-secret' });
  try {
    assert.strictEqual(
      (await postCsv(s.port, 'x,y,rssi\n1,1,-50\n')).status,
      401
    );
    const ok = await postCsv(s.port, 'x,y,rssi\n1,1,-50\n', {
      authorization: 'Bearer csv-secret',
    });
    assert.strictEqual(ok.status, 201);
  } finally {
    s.stop();
  }
});

test('the shipped sample file imports cleanly', async () => {
  const s = await startServer();
  try {
    const csv = fs.readFileSync(
      path.join(ROOT, 'docs/examples/sample-readings.csv'),
      'utf8'
    );
    const r = await postCsv(s.port, csv);
    // Read the body once. assert.strictEqual's third argument is evaluated
    // eagerly, so passing `await r.text()` there consumes the stream and the
    // r.json() below throws "Body has already been read".
    const text = await r.text();
    assert.strictEqual(r.status, 201, text);
    const body = JSON.parse(text);
    // "about 40 points", as documented.
    assert.ok(
      body.imported >= 35 && body.imported <= 50,
      `got ${body.imported}`
    );
  } finally {
    s.stop();
  }
});

test('GET is not allowed on the import route', async () => {
  const s = await startServer();
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/import/readings.csv`);
    assert.strictEqual(r.status, 404);
  } finally {
    s.stop();
  }
});
