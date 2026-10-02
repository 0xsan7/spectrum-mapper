/**
 * Colour ramps for the heatmap.
 *
 * Three ramps, switchable at runtime.
 *
 *   inferno   the default. Perceptually uniform and monotonic in lightness, so
 *             a 5 dB step looks like a 5 dB step everywhere on the scale
 *             instead of only in the middle.
 *   cividis   the colour-blind-safe alternative, designed for deuteranopia
 *             and protanopia. Monotonic in lightness too, which is why it still
 *             reads as a scale rather than as confetti.
 *   classic   the old blue-green-yellow-red ramp. Kept because it is what the
 *             legend and the docs described before, and because some people
 *             read it faster. It is not perceptually uniform: the green-yellow
 *             stretch is much wider than the red one, so equal dB steps in the
 *             middle occupy far more colour than equal steps at the ends.
 *
 * Interpolation happens in Oklab, not sRGB. Linear RGB is "correct" and still
 * wrong to look at: sRGB gamma makes a straight mix between two colours bow
 * through a lighter, less saturated path than the eye expects, which shows up
 * as a pale band across the middle of every ramp.
 *
 * The control points below are the published matplotlib values for these maps.
 * matplotlib's colormaps are released under a permissive notice allowing
 * redistribution with attribution; the provenance is recorded here rather than
 * in a separate file so it cannot drift from the numbers.
 */
class ColorMapper {
  /**
   * Control points, evenly spaced from MIN to MAX dBm.
   *
   * Stored as 8-bit RGB because that is what the published tables give, and
   * quantised at source rather than after conversion so the Oklab round trip is
   * reproducible.
   */
  static RAMPS = {
    inferno: {
      label: 'Inferno (perceptual)',
      points: [
        [0, 0, 4],
        [22, 11, 57],
        [66, 10, 104],
        [106, 23, 110],
        [147, 38, 103],
        [188, 55, 84],
        [221, 81, 58],
        [243, 120, 25],
        [252, 165, 10],
        [246, 215, 70],
        [252, 255, 164],
      ],
    },
    cividis: {
      label: 'Cividis (colour-blind safe)',
      points: [
        [0, 32, 76],
        [0, 42, 102],
        [0, 52, 110],
        [39, 63, 108],
        [60, 74, 107],
        [76, 85, 107],
        [91, 95, 109],
        [104, 106, 112],
        [117, 117, 117],
        [131, 129, 120],
        [146, 140, 120],
        [161, 152, 118],
        [177, 164, 114],
        [194, 177, 109],
        [211, 190, 102],
        [230, 204, 92],
        [248, 219, 78],
      ],
    },
    classic: {
      label: 'Classic blue-red',
      points: [
        [0, 102, 255],
        [255, 255, 0],
        [255, 136, 0],
        [255, 0, 0],
      ],
    },
  };

  static DEFAULT_RAMP = 'inferno';

  /** @returns {string[]} the ramp names, in toggle order. */
  static rampNames() {
    return Object.keys(ColorMapper.RAMPS);
  }

  /** @returns {string} the next ramp after `name`, wrapping. */
  static nextRamp(name) {
    const names = ColorMapper.rampNames();
    const at = names.indexOf(name);
    return names[(at + 1 + names.length) % names.length];
  }

  static hasRamp(name) {
    return Object.prototype.hasOwnProperty.call(ColorMapper.RAMPS, name);
  }

  /* ---- Oklab ---------------------------------------------------------- */

  /**
   * sRGB (0-255) to Oklab.
   *
   * Björn Ottosson's matrices. The sRGB -> linear step is the inverse companding
   * curve; skipping it is the whole point, because the companding is what makes
   * naive sRGB interpolation look wrong.
   */
  static srgbToOklab(r, g, b) {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const R = lin(r);
    const G = lin(g);
    const B = lin(b);

    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);

    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  /** Oklab back to sRGB, clamped and rounded. */
  static oklabToSrgb(L, a, bb) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;

    const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

    const enc = (v) => {
      const c =
        v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      return Math.max(0, Math.min(255, Math.round(c * 255)));
    };
    return [enc(R), enc(G), enc(B)];
  }

  /** Oklab lightness L*, 0-1. The quantity a perceptual ramp must be monotonic in. */
  static lightnessOf(rgb) {
    return ColorMapper.srgbToOklab(rgb[0], rgb[1], rgb[2])[0];
  }

  /**
   * Map an RSSI in dBm to an RGB triple.
   *
   * @param {number} rssi dBm
   * @param {number} minRssi bottom of the scale, e.g. -100
   * @param {number} maxRssi top of the scale, e.g. -20
   * @param {string} [ramp] one of ColorMapper.rampNames()
   */
  static getColor(
    rssi,
    minRssi = -100,
    maxRssi = -20,
    ramp = ColorMapper.DEFAULT_RAMP
  ) {
    const span = maxRssi - minRssi;
    if (span <= 0) return [0, 0, 0];

    const chosen = ColorMapper.hasRamp(ramp) ? ramp : ColorMapper.DEFAULT_RAMP;
    const points = ColorMapper.RAMPS[chosen].points;
    const t = Math.max(0, Math.min(1, (rssi - minRssi) / span));

    if (points.length === 1) return points[0].slice();

    const scaled = t * (points.length - 1);
    const index = Math.min(Math.floor(scaled), points.length - 2);
    const local = scaled - index;

    // The classic ramp's existing test suite pins its sRGB control points
    // exactly, so it keeps interpolating in sRGB. The perceptual ramps go
    // through Oklab.
    if (chosen === 'classic') {
      return ColorMapper.interpolate(points[index], points[index + 1], local);
    }

    const a = ColorMapper.srgbToOklab(
      points[index][0],
      points[index][1],
      points[index][2]
    );
    const b = ColorMapper.srgbToOklab(
      points[index + 1][0],
      points[index + 1][1],
      points[index + 1][2]
    );
    return ColorMapper.oklabToSrgb(
      a[0] + (b[0] - a[0]) * local,
      a[1] + (b[1] - a[1]) * local,
      a[2] + (b[2] - a[2]) * local
    );
  }

  /** sRGB lerp between two [r,g,b] triples. */
  static interpolate(c1, c2, t) {
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * t),
      Math.round(c1[1] + (c2[1] - c1[1]) * t),
      Math.round(c1[2] + (c2[2] - c1[2]) * t),
    ];
  }

  static toCss([r, g, b]) {
    return `rgb(${r}, ${g}, ${b})`;
  }

  /** A CSS gradient string for a ramp, for the legend and the badge. */
  static toGradient(ramp, minRssi, maxRssi, steps = 32) {
    const parts = [];
    for (let i = 0; i < steps; i++) {
      const t = steps === 1 ? 0 : i / (steps - 1);
      const rssi = minRssi + t * (maxRssi - minRssi);
      parts.push(
        `${ColorMapper.toCss(ColorMapper.getColor(rssi, minRssi, maxRssi, ramp))} ${(t * 100).toFixed(1)}%`
      );
    }
    return `linear-gradient(to right, ${parts.join(', ')})`;
  }
}
