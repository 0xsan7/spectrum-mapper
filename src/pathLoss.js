const { CONFIG } = require('./config/constants');

/** Speed of light in m/s. */
const C = 299792458;

/**
 * Log-distance path loss model.
 *
 *   PL(d) = PL(d0) + 10 * n * log10(d / d0)        [dB]
 *   RSSI  = txPower - PL(d)                         [dBm]
 *
 * where PL(d0) is the free-space loss at the reference distance d0:
 *
 *   PL(d0) = 20 * log10(4 * pi * d0 * f / c)
 *
 * `n` is the path loss exponent. Free space is 2.0; indoor office / urban
 * clutter pushes it to 2.7-3.5 depending on how many obstructions the signal
 * actually crosses, which is why it is configurable rather than hardcoded.
 *
 * `f` is the carrier frequency in MHz. PL(d0) scales with frequency, so a
 * 2.4 GHz link loses about 6 dB more at d0 than a 900 MHz one does.
 *
 * Beyond d0 the exponent term dominates, so a larger n means faster decay.
 */
class PathLossModel {
  /** Defaults live on the model, not in CONFIG, so tests can construct one. */
  static defaults() {
    return {
      referenceDistance: 1, // d0, metres
      frequency: 2437, // MHz, Wi-Fi 2.4 GHz channel 6
      exponent: 2.7, // indoor path loss exponent
      noiseFloor: CONFIG.MIN_RSSI,
      fading: 3, // +/- dB, uniform
    };
  }

  /**
   * Free-space path loss at the reference distance, in dB.
   * @param {number} d0 reference distance in metres
   * @param {number} frequencyMHz carrier frequency in MHz
   */
  static referenceLoss(d0, frequencyMHz) {
    return 20 * Math.log10((4 * Math.PI * d0 * frequencyMHz * 1e6) / C);
  }

  /**
   * Path loss in dB at `distance` metres.
   * @param {number} distance metres
   * @param {object} [options] overrides for the defaults
   */
  static pathLoss(distance, options = {}) {
    const opts = { ...this.defaults(), ...options };
    const d0 = opts.referenceDistance;
    const d = Math.max(distance, d0); // clamp: never evaluate log10(<=0)
    return (
      this.referenceLoss(d0, opts.frequency) +
      10 * opts.exponent * Math.log10(d / d0)
    );
  }

  /**
   * RSSI in dBm at `distance` metres from a transmitter.
   *
   * `fadingDb` is passed in rather than drawn from Math.random so that callers
   * (and tests) stay deterministic. Omit it for a random draw.
   */
  static calculateRSSI(txPower, distance, options = {}) {
    const opts = { ...this.defaults(), ...options };
    const loss = this.pathLoss(distance, opts);

    const fadingDb =
      opts.fadingDb !== undefined
        ? opts.fadingDb
        : (Math.random() - 0.5) * opts.fading;

    return Math.max(txPower - loss - fadingDb, opts.noiseFloor);
  }

  /** Straight-line distance between two points. */
  static distance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  }

  /** Convert dBm to milliwatts. */
  static dbmToMilliwatts(dbm) {
    return Math.pow(10, dbm / 10);
  }

  /** Convert milliwatts to dBm. */
  static milliwattsToDbm(mw) {
    return 10 * Math.log10(mw);
  }

  /**
   * Combined RSSI at (x, y) from every source.
   *
   * Sources add in linear power, not in dBm: averaging four -60 dBm readings
   * gives -60 dBm, which is wrong by 6 dB per doubling of the source count.
   * Summing milliwatts and converting back is the physically correct form and
   * is why the heatmap no longer saturates.
   *
   * `obstacles` is an Obstacles instance; every wall the straight path from a
   * source to this point crosses subtracts that wall's dB attenuation.
   */
  static calculateGridRSSI(x, y, rfSources, options = {}) {
    if (!rfSources || rfSources.length === 0) return CONFIG.MIN_RSSI;

    const { obstacles, ...pathLossOptions } = options;

    let totalMilliwatts = 0;
    for (const source of rfSources) {
      const dist = this.distance(x, y, source.x, source.y);
      const rssi = this.calculateRSSI(source.txPower, dist, {
        ...pathLossOptions,
        ...(source.pathLossOptions || {}),
      });

      let obstacleLoss = 0;
      if (obstacles) {
        obstacleLoss = obstacles.attenuationBetween(source.x, source.y, x, y);
      }

      totalMilliwatts += this.dbmToMilliwatts(rssi - obstacleLoss);
    }

    return this.milliwattsToDbm(totalMilliwatts);
  }
}

module.exports = PathLossModel;
