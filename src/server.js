const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const RFSimulation = require('./simulation');
const Receivers = require('./receivers');
const HeatmapGenerator = require('./heatmap');
const Obstacles = require('./obstacles');
const Trilateration = require('./trilateration');
const PathLossModel = require('./pathLoss');
const { CONFIG } = require('./config/constants');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Resolve against this file so `npm start` works from any working directory.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

const simulation = new RFSimulation();
const receivers = new Receivers();
const obstacles = new Obstacles();

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

function updateSimulation() {
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
    roomWidth: CONFIG.ROOM_WIDTH,
    roomHeight: CONFIG.ROOM_HEIGHT,
  };
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
      simulation.pinned.clear();
      receivers.reset();
      obstacles.clear();
      params.exponent = 2.7;
      params.frequency = 2437;
      params.noise = 3;
      return null;

    case 'ping':
      return null;

    default:
      return `unknown message type: ${msg.type}`;
  }
}

wss.on('connection', (ws) => {
  if (simulationData) ws.send(JSON.stringify(simulationData));

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
  app,
  server,
  start,
  simulation,
  receivers,
  obstacles,
  params,
  handleCommand,
  updateSimulation,
  locateTrackedSource,
  PathLossModel,
  Trilateration,
};
