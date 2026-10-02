/**
 * Keyboard shortcuts. Every one of these is implemented; the old README
 * advertised a `?` help key that did not exist.
 *
 *   Space  pause / resume
 *   R      reset the scene
 *   W      toggle wall-drawing mode
 *   C      clear all walls
 *   M      cycle the map: model / measured
 *   K      cycle the colour ramp: inferno / cividis / classic
 */
class KeyboardShortcuts {
  static init() {
    document.addEventListener('keydown', (event) => {
      // Never hijack typing in an input.
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

      switch (event.key.toLowerCase()) {
        case ' ':
          event.preventDefault();
          document.getElementById('pauseBtn').click();
          break;
        case 'r':
          document.getElementById('resetBtn').click();
          break;
        case 'w':
          dashboard.interaction.setMode(
            dashboard.interaction.mode === 'wall' ? 'move' : 'wall'
          );
          dashboard.setStatusHint();
          break;
        case 'm':
          // Cycle the map layer. Leaving wall-drawing mode at the same time is
          // deliberate: M is the escape hatch back to looking at the map, and a
          // cursor left in crosshair makes that surprising.
          dashboard.interaction.setMode('move');
          dashboard.cycleMapMode();
          dashboard.setStatusHint();
          break;
        case 'k':
          // The colour ramp, not R: R is already reset, and a shortcut that
          // does something destructive is a bad neighbour to one that only
          // changes how the map looks.
          dashboard.cycleRamp();
          break;
        case 'c':
          dashboard.send({ type: 'clearWalls' });
          break;
        default:
          break;
      }
    });
  }
}

KeyboardShortcuts.init();
