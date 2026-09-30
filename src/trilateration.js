const PathLossModel = require('./pathLoss');
const { CONFIG } = require('./config/constants');

/**
 * Trilateration: estimate a transmitter's position from the RSSI measured at
 * each receiver.
 *
 * The idea is the inverse of the path loss model. The forward model says
 *
 *   RSSI_i = txPower - PL(d_i) - (wall losses on the i-th path)
 *
 * so for a known txPower and exponent, each measurement implies a distance
 * d_i. Three or more of those circles intersect at a point, and that point is
 * the estimate.
 *
 * Rather than intersecting circles, this fits the linearised equations by
 * least squares. From
 *
 *   (x - x_i)^2 + (y - y_i)^2 = d_i^2
 *
 * subtracting the reference receiver's equation from every other one cancels
 * the quadratic terms and leaves
 *
 *   2(x_i - x_0) * x + 2(y_i - y_0) * y = d_i^2 - d_0^2 - (x_i^2 - x_0^2) - (y_i^2 - y_0^2)
 *
 * which is linear in x and y and has a closed-form solution. That degrades
 * gracefully: with two receivers it returns the midpoint of the two candidate
 * positions, and with one it reports the position as undetermined rather than
 * guessing.
 *
 * Circle intersection was rejected because with fading, walls, and rounded RSSI
 * the circles generally do not meet at a single point, and picking "the best
 * pair" is arbitrary.
 */
class Trilateration {
  /**
   * Convert an RSSI measurement to a distance estimate.
   *
   * @param {number} rssi measured dBm
   * @param {object} options
   *   txPower, exponent, frequency, referenceDistance, noiseFloor, and an
   *   `attenuation` in dB to add back for walls the signal crossed
   * @returns {number} metres, or NaN when the reading carries no range
   *   information (at or below the noise floor)
   */
  static rssiToDistance(rssi, options = {}) {
    const {
      txPower = 0,
      attenuation = 0,
      noiseFloor = CONFIG.MIN_RSSI,
      referenceDistance = 1,
      frequency = 2437,
      exponent = 2.7,
    } = options;

    // At or below the noise floor every distance is consistent with the
    // reading, so the answer is "no information", not zero.
    if (!Number.isFinite(rssi) || rssi <= noiseFloor) return NaN;

    // Add the wall loss back, so the exponent fit sees a clean-space path.
    const effective = rssi + attenuation;
    const referenceLoss = PathLossModel.referenceLoss(
      referenceDistance,
      frequency
    );
    const excessLoss = txPower - effective - referenceLoss;

    // Stronger than d0 allows (excessLoss <= 0) implies d < d0, which the log
    // distance model cannot represent. Clamp to the reference distance.
    if (excessLoss <= 0) return referenceDistance;

    return referenceDistance * Math.pow(10, excessLoss / (10 * exponent));
  }

  /**
   * Intersection of two range circles.
   *
   * With only two receivers the least-squares normal equations are rank-1 and
   * singular, but the geometry is still solvable: two circles meet in up to
   * two points, mirrored about the line joining the receivers. Both are
   * returned so the caller can see the ambiguity instead of being handed one
   * of them silently.
   *
   * @returns {?Array<{x:number, y:number}>} 0, 1 or 2 solutions
   */
  static circleIntersection(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) return [];

    // Circles that miss each other, or one inside the other, have no meeting
    // point. A measurement pair this inconsistent means bad ranges, not a
    // position.
    if (d > a.range + b.range) return [];
    if (d < Math.abs(a.range - b.range)) return [];

    // Distance along the baseline to the radical line, then the offset from it.
    const along = (a.range * a.range - b.range * b.range + d * d) / (2 * d);
    const heightSquared = a.range * a.range - along * along;
    if (heightSquared < 0) return [];
    const height = Math.sqrt(heightSquared);

    const baseX = a.x + (along * dx) / d;
    const baseY = a.y + (along * dy) / d;

    // Tangent circles have height 0, and the two candidates coincide. Return
    // one point rather than the same point twice, so `ambiguous` means what
    // it says.
    if (height < 1e-9) return [{ x: baseX, y: baseY }];

    return [
      { x: baseX + (height * dy) / d, y: baseY - (height * dx) / d },
      { x: baseX - (height * dy) / d, y: baseY + (height * dx) / d },
    ];
  }

  /**
   * Least-squares position from range measurements.
   *
   * @param {Array<{x:number, y:number}>} receivers known receiver positions
   * @param {number[]} ranges distance estimates, one per receiver
   * @returns {?{x:number, y:number, errorMetres:number, used:number,
   *   method:string, degenerate:boolean, ambiguous:boolean,
   *   alternative:?{x:number, y:number}}} null when it cannot be solved
   */
  static leastSquares(receivers, ranges) {
    const usable = receivers
      .map((r, i) => ({ ...r, range: ranges[i] }))
      .filter((r) => Number.isFinite(r.range) && r.range >= 0);

    if (usable.length < 2) return null;

    const reference = usable[0];
    const spread = usable.some(
      (r) => Math.hypot(r.x - reference.x, r.y - reference.y) > 1e-9
    );
    if (!spread) return null;

    // Two receivers: solve the geometry directly, and report the mirror image
    // as an alternative rather than pretending the answer is unique.
    if (usable.length === 2) {
      const solutions = Trilateration.circleIntersection(usable[0], usable[1]);
      if (solutions.length === 0) return null;

      // Tie-break toward the middle of the receiver pair. With two receivers
      // the position is genuinely ambiguous, so this is a convention, not a
      // measurement, and `ambiguous` says so.
      const centroid = {
        x: (usable[0].x + usable[1].x) / 2,
        y: (usable[0].y + usable[1].y) / 2,
      };
      const ranked = [...solutions].sort(
        (p, q) =>
          Math.hypot(p.x - centroid.x, p.y - centroid.y) -
          Math.hypot(q.x - centroid.x, q.y - centroid.y)
      );
      const best = ranked[0];
      const alternative = ranked[1] || null;

      return {
        x: best.x,
        y: best.y,
        errorMetres: Trilateration.residualRms(usable, best),
        used: 2,
        method: 'two-receiver',
        degenerate: false,
        ambiguous: solutions.length > 1,
        alternative,
      };
    }

    // Normal equations for the 2x2 system A*[x,y]^T = b.
    //
    // Subtracting the reference equation from each other one gives
    //   2(x_0 - x_i) * x + 2(y_0 - y_i) * y
    //       = d_i^2 - d_0^2 - (x_i^2 + y_i^2) + (x_0^2 + y_0^2)
    // so the design row is [2*dx, 2*dy] with dx = x_0 - x_i. Carrying the
    // factor of 2 here (rather than halving the right-hand side) keeps the
    // coefficients below in one consistent form.
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    let b1 = 0;
    let b2 = 0;

    for (let i = 1; i < usable.length; i++) {
      const r = usable[i];
      const u = 2 * (reference.x - r.x);
      const v = 2 * (reference.y - r.y);
      const rhs =
        r.range * r.range -
        reference.range * reference.range -
        (r.x * r.x + r.y * r.y) +
        (reference.x * reference.x + reference.y * reference.y);

      a11 += u * u;
      a12 += u * v;
      a22 += v * v;
      b1 += u * rhs;
      b2 += v * rhs;
    }

    const determinant = a11 * a22 - a12 * a12;
    if (Math.abs(determinant) < 1e-9) {
      // Collinear receivers: solvable along one axis only. Report the
      // reference position rather than dividing by ~0 for a wild answer.
      return {
        x: reference.x,
        y: reference.y,
        errorMetres: 0,
        used: usable.length,
        method: 'degenerate',
        degenerate: true,
        ambiguous: false,
        alternative: null,
      };
    }

    const x = (b1 * a22 - a12 * b2) / determinant;
    const y = (a11 * b2 - a12 * b1) / determinant;

    return {
      x,
      y,
      errorMetres: Trilateration.residualRms(usable, { x, y }),
      used: usable.length,
      method: 'least-squares',
      degenerate: false,
      ambiguous: false,
      alternative: null,
    };
  }

  /**
   * RMS difference between the estimated position's distances to each
   * receiver and the ranges that were fitted. This is the honest quality
   * figure: it says how well the estimate explains the measurements, which is
   * not the same as how close it is to the truth.
   */
  static residualRms(ranges, position) {
    let sumSquared = 0;
    for (const r of ranges) {
      sumSquared +=
        (Math.hypot(position.x - r.x, position.y - r.y) - r.range) ** 2;
    }
    return Math.sqrt(sumSquared / ranges.length);
  }

  /**
   * Full pipeline: RSSI readings at known receivers -> a position estimate.
   *
   * @param {Array<{x:number, y:number}>} receivers
   * @param {number[]} readings RSSI in dBm, one per receiver
   * @param {object} options forwarded to rssiToDistance
   */
  static estimate(receivers, readings, options = {}) {
    const ranges = readings.map((rssi) =>
      Trilateration.rssiToDistance(rssi, options)
    );
    const solution = Trilateration.leastSquares(receivers, ranges);
    if (!solution) {
      return {
        x: null,
        y: null,
        errorMetres: null,
        used: 0,
        method: 'insufficient',
        degenerate: true,
        ambiguous: false,
        alternative: null,
        ranges,
      };
    }
    return { ...solution, ranges };
  }

  /**
   * Distance in metres between an estimate and the true position. This is the
   * number the UI reports, so it is computed server-side where both are known
   * rather than in the browser.
   */
  static positionError(estimate, truth) {
    if (!estimate || estimate.x === null || estimate.x === undefined)
      return null;
    if (!truth) return null;
    return Math.hypot(estimate.x - truth.x, estimate.y - truth.y);
  }
}

module.exports = Trilateration;
