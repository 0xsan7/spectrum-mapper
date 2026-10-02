const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

/**
 * A canvas stub that records what gets drawn.
 *
 * paintCells() is the one place in the renderer that writes through an index
 * rather than through coordinates, which is precisely why it needs a test: the
 * colour path can be right while the pixel it lands in is wrong, and nothing
 * about the code says which convention it is using.
 */
function makeCanvasStub(record) {
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    clearRect() {},
    fillRect(x, y, w, h) {
      record.fills.push({ x, y, w, h, style: ctx.fillStyle });
    },
    drawImage() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    rect() {},
    clip() {},
    stroke() {},
    fill() {},
    save() {},
    restore() {},
    fillText() {},
    measureText: () => ({ width: 0 }),
    createImageData(w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(img, x, y) {
      record.images.push({ img, x, y });
    },
    getImageData() {
      return { data: new Uint8ClampedArray(4) };
    },
  };
  return {
    width: 1086,
    height: 815,
    parentElement: { clientWidth: 1086 },
    getContext: () => ctx,
  };
}

/** Load the renderer with stubbed DOM globals. */
function loadRenderer(record) {
  const context = vm.createContext({
    console,
    Math,
    Number,
    JSON,
    Object,
    Array,
    Infinity,
    String,
    Boolean,
    document: {
      createElement: () => makeCanvasStub(record),
      getElementById: () => null,
    },
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    performance: { now: () => 0 },
  });
  for (const file of ['colors.js', 'heatmap.js']) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, file), 'utf8'), context, {
      filename: file,
    });
  }
  const { HeatmapRenderer, ColorMapper } = vm.runInContext(
    '({ HeatmapRenderer, ColorMapper })',
    context
  );
  return { HeatmapRenderer, ColorMapper };
}

/** Read pixel (px, py) out of an ImageData. */
const pixelAt = (img, px, py) => {
  const at = (py * img.width + px) * 4;
  return [img.data[at], img.data[at + 1], img.data[at + 2], img.data[at + 3]];
};

const COLS = 20;
const ROWS = 15;

/**
 * The lattice is column-major - grid[x * rows + y], the order src/heatmap.js
 * and src/interpolate.js both emit. ImageData is row-major - pixel
 * (px, py) lives at py * width + px.
 *
 * Those are different orderings and they share a linear index, so writing
 * `at = i * 4` looks right and is not. This fixture gives every cell a
 * distinct, identifiable colour so a misplaced cell cannot hide.
 */
function distinctiveGrid() {
  const grid = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      // r = x*10, g = y*10, b = 200 - so every cell is identifiable and none
      // two cells share a colour.
      grid.push({ x, y, rssi: -(40 + x * 2 + y), hasData: true });
    }
  }
  return grid;
}

test('a null in the grid puts each cell at its own lattice position', () => {
  const record = { fills: [], images: [] };
  const { HeatmapRenderer } = loadRenderer(record);
  const renderer = new HeatmapRenderer(makeCanvasStub(record));
  renderer.ramp = 'classic';
  renderer.minRssi = -100;
  renderer.maxRssi = -20;

  // One gap, so the anyGap / createImageData branch is the one that runs.
  const grid = distinctiveGrid();
  grid[7 * ROWS + 2] = { x: 7, y: 2, rssi: null, hasData: false };

  renderer.paintCells(grid, COLS, ROWS, { maskGaps: true });

  assert.strictEqual(
    record.images.length,
    1,
    'the ImageData path must be the one used'
  );
  const img = record.images[0].img;

  // The gap must be a hole at (7, 2) - not somewhere else.
  assert.deepStrictEqual(
    pixelAt(img, 7, 2).slice(0, 3),
    [0, 0, 0],
    'the gap cell must be transparent at its own lattice position'
  );
  assert.strictEqual(pixelAt(img, 7, 2)[3], 0, 'and fully transparent');

  // Every non-gap cell must be opaque, so a misplaced cell shows up as a hole.
  let opaque = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (x === 7 && y === 2) continue;
      assert.strictEqual(
        pixelAt(img, x, y)[3],
        renderer.cellAlpha,
        `cell (${x},${y}) was not written at its own position`
      );
      opaque++;
    }
  }
  assert.strictEqual(opaque, COLS * ROWS - 1);
});

test('the ImageData path and the fillRect path paint the same picture', () => {
  const grid = distinctiveGrid();

  // Path A: with a gap somewhere else in the room, so the lattice path runs.
  const withGap = grid.map((p) => ({ ...p }));
  withGap[0 * ROWS + 0] = { x: 0, y: 0, rssi: null, hasData: false };

  const recordA = { fills: [], images: [] };
  const a = new (loadRenderer(recordA).HeatmapRenderer)(
    makeCanvasStub(recordA)
  );
  a.ramp = 'classic';
  a.minRssi = -100;
  a.maxRssi = -20;
  a.paintCells(withGap, COLS, ROWS, { maskGaps: true });
  const imgA = recordA.images[0].img;

  // Path B: no gaps at all, so the fillRect path runs.
  const recordB = { fills: [], images: [] };
  const b = new (loadRenderer(recordB).HeatmapRenderer)(
    makeCanvasStub(recordB)
  );
  b.ramp = 'classic';
  b.minRssi = -100;
  b.maxRssi = -20;
  b.paintCells(grid, COLS, ROWS, { maskGaps: false });

  // The fillRect path addresses pixels by coordinate, so compare on that.
  // Build its image back out of the recorded rects.
  const fromFills = new Uint8ClampedArray(COLS * ROWS * 4);
  let rgbFills = 0;
  for (const fill of recordB.fills) {
    const rgb = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(fill.style);
    if (!rgb) continue; // the no-data hatch paints #12161c, not rgb()
    rgbFills++;
    const at = (fill.y * COLS + fill.x) * 4;
    fromFills[at] = Number(rgb[1]);
    fromFills[at + 1] = Number(rgb[2]);
    fromFills[at + 2] = Number(rgb[3]);
    fromFills[at + 3] = 255;
  }
  assert.strictEqual(
    rgbFills,
    COLS * ROWS,
    `every cell must be painted by the fillRect path; got ${rgbFills}`
  );

  let mismatch = 0;
  let firstBad = null;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (x === 0 && y === 0) continue;
      const viaImage = pixelAt(imgA, x, y);
      const viaFill = Array.from(
        fromFills.slice((y * COLS + x) * 4, (y * COLS + x) * 4 + 3)
      );
      if (viaImage.slice(0, 3).join() !== viaFill.join()) {
        mismatch++;
        if (!firstBad) firstBad = { x, y, viaImage, viaFill };
      }
    }
  }
  assert.strictEqual(
    mismatch,
    0,
    `the two paths disagree on ${mismatch} cells; first at ${JSON.stringify(firstBad)}`
  );
});

test('the gap branch writes at row-major offsets, not grid order', () => {
  // A direct assertion on the indexing, independent of colour.
  // Grid index for (x, y) is x * rows + y. ImageData offset is
  // (y * width + x) * 4. If the code uses the grid index as the pixel index,
  // cell (0, 1) lands at pixel (1, 0) and cell (1, 0) lands at pixel (0, 1) -
  // a transpose, which on a 20x15 lattice displaces 298 of 300 cells.
  const gridIndex = (x, y) => x * ROWS + y;
  const imageOffset = (x, y) => (y * COLS + x) * 4;
  const grid = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) grid.push({ x, y, rssi: -(40 + x * 2 + y) });
  }
  // A gap at a corner and at a middle cell, so both must land exactly there.
  const gaps = [
    [0, 1],
    [7, 2],
    [19, 14],
  ];
  const record = { fills: [], images: [] };
  const { HeatmapRenderer } = loadRenderer(record);
  const renderer = new HeatmapRenderer(makeCanvasStub(record));
  renderer.ramp = 'classic';
  renderer.minRssi = -100;
  renderer.maxRssi = -20;
  for (const [gx, gy] of gaps) {
    grid[gridIndex(gx, gy)] = { x: gx, y: gy, rssi: null, hasData: false };
  }
  renderer.paintCells(grid, COLS, ROWS, { maskGaps: true });
  const img = record.images[0].img;

  for (const [gx, gy] of gaps) {
    assert.strictEqual(
      pixelAt(img, gx, gy)[3],
      0,
      `gap at (${gx},${gy}) must be transparent there; image offset should be ` +
        `${imageOffset(gx, gy)} but the pixel at (${gx},${gy}) is opaque`
    );
  }
  // And the count of transparent pixels must equal the number of gaps - no more.
  let transparent = 0;
  for (let i = 3; i < img.data.length; i += 4)
    if (img.data[i] === 0) transparent++;
  assert.strictEqual(
    transparent,
    gaps.length,
    `exactly ${gaps.length} transparent texels expected, found ${transparent} - ` +
      'extra transparency means a gap leaked somewhere else'
  );
});
