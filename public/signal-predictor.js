class SignalPredictor {
  constructor() {
    this.predictions = [];
  }

  predict(x, y, sources) {
    let totalRSSI = 0;
    sources.forEach((source) => {
      let dist = Math.sqrt(
        Math.pow(x - source.x, 2) + Math.pow(y - source.y, 2)
      );
      if (dist < 0.5) dist = 0.5;
      const pathLoss = 20 * Math.log10(dist) + 20;
      const rssi = source.txPower - pathLoss - (Math.random() - 0.5) * 3;
      totalRSSI += Math.max(rssi, -100);
    });
    return (totalRSSI / sources.length).toFixed(1);
  }

  addPrediction(x, y, rssi) {
    this.predictions.push({ x, y, rssi, timestamp: Date.now() });
    if (this.predictions.length > 10) this.predictions.shift();
  }

  getPredictions() {
    return this.predictions;
  }
}

const signalPredictor = new SignalPredictor();

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('heatmapCanvas');
  if (canvas) {
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 20;
      const y = ((e.clientY - rect.top) / rect.height) * 15;

      const dashboard = window.dashboard;
      if (dashboard && dashboard.currentData) {
        const rssi = signalPredictor.predict(
          x,
          y,
          dashboard.currentData.sources
        );
        signalPredictor.addPrediction(x, y, rssi);
        showPrediction(x, y, rssi);
      }
    });
  }
});

function showPrediction(x, y, rssi) {
  const msg = `Prediction at (${x.toFixed(1)}, ${y.toFixed(1)}): ${rssi} dBm`;
  console.log(msg);

  const alert = document.createElement('div');
  alert.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #00d4ff;
    color: #000;
    padding: 12px 16px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    z-index: 9999;
    animation: slideIn 0.3s ease;
  `;
  alert.textContent = msg;
  document.body.appendChild(alert);
  setTimeout(() => alert.remove(), 3000);
}

const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(400px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
`;
document.head.appendChild(style);
