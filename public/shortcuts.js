/**
 * Keyboard shortcuts. Every one of these is implemented.
 *
 * The bindings themselves live in ShortcutSheet.BINDINGS, which is also what
 * generates the on-screen sheet behind `?`. Binding them from one table is the
 * only way a help list cannot drift into confidently advertising a key that
 * does something else.
 *
 *   Space  pause / resume          M  cycle the map: model / measured
 *   R      reset the scene         K  cycle the colour ramp
 *   W      toggle wall mode        C  clear all walls
 *   ?      open or close the sheet
 */
class KeyboardShortcuts {
  /** Which binding answers which physical key. Shift is stripped by the caller. */
  static KEY_TO_BINDING = {
    ' ': 'Space',
    r: 'R',
    w: 'W',
    m: 'M',
    k: 'K',
    c: 'C',
    '?': '?',
  };

  static init() {
    document.addEventListener('keydown', (event) => {
      // Never hijack typing in an input, or a key press inside the sheet.
      const tag = event.target.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        event.target.isContentEditable
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const dashboard = window.dashboard;
      if (!dashboard) return;

      // Escape closes the sheet from anywhere inside it.
      if (event.key === 'Escape' && dashboard.sheet && dashboard.sheet.open) {
        event.preventDefault();
        dashboard.sheet.close();
        return;
      }

      const key = KeyboardShortcuts.KEY_TO_BINDING[event.key.toLowerCase()];
      if (!key) return;
      const binding = ShortcutSheet.BINDINGS.find((b) => b.keys.includes(key));
      if (!binding) return;

      // Space is the only one that would otherwise scroll the page.
      if (key === 'Space') event.preventDefault();

      // One path for every binding, including `?`. Handling the sheet key as a
      // special case here would put its behaviour in two places, and the sheet
      // would then list a key this file no longer honours.
      if (binding.available && !binding.available(dashboard)) return;
      if (binding.run) binding.run(dashboard);
    });
  }
}

KeyboardShortcuts.init();
