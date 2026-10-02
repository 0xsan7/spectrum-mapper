/**
 * Sidebar tabs.
 *
 * The sidebar is eleven panels in one long scroll, which at 1440x800 means the
 * export buttons are below the fold and nobody finds them. Grouped into five
 * tabs it fits without scrolling on a laptop and still reads top to bottom.
 *
 * Follows the WAI-ARIA tabs pattern:
 *   - the tablist owns arrow-key navigation, Home and End
 *   - a roving tabindex: one tab is tabbable, the rest are -1, so Tab moves
 *     out of the tablist into the panel rather than through every tab
 *   - the panel is focusable and labelled by its tab
 *
 * Selecting a tab dispatches 'sidebar:tabshown' rather than poking the chart
 * directly. The RSSI chart sizes itself from its container, and a panel that
 * was `hidden` has no width to measure - so anything that needs to re-measure
 * on becoming visible listens for this instead of guessing.
 */
class SidebarTabs {
  /**
   * @param {Element} root the element carrying the tablist
   * @param {{onShow?: Function}} [options]
   */
  constructor(root, options = {}) {
    this.root = root;
    this.onShow = options.onShow || null;
    this.tabs = Array.from(root.querySelectorAll('[role="tab"]'));
    this.panels = this.tabs
      .map((tab) => document.getElementById(tab.getAttribute('aria-controls')))
      .filter(Boolean);

    this.tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => this.select(i, { focus: false }));
      tab.addEventListener('keydown', (event) => this.onKeyDown(event, i));
    });

    // The initially selected tab is whatever the markup marked, so the server-
    // rendered page and the script agree without a second source of truth.
    const initial = this.tabs.findIndex(
      (t) => t.getAttribute('aria-selected') === 'true'
    );
    this.select(initial >= 0 ? initial : 0, { focus: false, silent: true });
  }

  /** The tab currently shown. */
  get activeIndex() {
    return this.tabs.findIndex(
      (t) => t.getAttribute('aria-selected') === 'true'
    );
  }

  select(index, { focus = true, silent = false } = {}) {
    const i = Math.max(0, Math.min(index, this.tabs.length - 1));
    this.tabs.forEach((tab, n) => {
      const on = n === i;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      // Roving tabindex: only the selected tab is in the tab order.
      tab.setAttribute('tabindex', on ? '0' : '-1');
      if (this.panels[n]) {
        if (on) this.panels[n].removeAttribute('hidden');
        else this.panels[n].setAttribute('hidden', '');
      }
    });
    if (focus) this.tabs[i].focus();
    if (!silent && this.onShow) this.onShow(i, this.tabs[i]);
    return i;
  }

  onKeyDown(event, index) {
    const last = this.tabs.length - 1;
    let next = null;
    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    // Only the arrows, Home and End belong to the tablist. Enter and Space are
    // left to the button, which already activates on click.
    event.preventDefault();
    this.select(next);
  }
}
