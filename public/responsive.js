/**
 * Mobile layout. The sidebar stacks under the map on narrow screens.
 *
 * The previous version used MediaQueryList.addListener, which browsers have
 * removed; addEventListener('change') is the supported API. The layout is
 * also done in CSS now, so this only reports the breakpoint for the UI.
 */
class ResponsiveManager {
  static init(onChange = () => {}) {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const apply = (event) => {
      document.body.classList.toggle('narrow', event.matches);
      onChange(event.matches);
    };
    mediaQuery.addEventListener('change', apply);
    apply(mediaQuery);
    return mediaQuery;
  }

  static get isNarrow() {
    return window.matchMedia('(max-width: 768px)').matches;
  }
}

ResponsiveManager.init(() => {
  if (window.dashboard) window.dashboard.requestRender();
});
