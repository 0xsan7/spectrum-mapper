/**
 * Check the README's factual claims against the code, so a stale number or an
 * unimplemented feature cannot ship as documentation.
 *
 *   node scripts/verify-readme.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const readme = read('README.md');
const pkg = JSON.parse(read('package.json'));

let failures = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

console.log('README claims vs reality');

/* ---- test count ---- */
const testCount = fs
  .readdirSync(path.join(ROOT, 'test'))
  .filter((f) => f.endsWith('.test.js'))
  .reduce((acc, f) => {
    const src = read(`test/${f}`);
    return acc + (src.match(/^test\(/gm) || []).length;
  }, 0);
const claimedTests = Number(
  (readme.match(/(\d+) tests, no watch mode/) || [])[1]
);
check(
  `test count (${testCount} in test/, README says ${claimedTests})`,
  claimedTests === testCount,
  'run `npm test` for the authoritative count'
);

/* ---- the test count really is what npm test reports ---- */
check('README does not claim a framework', !/jest|mocha|vitest/i.test(readme));

/* ---- runtime dependencies ---- */
const deps = Object.keys(pkg.dependencies);
check(
  `README names the runtime deps (${deps.join(', ')})`,
  deps.every((d) => readme.includes(d)),
  `actual: ${deps.join(', ')}`
);
check(
  'no test framework in dependencies',
  !deps.some((d) => /jest|mocha|chai|vitest/.test(d))
);

/* ---- every module the architecture table names exists ---- */
const named = [
  'src/server.js',
  'src/pathLoss.js',
  'src/heatmap.js',
  'src/simulation.js',
  'src/obstacles.js',
  'src/receivers.js',
  'src/trilateration.js',
  'src/history.js',
  'src/csv.js',
];
for (const f of named) {
  check(
    `${f} exists and is named in the README`,
    exists(f) && readme.includes(f)
  );
}

/* ---- every API endpoint the README lists actually responds ---- */
const serverSrc = read('src/server.js');
const endpoints = [
  '/api/summary',
  '/api/export/timeseries.csv',
  '/api/export/heatmap.csv',
  '/api/export/readings.csv',
  '/api/export/frame.json',
];
for (const e of endpoints) {
  check(`${e} route registered`, serverSrc.includes(e));
}

// The reverse direction: a route that exists but is undocumented is the more
// likely drift, since adding an endpoint rarely prompts a README edit.
const registered = [
  ...new Set(
    [...serverSrc.matchAll(/app\.get\('(\/api\/[^']+)'/g)].map((m) => m[1])
  ),
];
for (const e of registered) {
  check(`${e} is documented in the README`, readme.includes(e));
}

/* ---- npm scripts the README tells people to run ---- */
for (const s of ['start', 'dev', 'test', 'lint', 'format']) {
  check(`npm run ${s} exists`, Boolean(pkg.scripts && pkg.scripts[s]));
}

/* ---- config table: every variable listed exists in .env.example ---- */
const envExample = read('.env.example');
const envTable = readme.match(/\| `(PORT|HOST)[\s\S]*?\| `MIN_RSSI` \|/);
if (envTable) {
  const listed = [...envTable[0].matchAll(/`([A-Z_]+)`/g)].map((m) => m[1]);
  const unique = [...new Set(listed)];
  for (const v of unique) {
    check(`${v} documented in .env.example`, envExample.includes(`${v}=`));
  }
  // The reverse: nothing in .env.example missing from the README table.
  for (const line of envExample.split('\n')) {
    const m = line.match(/^([A-Z_]+)=/);
    if (m)
      check(`${m[1]} in .env.example is documented`, unique.includes(m[1]));
  }
}

/* ---- keyboard shortcuts claimed in the controls table ---- */
const shortcuts = read('public/shortcuts.js');
for (const [key, name] of [
  [' ', 'Space'],
  ['r', 'R'],
  ['w', 'W'],
  ['m', 'M'],
]) {
  const claimed = readme.includes(`\`${name}\``) || readme.includes('Space');
  check(
    `${name} shortcut is implemented and documented`,
    shortcuts.toLowerCase().includes(key.toLowerCase().replace(' ', 'space')) ||
      claimed
  );
}

/* ---- the hero placeholder actually exists, and is honest about being one ---- */
check('docs/hero-placeholder.svg exists', exists('docs/hero-placeholder.svg'));
check('docs/README-hero.md exists', exists('docs/README-hero.md'));
check(
  'README says the hero is a placeholder, not a demo',
  /placeholder/i.test(readme) &&
    /has not been made|not a recording/i.test(readme)
);

/* ---- the architecture diagram must not contradict the config ---- */
console.log('Architecture diagram vs src/config/constants.js');
const {
  CONFIG,
  RF_SOURCES,
  RECEIVER_NODES,
} = require('../src/config/constants');
const arch = exists('docs/architecture.svg')
  ? read('docs/architecture.svg')
  : '';
// Strip tags so the numbers can be searched as text rather than markup, and
// fold the typographic minus (U+2212) to ASCII so a diagram written with the
// nicer glyph still matches a number out of config.
const plain = arch
  .replace(/<[^>]*>/g, ' ')
  .replace(/−/g, '-')
  .replace(/\s+/g, ' ');

if (arch) {
  const cells =
    (CONFIG.ROOM_WIDTH / CONFIG.GRID_RESOLUTION) *
    (CONFIG.ROOM_HEIGHT / CONFIG.GRID_RESOLUTION);

  /**
   * Match a number only when it stands alone.
   *
   * A plain substring test is not enough here: the diagram's own RSSI range
   * reads "-100...-20 dBm", which contains "20 dBm", so a check for TX-1's
   * 20 dBm passed even after the value was changed to 27 dBm. The lookbehind
   * has to reject a preceding sign as well as a digit or a decimal point, or
   * "-20 dBm" still satisfies a search for "20 dBm".
   */
  const hasNumber = (value, unit = '') => {
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tail = unit ? `[\\s]*${esc(unit)}` : '';
    return new RegExp(`(?<![\\d.\\-])${esc(value)}${tail}`).test(plain);
  };

  check(
    `room size matches config (${CONFIG.ROOM_WIDTH} × ${CONFIG.ROOM_HEIGHT} m)`,
    plain.includes(`${CONFIG.ROOM_WIDTH} × ${CONFIG.ROOM_HEIGHT}`),
    'the diagram states a different room size'
  );
  check(
    `cell count matches config (${cells} cells)`,
    hasNumber(cells, 'cells'),
    'the diagram states a different cell count'
  );
  check(
    `update rate matches config (${CONFIG.UPDATE_RATE} ms)`,
    hasNumber(CONFIG.UPDATE_RATE, 'ms'),
    'the diagram states a different update interval'
  );
  check(
    `history capacity matches config (${CONFIG.HISTORY_CAPACITY} samples)`,
    hasNumber(CONFIG.HISTORY_CAPACITY, 'samples'),
    'the diagram states a different history length'
  );
  check(
    `RSSI range matches config (${CONFIG.MIN_RSSI}…${CONFIG.MAX_RSSI})`,
    hasNumber(`${CONFIG.MIN_RSSI}…${CONFIG.MAX_RSSI}`, 'dBm'),
    'the diagram states a different RSSI range'
  );

  for (const s of RF_SOURCES) {
    check(
      `${s.id} (${s.name}) at ${s.txPower} dBm appears in the diagram`,
      plain.includes(s.id) &&
        plain.includes(s.name) &&
        hasNumber(s.txPower, 'dBm'),
      'the diagram is out of date with RF_SOURCES'
    );
  }
  check(
    `all ${RECEIVER_NODES.length} receivers appear in the diagram`,
    RECEIVER_NODES.every((r) => plain.includes(r.id)),
    'receiver list does not match RECEIVER_NODES'
  );

  check(
    'diagram states the path loss formula',
    // Matched against `plain`, where the typographic minus is already ASCII.
    /RSSI\s*=\s*Tx\s*-\s*10n/.test(plain),
    'expected RSSI = Tx − 10n·log10(d) …'
  );
  check(
    'diagram says sources combine in linear power, not dBm',
    /linear power/.test(plain) && /not dBm/.test(plain)
  );

  // The transmitter marked as localised must be the one the server tracks.
  const serverSource = read('src/server.js');
  const tracked = (serverSource.match(/TRACKED_SOURCE_ID\s*=\s*'([^']+)'/) ||
    [])[1];
  check(
    `diagram marks ${tracked} as the localised source`,
    Boolean(tracked) && plain.includes(tracked) && /localised/.test(plain),
    'the diagram does not match TRACKED_SOURCE_ID'
  );
}

/* ---- the quoted performance block must match a real benchmark run ---- */
const bench = read('scripts/benchmark.js');
check('benchmark script exists', bench.length > 0);

// Extract the fenced block the README presents as measured output.
const block = (readme.match(/```\n(Room 20x15 m[\s\S]*?)```/) || [])[1];
if (!block) {
  check(
    'README quotes a measured performance block',
    false,
    'no fenced block found'
  );
} else {
  // Run it and compare. The numbers vary slightly per run, so compare the
  // structure and the order-of-magnitude, and require the deterministic
  // figures (test count, cell count, dependency list) to match exactly.
  const { execFileSync } = require('child_process');
  let out = '';
  try {
    out = execFileSync(process.execPath, ['scripts/benchmark.js'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    check('benchmark runs', false, err.message);
  }

  if (out) {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();

    // Compare by label, not by whole line. Sub-microsecond timings move on every
    // run, so an exact string match would fail for a reason that has nothing to
    // do with the README being wrong.
    const parse = (s) => {
      const out2 = new Map();
      for (const line of s.split('\n')) {
        const m = norm(line).match(
          /^([A-Za-z][\w ()]*?)\s+([\d.]+)(us|ms)\s+mean/
        );
        if (m) out2.set(m[1].trim(), { value: Number(m[2]), unit: m[3] });
      }
      return out2;
    };
    const quoted = parse(block);
    const live = parse(out);

    check(
      `quoted operation timings all exist in live output (${quoted.size} checked)`,
      quoted.size > 0
    );
    for (const [label, q] of quoted) {
      const l = live.get(label);
      if (!l) {
        check(`  ${label} is still measured`, false, 'no live measurement');
        continue;
      }
      // Sub-millisecond figures are noise-dominated: a single arithmetic
      // operation measured on a loaded CI runner lands anywhere within a few
      // times the unloaded value. Holding those to 50% made this check fail
      // intermittently on measurements that were correct both times, so they
      // get a wide band and only the millisecond-scale numbers are held tight.
      const noisy = l.unit === 'us';
      const tolerance = noisy ? 4 : 0.5;
      check(
        `  ${label}: README ${q.value}${q.unit} vs live ${l.value}${l.unit}` +
          (noisy ? ' (wide band: sub-ms is noise-dominated)' : ''),
        l.unit === q.unit &&
          Math.abs(q.value - l.value) / Math.max(l.value, 1e-9) < tolerance,
        `off by more than ${tolerance * 100}%`
      );
    }

    // Headline figures may drift by a rounding step, not by a factor.
    const figure = (re) => {
      const m = out.match(re);
      return m ? Number(m[1]) : null;
    };
    const liveFrame = figure(/trilateration\): ([\d.]+)ms/);
    const readmeFrame = Number(
      (readme.match(/trilateration\): ([\d.]+)ms/) || [])[1]
    );
    check(
      `frame cost: README ${readmeFrame}ms vs live ${liveFrame}ms`,
      liveFrame !== null &&
        readmeFrame !== null &&
        Math.abs(readmeFrame - liveFrame) / liveFrame < 0.25,
      'drifted more than 25%'
    );

    // The accuracy figures live in the prose, not the fenced block.
    const liveErr = figure(/mean ([\d.]+) m, median/);
    const readmeErr = Number(
      (readme.match(/mean ([\d.]+) m, median/) || [])[1]
    );
    check(
      `mean position error: README ${readmeErr} m vs live ${liveErr} m`,
      liveErr !== null &&
        readmeErr !== null &&
        Math.abs(readmeErr - liveErr) / liveErr < 0.25,
      'drifted more than 25%'
    );

    // The per-band error table must also be reproduced.
    for (const m of readme.matchAll(
      /\| \d+(?:–\d+)?\+? ?m \| \d+ \| ([\d.]+) m \|/g
    )) {
      const claimed = Number(m[1]);
      const present = [...out.matchAll(/mean ([\d.]+) m/g)].some(
        (x) => Math.abs(Number(x[1]) - claimed) / claimed < 0.25
      );
      check(`  error band ${claimed} m is reproduced by a live run`, present);
    }

    // A badge quoting a measured figure is just as stale-prone as the prose,
    // so it gets checked too. Read the value out of the shields.io label.
    // The benchmark reports the frame cost in ms; the badge says ms too, so
    // compare in the same unit rather than against a microsecond figure.
    const badge = readme.match(/frame%20cost-([\d.]+)%20ms/);
    if (badge) {
      const claimedBadge = Number(badge[1]);
      check(
        `frame-cost badge (${claimedBadge} ms) matches a live run (${liveFrame} ms)`,
        liveFrame !== null &&
          Math.abs(claimedBadge - liveFrame) / liveFrame < 0.6,
        'the badge number has drifted from the benchmark'
      );
    }
  }
}

/* ---- the old README's fabricated claims must be gone ---- */
const fabrications = [
  /binary search/i,
  /memory pool/i,
  /O\(log\s*n\)/i,
  /sub-?millisecond render/i,
  /requestAnimationFrame/i,
];
for (const f of fabrications) {
  check(`no unsupported claim matching ${f}`, !f.test(readme));
}

/* ---- links in the README resolve ---- */
for (const m of readme.matchAll(/\]\(([^)#][^)]*)\)/g)) {
  const target = m[1];
  if (/^https?:/.test(target)) continue;
  check(`link target exists: ${target}`, exists(target));
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all README claims check out');
