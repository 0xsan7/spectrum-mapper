const { CONFIG, RECEIVER_NODES } = require('./config/constants');
const PathLossModel = require('./pathLoss');

class HeatmapGenerator {
  /**
   * Build the RSSI grid for the room.
   * @param {Array} rfSources sources with {x, y, txPower}
   * @param {object} [pathLossOptions] forwarded to PathLossModel, so a caller
   *   can sweep exponent/frequency without mutating CONFIG
   */
  static generate(rfSources, pathLossOptions = {}) {
    const grid = [];
    for (let x = 0; x < CONFIG.ROOM_WIDTH; x += CONFIG.GRID_RESOLUTION) {
      for (let y = 0; y < CONFIG.ROOM_HEIGHT; y += CONFIG.GRID_RESOLUTION) {
        const rssi = PathLossModel.calculateGridRSSI(
          x,
          y,
          rfSources,
          pathLossOptions
        );
        grid.push({
          x: parseFloat(x.toFixed(1)),
          y: parseFloat(y.toFixed(1)),
          rssi: parseFloat(rssi.toFixed(1)),
        });
      }
    }
    return grid;
  }

  static getReceiverNodes() {
    return RECEIVER_NODES.map((r) => ({ id: r.id, x: r.x, y: r.y }));
  }

  static calculateStats(heatmap) {
    const rssiValues = heatmap.map((p) => p.rssi);
    const sum = rssiValues.reduce((a, b) => a + b, 0);
    return {
      maxRSSI: Math.max(...rssiValues).toFixed(1),
      minRSSI: Math.min(...rssiValues).toFixed(1),
      avgRSSI: (sum / rssiValues.length).toFixed(1),
      hotspotCount: rssiValues.filter((r) => r > CONFIG.HOTSPOT_THRESHOLD)
        .length,
    };
  }
}

module.exports = HeatmapGenerator;
