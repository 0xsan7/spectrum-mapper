class Dashboard {
  constructor() {
    this.canvas = document.getElementById('heatmapCanvas');
    this.renderer = new HeatmapRenderer(this.canvas);
    this.isRunning = true;
    this.currentData = null;

    this.canvas.width = this.canvas.parentElement.clientWidth;
    this.canvas.height = this.canvas.parentElement.clientHeight;

    this.setupWebSocket();
    this.setupControls();
  }

  setupWebSocket() {
    this.wsClient = new WebSocketClient((data) => {
      this.currentData = data;
      if (this.isRunning) this.render();
    });
  }

  render() {
    if (!this.currentData) return;
    this.renderer.render(this.currentData);
    this.updateSidebar();
  }

  updateSidebar() {
    const { sources, receivers, stats } = this.currentData;

    document.getElementById('sourcesList').innerHTML = sources
      .map(
        (s) =>
          `<div class="info-item"><div class="name">${s.name}</div><div class="meta">TX: ${s.txPower} dBm | X: ${s.x}, Y: ${s.y}</div></div>`
      )
      .join('');

    document.getElementById('receiversList').innerHTML = receivers
      .map(
        (r) =>
          `<div class="info-item"><div class="name">${r.id}</div><div class="meta">X: ${r.x}, Y: ${r.y}</div></div>`
      )
      .join('');

    document.getElementById('statsPanel').innerHTML = `
      <div class="stat-row"><label>Max RSSI</label><value>${stats.maxRSSI} dBm</value></div>
      <div class="stat-row"><label>Min RSSI</label><value>${stats.minRSSI} dBm</value></div>
      <div class="stat-row"><label>Avg RSSI</label><value>${stats.avgRSSI} dBm</value></div>
      <div class="stat-row"><label>Hotspots</label><value>${stats.hotspotCount}</value></div>
    `;
  }

  setupControls() {
    document.getElementById('pauseBtn').addEventListener('click', () => {
      this.isRunning = !this.isRunning;
      document.getElementById('pauseBtn').textContent = this.isRunning
        ? 'Pause'
        : 'Resume';
    });

    document.getElementById('resetBtn').addEventListener('click', () => {
      location.reload();
    });
  }
}

window.addEventListener('load', () => new Dashboard());

// Store dashboard instance for signal predictor
window.dashboard = null;
window.addEventListener('load', () => {
  window.dashboard = new Dashboard();
});
