class DataExport {
  static exportJSON(data) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'heatmap-data.json';
    link.click();
  }

  static exportImage() {
    const canvas = document.getElementById('heatmapCanvas');
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `heatmap-${Date.now()}.png`;
    link.click();
  }
}
