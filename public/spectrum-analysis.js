class SpectrumAnalyzer {
  constructor() {
    this.history = [];
    this.maxHistory = 50;
  }

  analyze(heatmap) {
    const rssiValues = heatmap.map(p => p.rssi);
    
    const bins = {
      veryWeak: rssiValues.filter(r => r < -80).length,
      weak: rssiValues.filter(r => r >= -80 && r < -60).length,
      moderate: rssiValues.filter(r => r >= -60 && r < -40).length,
      strong: rssiValues.filter(r => r >= -40 && r < -20).length,
      veryStrong: rssiValues.filter(r => r >= -20).length
    };

    this.history.push({
      timestamp: Date.now(),
      distribution: bins,
      dominantBand: Object.keys(bins).reduce((a, b) => 
        bins[a] > bins[b] ? a : b
      )
    });

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    return bins;
  }

  getDistribution() {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1].distribution;
  }

  generateReport() {
    const latest = this.history[this.history.length - 1];
    const dist = latest.distribution;
    const total = Object.values(dist).reduce((a, b) => a + b);

    return {
      coverage: ((dist.strong + dist.veryStrong) / total * 100).toFixed(1),
      deadZones: ((dist.veryWeak) / total * 100).toFixed(1),
      dominantBand: latest.dominantBand,
      distribution: dist
    };
  }
}

const spectrumAnalyzer = new SpectrumAnalyzer();
