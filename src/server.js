const express = require('express');
const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const RFSimulation = require('./simulation');
const Receivers = require('./receivers');
const HeatmapGenerator = require('./heatmap');
const Obstacles = require('./obstacles');
const Trilateration = require('./trilateration');
const PathLossModel = require('./pathLoss');
const History = require('./history');
const CSV = require('./csv');
const Readings = require('./readings');
const Interpolate = require('./interpolate');
const { CONFIG } = require('./config/constants');

const app = express();
const server = http.createServer(app);
/**
 * noServer, so this module owns the upgrade.
 *
 * WebSocket.Server({ server }) installs its own 'upgrade' listener in its
 * constructor. Adding another listener does not replace it: both run, ws calls
 * handleUpgrade regardless, and the handshake completes with 101 even after this
 * code destroys the socket. A refused Origin has to be caught before ws sees the
 * request at all, which is what noServer is for.
 */
const wss = new WebSocket.Server({ noServer: true });

// Resolve against this file so `npm start` works from any working directory.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

const simulation = new RFSimulation();
const receivers = new Receivers();
const obstacles = new Obstacles();
// At 2 Hz, 240 samples is the last two minutes: enough to see a pattern, small
// enough that the buffer is a fixed-size cost. Overridable mainly so the
// rollover behaviour can be exercised without waiting two minutes.
const HISTORY_CAPACITY = Number(CONFIG.HISTORY_CAPACITY) || 240;
const history = new History(HISTORY_CAPACITY);

/** Measured readings, bounded. See src/readings.js. */
const readings = new Readings.ReadingsStore();

/**
 * Sequence number of the last history sample sent to clients. A sequence
 * rather than a count: the buffer evicts, so a count-based cursor stops
 * advancing once the buffer is full and every delta comes back empty.
 */
let sentHistorySeq = -1;

/**
 * Trail points drawn per source on a live frame. The full 240-sample buffer
 * per source per frame was the same redundancy as the history; a trail older
 * than ~30s is not readable anyway.
 */
const TRAIL_POINTS = 60;

/**
 * Live model parameters, adjustable from the UI. The bounds matter: this is
 * untrusted input arriving over a socket, and a 10000 exponent or a negative
 * attenuation would produce a garbage heatmap for every connected client.
 */
const params = {
  exponent: 2.7,
  frequency: 2437,
  noise: 3, // +/- dB of fading
  paused: 0, // 0 = running, 1 = frozen
};

/**
 * Acceptable values per parameter. `paused` is a boolean sent as 0/1, so it
 * pins to those two values instead of a numeric range.
 *
 * Every key here is also the complete set of writable keys: handleCommand
 * refuses anything not listed, so a client cannot invent a new parameter.
 */
const LIMITS = {
  exponent: { min: 1, max: 5, step: 0.1 },
  frequency: { min: 100, max: 6000, step: 1 },
  noise: { min: 0, max: 20, step: 0.5 },
  paused: { min: 0, max: 1, step: 1 },
};

/**
 * Measured grid, recomputed only when the store actually changes.
 *
 * updateSimulation runs twice a second and the grid is 300 cells over 8
 * neighbours each, so rebuilding it on every tick would be pure waste - and it
 * is stable data. Keyed on the store's accepted counter, which only advances
 * when something was stored.
 */
let measuredCache = { key: -1, value: null };

function measuredData() {
  if (readings.size === 0) {
    measuredCache = { key: '', value: null };
    return null;
  }
  const modelKey = `${readings.accepted}|${params.exponent}|${params.frequency}|${params.noise}`;
  if (measuredCache.key !== modelKey) {
    const points = readings.all();
    // How far the model is from what was actually measured, at the sample
    // points. This is the number that says whether the simulator is any use for
    // the room it claims to model - and it is only meaningful against the model
    // that is currently configured, so it moves when the sliders move.
    const rmseDb = Interpolate.modelRmseDb(points, (x, y) =>
      PathLossModel.calculateGridRSSI(x, y, simulation.getSourceData(), {
        ...currentPathLossOptions(),
        obstacles,
      })
    );
    measuredCache = {
      key: modelKey,
      value: {
        grid: Interpolate.generateGrid(points),
        points,
        count: readings.size,
        maxDistance: Interpolate.IDW.MAX_DISTANCE,
        dropped: readings.dropped,
        rmseDb,
      },
    };
  }
  return measuredCache.value;
}

let simulationData = null;
// Set by start(). Kept module-level so shutdown() can clear it. It is
// deliberately not created at import time: a live interval would keep the
// event loop (and any test process that requires this file) alive forever.
let simulationInterval = null;

function clampToLimits(key, value) {
  const limit = LIMITS[key];
  if (!limit || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, limit.min), limit.max);
}

function currentPathLossOptions() {
  return {
    exponent: params.exponent,
    frequency: params.frequency,
    fading: params.noise,
  };
}

/**
 * The transmitter we try to localise: the mobile device, because it is the one
 * that moves and the only one where a position estimate means anything.
 */
const TRACKED_SOURCE_ID = 'TX-3';

/**
 * Smoothed error for the tracked source. A single frame's error jitters with
 * the fading draw, which makes the number unreadable; the EMA is what a survey
 * tool would actually report. `instantErrorMetres` carries the raw value.
 */
const errorEma = { value: null, alpha: 0.15 };

/**
 * Estimate the tracked transmitter's position from the RSSI each receiver
 * measures, and report the error against where it actually is.
 *
 * The measurements are taken from the same path loss model that drew the
 * heatmap, so the estimate is a genuine inverse of the forward model rather
 * than a separate calculation. Wall attenuation is added back per receiver
 * before inverting, so a wall between a receiver and the target does not bias
 * the range that receiver contributes.
 */
function locateTrackedSource() {
  const target = simulation.sources.find((s) => s.id === TRACKED_SOURCE_ID);
  const receiverNodes = receivers.getNodes();
  if (!target || receiverNodes.length < 2) return null;

  const pathLoss = currentPathLossOptions();
  const rangeOptions = {
    txPower: target.txPower,
    exponent: pathLoss.exponent,
    frequency: pathLoss.frequency,
  };

  // Measure, then invert each receiver's own reading. The wall loss differs
  // per receiver, so it has to be corrected individually - a single global
  // correction would bias whichever receivers sit behind the wall.
  //
  // Fading is left ON here, unlike the heatmap's own per-cell draw. With
  // fading disabled the estimate is an exact algebraic inverse and the error
  // is identically zero, which makes the "error in metres" figure a fiction.
  // With it on, the reported error is the real spread a receiver network
  // would see.
  const readings = receiverNodes.map((receiver) => {
    const distance = Math.hypot(receiver.x - target.x, receiver.y - target.y);
    const rssi = PathLossModel.calculateRSSI(target.txPower, distance, {
      ...pathLoss,
    });
    const wallLoss = obstacles.attenuationBetween(
      target.x,
      target.y,
      receiver.x,
      receiver.y
    );
    const range = Trilateration.rssiToDistance(rssi, {
      ...rangeOptions,
      attenuation: wallLoss,
    });

    return {
      id: receiver.id,
      rssi: Number(rssi.toFixed(1)),
      wallLoss,
      range: Number.isFinite(range) ? Number(range.toFixed(2)) : null,
      _range: range,
    };
  });

  const solution = Trilateration.leastSquares(
    receiverNodes,
    readings.map((r) => r._range)
  );
  if (!solution) return null;

  const truth = { x: target.x, y: target.y };

  // The target is known to be inside the room, so an estimate outside it is
  // definitely wrong. Clamp rather than draw a position off the map, and
  // report the post-clamp error so the number matches what is displayed.
  const estimateX = Math.min(Math.max(solution.x, 0), CONFIG.ROOM_WIDTH);
  const estimateY = Math.min(Math.max(solution.y, 0), CONFIG.ROOM_HEIGHT);
  const estimate = { x: estimateX, y: estimateY };
  const wasClamped = estimateX !== solution.x || estimateY !== solution.y;

  const instantError = Trilateration.positionError(estimate, truth);
  errorEma.value =
    errorEma.value === null
      ? instantError
      : errorEma.alpha * instantError + (1 - errorEma.alpha) * errorEma.value;

  return {
    id: TRACKED_SOURCE_ID,
    name: target.name,
    truth,
    estimate: {
      x: estimate.x,
      y: estimate.y,
      rawX: solution.x,
      rawY: solution.y,
      wasClamped,
      alternative: solution.alternative,
      ambiguous: solution.ambiguous,
      method: solution.method,
      used: solution.used,
    },
    // Raw error for this frame, and the smoothed value the UI shows. Computable
    // only here, because the server knows the truth the browser never sees.
    errorMetres: Number(instantError.toFixed(2)),
    smoothedErrorMetres: Number(errorEma.value.toFixed(2)),
    residualMetres: Number(solution.errorMetres.toFixed(2)),
    readings: readings.map(({ _range, ...rest }) => rest),
  };
}

function updateSimulation(full = false) {
  if (!params.paused) simulation.updatePositions();

  const rfSources = simulation.getSourceData();
  const heatmap = HeatmapGenerator.generate(rfSources, {
    ...currentPathLossOptions(),
    obstacles,
  });
  const receiverNodes = receivers.getNodes();
  const stats = HeatmapGenerator.calculateStats(heatmap);

  simulationData = {
    timestamp: new Date().toISOString(),
    heatmap,
    sources: simulation.getSources(),
    receivers: receiverNodes,
    walls: obstacles.getWalls(),
    stats,
    tracking: locateTrackedSource(),
    params: { ...params },
    limits: LIMITS,
    bounds: { min: CONFIG.MIN_RSSI, max: CONFIG.MAX_RSSI },
    roomWidth: CONFIG.ROOM_WIDTH,
    roomHeight: CONFIG.ROOM_HEIGHT,
    // The UI shows a banner from this. Sent on every frame so a browser that
    // reconnects to a demo gets it without a second round trip.
    demo: CONFIG.DEMO_MODE,
    // null until something has been ingested. The browser checks for null
    // rather than for an empty array: "no measurements yet" and "measurements
    // that cover none of this room" are different states.
    measured: measuredData(),
  };

  history.push(simulationData);

  // Send only what is new, not the whole buffer. Re-sending the full history
  // and trails twice a second made them 85% of the frame - 103 KB/s to carry
  // ~11 KB/s of new data. A newly connected client gets one full snapshot
  // instead, so a late joiner still has a populated chart.
  const total = history.samples.length;
  if (full) {
    simulationData.history = history.series();
    simulationData.trails = {};
    for (const source of simulationData.sources) {
      simulationData.trails[source.id] = history.trail(source.id);
    }
    sentHistorySeq = history.sequence - 1;
  } else {
    simulationData.historyDelta = history.since(sentHistorySeq);
    simulationData.trails = {};
    for (const source of simulationData.sources) {
      simulationData.trails[source.id] = history
        .trail(source.id)
        .slice(-TRAIL_POINTS);
    }
    sentHistorySeq = history.sequence - 1;
  }
  simulationData.historyLength = total;

  return simulationData;
}

/** Broadcast one frame to every connected client. */
function broadcast() {
  const data = updateSimulation();
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
  return data;
}

/* ---- public demo hardening ---- */

/**
 * Per-client command rate limiting.
 *
 * A Map keyed by client id rather than by socket object: it is inspectable, it
 * can be pruned, and it survives a reconnect without being a leak. Entries are
 * dropped once they fall back under the limit, so an idle demo does not grow
 * this forever.
 */
const rateBuckets = new Map();

/** True when `id` is allowed another command right now. */
function rateLimitOk(id, now = Date.now()) {
  if (!CONFIG.DEMO_MODE) return true;

  const bucket = rateBuckets.get(id);
  if (!bucket) {
    rateBuckets.set(id, { count: 1, windowStart: now });
    return true;
  }
  // A fixed window, reset once it elapses. Deliberately simple: at 20/s against
  // a single visitor dragging a slider this is not the interesting control,
  // and anything cleverer is harder to reason about than it is worth.
  if (now - bucket.windowStart >= 1000) {
    bucket.count = 1;
    bucket.windowStart = now;
    return true;
  }
  if (bucket.count >= CONFIG.DEMO_RATE_LIMIT) return false;
  bucket.count++;
  return true;
}

function forgetClientRate(id) {
  rateBuckets.delete(id);
}

/**
 * Origin check for the WebSocket upgrade.
 *
 * Browsers send Origin on a WebSocket handshake but nothing else stops a script
 * from connecting directly, so this is a control on drive-by pages rather than
 * an authentication mechanism. It matters because a public demo lets anyone who
 * reaches it move every transmitter - a hostile page could script that against
 * someone else's copy.
 */
function originAllowed(req) {
  if (!CONFIG.DEMO_MODE || CONFIG.ALLOWED_ORIGINS.length === 0) return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  return CONFIG.ALLOWED_ORIGINS.includes(origin);
}

/** When the last command arrived, and the reset timer that follows it. */
const demoIdle = { last: Date.now(), timer: null };

function noteDemoActivity() {
  demoIdle.last = Date.now();
  if (demoIdle.timer) {
    clearTimeout(demoIdle.timer);
    demoIdle.timer = null;
  }
  demoIdle.timer = setTimeout(() => {
    demoIdle.timer = null;
    resetScene();
  }, CONFIG.DEMO_IDLE_RESET_MS);
  // Do not hold the process open for an idle timer.
  if (demoIdle.timer.unref) demoIdle.timer.unref();
}

/** Put the room back the way it started. */
function resetScene() {
  simulation.reset();
  receivers.reset();
  obstacles.clear();
  params.exponent = 2.7;
  params.frequency = 2437;
  params.noise = 3;
  params.paused = 0;
}

/**
 * Handle a client command. Returns an error string, or null on success.
 * Every branch validates before mutating, because these messages come from
 * whatever the browser has open.
 */
function handleCommand(msg) {
  switch (msg.type) {
    case 'moveSource': {
      if (!simulation.moveSource(msg.id, msg.x, msg.y)) {
        return `unknown source: ${msg.id}`;
      }
      return null;
    }

    case 'releaseSource':
      simulation.releaseSource(msg.id);
      return null;

    case 'moveReceiver': {
      if (!receivers.move(msg.id, msg.x, msg.y)) {
        return `unknown receiver: ${msg.id}`;
      }
      return null;
    }

    case 'addWall': {
      try {
        obstacles.addWall(msg.wall);
      } catch (err) {
        return err.message;
      }
      return null;
    }

    case 'removeWall':
      obstacles.removeWall(msg.index);
      return null;

    case 'clearWalls':
      obstacles.clear();
      return null;

    case 'setParam': {
      // Check the key against a known list, never against `key in params`:
      // `__proto__ in params` is true, so the latter would happily let a
      // client write to Object.prototype.
      if (!Object.hasOwn(LIMITS, msg.key)) {
        return `param ${msg.key} rejected (unknown parameter)`;
      }
      const value = clampToLimits(msg.key, msg.value);
      if (value === null) {
        return `param ${msg.key} rejected (out of range or not a number)`;
      }
      params[msg.key] = value;
      return null;
    }

    case 'reset':
      resetScene();
      return null;

    case 'clearReadings':
      readings.clear();
      measuredCache = { key: '', value: null };
      return null;

    case 'clearHistory':
      history.clear();
      sentHistorySeq = -1;
      return null;

    case 'ping':
      return null;

    default:
      return `unknown message type: ${msg.type}`;
  }
}

/**
 * Upgrade guard, run *before* the handshake completes.
 *
 * Checking inside 'connection' looks equivalent and is not: the HTTP upgrade has
 * already returned 101 by then, so the client sees a successful socket open and
 * only then a close. A rejected origin should never get a completed handshake at
 * all. Destroying the socket here makes it an outright failed connection.
 *
 * Origin first, then the cap. Refusing over the cap means a demo that is full
 * does not also spend a socket on a visitor who will be disconnected anyway.
 */
// On the http server, not on wss. With noServer: true the WebSocketServer emits
// no 'upgrade' of its own, and a listener attached to wss simply never fires -
// the upgrade then falls through to express, which answers 200 and the client
// sees a successful-looking HTTP response with no socket in it.
server.on('upgrade', (req, socket, head) => {
  if (!originAllowed(req)) {
    socket.write(
      'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
    );
    socket.destroy();
    return;
  }

  if (CONFIG.DEMO_MODE && wss.clients.size >= CONFIG.DEMO_MAX_CLIENTS) {
    // 503 rather than 101-then-close: the platform's own health checks and any
    // client library see a refusal instead of a flapping connection.
    socket.write(
      'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 30\r\nContent-Length: 0\r\n\r\n'
    );
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  ws.clientId = `${req.socket.remoteAddress || 'unknown'}:${Date.now()}:${Math.random()}`;

  if (simulationData) {
    // `full: true` gives a new client the complete history and trails once, so
    // its chart and trails are populated immediately instead of filling in from
    // empty over the next two minutes.
    ws.send(JSON.stringify(updateSimulation(true)));
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
      return;
    }

    if (!msg || typeof msg.type !== 'string') {
      ws.send(JSON.stringify({ type: 'error', message: 'missing type' }));
      return;
    }

    // Only real commands count against the limit and the idle timer. A ping or
    // a malformed message should not be able to keep a room from ever resetting,
    // and should not cost a visitor their budget either.
    if (!rateLimitOk(ws.clientId)) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: `slow down: ${CONFIG.DEMO_RATE_LIMIT} commands per second`,
        })
      );
      return;
    }
    noteDemoActivity();

    const error = handleCommand(msg);
    if (error) {
      ws.send(JSON.stringify({ type: 'error', message: error }));
      return;
    }

    // Push the new state immediately so the UI feels responsive instead of
    // waiting out the rest of the update interval.
    const data = updateSimulation();
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  });

  ws.on('close', () => {
    if (ws.clientId) forgetClientRate(ws.clientId);
  });
});

/**
 * Export endpoints.
 *
 * Served from the server rather than assembled in the browser so the files are
 * reproducible from curl, scriptable, and testable in Node.
 */

/** A frame must exist before there is anything to export. */
function requireFrame(res) {
  if (!simulationData) {
    res.status(503).json({ error: 'no frame yet' });
    return null;
  }
  return simulationData;
}

app.get('/api/export/timeseries.csv', (req, res) => {
  const frame = requireFrame(res);
  if (!frame) return;
  res.type('text/csv');
  res.set(
    'Content-Disposition',
    'attachment; filename="spectrum-timeseries.csv"'
  );
  res.send(CSV.seriesToCsv(history.series()));
});

app.get('/api/export/heatmap.csv', (req, res) => {
  const frame = requireFrame(res);
  if (!frame) return;
  res.type('text/csv');
  res.set('Content-Disposition', 'attachment; filename="spectrum-heatmap.csv"');
  res.send(CSV.heatmapToCsv(frame));
});

app.get('/api/export/readings.csv', (req, res) => {
  const frame = requireFrame(res);
  if (!frame) return;
  res.type('text/csv');
  res.set(
    'Content-Disposition',
    'attachment; filename="spectrum-readings.csv"'
  );
  res.send(CSV.readingsToCsv(frame.tracking));
});

/**
 * The readings that came in, in the same format the import accepts, so a survey
 * can be taken back out and re-imported elsewhere. Deliberately not heatmap.csv:
 * that is the model's grid, and mixing the two would quietly relabel synthetic
 * values as measurements.
 */
app.get('/api/export/measured.csv', (req, res) => {
  res.type('text/csv');
  res.set(
    'Content-Disposition',
    'attachment; filename="spectrum-measured.csv"'
  );
  const rows = readings
    .all()
    .map((p) => `${p.x},${p.y},${p.rssi}`)
    .join('\n');
  // A header-only file rather than a 404: asking for the measurements when
  // there are none is a legitimate state, not a missing resource.
  res.send(rows ? `x,y,rssi\n${rows}\n` : 'x,y,rssi\n');
});

/** The full frame as JSON, for scripting or archiving a run. */
app.get('/api/export/frame.json', (req, res) => {
  const frame = requireFrame(res);
  if (!frame) return;
  res.set('Content-Disposition', 'attachment; filename="spectrum-frame.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    params: frame.params,
    room: { width: frame.roomWidth, height: frame.roomHeight },
    stats: frame.stats,
    sources: frame.sources,
    receivers: frame.receivers,
    walls: frame.walls,
    tracking: frame.tracking,
    heatmap: frame.heatmap,
    // The export is documented as the full frame, so the measured layer rides
    // along. Without it a scripted consumer of frame.json could see the model
    // grid and no way to tell it apart from real measurements.
    measured: frame.measured,
    demo: frame.demo,
    history: history.series(),
    summary: history.summary(),
  });
});

/* ---- ingest measured readings ---- */

/**
 * Reject an unauthenticated ingest attempt before the body is read, so a bad
 * token costs nothing.
 */
function readingsTokenGuard(req, res, next) {
  // Demo mode first, and with no token in the message: a public copy is not
  // collecting readings, and saying "unauthorised" would suggest a token would
  // help. 403 rather than 404 - the route exists, it is simply closed.
  if (CONFIG.DEMO_MODE) {
    res.status(403).json({ error: 'ingest is disabled in demo mode' });
    return;
  }
  if (readingsTokenOk(req)) {
    next();
    return;
  }
  res
    .status(401)
    .json({ error: 'a valid Authorization: Bearer token is required' });
}

/**
 * Shared-secret check for the ingest endpoints.
 *
 * Timing-safe because the token is compared byte for byte, and a plain
 * `===` leaks its length and first differing byte through response time.
 * Returns false when no token is configured, so a local install is open.
 */
function readingsTokenOk(req) {
  const expected = CONFIG.READINGS_TOKEN;
  if (!expected) return true;

  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return timingSafeEqual(match[1], expected);
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  // Hash first so the comparison is over equal-length buffers; without this a
  // length mismatch returns early and takes a different time.
  const ah = crypto.createHash('sha256').update(ab).digest();
  const bh = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}

/**
 * POST /api/readings - one reading or an array of them.
 *
 * Body size is capped before parsing. express.json() will happily buffer a
 * 500 MB body and then fail on the JSON parse, so the limit has to be a
 * transport-level one.
 */
app.post(
  '/api/readings',
  readingsTokenGuard,
  express.json({ limit: Readings.LIMITS.MAX_BODY_BYTES }),
  (req, res) => {
    const result = Readings.validatePayload(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const added = readings.add(result.points);
    res
      .status(201)
      .json({ accepted: added.stored, ...added, readings: readings.size });
  }
);

/**
 * POST /api/import/readings.csv - the same ingest from a survey file.
 *
 * Served as text/csv and read raw rather than through express.text(), so the
 * byte cap is the same 100 KB the JSON path uses and a mismatch in either
 * cannot slip through.
 */
app.post(
  '/api/import/readings.csv',
  readingsTokenGuard,
  express.text({ type: 'text/csv', limit: Readings.LIMITS.MAX_BODY_BYTES }),
  (req, res) => {
    const parsed = Readings.parseCsv(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    // Parsed, not validated: a CSV row that is short or non-numeric becomes a
    // point here, and validatePayload is what turns that into a message naming
    // the offending value. Validating twice would report line numbers for
    // something the parser already refused.
    const result = Readings.validatePayload(parsed.points);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const added = readings.add(result.points);
    res.status(201).json({
      imported: added.stored,
      ...added,
      readings: readings.size,
    });
  }
);

/**
 * Liveness for a platform health check.
 *
 * Deliberately not behind requireFrame: this has to answer before the first
 * broadcast, or a platform waiting on it concludes the container is broken.
 * It reports the room and whether readings exist, which is enough to tell a
 * working instance from a half-started one, and nothing that leaks the model.
 */
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    demo: CONFIG.DEMO_MODE,
    uptimeSeconds: Math.round(process.uptime()),
    room: { width: CONFIG.ROOM_WIDTH, height: CONFIG.ROOM_HEIGHT },
    readings: readings.size,
  });
});

app.get('/api/summary', (req, res) => {
  const frame = requireFrame(res);
  if (!frame) return;
  res.json({ summary: history.summary(), params: frame.params });
});

/** Start listening and begin the simulation loop. */
function start(port = CONFIG.PORT, host = CONFIG.HOST) {
  const listening = server.listen(port, host, () => {
    console.log(
      `Server running on http://localhost:${port} ` +
        `(room ${CONFIG.ROOM_WIDTH}x${CONFIG.ROOM_HEIGHT} m, ` +
        `update ${CONFIG.UPDATE_RATE}ms)`
    );
  });
  if (!simulationInterval)
    simulationInterval = setInterval(broadcast, CONFIG.UPDATE_RATE);
  return listening;
}

if (require.main === module) start();

function shutdown() {
  if (simulationInterval) clearInterval(simulationInterval);
  simulationInterval = null;
  wss.clients.forEach((client) => client.close());
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = {
  CONFIG,

  app,
  server,
  start,
  simulation,
  receivers,
  obstacles,
  history,
  readings,
  params,
  handleCommand,
  // Exported for the demo-mode tests: the rate limiter and the reset are the
  // things worth testing directly, and driving them through a real socket would
  // make those tests slow and timing-dependent.
  rateLimitOk,
  resetScene,
  forgetClientRate,
  rateBuckets,
  updateSimulation,
  locateTrackedSource,
  PathLossModel,
  Trilateration,
};
