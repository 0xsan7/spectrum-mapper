/**
 * Sidebar controls: live model sliders, wall list, transport buttons.
 *
 * Slider values are sent to the server, which owns the model. The server
 * echoes them back in every frame, so the UI is only ever reflecting server
 * state - a dropped message self-corrects instead of leaving the slider lying.
 */
class Controls {
  constructor(dashboard) {
    this.dashboard = dashboard;
    this.container = document.getElementById('sliders');
    this.sliders = {};
    this.buildSliders();
    this.buildWallList();
    this.buildTransport();
  }

  /**
   * Sliders are built from the server's `limits` map so the UI can never
   * offer a value the server will reject.
   */
  buildSliders() {
    const limits = this.dashboard.currentData?.limits;
    if (!limits) return;

    const LABELS = {
      exponent: { label: 'Path loss exponent', unit: '' },
      frequency: { label: 'Frequency', unit: 'MHz' },
      noise: { label: 'Noise / fading', unit: 'dB' },
    };

    this.container.innerHTML = '';
    // `paused` lives in limits because the server accepts it as a parameter,
    // but it is a transport flag, not a model input: showing it as a "0 dB"
    // slider would be nonsense. It has a button instead.
    Object.entries(limits)
      .filter(([key]) => LABELS[key])
      .forEach(([key, limit]) => {
        const meta = LABELS[key];
        const current = this.dashboard.currentData.params[key];

        const row = document.createElement('div');
        row.className = 'slider-row';

        const label = document.createElement('label');
        label.textContent = meta.label;
        label.htmlFor = `slider-${key}`;

        const output = document.createElement('output');
        output.id = `value-${key}`;
        output.textContent = this.format(key, current);

        const input = document.createElement('input');
        input.type = 'range';
        input.id = `slider-${key}`;
        input.min = limit.min;
        input.max = limit.max;
        input.step = limit.step;
        input.value = current;

        // Throttled: a slider drag fires dozens of events, and every one would
        // otherwise trigger a full 300-cell recompute on the server.
        input.addEventListener(
          'input',
          Throttle.debounce(() => {
            const value = Number(input.value);
            output.textContent = this.format(key, value);
            this.dashboard.send({ type: 'setParam', key, value });
          }, 80)
        );

        row.append(label, output, input);
        this.container.appendChild(row);
        this.sliders[key] = { input, output };
      });
  }

  format(key, value) {
    if (key === 'frequency') return `${Math.round(value)} MHz`;
    if (key === 'exponent') return Number(value).toFixed(1);
    return `${value} dB`;
  }

  /** Reflect the server's echo back into the sliders. */
  syncFromParams(params) {
    Object.entries(this.sliders).forEach(([key, { input, output }]) => {
      if (params[key] === undefined) return;
      if (Number(input.value) !== Number(params[key])) {
        input.value = params[key];
      }
      output.textContent = this.format(key, params[key]);
    });
  }

  buildWallList() {
    const list = document.getElementById('wallsList');
    const walls = this.dashboard.currentData?.walls || [];

    if (walls.length === 0) {
      list.innerHTML =
        '<div class="hint">No walls. Press W, then drag on the map.</div>';
      return;
    }

    list.innerHTML = '';
    walls.forEach((wall, index) => {
      const row = document.createElement('div');
      row.className = 'wall-row';

      const label = document.createElement('span');
      label.textContent = `#${index} — ${wall.attenuation} dB ${wall.material}`;

      const remove = document.createElement('button');
      remove.textContent = 'x';
      remove.title = 'Remove this wall';
      remove.addEventListener('click', () => {
        this.dashboard.send({ type: 'removeWall', index });
      });

      row.append(label, remove);
      list.appendChild(row);
    });
  }

  buildTransport() {
    const pauseBtn = document.getElementById('pauseBtn');
    const resetBtn = document.getElementById('resetBtn');

    pauseBtn.addEventListener('click', () => {
      const paused = !this.dashboard.isPaused;
      this.dashboard.send({
        type: 'setParam',
        key: 'paused',
        value: paused ? 1 : 0,
      });
    });

    resetBtn.addEventListener('click', () => {
      this.dashboard.send({ type: 'reset' });
    });

    const wallSlider = document.getElementById('wallAttenuation');
    const wallValue = document.getElementById('wallAttenuationValue');
    wallSlider.addEventListener('input', () => {
      wallValue.textContent = `${wallSlider.value} dB`;
    });
  }

  update(data) {
    this.syncFromParams(data.params || {});
    this.buildWallList();
    const pauseBtn = document.getElementById('pauseBtn');
    pauseBtn.textContent = data.params?.paused ? 'Resume' : 'Pause';
  }
}
