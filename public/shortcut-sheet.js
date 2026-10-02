/**
 * The shortcut sheet, behind `?`.
 *
 * The shortcuts were implemented but only documented in the README and in a
 * hint at the bottom of the sidebar, which is below the fold at 1440x800. A
 * keyboard-only user had no way to discover them from the page.
 *
 * The list is declared once, here, and the same table is used to generate the
 * sheet and to bind the keys. That is the point: a sheet that can drift from
 * the bindings is worse than no sheet, because it is confidently wrong.
 */
/**
 * Every shortcut, with what it does and the key it is bound to.
 *
 * `available` lets a mode hide a binding that cannot work there, so the sheet
 * never advertises a key that does nothing.
 *
 * A module-level constant rather than a static getter, so the array has one
 * identity: a getter handed out a fresh array of fresh objects on every
 * access, which makes the table impossible to extend from outside and turns
 * any mutation into a silent no-op.
 *
 * @type {ReadonlyArray<{keys: readonly string[], label: string, run: ((dashboard: any) => void)|null, available?: (dashboard: any) => boolean}>}
 */
const SHORTCUT_BINDINGS = Object.freeze(
  [
    {
      keys: ['Space'],
      label: 'Pause or resume the simulation',
      run: () => document.getElementById('pauseBtn').click(),
    },
    {
      keys: ['R'],
      label: 'Reset the scene',
      run: () => document.getElementById('resetBtn').click(),
    },
    {
      keys: ['W'],
      label: 'Toggle wall-drawing mode',
      run: (d) => {
        d.interaction.setMode(d.interaction.mode === 'wall' ? 'move' : 'wall');
        d.setStatusHint();
      },
    },
    {
      keys: ['M'],
      label: 'Switch the map: model or measured',
      run: (d) => {
        d.interaction.setMode('move');
        d.cycleMapMode();
        d.setStatusHint();
      },
    },
    {
      keys: ['K'],
      label: 'Cycle the colour ramp',
      run: (d) => d.cycleRamp(),
    },
    {
      keys: ['C'],
      label: 'Clear all walls',
      run: (d) => d.send({ type: 'clearWalls' }),
    },
    {
      keys: ['Tab'],
      label: 'Move between the map, the tabs, and the sidebar panels',
      // Native browser behaviour, listed so it is discoverable. Not bound here.
      run: null,
    },
    {
      keys: ['Left', 'Right'],
      label: 'Move between sidebar tabs, once the tab strip has focus',
      run: null,
    },
    {
      keys: ['?'],
      label: 'Open or close this list',
      run: (d) => {
        if (d.sheet) d.sheet.toggle(d);
      },
    },
  ].map((b) => Object.freeze({ ...b, keys: Object.freeze([...b.keys]) }))
);

class ShortcutSheet {
  /** @see SHORTCUT_BINDINGS */
  static BINDINGS = SHORTCUT_BINDINGS;

  /**
   * @param {Element} root the dialog element
   * @param {{listEl?: Element}} [options]
   */
  constructor(root, options = {}) {
    this.root = root;
    this.listEl = options.listEl || root.querySelector('[data-shortcut-list]');
    this.open = false;
    this.lastFocused = null;

    root.addEventListener('click', (event) => {
      // Clicking the backdrop closes; clicking the sheet does not.
      if (event.target === root) this.close();
    });
  }

  /** The bindings that apply right now. */
  available(dashboard) {
    return ShortcutSheet.BINDINGS.filter(
      (b) => !b.available || b.available(dashboard)
    );
  }

  render(dashboard) {
    if (!this.listEl) return 0;
    this.listEl.innerHTML = '';
    const rows = this.available(dashboard);
    for (const binding of rows) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';
      const keys = document.createElement('kbd');
      keys.className = 'shortcut-keys';
      keys.textContent = binding.keys.join(' / ');
      const label = document.createElement('span');
      label.className = 'shortcut-label';
      label.textContent = binding.label;
      row.append(keys, label);
      this.listEl.appendChild(row);
    }
    return rows.length;
  }

  show(dashboard) {
    this.render(dashboard);
    this.lastFocused = document.activeElement;
    this.root.removeAttribute('hidden');
    this.open = true;
    // Focus the close button, not the dialog: a keyboard user needs a way out
    // that is reachable in one keypress.
    const close = this.root.querySelector('[data-shortcut-close]');
    if (close) close.focus();
  }

  close() {
    if (!this.open) return false;
    this.root.setAttribute('hidden', '');
    this.open = false;
    if (this.lastFocused && this.lastFocused.focus) this.lastFocused.focus();
    this.lastFocused = null;
    return true;
  }

  toggle(dashboard) {
    if (this.open) this.close();
    else this.show(dashboard);
    return this.open;
  }
}
