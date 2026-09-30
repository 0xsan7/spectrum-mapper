/**
 * Rolling RSSI history and movement trails.
 *
 * The server is the only place that sees every frame in order, so the history
 * is accumulated there rather than in the browser: a client that connects late
 * would otherwise have no past to draw.
 */
class History {
  /**
   * @param {number} capacity maximum samples kept per series
   */
  constructor(capacity = 240) {
    this.capacity = capacity;
    this.samples = [];
    // Monotonic counter. Samples are identified by this, not by their index:
    // the buffer evicts from the front, so once it is full every index is
    // pinned at `capacity` and an index-based cursor stops advancing - the
    // delta would come back empty forever and a client's chart would freeze.
    this.sequence = 0;
  }

  /**
   * Record one frame. `timestamp` is the frame's own ISO string so the series
   * is on the server's clock, not the client's.
   */
  push(frame) {
    const { timestamp, stats, sources, tracking, heatmap } = frame;

    this.samples.push({
      seq: this.sequence++,
      timestamp,
      elapsedMs: Date.now(),
      avgRSSI: Number(stats.avgRSSI),
      maxRSSI: Number(stats.maxRSSI),
      minRSSI: Number(stats.minRSSI),
      hotspotCount: stats.hotspotCount,
      // Room-average only. Sending all 300 cells per frame for 240 frames
      // would be 72000 points of history nobody plots.
      cellCount: heatmap.length,
      sources: sources.map((s) => ({ id: s.id, x: s.x, y: s.y })),
      estimate:
        tracking && tracking.estimate
          ? { x: tracking.estimate.x, y: tracking.estimate.y }
          : null,
      errorMetres: tracking ? tracking.errorMetres : null,
    });

    // Drop the oldest rather than shifting on every push: shift() is O(n) and
    // this runs twice a second.
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity);
    }
    return this.samples[this.samples.length - 1];
  }

  /**
   * Samples recorded after `seq`, oldest first. This is the delta a live
   * client needs, and it stays correct once the buffer starts evicting.
   */
  since(seq) {
    return this.samples.filter((s) => s.seq > seq);
  }

  /** Oldest to newest, ready to plot. */
  series() {
    return this.samples.map((s, index) => ({
      index,
      avgRSSI: s.avgRSSI,
      maxRSSI: s.maxRSSI,
      minRSSI: s.minRSSI,
      errorMetres: s.errorMetres,
      timestamp: s.timestamp,
    }));
  }

  /**
   * Per-source movement trails, as room-space points oldest to newest.
   * @param {string} id source id
   */
  trail(id) {
    return this.samples
      .map((s) => s.sources.find((src) => src.id === id))
      .filter(Boolean);
  }

  /** Aggregate figures over the whole buffer, for the export header. */
  summary() {
    if (this.samples.length === 0) {
      return {
        samples: 0,
        avgRSSIMean: null,
        avgRSSIMin: null,
        avgRSSIMax: null,
        errorMean: null,
        errorMax: null,
      };
    }
    const avg = this.samples.map((s) => s.avgRSSI);
    const errors = this.samples
      .map((s) => s.errorMetres)
      .filter((e) => e !== null && Number.isFinite(e));

    const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

    return {
      samples: this.samples.length,
      first: this.samples[0].timestamp,
      last: this.samples[this.samples.length - 1].timestamp,
      avgRSSIMean: Number(mean(avg).toFixed(2)),
      avgRSSIMin: Math.min(...avg),
      avgRSSIMax: Math.max(...avg),
      errorMean: errors.length ? Number(mean(errors).toFixed(2)) : null,
      errorMax: errors.length ? Math.max(...errors) : null,
    };
  }

  clear() {
    this.samples = [];
  }
}

module.exports = History;
