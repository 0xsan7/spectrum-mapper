/**
 * Generate the project-structure tree for the README from `git ls-files`.
 *
 * Generated rather than hand-written so it cannot drift: a new module shows up
 * the next time this runs. Excluded: the lockfile (noise at this depth) and
 * anything under node_modules.
 *
 *   node scripts/gen-tree.js          # print the tree
 *   node scripts/gen-tree.js --write  # print, and splice into README.md
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const EMOJI = {
  src: '⚡',
  public: '🖥️',
  config: '⚙️',
  test: '🧪',
  scripts: '🔧',
  docs: '📚',
  '.github': '🔄',
};

const DESCRIPTIONS = {
  'src/server.js': 'Express + ws, state owner, command validation',
  'src/pathLoss.js': 'log-distance model, dBm ↔ linear power',
  'src/heatmap.js': 'grid generation and statistics',
  'src/simulation.js': 'transmitter positions, velocity, pinning',
  'src/obstacles.js': 'wall geometry and per-crossing attenuation',
  'src/receivers.js': 'receiver node state',
  'src/trilateration.js': 'RSSI → range → position',
  'src/history.js': 'rolling time-series buffer',
  'src/csv.js': 'CSV formatting for the export API',
  'src/config/constants.js': 'room, grid, model and node defaults',
  'src/config/env.js': 'dependency-free .env loader',
  'public/index.html': 'document shell and sidebar',
  'public/dashboard.js': 'single app instance, frame dispatch',
  'public/heatmap.js': 'canvas renderer, walls, trails, markers',
  'public/colors.js': 'RSSI → RGB ramp',
  'public/legend.js': 'legend built from the same ramp',
  'public/chart.js': 'RSSI and error time series',
  'public/controls.js': 'sliders, transport, wall controls',
  'public/interaction.js': 'TX/RX dragging, wall drawing',
  'public/export.js': 'PNG compositor',
  'public/websocket.js': 'connection and reconnect state',
  'public/spectrum-analysis.js': 'coverage statistics',
  'public/performance.js': 'throttle helper',
  'public/logger.js': 'namespaced console logging',
  'public/responsive.js': 'viewport listener',
  'public/shortcuts.js': 'keyboard commands',
  'public/style.css': 'all styling',
  'public/favicon.svg': 'icon',
  'test/pathLoss.test.js': 'model anchored to reference values',
  'test/heatmap.test.js': 'grid and statistics',
  'test/obstacles.test.js': 'wall geometry, server state, NaN handling',
  'test/trilateration.test.js': 'inversion and degenerate cases',
  'test/history.test.js': 'buffer, deltas, CSV quoting',
  'test/server.test.js': 'commands, routes, payload size',
  'test/browser.test.js': 'browser logic loaded into a VM',
  'scripts/benchmark.js': 'produces the README performance numbers',
  'scripts/verify-readme.js': 'fails when docs drift from code',
  'scripts/gen-tree.js': 'regenerates this tree',
  'scripts/verify-diagrams.js': 'validates the SVG assets',
  'docs/architecture.svg': 'architecture diagram',
  'docs/structure-banner.svg': 'file-system banner',
  'docs/hero-placeholder.svg': 'hero placeholder',
  'docs/README-hero.md': 'how to record the real hero GIF',
  '.github/workflows/ci.yml': 'lint, format, test, audit, docs check',
  Dockerfile: 'multi-stage production image',
  '.dockerignore': 'image build context exclusions',
  '.env.example': 'every setting, documented',
  '.gitignore': 'ignored paths',
  '.prettierrc.json': 'formatting config',
  '.prettierignore': 'formatting exclusions',
  'eslint.config.mjs': 'flat config; browser globals declared here',
  'package.json': 'scripts, engines, dependencies',
  LICENSE: 'MIT',
  'README.md': 'this file',
  'CONTRIBUTING.md': 'how to contribute',
  'CHANGELOG.md': 'release history',
};

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => f !== 'package-lock.json' && !f.startsWith('node_modules/'));

// Build a nested tree.
const root = { children: new Map() };
for (const file of files) {
  const parts = file.split('/');
  let node = root;
  parts.forEach((part, i) => {
    if (!node.children.has(part)) {
      node.children.set(part, {
        children: new Map(),
        isFile: i === parts.length - 1,
      });
    }
    node = node.children.get(part);
  });
}

const lines = [];

function comment(file) {
  const d = DESCRIPTIONS[file];
  return d ? `  # ${d}` : '';
}

function render(node, prefix, pathSoFar) {
  const entries = [...node.children.entries()];
  entries.forEach(([name, child], i) => {
    const last = i === entries.length - 1;
    const branch = last ? '└── ' : '├── ';
    const full = pathSoFar ? `${pathSoFar}/${name}` : name;

    if (child.isFile) {
      lines.push(`${prefix}${branch}${name}${comment(full)}`);
    } else {
      const emoji = EMOJI[name] ? `${EMOJI[name]} ` : '';
      lines.push(`${prefix}${branch}${emoji}${name}/`);
      render(child, prefix + (last ? '    ' : '│   '), full);
    }
  });
}

render(root, '', '');
const tree = lines.join('\n');

if (process.argv.includes('--write')) {
  const readmePath = path.join(ROOT, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  // The content group must allow an empty block, and the gap after the marker
  // must be tolerant: Prettier inserts a blank line between the HTML comment
  // and the fence, so requiring exactly one newline meant the block could be
  // written but never read back.
  const re =
    /(<!-- tree:start -->\r?\n\s*```text\r?\n)[\s\S]*?(\r?\n?```\r?\n\s*<!-- tree:end -->)/;
  if (!re.test(readme)) {
    console.error(
      'could not find the <!-- tree:start --> markers in README.md'
    );
    process.exit(1);
  }
  fs.writeFileSync(readmePath, readme.replace(re, `$1${tree}\n$2`));
  console.error(`README.md tree updated (${lines.length} lines)`);
}

console.log(tree);
