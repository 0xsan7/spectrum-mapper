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

    this.chart = new RssiChart(document.getElementById('rssiChart'), {
      min: this.minRssi,
      max: this.maxRssi,
    });
    // The server sends only the samples added since the previous frame, so the
    // client keeps its own copy for the chart. Same cap, or a long session
    // grows without bound.
    this.historyBuffer = [];
    this.exporter = new ExportManager();
    this.bindExportButtons();

    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.requestRender();
      this.chart.draw();
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
    this.updateTracking();
    this.updateCoverage();
    this.updateChart();
  }

  updateChart() {
    // A full snapshot replaces the buffer; a delta appends to it. The server
    // sends one snapshot on connect and deltas thereafter.
    if (Array.isArray(this.currentData.history)) {
      this.historyBuffer = this.currentData.history.slice();
    } else if (Array.isArray(this.currentData.historyDelta)) {
      this.historyBuffer.push(...this.currentData.historyDelta);
      if (this.historyBuffer.length > 240) {
        this.historyBuffer.splice(0, this.historyBuffer.length - 240);
      }
    }

    this.chart.update({
      history: this.historyBuffer,
      bounds: { min: this.minRssi, max: this.maxRssi },
    });

    const hint = document.getElementById('historyHint');
    const count = this.historyBuffer.length;
    if (hint) {
      hint.textContent = `${count} samples buffered (last ${(
        count * 0.5
      ).toFixed(0)}s). Error uses its own 0-max scale.`;
    }
  }

  /**
   * Export controls.
   *
   * The PNG is built in the browser from the live canvas. Everything else is
   * a plain link to the server's API, so the same files are reachable with
   * curl and do not depend on this page being open.
   */
  bindExportButtons() {
    const api = {
      exportSeries: '/api/export/timeseries.csv',
      exportHeatmap: '/api/export/heatmap.csv',
      exportReadings: '/api/export/readings.csv',
      exportFrame: '/api/export/frame.json',
    };

    for (const [id, href] of Object.entries(api)) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.addEventListener('click', () => {
        window.location.href = href;
      });
    }

    const png = document.getElementById('exportPng');
    if (png) {
      png.addEventListener('click', () => {
        const url = this.exporter.capturePng(this.renderer, {
          stats: this.currentData.stats,
          params: this.currentData.params,
          roomWidth: this.currentData.roomWidth,
          roomHeight: this.currentData.roomHeight,
          tracking: this.currentData.tracking,
        });
        this.exporter.download(url, 'spectrum-map.png');
      });
    }
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

  /**
   * The trilateration readout.
   *
   * The error against the simulated truth is computed on the server, which is
   * the only place both the estimate and the truth exist. Everything shown
   * here is a value the server sent - the browser never re-derives it.
   */
  updateTracking() {
    const panel = document.getElementById('trackingPanel');
    if (!panel) return;
    const t = this.currentData.tracking;

    if (!t || !t.estimate || t.estimate.x === null) {
      panel.innerHTML =
        '<div class="hint">Not enough usable receivers to localise the mobile device.</div>';
      return;
    }

    const { estimate, truth, readings } = t;
    const rows = [
      ['True position', `(${truth.x.toFixed(2)}, ${truth.y.toFixed(2)}) m`],
      ['Estimate', `(${estimate.x.toFixed(2)}, ${estimate.y.toFixed(2)}) m`],
      ['Error', `${t.smoothedErrorMetres.toFixed(2)} m`],
      ['Error (this frame)', `${t.errorMetres.toFixed(2)} m`],
      ['Range residual', `${t.residualMetres.toFixed(2)} m`],
      ['Method', estimate.method],
      ['Receivers used', `${estimate.used} / ${readings.length}`],
    ];

    const ambiguousNote = estimate.ambiguous
      ? '<div class="hint">Only two receivers: two positions fit equally well. The hollow circle is the other candidate.</div>'
      : '';

    const clampedNote = estimate.wasClamped
      ? `<div class="hint">Raw fit landed off the map at (${estimate.rawX.toFixed(2)}, ${estimate.rawY.toFixed(2)}) m and was clamped to the room.</div>`
      : '';

    panel.innerHTML = `
      ${rows
        .map(
          ([label, value]) =>
            `<div class="stat-row"><label>${label}</label><value>${value}</value></div>`
        )
        .join('')}
      ${clampedNote}
      ${ambiguousNote}
      <table class="reading-table">
        <thead><tr><th>RX</th><th>RSSI</th><th>Wall</th><th>Range</th></tr></thead>
        <tbody>
          ${readings
            .map(
              (r) => `<tr>
                <td>${r.id}</td>
                <td>${r.rssi}</td>
                <td>${r.wallLoss ? `-${r.wallLoss} dB` : '-'}</td>
                <td>${r.range === null ? 'n/a' : `${r.range} m`}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
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
