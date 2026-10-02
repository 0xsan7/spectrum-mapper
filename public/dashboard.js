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
    this.statusPill = document.getElementById('statusPill');
    this.modeBadge = document.getElementById('modeBadge');
    this.fpsBadge = document.getElementById('fpsBadge');
    // Frame times are counted here rather than read from a timer, because what
    // matters is frames the page actually painted - a tab in the background
    // stops being given frames and the number should say so.
    this.frameTimes = [];
    this.minRssi = -100;
    this.maxRssi = -20;

    this.ws = new WebSocketClient(
      (data) => this.onFrame(data),
      ({ state }) => this.setConnectionState(state)
    );

    this.interaction = new Interaction({
      canvas: this.canvas,
      dashboard: this,
    });
    this.initMeasuredControls();

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

  /**
   * Connection state, in the pill.
   *
   * The pill is coloured from a data-state attribute rather than by swapping a
   * class, so the CSS owns the colours and there is one place to change them.
   * The state word itself is always spelled out: a red dot alone tells a
   * colour-blind reader nothing.
   */
  setConnectionState(state) {
    if (this.statusEl) this.statusEl.textContent = state;
    if (!this.statusPill) return;
    const key = String(state).toLowerCase();
    // The CSS keys off 'connected' / 'disconnected' / 'connection error';
    // anything else is a connecting-ish state and stays neutral.
    const known = [
      'connected',
      'disconnected',
      'connection error',
      'reconnect limit reached',
    ];
    this.statusPill.dataset.state = known.includes(key) ? key : 'connecting';
  }

  /** Frames per second over a one-second window, refreshed on each frame. */
  updateFps() {
    if (!this.fpsBadge) return;
    const now = performance.now();
    this.frameTimes.push(now);
    // Keep a second's worth, and no more: an unbounded array here is a slow
    // leak on a page left open overnight.
    while (this.frameTimes.length && now - this.frameTimes[0] > 1000) {
      this.frameTimes.shift();
    }
    const span = this.frameTimes.length > 1 ? now - this.frameTimes[0] : 0;
    const fps = span > 0 ? ((this.frameTimes.length - 1) * 1000) / span : 0;
    this.fpsBadge.textContent = `${fps.toFixed(0)} fps`;
  }

  /** Which grid is painted, in the header badge. */
  updateModeBadge() {
    if (!this.modeBadge || !this.renderer) return;
    const mode = this.renderer.mapMode;
    this.modeBadge.dataset.mode = mode;
    this.modeBadge.textContent = mode;
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
    this.updateFps();
    this.updateModeBadge();
    this.updateSidebar();
    // Chrome first: it sets this.demoMode, which the panel body reads. The other
    // way round shows the local-install wording for one frame on every update.
    this.updateDemoBanner(data);
    this.updateDemoChrome(data);
    this.updateMeasuredPanel();
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
  /**
   * M cycles model <-> measured. Falls back to the model grid when nothing has
   * been ingested, and says so rather than showing an empty map.
   */
  cycleMapMode() {
    const measured = this.currentData && this.currentData.measured;
    const next = this.renderer.mapMode === 'measured' ? 'model' : 'measured';
    if (next === 'measured' && !measured) {
      this.renderer.mapMode = 'model';
      this.measuredMessage(
        'No readings yet - import a CSV or POST to /api/readings, then press M'
      );
      this.render();
      return;
    }
    this.renderer.mapMode = next;
    this.render();
    this.updateModeBadge();
    this.updateMeasuredPanel();
  }

  /** The measured-count / mode line in the sidebar. */
  updateMeasuredPanel() {
    const panel = document.getElementById('measuredPanel');
    if (!panel) return;
    const measured = this.currentData && this.currentData.measured;
    const mode = this.renderer.mapMode;

    if (!measured) {
      // Outside a demo the hint tells you how to add readings. In a demo they
      // cannot be added and the survey is preloaded, so say that instead of
      // offering a control that is not there.
      const hint = this.demoMode
        ? '<div class="hint">A sample survey loads with the demo.</div>'
        : '<div class="hint">Import a CSV or POST to /api/readings, then press M.</div>';
      panel.innerHTML =
        `<div class="stat-row"><span>Readings</span><span>none</span></div>` +
        hint;
      return;
    }
    const gaps = measured.grid.filter((c) => c.hasData === false).length;
    const rmse = measured.rmseDb;
    panel.innerHTML =
      `<div class="stat-row"><span>Readings</span><span>${measured.count}</span></div>` +
      (this.demoMode
        ? '<div class="hint">Bundled sample survey, fixed for the demo.</div>'
        : '') +
      `<div class="stat-row"><span>Map layer</span><span>${
        mode === 'measured' ? 'measured' : 'model'
      } (M)</span></div>` +
      // RMSE is against the model currently configured, so it moves when the
      // sliders move. "n/a" rather than 0 when there is nothing to compare:
      // zero would read as a perfect match.
      `<div class="stat-row"><span>Model vs measured</span><span>${
        rmse === null || rmse === undefined ? 'n/a' : `${rmse} dB RMSE`
      }</span></div>` +
      `<div class="stat-row"><span>Cells with data</span><span>${
        measured.grid.length - gaps
      }/${measured.grid.length}</span></div>` +
      (gaps
        ? `<div class="hint">${gaps} hatched cells have no sample within ${measured.maxDistance} m.</div>`
        : '') +
      (measured.dropped
        ? `<div class="hint">${measured.dropped} older readings dropped by the 5000-point limit.</div>`
        : '');
  }

  /**
   * Say something in the Measured panel.
   *
   * The panel, not the console: Logger.warn writes to the developer console,
   * which the person clicking "Import readings CSV" never has open. A failed
   * import that reports itself only to devtools looks like nothing happened.
   */
  measuredMessage(text) {
    const panel = document.getElementById('measuredPanel');
    if (panel)
      panel.insertAdjacentHTML('beforeend', `<div class="hint">${text}</div>`);
    Logger.warn(text);
  }

  /**
   * Read a local CSV and hand it to the server.
   *
   * The file is read here and posted as text: the browser never parses it, so
   * the server's validation and its 400 messages are the only path, and the
   * file picker cannot disagree with curl about what is acceptable.
   */
  async importCsvFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const response = await fetch('/api/import/readings.csv', {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: text,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.measuredMessage(`Import failed: ${body.error || response.status}`);
        return;
      }
      this.measuredMessage(
        `Imported ${body.imported} readings - press M to view`
      );
      this.renderer.mapMode = 'measured';
      this.render();
      this.updateMeasuredPanel();
    } catch (err) {
      this.measuredMessage(`Import failed: ${err.message}`);
    }
  }

  /** Wire the measured-data controls. */
  initMeasuredControls() {
    const pick = document.getElementById('csvPicker');
    const button = document.getElementById('importCsv');
    const clear = document.getElementById('clearReadings');
    if (button && pick) button.addEventListener('click', () => pick.click());
    if (pick)
      pick.addEventListener('change', (e) =>
        this.importCsvFile(e.target.files[0])
      );
    if (clear)
      clear.addEventListener('click', () => {
        this.send({ type: 'clearReadings' });
        this.renderer.mapMode = 'model';
        this.render();
        this.updateMeasuredPanel();
      });
  }

  /**
   * Say, plainly, that this is a shared room.
   *
   * A visitor who drags a transmitter and sees nothing move, or sees someone
   * else's layout appear, needs to know why. The banner is on the server's
   * frame rather than baked into the page, so the same build is correct whether
   * it is running as a demo or not.
   */
  updateDemoBanner(data) {
    const banner = document.getElementById('demoBanner');
    if (!banner) return;
    // The wording stays in index.html so the notice reads correctly even
    // before this first frame arrives; here it is only shown or hidden.
    banner.hidden = !(data && data.demo);
  }

  /**
   * Match the Measured panel to what it is actually showing.
   *
   * In a demo the readings are the bundled sample survey, not anybody's, so
   * the heading says so and the import control goes away - ingest answers 403
   * there, so the button could only ever produce an error. Both driven from the
   * server's frame flag rather than baked into the page, so one build is right
   * either way.
   */
  updateDemoChrome(data) {
    const demo = Boolean(data && data.demo);
    const heading = document.getElementById('measuredHeading');
    if (heading) {
      heading.textContent = demo ? 'Sample survey (demo data)' : 'Measured';
    }
    const importControl = document.getElementById('csvImportControl');
    if (importControl) {
      // The button as well as the wrapper. Hiding only the wrapper left the
      // button laid out inside .export-buttons - measured in a real browser,
      // not assumed. A control that looks clickable and can only 403 is worse
      // than no control.
      importControl.hidden = demo;
      // The picker is hidden in the markup already; setting it again keeps the
      // two states in one place rather than split between HTML and JS.
      const picker = document.getElementById('csvPicker');
      if (picker) picker.hidden = demo;
      const button = document.getElementById('importCsv');
      if (button) button.hidden = demo;
    }
    // The empty-state hint tells a local user how to add readings. In a demo
    // they cannot, and the panel is never empty anyway.
    this.demoMode = demo;
  }

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
