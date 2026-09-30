const { CONFIG } = require('./config/constants');

class PathLossModel {
  static calculateRSSI(txPower, distance) {
    if (distance < 0.5) distance = 0.5;
    const pathLoss = 20 * Math.log10(distance) + 20;
    const fading = (Math.random() - 0.5) * 3;
    const rssi = txPower - pathLoss - fading;
    return Math.max(rssi, CONFIG.MIN_RSSI);
  }

  static distance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  }

  static calculateGridRSSI(x, y, rfSources) {
    let totalRSSI = 0;
    rfSources.forEach((source) => {
      const dist = this.distance(x, y, source.x, source.y);
      totalRSSI += this.calculateRSSI(source.txPower, dist);
    });
    return totalRSSI / rfSources.length;
  }
}

module.exports = PathLossModel;
