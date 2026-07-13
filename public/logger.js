class Logger {
  static info(message, data) {
    console.log(`[INFO] ${message}`, data || '');
  }

  static error(message, data) {
    console.error(`[ERROR] ${message}`, data || '');
  }

  static warn(message, data) {
    console.warn(`[WARN] ${message}`, data || '');
  }
}

window.addEventListener('error', (event) => {
  Logger.error('Uncaught error', event.message);
});
