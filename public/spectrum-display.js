function updateSpectrumPanel(heatmap) {
  const analysis = spectrumAnalyzer.analyze(heatmap);
  const report = spectrumAnalyzer.generateReport();

  const html = `
    <div class="spectrum-stats">
      <div class="spectrum-row">
        <label>Coverage</label>
        <value>${report.coverage}%</value>
      </div>
      <div class="spectrum-row">
        <label>Dead Zones</label>
        <value>${report.deadZones}%</value>
      </div>
      <div class="spectrum-row">
        <label>Dominant Band</label>
        <value>${report.dominantBand.toUpperCase()}</value>
      </div>
    </div>
    <div class="spectrum-distribution">
      <div class="spectrum-bar" style="width: ${analysis.veryWeak / 3}%; background: #0066ff;"></div>
      <div class="spectrum-bar" style="width: ${analysis.weak / 3}%; background: #00ff00;"></div>
      <div class="spectrum-bar" style="width: ${analysis.moderate / 3}%; background: #ffff00;"></div>
      <div class="spectrum-bar" style="width: ${analysis.strong / 3}%; background: #ff8800;"></div>
      <div class="spectrum-bar" style="width: ${analysis.veryStrong / 3}%; background: #ff0000;"></div>
    </div>
  `;

  const panel = document.getElementById('spectrumPanel');
  if (panel) panel.innerHTML = html;
}
