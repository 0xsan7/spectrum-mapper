/**
 * Application shell: owns the socket, the renderer, and the sidebar.
 *
 * The previous version registered two `load` listeners that each constructed a
 * Dashboard, so the page ran two WebSocket connections and two render loops,
 * and the prototype hooks in spectrum-hook.js / threat-integration.js patched
 * a throwaway instance. There is now exactly one instance, created once, and
 * the sidebar updates are plain method calls rather than prototype surgery.
 */
class Dashboard {
  constructor() {
    this.canvas = document.getElementById('heatmapCanvas');
    this.renderer = new HeatmapRenderer(this.canvas);
    this.legend = new LegendBar(
      document.getElementById('legendBar'),
      document.getElementById('legendLabels')
    );
    this.currentData = null;
    this.isPaused = false;
    this.frameRequested = false;
    this.statusEl = document.getElementById('statusText');
    this.minRssi = -100;
    this.maxRssi = -20;

    this.ws = new WebSocketClient(
      (data) => this.onFrame(data),
      ({ state }) => {
        this.statusEl.textContent = state;
      }
    );

    this.interaction = new Interaction({
      canvas: this.canvas,
      dashboard: this,
    });

    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.requestRender();
    });
  }

  onFrame(data) {
    const first = !this.currentData;
    this.currentData = data;
    this.roomWidth = data.roomWidth;
    this.roomHeight = data.roomHeight;
    this.isPaused = Boolean(data.params && data.params.paused);

    this.legend.render(this.minRssi, this.maxRssi);

    if (first) {
      // The sidebar cannot be built before the first frame, because the
      // sliders are generated from the limits the server sends.
      this.controls = new Controls(this);
      this.interaction.setMode('move');
    } else if (this.controls) {
      this.controls.update(data);
    }

    this.render();
    this.updateSidebar();
    this.updateCoverage();
  }

  /**
   * Render on the next animation frame.
   *
   * A drag produces pointermove events far faster than the socket's update
   * rate, so coalescing them into one render per frame keeps dragging smooth
   * instead of queueing a canvas repaint per mouse event.
   */
  requestRender() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.render();
    });
  }

  render() {
    if (!this.currentData) return;
    this.renderer.render(this.currentData);
  }

  send(message) {
    this.ws.send(message);
  }

  /** Echo the current interaction mode, so W/M have visible feedback. */
  setStatusHint() {
    const mode = this.interaction.mode;
    this.statusEl.textContent =
      mode === 'wall'
        ? 'Connected - drag on the map to draw a wall'
        : 'Connected';
  }

  updateSidebar() {
    const { sources, receivers, stats, walls, heatmap } = this.currentData;

    document.getElementById('sourcesList').innerHTML = sources
      .map(
        (s) => `
        <div class="info-item">
          <div class="name">${s.name} <span class="badge">${s.id}</span></div>
          <div class="meta">${s.txPower} dBm &middot; (${s.x}, ${s.y}) m
            ${s.pinned ? '<span class="pin">pinned</span>' : ''}
          </div>
        </div>`
      )
      .join('');

    document.getElementById('receiversList').innerHTML = receivers
      .map(
        (r) => `
        <div class="info-item">
          <div class="name">${r.id}</div>
          <div class="meta">(${r.x}, ${r.y}) m</div>
        </div>`
      )
      .join('');

    document.getElementById('statsPanel').innerHTML = `
      <div class="stat-row"><label>Max</label><value>${stats.maxRSSI} dBm</value></div>
      <div class="stat-row"><label>Min</label><value>${stats.minRSSI} dBm</value></div>
      <div class="stat-row"><label>Average</label><value>${stats.avgRSSI} dBm</value></div>
      <div class="stat-row"><label>Hotspots</label><value>${stats.hotspotCount} / ${heatmap.length}</value></div>
      <div class="stat-row"><label>Walls</label><value>${walls.length}</value></div>
    `;
  }

  updateCoverage() {
    const panel = document.getElementById('spectrumPanel');
    if (!panel) return;
    const report = spectrumAnalyzer.analyze(this.currentData.heatmap);
    panel.innerHTML = `
      <div class="stat-row"><label>Strong coverage</label><value>${report.coverage}%</value></div>
      <div class="stat-row"><label>Dead zones</label><value>${report.deadZones}%</value></div>
      <div class="spectrum-bar-wrap">
        ${report.bars
          .map(
            (bar) =>
              `<div class="spectrum-bar" style="width:${bar.percent}%;background:${bar.color}"></div>`
          )
          .join('')}
      </div>
      <div class="spectrum-key">
        ${report.bars
          .map(
            (b) =>
              `<span><i style="background:${b.color}"></i>${b.label}</span>`
          )
          .join('')}
      </div>
    `;
  }
}

window.dashboard = new Dashboard();
