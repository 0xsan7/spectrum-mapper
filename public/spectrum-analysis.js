/**
 * Coverage statistics over the RSSI grid.
 *
 * The previous version reported a "dominant band" by naming the largest of
 * five arbitrary buckets, which is a label on noise rather than a measurement,
 * and sized the distribution bars as count/3, which overflows the container
 * whenever a bucket exceeds 3% of the room. Both are replaced with the two
 * numbers that mean something: the share of the room above the usable-signal
 * threshold, and the share in the dead zone.
 */
class SpectrumAnalyzer {
  /**
   * Bucket boundaries in dBm, weakest first. These are the conventional
   * Wi-Fi survey thresholds: below -80 dBm a link is unusable, and -50 dBm is
   * a good indoor signal.
   */
  static get BANDS() {
    return [
      { label: 'unusable', max: -80, color: '#0066ff' },
      { label: 'weak', max: -70, color: '#00c8ff' },
      { label: 'fair', max: -60, color: '#00ff88' },
      { label: 'good', max: -50, color: '#ffff00' },
      { label: 'excellent', max: Infinity, color: '#ff8800' },
    ];
  }

  /** Bands that count as usable coverage. */
  static get STRONG_BANDS() {
    return ['good', 'excellent'];
  }

  static get DEAD_BAND() {
    return 'unusable';
  }

  analyze(heatmap) {
    const values = heatmap.map((p) => p.rssi);
    const total = values.length || 1;

    const bars = SpectrumAnalyzer.BANDS.map((band, index) => {
      const previousMax =
        index === 0 ? -Infinity : SpectrumAnalyzer.BANDS[index - 1].max;
      const count = values.filter(
        (r) => r > previousMax && r <= band.max
      ).length;
      return {
        label: band.label,
        color: band.color,
        count,
        // Share of the room, so the bar widths always total 100%.
        percent: (count / total) * 100,
      };
    });

    const strong = bars
      .filter((b) => SpectrumAnalyzer.STRONG_BANDS.includes(b.label))
      .reduce((sum, b) => sum + b.count, 0);
    const dead = bars.find((b) => b.label === SpectrumAnalyzer.DEAD_BAND).count;

    return {
      bars,
      coverage: ((strong / total) * 100).toFixed(1),
      deadZones: ((dead / total) * 100).toFixed(1),
      total,
    };
  }
}

const spectrumAnalyzer = new SpectrumAnalyzer();
