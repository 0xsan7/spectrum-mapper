class KeyboardShortcuts {
  static init() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        document.getElementById('pauseBtn').click();
      }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        document.getElementById('resetBtn').click();
      }
    });
  }
}

window.addEventListener('load', () => KeyboardShortcuts.init());
