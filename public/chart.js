/**
 * RSSI / position-error time-series chart.
 *
 * Plain canvas rather than a charting library: the repo has no runtime
 * dependencies beyond Express and ws, and a two-series line plot does not
 * justify adding one.
 */
class RssiChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} bounds min/max values for the RSSI axis, from the server
   */
  constructor(canvas, bounds = { min: -100, max: -30 }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bounds = bounds;
    this.padding = { top: 14, right: 40, bottom: 20, left: 34 };
    this.series = [];
  }

  update(data) {
    if (data && data.bounds) this.bounds = data.bounds;
    this.series = data && data.history ? data.history : [];
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const plotW = width - this.padding.left - this.padding.right;
    const plotH = height - this.padding.top - this.padding.bottom;

    this.drawGrid(width, height, plotW, plotH);

    if (this.series.length < 2) {
      ctx.fillStyle = '#555';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('collecting...', width / 2, height / 2);
      return;
    }

    this.drawLine('avgRSSI', '#00d4ff', plotW, plotH, 1.5, true);
    this.drawLine('errorMetres', '#ffd400', plotW, plotH, 1.5, false, 'm');
  }

  drawGrid(width, height, plotW, plotH) {
    const { ctx, bounds } = this;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const y = this.padding.top + plotH * t;
      const value = bounds.max - (bounds.max - bounds.min) * t;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(this.padding.left, y);
      ctx.lineTo(this.padding.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#666';
      ctx.fillText(value.toFixed(0), this.padding.left - 5, y);
    }
  }

  /**
   * @param {string} key field on each series point
   * @param {number[]} scale maps the value range onto the plot height
   */
  drawLine(key, color, plotW, plotH, lineWidth, filled, unit = 'dBm') {
    const { ctx, bounds } = this;
    const points = this.series
      .map((s, i) => ({ value: s[key], i }))
      .filter((p) => p.value !== null && Number.isFinite(p.value));

    if (points.length < 2) return;

    // The error series shares the RSSI axis, so give it its own scale from 0
    // to the largest error seen. Plotting metres on a dBm axis would draw a
    // flat line along the floor and imply the error is negligible.
    const valueAt = (value) => {
      if (key === 'errorMetres') {
        const maxError = Math.max(
          2,
          ...this.series.map((s) =>
            Number.isFinite(s.errorMetres) ? s.errorMetres : 0
          )
        );
        return (
          this.padding.top + plotH - (Math.max(0, value) / maxError) * plotH
        );
      }
      return (
        this.padding.top +
        ((bounds.max - value) / (bounds.max - bounds.min)) * plotH
      );
    };

    const xAt = (index) =>
      this.padding.left + (index / Math.max(1, this.series.length - 1)) * plotW;

    ctx.save();
    ctx.beginPath();
    points.forEach((p, idx) => {
      const x = xAt(p.i);
      const y = Math.min(
        this.padding.top + plotH,
        Math.max(this.padding.top, valueAt(p.value))
      );
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (filled) {
      const lastX = xAt(points[points.length - 1].i);
      ctx.lineTo(lastX, this.padding.top + plotH);
      ctx.lineTo(xAt(points[0].i), this.padding.top + plotH);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 212, 255, 0.10)';
      ctx.fill();
    }

    ctx.beginPath();
    points.forEach((p, idx) => {
      const x = xAt(p.i);
      const y = Math.min(
        this.padding.top + plotH,
        Math.max(this.padding.top, valueAt(p.value))
      );
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();

    // The live value at the right edge, so the number is readable without
    // making the user trace the line to a gridline.
    const last = points[points.length - 1];
    const lx = xAt(last.i);
    const ly = Math.min(
      this.padding.top + plotH,
      Math.max(this.padding.top, valueAt(last.value))
    );
    ctx.fillStyle = color;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `${last.value.toFixed(key === 'errorMetres' ? 1 : 1)}${unit}`,
      Math.min(lx + 4, this.padding.left + plotW + 2),
      ly
    );
  }
}
