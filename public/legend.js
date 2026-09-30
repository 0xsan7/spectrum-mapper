/**
 * The RSSI legend bar.
 *
 * The old markup hardcoded three labels (-100 / -50 / -20) next to a CSS
 * gradient, which drifted from whatever the canvas was actually painting. This
 * builds the gradient from the same ColorMapper the heatmap uses, so the bar
 * cannot disagree with the map.
 */
class LegendBar {
  constructor(barEl, labelsEl) {
    this.bar = barEl;
    this.labels = labelsEl;
  }

  render(minRssi, maxRssi) {
    const steps = 40;
    const parts = [];
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const rssi = minRssi + t * (maxRssi - minRssi);
      parts.push(
        `${ColorMapper.toCss(ColorMapper.getColor(rssi, minRssi, maxRssi))} ${(t * 100).toFixed(1)}%`
      );
    }
    this.bar.style.background = `linear-gradient(to right, ${parts.join(', ')})`;

    // Label the ends and the midpoint of the real range.
    const mid = Math.round((minRssi + maxRssi) / 2);
    this.labels.innerHTML = '';
    [minRssi, mid, maxRssi].forEach((value) => {
      const span = document.createElement('span');
      span.textContent = `${value} dBm`;
      this.labels.appendChild(span);
    });

    // A tick at the hotspot threshold, so the coverage number has a visible
    // anchor on the scale.
    this.bar.title = `Hotspot threshold: ${minRssi + (maxRssi - minRssi) * 0.75} dBm`;
  }
}
