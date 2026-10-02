/**
 * Theme: dark by default, light on request, remembered.
 *
 * Loaded synchronously from <head> so the stored theme is applied before the
 * first paint. A deferred script here would be correct and would also flash the
 * wrong background on every load, which is the thing a theme toggle exists to
 * prevent.
 *
 * Every storage access is wrapped. localStorage throws outright in Firefox
 * private mode and when a site's cookies are blocked, and a theme preference is
 * never worth breaking the page over.
 */
class ThemeToggle {
  static STORAGE_KEY = 'spectrum-mapper-theme';
  static THEMES = ['dark', 'light'];

  /** @returns {'dark'|'light'} the theme in effect right now */
  static current() {
    const attr = document.documentElement.getAttribute('data-theme');
    return attr === 'light' ? 'light' : 'dark';
  }

  static read() {
    try {
      const stored = window.localStorage.getItem(ThemeToggle.STORAGE_KEY);
      return ThemeToggle.THEMES.includes(stored) ? stored : null;
    } catch {
      // Blocked or unavailable storage: fall back to the OS preference, which
      // needs no permission.
      return null;
    }
  }

  static write(theme) {
    try {
      window.localStorage.setItem(ThemeToggle.STORAGE_KEY, theme);
      return true;
    } catch {
      return false;
    }
  }

  /** The OS preference, or null if it cannot be read or states no preference. */
  static systemPrefersLight() {
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches;
    } catch {
      return null;
    }
  }

  /**
   * @param {'dark'|'light'} theme
   * @param {boolean} [persist] false for the initial apply, so a visit with no
   *   stored preference does not immediately write one and make the OS setting
   *   sticky-off after the user changes it at the OS level.
   */
  static apply(theme, persist = true) {
    const next = ThemeToggle.THEMES.includes(theme) ? theme : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    if (persist) ThemeToggle.write(next);

    const button = document.getElementById('themeToggle');
    if (button) {
      const other = next === 'dark' ? 'light' : 'dark';
      button.setAttribute('aria-label', `Switch to ${other} theme`);
      button.setAttribute('aria-pressed', String(next === 'light'));
      const path = document.getElementById('themeGlyphPath');
      // Paths, not characters. The sun is a disc with rays; the moon is a disc
      // with a bite taken out of it, drawn as an arc so it needs one fill rule
      // and no mask.
      if (path) {
        path.setAttribute(
          'd',
          next === 'dark'
            ? 'M13.5 9.6A6 6 0 0 1 6.4 2.5a6 6 0 1 0 7.1 7.1z'
            : 'M8 3.2v1.6M8 11.2v1.6M3.2 8h1.6M11.2 8h1.6M4.6 4.6l1.2 1.2M10.2 10.2l1.2 1.2M11.4 4.6l-1.2 1.2M5.8 10.2l-1.2 1.2M8 5.8A2.2 2.2 0 1 0 8 10.2 2.2 2.2 0 1 0 8 5.8z'
        );
      }
    }
    return next;
  }

  static init() {
    // Apply now, while <head> is still parsing: the attribute has to be on
    // <html> before the first paint or the page flashes the wrong background.
    const stored = ThemeToggle.read();
    if (stored) {
      ThemeToggle.apply(stored, false);
    } else {
      const prefersLight = ThemeToggle.systemPrefersLight();
      ThemeToggle.apply(prefersLight ? 'light' : 'dark', false);
    }

    // But the toggle button is in <body>, which does not exist yet. Wiring the
    // click here silently did nothing - init ran, found no button, returned, and
    // the button stayed inert. The browser harness caught it: clicking the
    // toggle changed nothing and nothing was persisted.
    ThemeToggle.wire();
  }

  /** Attach the toggle, once the button exists. */
  static wire() {
    const attach = () => {
      const button = document.getElementById('themeToggle');
      if (!button) return;
      // apply() refreshes the label and glyph, which the early call above could
      // not do for the same reason.
      ThemeToggle.apply(ThemeToggle.current(), false);
      button.addEventListener('click', () => {
        ThemeToggle.apply(ThemeToggle.current() === 'dark' ? 'light' : 'dark');
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attach, { once: true });
    } else {
      attach();
    }
  }
}

// Applied immediately, before body renders.
ThemeToggle.init();
