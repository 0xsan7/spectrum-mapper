const { CONFIG, RECEIVER_NODES } = require('./config/constants');

/**
 * Receiver nodes. The fixed monitoring points in the room, which the UI can
 * drag around. They live in their own object rather than inside RFSimulation
 * because they never move on their own - only the client moves them.
 */
class Receivers {
  constructor(nodes = RECEIVER_NODES) {
    this.nodes = nodes.map((n) => ({ ...n }));
  }

  /**
   * Move a receiver to an absolute position.
   * @returns {boolean} whether the move was applied (false if the id is
   *   unknown or the coordinates are not finite)
   */
  move(id, x, y) {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    node.x = Math.min(Math.max(x, 0), CONFIG.ROOM_WIDTH);
    node.y = Math.min(Math.max(y, 0), CONFIG.ROOM_HEIGHT);
    return true;
  }

  /** The payload the client expects: id/x/y only. */
  getNodes() {
    return this.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  }

  reset() {
    this.nodes = RECEIVER_NODES.map((n) => ({ ...n }));
  }
}

module.exports = Receivers;
