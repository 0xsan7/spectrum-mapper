/**
 * Pointer interaction on the heatmap: drag transmitters and receivers, draw
 * walls, and show a hover tooltip.
 *
 * All of it funnels through the Dashboard, which owns the socket. Nothing here
 * renders; it only translates pointer events into commands.
 */
class Interaction {
  constructor({ canvas, dashboard }) {
    this.canvas = canvas;
    this.dashboard = dashboard;
    this.tooltip = document.getElementById('tooltip');

    this.mode = 'move'; // 'move' | 'wall'
    this.dragging = null; // {kind, id}
    this.pendingWall = null;
    this.hovered = null;

    this.attach();
  }

  setMode(mode) {
    this.mode = mode;
    this.pendingWall = null;
    this.canvas.style.cursor = mode === 'wall' ? 'crosshair' : 'grab';
  }

  attach() {
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointerleave', () => this.onPointerLeave());
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    // Suppress the browser's own drag-select while moving markers.
    this.canvas.addEventListener('dragstart', (e) => e.preventDefault());
  }

  onPointerDown(e) {
    const { x, y } = this.renderer.toRoomCoords(e.clientX, e.clientY);
    const data = this.dashboard.currentData;

    if (this.mode === 'wall') {
      this.pendingWall = { x1: x, y1: y, x2: x, y2: y };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    const source = this.renderer.findSourceAt(x, y, data);
    if (source) {
      this.dragging = { kind: 'source', id: source.id };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    const receiver = this.renderer.findReceiverAt(x, y, data);
    if (receiver) {
      this.dragging = { kind: 'receiver', id: receiver.id };
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  onPointerMove(e) {
    const { x, y } = this.renderer.toRoomCoords(e.clientX, e.clientY);

    if (this.dragging) {
      this.dashboard.send({
        type: this.dragging.kind === 'source' ? 'moveSource' : 'moveReceiver',
        id: this.dragging.id,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
      });
      this.hideTooltip();
      return;
    }

    if (this.pendingWall) {
      this.pendingWall.x2 = x;
      this.pendingWall.y2 = y;
      this.dashboard.requestRender();
      return;
    }

    this.updateTooltip(e, x, y);
  }

  onPointerUp(e) {
    if (this.pendingWall) {
      const wall = this.pendingWall;
      this.pendingWall = null;
      const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
      if (length < 0.3) {
        this.dashboard.requestRender(); // too short to be a wall, discard
        return;
      }
      this.dashboard.send({
        type: 'addWall',
        wall: {
          x1: Number(wall.x1.toFixed(2)),
          y1: Number(wall.y1.toFixed(2)),
          x2: Number(wall.x2.toFixed(2)),
          y2: Number(wall.y2.toFixed(2)),
          attenuation: Number(document.getElementById('wallAttenuation').value),
          thickness: 0.25,
          material: 'drywall',
        },
      });
    }

    if (this.dragging) {
      // Releasing does not free the node; a double-click does. Pinning on
      // drop is what makes positioning deliberate.
      this.dragging = null;
    }
    if (this.canvas.hasPointerCapture?.(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
  }

  onPointerLeave() {
    this.hideTooltip();
    this.hovered = null;
  }

  onDoubleClick(e) {
    const { x, y } = this.renderer.toRoomCoords(e.clientX, e.clientY);
    const source = this.renderer.findSourceAt(x, y, this.dashboard.currentData);
    if (source) {
      this.dashboard.send({ type: 'releaseSource', id: source.id });
    }
  }

  /** Show the grid cell's RSSI under the cursor. */
  updateTooltip(e, x, y) {
    const data = this.dashboard.currentData;
    if (!data || !data.heatmap) return;

    // Nearest cell: the grid is uniform, so round to the cell index.
    const cell = this.nearestCell(data, x, y);
    if (!cell) {
      this.hideTooltip();
      return;
    }

    this.tooltip.hidden = false;
    this.tooltip.innerHTML = `
      <div class="tt-rssi">${cell.rssi} dBm</div>
      <div class="tt-pos">${cell.x} m, ${cell.y} m</div>
    `;

    const rect = this.canvas.getBoundingClientRect();
    const wrapRect = this.canvas.parentElement.getBoundingClientRect();
    const px = e.clientX - wrapRect.left;
    const py = e.clientY - wrapRect.top;
    // Flip the tooltip to the left of the cursor near the right edge so it
    // never gets clipped by the wrapper.
    const flip = px > wrapRect.width - 140;
    this.tooltip.style.left = `${flip ? px - 130 : px + 14}px`;
    this.tooltip.style.top = `${Math.max(0, py - 46)}px`;
    void rect;
  }

  nearestCell(data, x, y) {
    let best = null;
    let bestDistance = Infinity;
    const limit = 1.5;
    for (const cell of data.heatmap) {
      const distance = Math.hypot(cell.x - x, cell.y - y);
      if (distance < bestDistance && distance <= limit) {
        best = cell;
        bestDistance = distance;
      }
    }
    return best;
  }

  hideTooltip() {
    if (this.tooltip) this.tooltip.hidden = true;
  }

  get renderer() {
    return this.dashboard.renderer;
  }
}
