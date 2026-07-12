class HeatmapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  render(data) {
    if (!data || !data.heatmap) return;

    const { heatmap, roomWidth, roomHeight } = data;
    const pxWidth = this.canvas.width / roomWidth;
    const pxHeight = this.canvas.height / roomHeight;

    const imageData = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    const pixels = imageData.data;

    heatmap.forEach(point => {
      const px = Math.round(point.x * pxWidth);
      const py = Math.round(point.y * pxHeight);

      if (px >= 0 && px < this.canvas.width && py >= 0 && py < this.canvas.height) {
        const color = ColorMapper.getColor(point.rssi);
        const idx = (py * this.canvas.width + px) * 4;
        pixels[idx] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = 200;
      }
    });

    this.ctx.putImageData(imageData, 0, 0);
    this.drawGrid(pxWidth, pxHeight, roomWidth, roomHeight);
    this.drawMarkers(data, pxWidth, pxHeight);
  }

  drawGrid(pxWidth, pxHeight, roomWidth, roomHeight) {
    this.ctx.strokeStyle = 'rgba(100, 100, 100, 0.1)';
    this.ctx.lineWidth = 0.5;
    for (let x = 0; x <= roomWidth; x++) {
      this.ctx.beginPath();
      this.ctx.moveTo(x * pxWidth, 0);
      this.ctx.lineTo(x * pxWidth, this.canvas.height);
      this.ctx.stroke();
    }
    for (let y = 0; y <= roomHeight; y++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y * pxHeight);
      this.ctx.lineTo(this.canvas.width, y * pxHeight);
      this.ctx.stroke();
    }
  }

  drawMarkers(data, pxWidth, pxHeight) {
    data.sources.forEach(source => {
      const px = source.x * pxWidth;
      const py = source.y * pxHeight;
      this.ctx.fillStyle = '#ff00ff';
      this.ctx.beginPath();
      this.ctx.arc(px, py, 8, 0, Math.PI * 2);
      this.ctx.fill();
    });

    data.receivers.forEach(receiver => {
      const px = receiver.x * pxWidth;
      const py = receiver.y * pxHeight;
      this.ctx.strokeStyle = '#00ff88';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(px - 6, py - 6, 12, 12);
    });
  }
}
