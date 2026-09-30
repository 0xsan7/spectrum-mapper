class ColorMapper {
  /**
   * Map an RSSI in dBm to an RGB triple.
   *
   * @param {number} rssi dBm
   * @param {number} minRssi bottom of the scale, e.g. -100
   * @param {number} maxRssi top of the scale, e.g. -20
   */
  static getColor(rssi, minRssi = -100, maxRssi = -20) {
    const span = maxRssi - minRssi;
    if (span <= 0) return [0, 0, 0];
    const t = Math.max(0, Math.min(1, (rssi - minRssi) / span));

    // Four-stop ramp: blue -> green -> yellow -> red.
    const STOPS = [
      [0, 102, 255],
      [255, 255, 0],
      [255, 136, 0],
      [255, 0, 0],
    ];
    const scaled = t * (STOPS.length - 1);
    const index = Math.min(Math.floor(scaled), STOPS.length - 2);
    return this.interpolate(STOPS[index], STOPS[index + 1], scaled - index);
  }

  static interpolate(c1, c2, t) {
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * t),
      Math.round(c1[1] + (c2[1] - c1[1]) * t),
      Math.round(c1[2] + (c2[2] - c1[2]) * t),
    ];
  }

  static toCss([r, g, b]) {
    return `rgb(${r}, ${g}, ${b})`;
  }
}
