/**
 * The RSSI legend bar.
 *
 * The old markup hardcoded three labels (-100 / -50 / -20) next to a CSS
 * gradient, which drifted from whatever the canvas was actually painting. This
 * builds the gradient from the same ColorMapper the heatmap uses, so the bar
 * cannot disagree with the map.
 */
class LegendBar {
  /**
   * @param {Element} barEl the gradient
   * @param {Element} labelsEl the min/mid/max row
   * @param {Element} [ticksEl] container for the contour level ticks
   */
  constructor(barEl, labelsEl, ticksEl = null) {
    this.bar = barEl;
    this.labels = labelsEl;
    this.ticks = ticksEl;
    /**
     * The RSSI levels marked on the bar. Set once by the dashboard; until it is
     * set, render() paints no ticks rather than guessing which ones matter.
     * @type {number[]|null}
     */
    this.levels = null;
  }

  /**
   * Mark where the contour levels fall on the bar.
   *
   * Positioned by the same normalisation the colour uses, so a tick at -70 sits
   * on the -70 colour. Out-of-range levels are dropped rather than clamped: a
   * tick pinned to the end of the bar would claim there is a contour at -20.
   */
  renderTicks(minRssi, maxRssi, levels) {
    if (!this.ticks) return 0;
    this.ticks.innerHTML = '';
    const span = maxRssi - minRssi;
    if (span <= 0) return 0;
    let placed = 0;
    for (const level of levels) {
      const t = (level - minRssi) / span;
      if (t < 0 || t > 1) continue;
      const tick = document.createElement('i');
      tick.style.left = `${(t * 100).toFixed(2)}%`;
      tick.dataset.level = String(level);
      this.ticks.appendChild(tick);
      placed++;
    }
    return placed;
  }

  /**
   * @param {number} minRssi
   * @param {number} maxRssi
   * @param {string} [ramp] the ramp the canvas is painting. The bar is built
   *   from the same ColorMapper call the heatmap makes, so it cannot disagree
   *   with the map - which is the whole point of generating it here rather
   *   than writing a CSS gradient by hand.
   */
  render(minRssi, maxRssi, ramp = ColorMapper.DEFAULT_RAMP) {
    this.bar.style.background = ColorMapper.toGradient(
      ramp,
      minRssi,
      maxRssi,
      40
    );
    this.ramp = ramp;

    // Label the ends and the midpoint of the real range.
    const mid = Math.round((minRssi + maxRssi) / 2);
    this.labels.innerHTML = '';
    [minRssi, mid, maxRssi].forEach((value) => {
      const span = document.createElement('span');
      span.textContent = `${value} dBm`;
      this.labels.appendChild(span);
    });

    // A tick at the hotspot threshold, so the coverage number has a visible
    // anchor on the scale. The title also names the ramp, because the contour
    // lines are pinned to fixed dBm and only make sense against a scale you
    // can read.
    const name = (ColorMapper.RAMPS[ramp] || {}).label || ramp;
    this.bar.title = `Hotspot threshold: ${minRssi + (maxRssi - minRssi) * 0.75} dBm. Ramp: ${name}`;

    /* The ticks are drawn here, not by the caller.
     *
     * They used to be a separate renderTicks() call that only onFrame made, so
     * anything else that changed the ramp - cycleRamp() - repainted the bar
     * and left the ticks where they were. That was invisible while the ticks
     * were ramp-independent, which they are: positioned by dBm and styled from
     * CSS. But nothing enforced that, so the first change giving a tick a
     * ramp-dependent style would have gone stale on every ramp switch with no
     * test failing.
     *
     * Rendering both from one entry point removes the coupling instead of
     * documenting it. Callers set `levels` once and never sequence anything.
     */
    if (this.levels) this.renderTicks(minRssi, maxRssi, this.levels);
  }
}
