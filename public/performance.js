// Renamed from `Performance`: a top-level `class Performance` in a classic
// script shadows the browser's built-in Performance interface for every other
// script on the page. The name below describes what it actually does.
class Throttle {
  /** Trailing-edge debounce: fire `wait` ms after the last call. */
  static debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }
}
