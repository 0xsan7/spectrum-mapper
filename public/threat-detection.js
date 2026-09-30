class ThreatDetector {
  constructor() {
    this.baseline = null;
    this.anomalies = [];
    this.threshold = 15; // dBm deviation
  }

  analyze(data) {
    if (!this.baseline) {
      this.baseline = data.stats.avgRSSI;
      return [];
    }

    const threats = [];
    data.sources.forEach((source) => {
      const deviation = Math.abs(source.txPower - this.baseline);
      if (deviation > this.threshold) {
        threats.push({
          id: source.id,
          name: source.name,
          risk: 'HIGH',
          deviation: deviation.toFixed(1),
          position: [source.x, source.y],
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    });

    this.anomalies = threats;
    return threats;
  }

  getThreats() {
    return this.anomalies;
  }

  displayThreats() {
    const html = this.anomalies
      .map(
        (threat) => `
      <div class="threat-alert">
        <span class="risk-badge">THREAT</span>
        <strong>${threat.name}</strong>
        <div class="threat-meta">Deviation: +${threat.deviation} dBm | ${threat.timestamp}</div>
      </div>
    `
      )
      .join('');

    const threatsPanel = document.getElementById('threatsPanel');
    if (threatsPanel) {
      threatsPanel.innerHTML =
        html || '<div class="no-threats">System clear</div>';
    }
  }
}

const threatDetector = new ThreatDetector();
