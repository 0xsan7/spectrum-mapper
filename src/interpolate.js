/**
 * Interpolate measured readings onto the room grid.
 *
 * Inverse-distance weighting, and the part that matters as much as the maths:
 * refusing to invent a value where nobody measured anything. A heatmap drawn
 * with the gaps filled in is a lie that looks like data, so a cell with no
 * sample within range is reported as having no data and the renderer leaves it
 * bare.
 */
const { CONFIG } = require('./config/constants');

const IDW = {
  /** Weight falls off as 1/d^2, the usual default for RF survey interpolation. */
  POWER: 2,
  /** How many neighbours vote. Eight is enough to smooth a walk without
   *  dragging a corner across the room. */
  NEAREST: 8,
  /** Metres. Beyond this from every sample, a cell is unknown. */
  MAX_DISTANCE: 3,
};

/**
 * Distance at or below which two points are treated as the same place.
 *
 * Not arbitrary: a grid cell is 1 m, so a sample can sit anywhere inside its
 * cell and a cell centre can be a hair off a sample's coordinates. Anything
 * above zero would make IDW return Infinity for the nearest sample.
 */
const COINCIDENT = 1e-9;

/**
 * Interpolate one point.
 *
 * @returns {{rssi: number|null, hasData: boolean, neighbours: number,
 *   nearestMetres: number}}
 */
function interpolateAt(readings, x, y, options = {}) {
  const power = options.power ?? IDW.POWER;
  const nearest = options.nearest ?? IDW.NEAREST;
  const maxDistance = options.maxDistance ?? IDW.MAX_DISTANCE;

  if (!readings || readings.length === 0) {
    return {
      rssi: null,
      hasData: false,
      neighbours: 0,
      nearestMetres: Infinity,
    };
  }

  // Sort a copy by distance and keep the nearest few. Copying matters: the
  // caller's array is the live store and must not be reordered underneath it.
  const ranked = readings
    .map((p) => ({ p, d: Math.hypot(x - p.x, y - p.y) }))
    .sort((a, b) => a.d - b.d);

  const closest = ranked[0];
  if (closest.d > maxDistance) {
    return {
      rssi: null,
      hasData: false,
      neighbours: 0,
      nearestMetres: closest.d,
    };
  }

  // A sample sitting on this exact point wins outright. Summing 1/0^2 would be
  // Infinity, and the weighted average would collapse to the nearest sample
  // anyway - but only by accident of floating point, so it is stated.
  if (closest.d <= COINCIDENT) {
    return {
      rssi: closest.p.rssi,
      hasData: true,
      neighbours: 1,
      nearestMetres: closest.d,
    };
  }

  const voters = ranked.slice(0, nearest);
  let num = 0;
  let den = 0;
  for (const { p, d } of voters) {
    const w = 1 / Math.pow(d, power);
    num += w * p.rssi;
    den += w;
  }

  return {
    rssi: den > 0 ? num / den : null,
    hasData: true,
    neighbours: voters.length,
    nearestMetres: closest.d,
  };
}

/**
 * The measured grid over the whole room.
 *
 * Cells are keyed like the model's grid so the renderer can treat the two the
 * same way, and `hasData` travels with each cell so a blank region is
 * distinguishable from a genuinely quiet one.
 */
function generateGrid(readings, options = {}) {
  const resolution = options.resolution ?? CONFIG.GRID_RESOLUTION;
  const grid = [];
  for (let x = 0; x < CONFIG.ROOM_WIDTH; x += resolution) {
    for (let y = 0; y < CONFIG.ROOM_HEIGHT; y += resolution) {
      const result = interpolateAt(readings, x, y, options);
      grid.push({
        x: parseFloat(x.toFixed(1)),
        y: parseFloat(y.toFixed(1)),
        rssi: result.rssi === null ? null : parseFloat(result.rssi.toFixed(1)),
        hasData: result.hasData,
        nearestMetres: parseFloat(result.nearestMetres.toFixed(2)),
      });
    }
  }
  return grid;
}

/**
 * Root-mean-square error between the model and the measurements, in dB.
 *
 * Only over samples that are actually inside the room bounds the model grid
 * covers. Returns null rather than zero when there is nothing to compare, so a
 * caller cannot mistake "no data" for "a perfect match".
 */
function modelRmseDb(readings, modelRssiAt) {
  if (!readings || readings.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const p of readings) {
    const modelled = modelRssiAt(p.x, p.y);
    if (!Number.isFinite(modelled)) continue;
    const d = modelled - p.rssi;
    sum += d * d;
    n++;
  }
  if (n === 0) return null;
  return parseFloat(Math.sqrt(sum / n).toFixed(2));
}

module.exports = { IDW, interpolateAt, generateGrid, modelRmseDb };
