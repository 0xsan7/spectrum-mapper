/**
 * PNG export of the heatmap canvas.
 *
 * The existing public/export.js was dead code: it defined an ExportManager
 * that no button ever called, and claimed to produce CSV too. This replaces it
 * with what actually ships - a canvas composite - and leaves the data exports
 * on the server, where they are scriptable and testable.
 */
class ExportManager {
  constructor() {
    this.lastExport = null;
  }

  /**
   * Composite the heatmap canvas, the legend, and a caption into a new canvas
   * and hand back a data URL.
   *
   * The heatmap canvas is drawn as-is; the caption is drawn in code because
   * the chart canvas is a different element and the two have to end up in one
   * image.
   */
  capturePng(renderer, meta = {}) {
    const source = renderer.canvas;
    const captionHeight = 46;
    const width = source.width;
    const height = source.height + captionHeight;

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0);

    const { stats, params, roomWidth, roomHeight, tracking } = meta;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, source.height, width, captionHeight);

    ctx.font = '13px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const left = `${roomWidth} x ${roomHeight} m | n=${params.exponent} `;
    ctx.fillStyle = '#00d4ff';
    ctx.fillText(left, 12, source.height + 15);

    ctx.fillStyle = '#ddd';
    ctx.textAlign = 'right';
    ctx.fillText(
      `avg ${stats.avgRSSI} dBm  max ${stats.maxRSSI}  min ${stats.minRSSI}  ` +
        `${stats.hotspotCount} hotspots`,
      width - 12,
      source.height + 15
    );

    ctx.textAlign = 'left';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = '#888';
    const track = tracking
      ? `est error ${tracking.smoothedErrorMetres} m | ${params.frequency} MHz | fading ${params.noise} dB`
      : `${params.frequency} MHz | fading ${params.noise} dB`;
    ctx.fillText(`${track} | spectrum-mapper`, 12, source.height + 33);

    this.lastExport = { width, height, generatedAt: new Date().toISOString() };
    return out.toDataURL('image/png');
  }

  /** Trigger a browser download of a data URL. */
  download(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
