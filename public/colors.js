class ColorMapper {
  static getColor(rssi) {
    const normalized = Math.max(0, Math.min(1, (rssi + 100) / 80));

    if (normalized < 0.25) {
      const t = normalized / 0.25;
      return this.interpolate([0, 102, 255], [0, 255, 0], t);
    } else if (normalized < 0.5) {
      const t = (normalized - 0.25) / 0.25;
      return this.interpolate([0, 255, 0], [255, 255, 0], t);
    } else if (normalized < 0.75) {
      const t = (normalized - 0.5) / 0.25;
      return this.interpolate([255, 255, 0], [255, 136, 0], t);
    } else {
      const t = (normalized - 0.75) / 0.25;
      return this.interpolate([255, 136, 0], [255, 0, 0], t);
    }
  }

  static interpolate(c1, c2, t) {
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * t),
      Math.round(c1[1] + (c2[1] - c1[1]) * t),
      Math.round(c1[2] + (c2[2] - c1[2]) * t),
    ];
  }
}
