const { CONFIG } = require('./config/constants');

/**
 * Wall obstacles with a per-crossing attenuation in dB.
 *
 * A wall is a line segment with a thickness. For each (source, grid point)
 * pair the segment is tested for intersection; every intersection subtracts
 * that wall's attenuation from the RSSI. A signal crossing two 8 dB drywall
 * partitions loses 16 dB, which is roughly right for drywall at 2.4 GHz.
 */
class Obstacles {
  constructor(walls = []) {
    this.walls = walls;
  }

  /**
   * Total attenuation in dB for a straight TX -> receiver path.
   * @param {number} x1 transmitter x
   * @param {number} y1 transmitter y
   * @param {number} x2 receiver x
   * @param {number} y2 receiver y
   */
  attenuationBetween(x1, y1, x2, y2) {
    let total = 0;
    for (const wall of this.walls) {
      if (this.segmentsIntersect(x1, y1, x2, y2, wall)) {
        total += wall.attenuation;
      }
    }
    return total;
  }

  /**
   * Do segment (x1,y1)-(x2,y2) cross this wall?
   *
   * The wall is expanded by half its thickness into a rectangle and the path
   * is tested against all four edges. Testing the centre line alone would miss
   * every path that clips a wall's edge.
   */
  segmentsIntersect(x1, y1, x2, y2, wall) {
    const half = (wall.thickness || 0) / 2;
    const minX = wall.x1 - half;
    const maxX = wall.x2 + half;
    const minY = wall.y1 - half;
    const maxY = wall.y2 + half;

    const rectEdges = [
      [minX, minY, maxX, minY], // top
      [minX, maxY, maxX, maxY], // bottom
      [minX, minY, minX, maxY], // left
      [maxX, minY, maxX, maxY], // right
    ];

    return rectEdges.some(([ax, ay, bx, by]) =>
      segmentsCross(x1, y1, x2, y2, ax, ay, bx, by)
    );
  }

  addWall(wall) {
    const validated = Obstacles.validate(wall);
    this.walls.push(validated);
    return validated;
  }

  removeWall(index) {
    if (index < 0 || index >= this.walls.length) return null;
    return this.walls.splice(index, 1)[0];
  }

  clear() {
    this.walls = [];
  }

  getWalls() {
    return this.walls.map((w) => ({ ...w }));
  }

  /**
   * Normalise and bound a client-supplied wall. Anything non-numeric or
   * out of the room is rejected rather than silently clamped, so a bad
   * message cannot produce a nonsense heatmap.
   */
  static validate(wall) {
    const numbers = ['x1', 'y1', 'x2', 'y2', 'attenuation', 'thickness'];
    for (const key of numbers) {
      if (!Number.isFinite(wall[key])) {
        throw new RangeError(`wall.${key} must be a finite number`);
      }
    }

    const clamp = (v, max) => Math.min(Math.max(v, 0), max);
    return {
      x1: clamp(wall.x1, CONFIG.ROOM_WIDTH),
      y1: clamp(wall.y1, CONFIG.ROOM_HEIGHT),
      x2: clamp(wall.x2, CONFIG.ROOM_WIDTH),
      y2: clamp(wall.y2, CONFIG.ROOM_HEIGHT),
      // Negative attenuation would amplify a signal, which no wall does.
      attenuation: Math.max(0, wall.attenuation),
      thickness: Math.max(0, wall.thickness),
      material: typeof wall.material === 'string' ? wall.material : 'wall',
    };
  }
}

/**
 * Standard segment intersection test. Endpoints touching count as a
 * crossing, which is the behaviour we want: a path that grazes a wall
 * corner still loses signal.
 */
function segmentsCross(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (ax, ay, bx, by, cx, cy) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

  const d1 = d(x3, y3, x4, y4, x1, y1);
  const d2 = d(x3, y3, x4, y4, x2, y2);
  const d3 = d(x1, y1, x2, y2, x3, y3);
  const d4 = d(x1, y1, x2, y2, x4, y4);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  return false;
}

module.exports = Obstacles;
module.exports.segmentsCross = segmentsCross;
