/**
 * Measured readings: validation and a bounded store.
 *
 * The simulator invents its own RSSI, which is the point of it. Feeding it real
 * measurements is the other half of the tool: a survey walker posts what a
 * phone actually saw at known coordinates, and the map interpolates between
 * those points instead of drawing a model.
 *
 * Deliberately free of express and of the HTTP server so it can be tested
 * directly. Everything here is untrusted input.
 */
const { CONFIG } = require('./config/constants');

/**
 * Hard limits. These are not tuning knobs: they bound the work a single
 * request can ask the server to do, and a public deployment would otherwise
 * let anyone allocate an unbounded array or spend unbounded CPU.
 */
const LIMITS = {
  /** Readings per request. */
  MAX_ITEMS: 500,
  /** Request body, bytes. 100 KB is ~500 readings with generous JSON. */
  MAX_BODY_BYTES: 100 * 1024,
  /** Readings held at once. Past this the oldest are dropped. */
  MAX_POINTS: 5000,
};

/** Accepts `{x, y, rssi}`, or an array of them. Returns the array either way. */
function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return [payload];
  return null;
}

/**
 * Check one reading.
 * @returns {{ok: true, point: {x, y, rssi}} | {ok: false, reason: string}}
 */
function validateReading(raw, config) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'not an object' };
  }

  const values = {};
  for (const key of ['x', 'y', 'rssi']) {
    const v = raw[key];
    // Number.isFinite rejects NaN, Infinity, numeric strings and booleans. A
    // string like "12" is rejected rather than coerced: a survey CSV with a
    // stray column should be told, not silently half-understood.
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return {
        ok: false,
        reason: `${key} must be a finite number (got ${JSON.stringify(v)})`,
      };
    }
    values[key] = v;
  }

  // Closed interval: a reading on the boundary is inside the room. Measured
  // coordinates just outside mean the walker left the room or the room is
  // misconfigured, and either way the point cannot be placed.
  if (values.x < 0 || values.x > config.roomWidth) {
    return {
      ok: false,
      reason: `x must be between 0 and ${config.roomWidth} m (got ${values.x})`,
    };
  }
  if (values.y < 0 || values.y > config.roomHeight) {
    return {
      ok: false,
      reason: `y must be between 0 and ${config.roomHeight} m (got ${values.y})`,
    };
  }
  if (values.rssi < config.minRssi || values.rssi > config.maxRssi) {
    return {
      ok: false,
      reason: `rssi must be between ${config.minRssi} and ${config.maxRssi} dBm (got ${values.rssi})`,
    };
  }

  return {
    ok: true,
    point: {
      x: Math.round(values.x * 1000) / 1000,
      y: Math.round(values.y * 1000) / 1000,
      rssi: Math.round(values.rssi * 100) / 100,
    },
  };
}

/**
 * The room and range limits, taken from CONFIG.
 *
 * CONFIG is SCREAMING_CASE, so it is mapped here rather than handed straight to
 * validateReading. Passing CONFIG itself looks equivalent and silently accepts
 * everything: `x > undefined` is false, so an out-of-room coordinate sails
 * through the check that exists to stop it. Only an HTTP-level test caught it,
 * because the unit tests pass a hand-made config with the keys they expect.
 */
function configDefaults() {
  return {
    roomWidth: CONFIG.ROOM_WIDTH,
    roomHeight: CONFIG.ROOM_HEIGHT,
    minRssi: CONFIG.MIN_RSSI,
    maxRssi: CONFIG.MAX_RSSI,
  };
}

/**
 * Validate a whole payload.
 *
 * All-or-nothing on purpose: a 400-row survey with three typos should not
 * silently become a 397-row map that looks complete. The message names the
 * index and the field so the sender can fix the row without guessing.
 *
 * @returns {{ok: true, points: Array} | {ok: false, error: string}}
 */
function validatePayload(payload, config = configDefaults()) {
  const items = asArray(payload);
  if (items === null) {
    return {
      ok: false,
      error: 'expected an object {x, y, rssi} or an array of them',
    };
  }
  if (items.length === 0) {
    return { ok: false, error: 'no readings supplied' };
  }
  if (items.length > LIMITS.MAX_ITEMS) {
    return {
      ok: false,
      error: `too many readings: ${items.length}, the limit is ${LIMITS.MAX_ITEMS}`,
    };
  }

  const points = [];
  for (let i = 0; i < items.length; i++) {
    const result = validateReading(items[i], config);
    if (!result.ok) {
      return { ok: false, error: `reading ${i}: ${result.reason}` };
    }
    points.push(result.point);
  }

  return { ok: true, points };
}

/**
 * Parse a survey CSV with the `x,y,rssi` header.
 *
 * Hand-rolled rather than pulled from a dependency: the format is three columns
 * and one header line. What matters is that a malformed row is reported with
 * its line number instead of becoming a NaN that propagates into the map.
 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();

  if (!lines.length) return { ok: false, error: 'the file is empty' };

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  if (
    header.length < 3 ||
    header[0] !== 'x' ||
    header[1] !== 'y' ||
    header[2] !== 'rssi'
  ) {
    return {
      ok: false,
      error: `header must be x,y,rssi (got "${lines[0].trim()}")`,
    };
  }

  const points = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = line.split(',');
    if (cells.length < 3) {
      return {
        ok: false,
        error: `line ${i + 1}: expected three columns (got "${line}")`,
      };
    }
    const numbers = cells.slice(0, 3).map((c) => {
      // Number('') is 0, which would silently place a reading at the origin.
      // An empty cell is a typo, not a zero.
      if (c.trim() === '') return NaN;
      return Number(c);
    });
    points.push({ x: numbers[0], y: numbers[1], rssi: numbers[2] });
  }

  if (!points.length)
    return { ok: false, error: 'the file has a header but no rows' };
  return { ok: true, points };
}

/**
 * Bounded store of readings.
 *
 * An array rather than a ring buffer on purpose: the cap is small and the
 * common read is "everything", so a ring would only add index arithmetic. The
 * drop is a single splice of the excess, so the store never shrinks cell by
 * cell as it fills.
 */
class ReadingsStore {
  constructor(maxPoints = LIMITS.MAX_POINTS) {
    this.maxPoints = maxPoints;
    this.points = [];
    /** Monotonic id of the next accepted reading, so a client can tell a
     *  duplicate submission from a new one without comparing coordinates. */
    this.accepted = 0;
    this.dropped = 0;
  }

  /**
   * Append readings, dropping the oldest past the cap.
   * @returns {{stored: number, evicted: number, total: number, droppedTotal: number}}
   */
  add(points) {
    // Push first, then evict. The other order looks equivalent and is not:
    // evicting before pushing splices against the pre-push length, so a batch
    // that overshoots the cap only removes the points that were already there
    // and the store ends up over its maximum. Adding 50 to a cap of 10 left 50.
    for (const p of points) this.points.push(p);
    const evicted = Math.max(0, this.points.length - this.maxPoints);
    if (evicted > 0) this.points.splice(0, evicted);
    this.accepted += points.length;
    this.dropped += evicted;
    return {
      stored: points.length,
      evicted,
      total: this.points.length,
      droppedTotal: this.dropped,
    };
  }

  all() {
    return this.points;
  }

  get size() {
    return this.points.length;
  }

  clear() {
    const n = this.points.length;
    this.points = [];
    return n;
  }

  /**
   * Discard everything and put this exact set back.
   *
   * Distinct from clear() because a demo needs to undo whatever a visitor did
   * and be back to the survey it started from. Resets the counters too: the
   * dropped count would otherwise keep growing across resets with nothing to
   * show for it.
   *
   * @returns {{stored: number, evicted: number, total: number, droppedTotal: number}}
   */
  replaceAll(points) {
    this.points = [];
    this.dropped = 0;
    // The accepted counter is monotonic for the life of a client, so it is not
    // rewound here; it feeds the interpolation cache key, and a cache miss on a
    // restore is cheaper than a stale layer.
    return this.add(points);
  }
}

module.exports = {
  LIMITS,
  ReadingsStore,
  asArray,
  configDefaults,
  parseCsv,
  validatePayload,
  validateReading,
};
