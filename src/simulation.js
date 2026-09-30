const { CONFIG, RF_SOURCES } = require('./config/constants');

class RFSimulation {
  constructor() {
    this.sources = JSON.parse(JSON.stringify(RF_SOURCES));
    // Ids the client has pinned in place by dragging. Anything not listed
    // keeps moving.
    this.pinned = new Set();
  }

  updatePositions() {
    this.sources.forEach((source) => {
      if (this.pinned.has(source.id)) return;

      source.x += source.vx;
      source.y += source.vy;

      // Wrap around the room. Bouncing off the walls reads better on a heatmap
      // than a node teleporting from one edge to the other.
      if (source.x < 0) source.x += CONFIG.ROOM_WIDTH;
      if (source.x > CONFIG.ROOM_WIDTH) source.x -= CONFIG.ROOM_WIDTH;
      if (source.y < 0) source.y += CONFIG.ROOM_HEIGHT;
      if (source.y > CONFIG.ROOM_HEIGHT) source.y -= CONFIG.ROOM_HEIGHT;
    });
  }

  /** Clamp a point into the room, keeping the full extent inclusive. */
  static clampToRoom(value, max) {
    return Math.min(Math.max(value, 0), max);
  }

  /**
   * Move a source to an absolute position, pinning it so it stops drifting.
   *
   * Non-finite coordinates are rejected outright rather than clamped: clamping
   * would silently snap a NaN to (0, 0) and teleport the node to a corner,
   * which is far harder to notice than an error.
   *
   * @returns {boolean} whether the move was applied
   */
  moveSource(id, x, y) {
    const source = this.sources.find((s) => s.id === id);
    if (!source) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    source.x = RFSimulation.clampToRoom(x, CONFIG.ROOM_WIDTH);
    source.y = RFSimulation.clampToRoom(y, CONFIG.ROOM_HEIGHT);
    this.pinned.add(id);
    return true;
  }

  /** Let a source resume its original velocity. */
  releaseSource(id) {
    return this.pinned.delete(id);
  }

  isPinned(id) {
    return this.pinned.has(id);
  }

  getSources() {
    return this.sources.map((s) => ({
      id: s.id,
      name: s.name,
      x: parseFloat(s.x.toFixed(2)),
      y: parseFloat(s.y.toFixed(2)),
      txPower: s.txPower,
      pinned: this.pinned.has(s.id),
    }));
  }

  getSourceData() {
    return this.sources;
  }
}

module.exports = RFSimulation;
