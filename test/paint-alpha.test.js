/**
 * The two paint branches must produce the same field.
 *
 * paintCells() has two paths. Where the grid has no gaps it fills one rect per
 * cell with an opaque colour. Where any cell is null - measured mode, or a
 * partly-masked survey - it writes an ImageData into the lattice instead and
 * leaves the gap texels transparent.
 *
 * The ImageData path wrote `cellAlpha` (200) into every texel while the fillRect
 * path wrote a fully opaque rgb(). A cell at the same RSSI therefore came out at
 * two different opacities depending only on whether some *other* cell happened
 * to be null. Pressing M, or ingesting readings and switching back to the model,
 * dimmed or brightened the whole map.
 *
 * These drive the real class against a canvas stub and compare the two outputs
 * cell by cell, alpha included.
 *
 * One trap worth naming, because it bit this file's first draft: the field is
 * painted into the renderer's own offscreen `gridCanvas`, not the visible one. A
 * stub that records only the context handed to the constructor sees no field at
 * all, and every assertion below then passes for the wrong reason.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

function paintCtx() {
  const fills = [];
  const images = [];
  return {
    fills,
    images,
    createImageData(w, h) {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData(img) {
      images.push({
        data: Array.from(img.data),
        width: img.width,
        height: img.height,
      });
    },
    fillRect(x, y, w, h) {
      fills.push({ style: this.fillStyle, x, y, w, h });
    },
    clearRect() {},
    drawImage() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    // paintNoData clips to a cell before hatching it, so the masked branch
    // reaches rect() and clip(). Without them the stub throws partway through.
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    arc() {},
    setLineDash() {},
    fillText() {},
    measureText() {
      return { width: 0 };
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: '',
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'left',
  };
}

/**
 * Load the real renderer. Every context it creates - the visible one and the
 * offscreen lattice - is pushed into `contexts`, in creation order.
 */
function loadRenderer() {
  const src = fs.readFileSync(path.join(PUBLIC, 'heatmap.js'), 'utf8');
  const contexts = [];
  const document = {
    createElement() {
      const ctx = paintCtx();
      contexts.push(ctx);
      return { width: 0, height: 0, getContext: () => ctx };
    },
  };
  // A strictly monotonic stand-in, so the branches cannot agree by both being
  // wrong in the same way.
  const ColorMapper = {
    DEFAULT_RAMP: 'inferno',
    getColor: (rssi, min, max) => {
      const t = Math.max(0, Math.min(1, (rssi - min) / (max - min)));
      return [
        Math.round(t * 255),
        Math.round(t * 128),
        255 - Math.round(t * 255),
      ];
    },
  };
  const sandbox = vm.createContext({
    Math,
    Number,
    JSON,
    Object,
    Array,
    Infinity,
    String,
    Boolean,
    document,
    ColorMapper,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
  });
  vm.runInContext(src, sandbox);
  return { Renderer: vm.runInContext('HeatmapRenderer', sandbox), contexts };
}

/** paintCells(heatmap, roomWidth, roomHeight, options) - the room, not the grid. */
function paint(Renderer, grid, maskGaps) {
  const visible = paintCtx();
  // The renderer's offscreen lattice is created inside the constructor, so it
  // has to be picked out of the registry afterwards rather than passed in.
  const before = paintCtx;
  void before;
  const r = new Renderer({
    width: 200,
    height: 150,
    getContext: () => visible,
  });
  r.paintCells(grid, 20, 15, { maskGaps });
  return { visible, lattice: r.gridCtx };
}

/** A 4x3 lattice with distinct values, column-major: grid[x * rows + y]. */
function gridOf(cols, rows) {
  const grid = [];
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      grid.push({ x, y, rssi: -95 + x * 11 + y * 4, hasData: true });
    }
  }
  return grid;
}

/** Read a fill-based paint back as r,g,b,a keyed by "x,y". */
function readFills(ctx) {
  const out = new Map();
  for (const fill of ctx.fills) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(
      fill.style
    );
    if (!m) continue; // the no-data hatch's own fillStyle, not a field cell
    out.set(`${fill.x},${fill.y}`, [
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Math.round((m[4] === undefined ? 1 : Number(m[4])) * 255),
    ]);
  }
  return out;
}

/** Read an ImageData paint back the same way, skipping transparent gap texels. */
function readImage(ctx) {
  const out = new Map();
  const img = ctx.images[ctx.images.length - 1];
  if (!img) return out;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const at = (y * img.width + x) * 4;
      if (img.data[at + 3] === 0) continue;
      out.set(`${x},${y}`, [
        img.data[at],
        img.data[at + 1],
        img.data[at + 2],
        img.data[at + 3],
      ]);
    }
  }
  return out;
}

test('both paint branches paint the same cells the same colour', () => {
  const { Renderer } = loadRenderer();
  const cols = 4;
  const rows = 3;
  const solid = gridOf(cols, rows);

  // The same values, with one cell null so the masked branch is taken.
  const masked = solid.map((c) => ({ ...c }));
  masked[2 * rows + 1] = { x: 2, y: 1, rssi: null, hasData: false };

  const opaque = readFills(paint(Renderer, solid, false).lattice);
  const alpha = readImage(paint(Renderer, masked, true).lattice);

  assert.strictEqual(
    opaque.size,
    cols * rows,
    'the fill branch must paint every cell'
  );
  assert.strictEqual(
    alpha.size,
    cols * rows - 1,
    'exactly the one gap cell should be transparent in the masked lattice'
  );

  const mismatches = [];
  for (const [key, viaFill] of opaque) {
    // The gap cell is null in `masked` and has a value in `solid`, so it is in
    // one picture and absent from the other by design. Everything else must
    // match, cell for cell.
    if (key === '2,1') continue;
    const viaImage = alpha.get(key);
    if (!viaImage) {
      mismatches.push(
        `${key}: painted by the fill branch, absent from the image branch`
      );
      continue;
    }
    for (let ch = 0; ch < 4; ch++) {
      if (viaFill[ch] !== viaImage[ch]) {
        mismatches.push(
          `${key} ch${ch}: fill ${viaFill[ch]} vs image ${viaImage[ch]}`
        );
      }
    }
  }
  assert.deepStrictEqual(
    mismatches,
    [],
    'both branches paint the same lattice, so every cell must match: ' +
      mismatches.slice(0, 6).join('; ')
  );
});

test('a measured cell is fully opaque, so pressing M cannot shift opacity', () => {
  const { Renderer } = loadRenderer();
  const solid = gridOf(4, 3);
  const masked = solid.map((c) => ({ ...c }));
  masked[1 * 3 + 2] = { x: 1, y: 2, rssi: null, hasData: false };

  const opaque = readFills(paint(Renderer, solid, false).lattice);
  assert.ok(opaque.size > 0, 'expected the fill branch to paint cells');
  for (const [key, rgba] of opaque) {
    assert.strictEqual(
      rgba[3],
      255,
      `cell ${key} painted at alpha ${rgba[3]}/255`
    );
  }

  const alpha = readImage(paint(Renderer, masked, true).lattice);
  assert.ok(alpha.size > 0, 'expected the masked branch to paint texels');
  for (const [key, rgba] of alpha) {
    assert.strictEqual(
      rgba[3],
      255,
      `cell ${key} painted at alpha ${rgba[3]}/255`
    );
  }
});

test('paintCells writes a full 255 into every lattice texel', () => {
  // The named knob is fine for whatever uses it; what it must not do is reach a
  // lattice texel, because the lattice is composited over an opaque background.
  const src = fs.readFileSync(path.join(PUBLIC, 'heatmap.js'), 'utf8');
  const body = src.slice(
    src.indexOf('paintCells('),
    src.indexOf('paintNoData(')
  );
  assert.ok(
    body.includes('paintCells('),
    'could not locate paintCells in the source'
  );
  const writes = [...body.matchAll(/px\[at \+ 3\]\s*=\s*([^;]+);/g)].map((m) =>
    m[1].trim()
  );
  assert.ok(writes.length > 0, 'expected paintCells to write a texel alpha');
  for (const write of writes) {
    assert.strictEqual(
      write,
      '255',
      `paintCells must write a full 255, found \`${write}\`; routing it through ` +
        'cellAlpha is what made the two branches disagree'
    );
  }
});

test('the gap texel is transparent and its neighbours are not', () => {
  const { Renderer } = loadRenderer();
  const masked = gridOf(3, 2);
  masked[1 * 2 + 1] = { x: 1, y: 1, rssi: null, hasData: false };
  const lattice = paint(Renderer, masked, true).lattice;
  const img = lattice.images[lattice.images.length - 1];
  assert.ok(img, 'expected the masked branch to write an ImageData');
  // ImageData is row-major; the lattice is 3x2 here.
  const at = (x, y) => (y * img.width + x) * 4;
  assert.strictEqual(
    img.data[at(1, 1) + 3],
    0,
    'the gap texel must stay transparent'
  );
  assert.strictEqual(
    img.data[at(0, 1) + 3],
    255,
    'the cell beside a gap must be opaque'
  );
  assert.strictEqual(
    img.data[at(2, 1) + 3],
    255,
    'the other neighbour must be opaque'
  );
});
