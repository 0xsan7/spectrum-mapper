function updatePredictionPanel() {
  const predictions = signalPredictor.getPredictions();
  const html = predictions.length > 0 
    ? predictions.map(p => `
      <div class="prediction-item">
        <div>(${p.x.toFixed(1)}, ${p.y.toFixed(1)})</div>
        <div style="color: #00d4ff;">${p.rssi} dBm</div>
      </div>
    `).join('')
    : '<div style="color: #666; font-size: 11px;">Click heatmap to predict</div>';
  
  const panel = document.getElementById('predictionPanel');
  if (panel) panel.innerHTML = html;
}

setInterval(updatePredictionPanel, 500);
