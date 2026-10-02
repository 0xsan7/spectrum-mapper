/**
 * Marching squares over an RSSI grid.
 *
 * Returns short line segments in *grid* coordinates, not pixels, so the caller
 * scales them with its own cell size. The grid is a regular lattice indexed
 * column-major: index = x * rows + y, which is the order src/heatmap.js emits.
 *
 * A cell with no measurement is `rssi: null`. It is skipped rather than read as
 * zero, because zero dBm is a very strong signal and drawing a contour through
 * a hole would claim there was one.
 *
 * A value exactly equal to `level` counts as *not above*, so a flat field that
 * sits precisely on the threshold produces nothing rather than tracing the
 * whole grid.
 */
function contourSegments(grid, cols, rows, level) {
  const segments = [];
  if (!Array.isArray(grid) || cols < 2 || rows < 2) return segments;

  const value = (x, y) => {
    const point = grid[x * rows + y];
    if (!point || point.rssi === null || point.rssi === undefined) return null;
    const v = Number(point.rssi);
    return Number.isFinite(v) ? v : null;
  };

  for (let x = 0; x < cols - 1; x++) {
    for (let y = 0; y < rows - 1; y++) {
      const tl = value(x, y);
      const tr = value(x + 1, y);
      const bl = value(x, y + 1);
      const br = value(x + 1, y + 1);
      if (tl === null || tr === null || bl === null || br === null) continue;

      // A cell with no values above the level cannot contain a crossing. This
      // is also the fast path: most of a room fails it.
      if (tl <= level && tr <= level && bl <= level && br <= level) continue;

      // Where the level cuts each edge, as a fraction from that edge's origin.
      const along = (a, b) => {
        const denom = b - a;
        // Equal endpoints straddle nothing; clamped so a flat edge cannot
        // divide by zero.
        return denom === 0 ? 0.5 : (level - a) / denom;
      };
      const top = [x + along(tl, tr), y];
      const right = [x + 1, y + along(tr, br)];
      const bottom = [x + along(bl, br), y + 1];
      const left = [x, y + along(tl, bl)];

      // Four-bit case index: a bit is set when that corner is above the level.
      const index =
        (tl > level ? 8 : 0) |
        (tr > level ? 4 : 0) |
        (br > level ? 2 : 0) |
        (bl > level ? 1 : 0);

      // Saddle cases (5 and 10) are ambiguous; resolved the cheap way, which is
      // fine for a display contour and avoids the centre-average rule.
      switch (index) {
        case 1:
        case 14:
          segments.push([left, bottom]);
          break;
        case 2:
        case 13:
          segments.push([bottom, right]);
          break;
        case 3:
        case 12:
          segments.push([left, right]);
          break;
        case 4:
        case 11:
          segments.push([top, right]);
          break;
        case 6:
        case 9:
          segments.push([top, bottom]);
          break;
        case 7:
        case 8:
          segments.push([left, top]);
          break;
        case 5:
        case 10: {
          /* Saddles. The two above-level corners are diagonal, so there are two
             valid pairings and only one is right. The cell's centre decides:
             if it is above the level the two above-level corners are joined
             through it, and the contour separates the two below-level corners
             instead; if it is below, the join is the other way.
             Pairing without this reads the corner above the level as one solid
             mass and drops a line, or draws a crossing where there is none. */
          const centre = (tl + tr + bl + br) / 4;
          if (centre > level) {
            if (index === 5) segments.push([left, top], [bottom, right]);
            else segments.push([top, right], [left, bottom]);
          } else {
            if (index === 5) segments.push([top, right], [left, bottom]);
            else segments.push([left, top], [bottom, right]);
          }
          break;
        }
        default:
          // 0 and 15: entirely below or entirely above.
          break;
      }
    }
  }
  return segments;
}

/** The RSSI levels drawn as contour lines on the map. */
const CONTOUR_LEVELS = [-50, -70, -85];

class HeatmapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    /**
     * 'model' or 'measured'. Set from the M key. Measured falls back to the
     * model grid automatically when nothing has been ingested, so the mode
     * never leaves the map blank with no explanation.
     */
    this.mapMode = 'model';
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.cellAlpha = 200;
    // Room dimensions in metres. Set from each frame, and defaulted here so a
    // pointer event before the first frame cannot divide by undefined.
    this.roomWidth = 20;
    this.roomHeight = 15;

    /**
     * The active colour ramp, and which grid is painted. Both are read by the
     * renderer each frame rather than baked in, so the toggle is immediate and
     * the legend can be built from the same ramp.
     */
    this.ramp = ColorMapper.DEFAULT_RAMP;
    this.showContours = true;

    /**
     * The 1 dB grid, painted once per frame into a tiny offscreen canvas and
     * then scaled up.
     *
     * The room is 20x15 samples and the canvas is over a thousand pixels wide,
     * so drawing one fillRect per cell meant 300 rects for 300 cells and a
     * visible staircase at every boundary. Painting the lattice at its own
     * resolution and letting the compositor's bilinear filter stretch it is a
     * single drawImage and gives a genuinely smooth field.
     */
    this.gridCanvas = document.createElement('canvas');
    this.gridCtx = this.gridCanvas.getContext('2d');
    this.gridImage = null;

    /**
     * Honour prefers-reduced-motion for the pulsing rings.
     *
     * Read once and re-read on change: the user can flip the OS setting while
     * the page is open, and a pulse that keeps going after that is the exact
     * thing the preference is asking us to stop.
     */
    this.reduceMotion = false;
    this.motionQuery =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    this.readMotionPreference();
    if (this.motionQuery) {
      const onChange = () => this.readMotionPreference();
      if (this.motionQuery.addEventListener) {
        this.motionQuery.addEventListener('change', onChange);
      } else if (this.motionQuery.addListener) {
        this.motionQuery.addListener(onChange);
      }
    }

    // A single shared start time, so every pulsing ring is in phase instead of
    // each one using its own clock and drifting apart.
    this.phaseStart = 0;
    /** Segments drawn by the last drawContours call, for verification. */
    this.lastContoursDrawn = 0;
  }

  readMotionPreference() {
    this.reduceMotion = Boolean(this.motionQuery && this.motionQuery.matches);
  }

  /** 0-1 sawtooth over ~2s, frozen when reduced motion is requested. */
  pulsePhase() {
    if (this.reduceMotion) return 0.5;
    if (!this.phaseStart) this.phaseStart = performance.now();
    return ((performance.now() - this.phaseStart) % 2000) / 2000;
  }

  /** Cycle to the next colour ramp. @returns {string} the new ramp. */
  cycleRamp() {
    this.ramp = ColorMapper.nextRamp(this.ramp);
    return this.ramp;
  }

  /** Match the backing store to the CSS size so the map is not blurry. */
  resize() {
    const wrapper = this.canvas.parentElement;
    const width = wrapper.clientWidth;
    const height = Math.round((width * 3) / 4); // 20x15 m room
    if (
      width > 0 &&
      (this.canvas.width !== width || this.canvas.height !== height)
    ) {
      this.canvas.width = width;
      this.canvas.height = height;
      return true;
    }
    return false;
  }

  render(data) {
    if (!data || !data.heatmap) return;
    this.resize();
    this.roomWidth = data.roomWidth;
    this.roomHeight = data.roomHeight;

    const { heatmap, roomWidth, roomHeight } = data;
    // Measured mode swaps which grid is painted, not how it is painted: the
    // same colour scale and the same cells, so switching modes is comparable.
    const showingMeasured = this.mapMode === 'measured' && data.measured;
    this.paintCells(
      showingMeasured ? data.measured.grid : heatmap,
      roomWidth,
      roomHeight,
      { maskGaps: showingMeasured }
    );
    this.minRssi = data.minRssi ?? -100;
    this.maxRssi = data.maxRssi ?? -20;
    if (showingMeasured) {
      this.drawSamplePoints(data.measured.points, roomWidth, roomHeight);
    }
    // Contours go under the furniture: they describe the field, and a wall or a
    // marker drawn on top of one is more useful than the line.
    this.drawContours(
      showingMeasured ? data.measured.grid : heatmap,
      roomWidth,
      roomHeight
    );
    this.drawGrid(roomWidth, roomHeight);
    this.drawTrails(data.trails || {}, roomWidth, roomHeight);
    this.drawWalls(data.walls || [], roomWidth, roomHeight);
    this.drawTracking(data.tracking, roomWidth, roomHeight);
    this.drawMarkers(data, roomWidth, roomHeight);
  }

  /**
   * Where each source has been.
   *
   * Drawn oldest to newest with the head brightest, so direction of travel
   * reads without needing arrows.
   */
  drawTrails(trails, roomWidth, roomHeight) {
    const entries = Object.entries(trails).filter(
      ([, points]) => Array.isArray(points) && points.length > 1
    );
    if (entries.length === 0) return;

    const sx = this.canvas.width / roomWidth;
    const sy = this.canvas.height / roomHeight;

    this.ctx.save();
    this.ctx.lineCap = 'round';
    for (const [, points] of entries) {
      // One stroke per segment so opacity can ramp along the trail: the head is
      // the transmitter's current position and the tail is history, so a
      // constant opacity draws a rope rather than a path.
      for (let i = 1; i < points.length; i++) {
        const t = i / points.length;
        const fade = t * t;
        this.ctx.strokeStyle = `rgba(0, 229, 255, ${0.04 + fade * 0.5})`;
        this.ctx.lineWidth = 0.5 + fade * 2;
        this.ctx.beginPath();
        this.ctx.moveTo(points[i - 1].x * sx, points[i - 1].y * sy);
        this.ctx.lineTo(points[i].x * sx, points[i].y * sy);
        this.ctx.stroke();
      }
      // A soft dot at the head, so the path's leading edge is not a blunt cut.
      const head = points[points.length - 1];
      this.ctx.fillStyle = 'rgba(0, 229, 255, 0.55)';
      this.ctx.beginPath();
      this.ctx.arc(head.x * sx, head.y * sy, 1.6, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  drawTracking(tracking, roomWidth, roomHeight) {
    if (!tracking || !tracking.estimate) return;
    const sx = this.canvas.width / roomWidth;
    const sy = this.canvas.height / roomHeight;
    const { estimate, truth } = tracking;
    if (estimate.x === null || estimate.x === undefined) return;

    const ex = estimate.x * sx;
    const ey = estimate.y * sy;
    const tx = truth.x * sx;
    const ty = truth.y * sy;

    this.ctx.save();

    // The error line, with the distance in metres on it.
    this.ctx.strokeStyle = 'rgba(243, 182, 31, 0.9)';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([5, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(tx, ty);
    this.ctx.lineTo(ex, ey);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // The mirror-image candidate, when only two receivers were usable. Drawn
    // hollow so it reads as a possibility, not a result.
    if (estimate.ambiguous && estimate.alternative) {
      this.ctx.strokeStyle = 'rgba(243, 182, 31, 0.45)';
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.arc(
        estimate.alternative.x * sx,
        estimate.alternative.y * sy,
        9,
        0,
        Math.PI * 2
      );
      this.ctx.stroke();
    }

    // The estimate itself: a crosshair with a gap in the middle.
    this.ctx.strokeStyle = '#f3b61f';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(ex - 12, ey);
    this.ctx.lineTo(ex - 4, ey);
    this.ctx.moveTo(ex + 4, ey);
    this.ctx.lineTo(ex + 12, ey);
    this.ctx.moveTo(ex, ey - 12);
    this.ctx.lineTo(ex, ey - 4);
    this.ctx.moveTo(ex, ey + 4);
    this.ctx.lineTo(ex, ey + 12);
    this.ctx.stroke();

    this.drawLabel(
      `est ${estimate.x.toFixed(1)}, ${estimate.y.toFixed(1)}`,
      ex,
      ey - 18
    );

    // The error distance rides the midpoint of the line. This used to be a
    // second hand-rolled label - its own font, its own translucent pill, its own
    // colour - which is how the map ended up with two shades of amber and two
    // label styles. drawLabel now owns all of it.
    this.drawLabel(
      `${tracking.errorMetres.toFixed(2)} m error`,
      (tx + ex) / 2,
      (ty + ey) / 2 + 2
    );

    this.ctx.restore();
  }

  /**
   * Fill each grid cell as a rectangle.
   *
   * The previous renderer wrote a single pixel per cell: at 800x600 for a 20x15
   * m room that is 300 painted pixels out of 480,000, so the heatmap was mostly
   * empty canvas with sparse dots.
   */
  paintCells(heatmap, roomWidth, roomHeight, options = {}) {
    const cols = Math.round(roomWidth);
    const rows = Math.round(roomHeight);
    if (!Array.isArray(heatmap) || cols < 1 || rows < 1) return;

    // The lattice is painted at its own resolution - one pixel per 1 dB sample
    // - and scaled up afterwards, so the bilinear filter has something smooth
    // to interpolate. Sizing it to the canvas instead would put the staircase
    // straight back in.
    if (this.gridCanvas.width !== cols || this.gridCanvas.height !== rows) {
      this.gridCanvas.width = cols;
      this.gridCanvas.height = rows;
    }
    const gctx = this.gridCtx;
    gctx.clearRect(0, 0, cols, rows);

    const maskGaps = Boolean(options.maskGaps);
    const anyGap =
      maskGaps ||
      heatmap.some((point) => point.rssi === null || point.rssi === undefined);

    // A gap has to be a real hole in the lattice for the interpolation to
    // blur around it, so where any gap exists the grid is painted with an
    // alpha mask and the gap cells left fully transparent. Where there is no
    // gap the old opaque path is kept, because it is measurably cheaper and
    // this is the common case for the model grid.
    if (anyGap) {
      const image = gctx.createImageData(cols, rows);
      const px = image.data;
      for (let i = 0; i < heatmap.length && i < cols * rows; i++) {
        const point = heatmap[i];
        // The lattice is column-major - grid[x * rows + y], the order
        // src/heatmap.js and src/interpolate.js both emit - but ImageData is
        // row-major: pixel (px, py) lives at py * width + px. Same linear
        // index, different meaning, so `i * 4` silently transposes the field.
        // 298 of 300 cells landed wrong in measured mode.
        //
        // Driven off point.x/point.y rather than i so the two cannot drift
        // apart again, whatever order the array is in.
        const at = (point.y * cols + point.x) * 4;
        const isGap =
          !point ||
          point.rssi === null ||
          point.rssi === undefined ||
          (maskGaps && point.hasData === false);
        if (isGap) continue;
        const [r, g, b] = ColorMapper.getColor(
          point.rssi,
          this.minRssi ?? -100,
          this.maxRssi ?? -20,
          this.ramp
        );
        px[at] = r;
        px[at + 1] = g;
        px[at + 2] = b;
        // A full 255, not cellAlpha. The lattice is composited over the opaque
        // background and the fillRect branch writes opaque rgb() colours, so
        // anything below 255 made the same cell dimmer depending only on
        // whether some other cell in the grid happened to be null - pressing M
        // shifted the whole field's opacity. The gap texels stay transparent,
        // which is what lets the interpolation blur around them.
        px[at + 3] = 255;
      }
      gctx.putImageData(image, 0, 0);
    } else {
      for (const point of heatmap) {
        if (!point || point.rssi === null || point.rssi === undefined) continue;
        const [r, g, b] = ColorMapper.getColor(
          point.rssi,
          this.minRssi ?? -100,
          this.maxRssi ?? -20,
          this.ramp
        );
        gctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        // +1 hides the hairline seams between adjacent lattice pixels.
        gctx.fillRect(point.x, point.y, 1.01, 1.01);
      }
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // One drawImage, scaled to the room. `imageSmoothingEnabled` plus a high
    // quality hint is what turns 300 samples into a smooth field; without it
    // the browser nearest-neighbours and the staircase comes back.
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(
      this.gridCanvas,
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );
    this.ctx.restore();

    // Gaps are marked on top, in canvas space, because a gap has no colour to
    // interpolate - the hatching says "not measured", which is a different
    // claim from any colour on this map.
    if (anyGap) {
      const cellW = this.canvas.width / roomWidth;
      const cellH = this.canvas.height / roomHeight;
      for (const point of heatmap) {
        if (!point) continue;
        const isGap =
          point.rssi === null ||
          point.rssi === undefined ||
          (maskGaps && point.hasData === false);
        if (!isGap) continue;
        this.paintNoData(
          Math.floor(point.x * cellW),
          Math.floor(point.y * cellH),
          Math.ceil(cellW) + 1,
          Math.ceil(cellH) + 1
        );
      }
    }
  }

  /**
   * Contour lines at the documented levels.
   *
   * Drawn from the same lattice the colour field came from, so a line at -70
   * sits on the -70 colour rather than near it. Each level gets its own weight
   * and tint so three lines are distinguishable without a key.
   */
  drawContours(heatmap, roomWidth, roomHeight) {
    if (!this.showContours) {
      // Recorded as 0 rather than left stale, so "are contours on" is a
      // question with a real answer even after they are switched off.
      this.lastContoursDrawn = 0;
      return 0;
    }
    const cols = Math.round(roomWidth);
    const rows = Math.round(roomHeight);
    const cellW = this.canvas.width / roomWidth;
    const cellH = this.canvas.height / roomHeight;

    // Weight and tint per level, strongest first. Keyed by dBm so the levels
    // themselves live in one place - CONTOUR_LEVELS - rather than being
    // repeated here, which is how a documented level and a drawn level drift
    // apart.
    const styles = {
      '-50': { width: 1.5, alpha: 0.92 },
      '-70': { width: 1, alpha: 0.62 },
      '-85': { width: 1, alpha: 0.42 },
    };

    this.ctx.save();
    this.ctx.lineCap = 'round';
    let drawn = 0;
    for (const level of CONTOUR_LEVELS) {
      const style = styles[String(level)] || { width: 1, alpha: 0.5 };
      const segments = contourSegments(heatmap, cols, rows, level);
      if (segments.length === 0) continue;
      this.ctx.beginPath();
      for (const [[ax, ay], [bx, by]] of segments) {
        this.ctx.moveTo(ax * cellW, ay * cellH);
        this.ctx.lineTo(bx * cellW, by * cellH);
      }
      // Two-tone stroke: a dark casing under a light core.
      //
      // Measured, this matters. Against the inferno ramp a white line scores
      // 14.8:1 at -85 dBm but only 3.61:1 at -50, and the ramp's top end
      // (252,255,164) is 1.05:1 against white - a single white stroke vanishes
      // over any strong-signal area. The casing is dark, so it carries the line
      // where the field is bright and the core carries it where the field is
      // dark. Either alone fails somewhere on the scale.
      this.ctx.strokeStyle = `rgba(8, 11, 16, ${Math.min(0.85, style.alpha + 0.15)})`;
      this.ctx.lineWidth = style.width + 1.6;
      this.ctx.stroke();

      this.ctx.strokeStyle = `rgba(255, 255, 255, ${style.alpha})`;
      this.ctx.lineWidth = style.width;
      this.ctx.stroke();
      drawn += segments.length;
    }
    this.ctx.restore();
    this.lastContoursDrawn = drawn;
    return drawn;
  }

  paintNoData(px, py, w, h) {
    this.ctx.fillStyle = '#12161c';
    this.ctx.fillRect(px, py, w, h);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(px, py, w, h);
    this.ctx.clip();
    this.ctx.strokeStyle = 'rgba(120, 132, 145, 0.30)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for (let d = -h; d < w + h; d += 7) {
      this.ctx.moveTo(px + d, py);
      this.ctx.lineTo(px + d + h, py + h);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  /** Where the readings were actually taken. */
  drawSamplePoints(points, roomWidth, roomHeight) {
    if (!points || !points.length) return;
    const sx = this.canvas.width / roomWidth;
    const sy = this.canvas.height / roomHeight;
    this.ctx.save();
    for (const p of points) {
      const cx = p.x * sx;
      const cy = p.y * sy;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fill();
      this.ctx.lineWidth = 1.5;
      this.ctx.strokeStyle = 'rgba(10, 14, 20, 0.9)';
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawGrid(roomWidth, roomHeight) {
    const cellW = this.canvas.width / roomWidth;
    const cellH = this.canvas.height / roomHeight;

    this.ctx.strokeStyle = 'rgba(120, 130, 140, 0.18)';
    this.ctx.lineWidth = 0.5;
    this.ctx.beginPath();
    for (let x = 0; x <= roomWidth; x++) {
      this.ctx.moveTo(x * cellW, 0);
      this.ctx.lineTo(x * cellW, this.canvas.height);
    }
    for (let y = 0; y <= roomHeight; y++) {
      this.ctx.moveTo(0, y * cellH);
      this.ctx.lineTo(this.canvas.width, y * cellH);
    }
    this.ctx.stroke();
  }

  drawWalls(walls, roomWidth, roomHeight) {
    const sx = this.canvas.width / roomWidth;
    const sy = this.canvas.height / roomHeight;

    this.ctx.save();
    this.ctx.lineCap = 'round';
    walls.forEach((wall, index) => {
      // Thickness in metres, but never thinner than 3px or the wall vanishes.
      const width = Math.max(3, (wall.thickness || 0.2) * sx);
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 + Math.min(0.5, wall.attenuation / 60)})`;
      this.ctx.lineWidth = width;
      this.ctx.beginPath();
      this.ctx.moveTo(wall.x1 * sx, wall.y1 * sy);
      this.ctx.lineTo(wall.x2 * sx, wall.y2 * sy);
      this.ctx.stroke();

      // Small handle at the midpoint so a wall is visibly selectable.
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      this.ctx.beginPath();
      this.ctx.arc(
        ((wall.x1 + wall.x2) / 2) * sx,
        ((wall.y1 + wall.y2) / 2) * sy,
        4,
        0,
        Math.PI * 2
      );
      this.ctx.fill();
      this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
      this.ctx.font = '9px monospace';
      this.ctx.fillText(
        String(index),
        ((wall.x1 + wall.x2) / 2) * sx + 6,
        ((wall.y1 + wall.y2) / 2) * sy - 5
      );
    });
    this.ctx.restore();
  }

  drawMarkers(data, roomWidth, roomHeight) {
    const sx = this.canvas.width / roomWidth;
    const sy = this.canvas.height / roomHeight;
    const phase = this.pulsePhase();

    data.sources.forEach((source) => {
      const px = source.x * sx;
      const py = source.y * sy;

      this.ctx.save();

      // Glow. shadowBlur is the honest way to do this on a 2D canvas, and it is
      // the expensive part of the frame, so it is scoped tightly: a single
      // fillRect with the blur set, restored immediately after.
      this.ctx.shadowColor = source.pinned
        ? 'rgba(243, 182, 31, 0.9)'
        : 'rgba(255, 43, 214, 0.9)';
      this.ctx.shadowBlur = 14;
      this.ctx.fillStyle = source.pinned ? '#f3b61f' : '#ff2bd6';
      this.ctx.beginPath();
      this.ctx.arc(px, py, 7, 0, Math.PI * 2);
      this.ctx.fill();

      // A pulsing ring that expands and fades, so a transmitter reads as
      // emitting rather than sitting there. Frozen when the OS asks for
      // reduced motion, and then drawn at a fixed radius - a pulse you cannot
      // see is not worth animating.
      this.ctx.shadowBlur = 0;
      const ring = this.reduceMotion ? 12 : 10 + phase * 16;
      const ringAlpha = this.reduceMotion ? 0.35 : 0.5 * (1 - phase);
      if (ringAlpha > 0.01) {
        this.ctx.strokeStyle = source.pinned
          ? `rgba(243, 182, 31, ${ringAlpha})`
          : `rgba(255, 43, 214, ${ringAlpha})`;
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.arc(px, py, ring, 0, Math.PI * 2);
        this.ctx.stroke();
      }

      this.ctx.restore();
      this.drawLabel(source.name, px, py - 14);
    });

    data.receivers.forEach((receiver) => {
      const px = receiver.x * sx;
      const py = receiver.y * sy;
      this.ctx.save();
      this.ctx.strokeStyle = '#39ff88';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(px - 7, py - 7, 14, 14);
      this.ctx.restore();
      this.drawLabel(receiver.id, px, py - 12);
    });
  }

  drawLabel(text, px, py) {
    this.ctx.save();
    this.ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'alphabetic';
    const width = this.ctx.measureText(text).width;
    this.ctx.fillStyle = 'rgba(10, 14, 20, 0.92)';
    this.ctx.fillRect(px - width / 2 - 4, py - 10, width + 8, 15);
    // A hairline keeps the pill readable where it crosses a bright cell.
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(px - width / 2 - 4.5, py - 10.5, width + 9, 16);
    this.ctx.fillStyle = '#dce6f0';
    this.ctx.fillText(text, px, py);
    this.ctx.restore();
  }

  /**
   * Screen position -> room coordinates in metres.
   * getBoundingClientRect is used rather than offsetWidth so the mapping stays
   * correct when the canvas is CSS-scaled.
   */
  toRoomCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.roomWidth,
      y: ((clientY - rect.top) / rect.height) * this.roomHeight,
    };
  }

  /** Nearest transmitter to a room-space point, within `tolerance` metres. */
  findSourceAt(x, y, data, tolerance = 1.2) {
    if (!data) return null;
    let best = null;
    let bestDistance = tolerance;
    data.sources.forEach((source) => {
      const distance = Math.hypot(source.x - x, source.y - y);
      if (distance <= bestDistance) {
        best = source;
        bestDistance = distance;
      }
    });
    return best;
  }

  findReceiverAt(x, y, data, tolerance = 1.2) {
    if (!data) return null;
    let best = null;
    let bestDistance = tolerance;
    data.receivers.forEach((receiver) => {
      const distance = Math.hypot(receiver.x - x, receiver.y - y);
      if (distance <= bestDistance) {
        best = receiver;
        bestDistance = distance;
      }
    });
    return best;
  }
}
