class HeatmapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.cellAlpha = 200;
    // Room dimensions in metres. Set from each frame, and defaulted here so a
    // pointer event before the first frame cannot divide by undefined.
    this.roomWidth = 20;
    this.roomHeight = 15;
  }

  /** Match the backing store to the CSS size so the map is not blurry. */
  resize() {
    const wrapper = this.canvas.parentElement;
    const width = wrapper.clientWidth;
    const height = Math.round((width * 3) / 4); // 20x15 m room
    if (
      width > 0 &&
      (this.canvas.width !== width || this.canvas.height !== height)
    ) {
      this.canvas.width = width;
      this.canvas.height = height;
      return true;
    }
    return false;
  }

  render(data) {
    if (!data || !data.heatmap) return;
    this.resize();
    this.roomWidth = data.roomWidth;
    this.roomHeight = data.roomHeight;

    const { heatmap, roomWidth, roomHeight } = data;
    this.paintCells(heatmap, roomWidth, roomHeight);
    this.drawGrid(roomWidth, roomHeight);
    this.drawTrails(data.trails || {}, roomWidth, roomHeight);
    this.drawWalls(data.walls || [], roomWidth, roomHeight);
    this.drawTracking(data.tracking, roomWidth, roomHeight);
    this.drawMarkers(data, roomWidth, roomHeight);
  }

  /**
   * Where each source has been.
   *
   * Drawn oldest to newest with the head brightest, so direction of travel
   * reads without needing arrows.
   */
  drawTrails(trails, roomWidth, roomHeight) {
    const entries = Object.entries(trails).filter(
      ([, points]) => Array.isArray(points) && points.length > 1
    );
    if (entries.length === 0) return;

    const sx = this.canvas.width / roomWidth;
    const sy = this.canvas.height / roomHeight;

    this.ctx.save();
    this.ctx.lineCap = 'round';
    for (const [, points] of entries) {
      // One stroke per segment so opacity can ramp along the trail.
      for (let i = 1; i < points.length; i++) {
        const t = i / points.length;
        this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + t * 0.3})`;
        this.ctx.lineWidth = 1 + t * 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(points[i - 1].x * sx, points[i - 1].y * sy);
        this.ctx.lineTo(points[i].x * sx, points[i].y * sy);
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  /**
   * Estimate vs truth for the tracked transmitter.
   *
   * The estimate is a crosshair, the truth keeps its normal marker, and the
   * line between them is the error. Drawn under the markers so the truth
   * marker is never hidden by its own error line.
   */
  drawTracking(tracking, roomWidth, roomHeight) {
    if (!tracking || !tracking.estimate) return;
    const sx = this.canvas.width / roomWidth;
    const sy = this.canvas.height / roomHeight;
    const { estimate, truth } = tracking;
    if (estimate.x === null || estimate.x === undefined) return;

    const ex = estimate.x * sx;
    const ey = estimate.y * sy;
    const tx = truth.x * sx;
    const ty = truth.y * sy;

    this.ctx.save();

    // The error line, with the distance in metres on it.
    this.ctx.strokeStyle = 'rgba(255, 212, 0, 0.9)';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([5, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(tx, ty);
    this.ctx.lineTo(ex, ey);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // The mirror-image candidate, when only two receivers were usable. Drawn
    // hollow so it reads as a possibility, not a result.
    if (estimate.ambiguous && estimate.alternative) {
      this.ctx.strokeStyle = 'rgba(255, 212, 0, 0.45)';
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.arc(
        estimate.alternative.x * sx,
        estimate.alternative.y * sy,
        9,
        0,
        Math.PI * 2
      );
      this.ctx.stroke();
    }

    // The estimate itself: a crosshair with a gap in the middle.
    this.ctx.strokeStyle = '#ffd400';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(ex - 12, ey);
    this.ctx.lineTo(ex - 4, ey);
    this.ctx.moveTo(ex + 4, ey);
    this.ctx.lineTo(ex + 12, ey);
    this.ctx.moveTo(ex, ey - 12);
    this.ctx.lineTo(ex, ey - 4);
    this.ctx.moveTo(ex, ey + 4);
    this.ctx.lineTo(ex, ey + 12);
    this.ctx.stroke();

    this.drawLabel(
      `est ${estimate.x.toFixed(1)}, ${estimate.y.toFixed(1)}`,
      ex,
      ey - 18
    );

    const label = `${tracking.errorMetres.toFixed(2)} m error`;
    this.ctx.font = '11px ui-monospace, monospace';
    const width = this.ctx.measureText(label).width;
    const midX = (tx + ex) / 2;
    const midY = (ty + ey) / 2;
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    this.ctx.fillRect(midX - width / 2 - 4, midY - 9, width + 8, 14);
    this.ctx.fillStyle = '#ffd400';
    this.ctx.fillText(label, midX, midY + 2);

    this.ctx.restore();
  }

  /**
   * Fill each grid cell as a rectangle.
   *
   * The previous renderer wrote a single pixel per cell: at 800x600 for a 20x15
   * m room that is 300 painted pixels out of 480,000, so the heatmap was mostly
   * empty canvas with sparse dots.
   */
  paintCells(heatmap, roomWidth, roomHeight) {
    const cellW = this.canvas.width / roomWidth;
    const cellH = this.canvas.height / roomHeight;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.globalAlpha = this.cellAlpha / 255;

    for (const point of heatmap) {
      const [r, g, b] = ColorMapper.getColor(point.rssi);
      this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      // +1 on each dimension hides the hairline seams between adjacent cells.
      this.ctx.fillRect(
        Math.floor(point.x * cellW),
        Math.floor(point.y * cellH),
        Math.ceil(cellW) + 1,
        Math.ceil(cellH) + 1
      );
    }

    this.ctx.globalAlpha = 1;
  }

  drawGrid(roomWidth, roomHeight) {
    const cellW = this.canvas.width / roomWidth;
    const cellH = this.canvas.height / roomHeight;

    this.ctx.strokeStyle = 'rgba(120, 130, 140, 0.18)';
    this.ctx.lineWidth = 0.5;
    this.ctx.beginPath();
    for (let x = 0; x <= roomWidth; x++) {
      this.ctx.moveTo(x * cellW, 0);
      this.ctx.lineTo(x * cellW, this.canvas.height);
    }
    for (let y = 0; y <= roomHeight; y++) {
      this.ctx.moveTo(0, y * cellH);
      this.ctx.lineTo(this.canvas.width, y * cellH);
    }
    this.ctx.stroke();
  }

  drawWalls(walls, roomWidth, roomHeight) {
    const sx = this.canvas.width / roomWidth;
    const sy = this.canvas.height / roomHeight;

    this.ctx.save();
    this.ctx.lineCap = 'round';
    walls.forEach((wall, index) => {
      // Thickness in metres, but never thinner than 3px or the wall vanishes.
      const width = Math.max(3, (wall.thickness || 0.2) * sx);
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 + Math.min(0.5, wall.attenuation / 60)})`;
      this.ctx.lineWidth = width;
      this.ctx.beginPath();
      this.ctx.moveTo(wall.x1 * sx, wall.y1 * sy);
      this.ctx.lineTo(wall.x2 * sx, wall.y2 * sy);
      this.ctx.stroke();

      // Small handle at the midpoint so a wall is visibly selectable.
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      this.ctx.beginPath();
      this.ctx.arc(
        ((wall.x1 + wall.x2) / 2) * sx,
        ((wall.y1 + wall.y2) / 2) * sy,
        4,
        0,
        Math.PI * 2
      );
      this.ctx.fill();
      this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
      this.ctx.font = '9px monospace';
      this.ctx.fillText(
        String(index),
        ((wall.x1 + wall.x2) / 2) * sx + 6,
        ((wall.y1 + wall.y2) / 2) * sy - 5
      );
    });
    this.ctx.restore();
  }

  drawMarkers(data, roomWidth, roomHeight) {
    const sx = this.canvas.width / roomWidth;
    const sy = this.canvas.height / roomHeight;

    data.sources.forEach((source) => {
      const px = source.x * sx;
      const py = source.y * sy;
      this.ctx.beginPath();
      this.ctx.arc(px, py, 9, 0, Math.PI * 2);
      this.ctx.fillStyle = source.pinned ? '#ffd400' : '#ff2fd0';
      this.ctx.fill();
      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
      this.drawLabel(source.name, px, py - 14);
    });

    data.receivers.forEach((receiver) => {
      const px = receiver.x * sx;
      const py = receiver.y * sy;
      this.ctx.strokeStyle = '#00ff88';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(px - 7, py - 7, 14, 14);
      this.drawLabel(receiver.id, px, py - 12);
    });
  }

  drawLabel(text, px, py) {
    this.ctx.save();
    this.ctx.font = '11px system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    const width = this.ctx.measureText(text).width;
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    this.ctx.fillRect(px - width / 2 - 4, py - 10, width + 8, 14);
    this.ctx.fillStyle = '#fff';
    this.ctx.fillText(text, px, py);
    this.ctx.restore();
  }

  /**
   * Screen position -> room coordinates in metres.
   * getBoundingClientRect is used rather than offsetWidth so the mapping stays
   * correct when the canvas is CSS-scaled.
   */
  toRoomCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.roomWidth,
      y: ((clientY - rect.top) / rect.height) * this.roomHeight,
    };
  }

  /** Nearest transmitter to a room-space point, within `tolerance` metres. */
  findSourceAt(x, y, data, tolerance = 1.2) {
    if (!data) return null;
    let best = null;
    let bestDistance = tolerance;
    data.sources.forEach((source) => {
      const distance = Math.hypot(source.x - x, source.y - y);
      if (distance <= bestDistance) {
        best = source;
        bestDistance = distance;
      }
    });
    return best;
  }

  findReceiverAt(x, y, data, tolerance = 1.2) {
    if (!data) return null;
    let best = null;
    let bestDistance = tolerance;
    data.receivers.forEach((receiver) => {
      const distance = Math.hypot(receiver.x - x, receiver.y - y);
      if (distance <= bestDistance) {
        best = receiver;
        bestDistance = distance;
      }
    });
    return best;
  }
}
