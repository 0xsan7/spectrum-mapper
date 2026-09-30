const originalRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  originalRender.call(this);
  if (this.currentData) {
    updateSpectrumPanel(this.currentData.heatmap);
  }
};
