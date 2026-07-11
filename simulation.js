const { CONFIG, RF_SOURCES } = require('./config/constants');

class RFSimulation {
  constructor() {
    this.sources = JSON.parse(JSON.stringify(RF_SOURCES));
  }

  updatePositions() {
    this.sources.forEach(source => {
      source.x += source.vx;
      source.y += source.vy;
      if (source.x < 0) source.x = CONFIG.ROOM_WIDTH;
      if (source.x > CONFIG.ROOM_WIDTH) source.x = 0;
      if (source.y < 0) source.y = CONFIG.ROOM_HEIGHT;
      if (source.y > CONFIG.ROOM_HEIGHT) source.y = 0;
    });
  }

  getSources() {
    return this.sources.map(s => ({
      id: s.id,
      name: s.name,
      x: parseFloat(s.x.toFixed(1)),
      y: parseFloat(s.y.toFixed(1)),
      txPower: s.txPower
    }));
  }

  getSourceData() {
    return this.sources;
  }
}

module.exports = RFSimulation;
