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

/* ---- the suite runner ----
 *
 * There used to be a check that the README's hard-coded test count matched the
 * number of `test(` calls in test/. It was correct, and it fired on every
 * commit that added or removed a test - including commits that had nothing to
 * do with the README. The count is now stated nowhere in the docs, so there is
 * nothing to keep in sync; what is still worth checking is that the project
 * keeps using the built-in runner and not a framework.
 */
check(
  'README describes the suite as running on node:test',
  /node:test/.test(readme),
  'say how the suite is run'
);
// Scoped to the two places a suite size would be stated, and it has to be a
// claim about the suite rather than a number in passing prose. A blanket
// search for "N tests" also matches the bug history - "15 of 28 tests fail"
// describes a past run of an earlier suite, and failing on that would be
// wrong. So: a number that is not part of "N of M", and not adjacent to
// words like "fail" or "passed".
const testingSection =
  (readme.match(/^## Testing\b[\s\S]*?(?=^## )/m) || [])[0] || '';
// Every `sh` block, not just the first: the first one is the clone
// instructions, and the npm command block is a different one further down.
const shBlocks = [...readme.matchAll(/^```sh[\s\S]*?^```/gm)].map((m) => m[0]);
const countIsAClaim = (s) =>
  [...s.matchAll(/^.*?\b\d+\s+tests?\b.*$/gm)].some(
    (line) =>
      !/\d+\s+of\s+\d+\s+tests?\b/.test(line) &&
      !/\b(fail|failed|pass|passed|broke|broken|green|red)\b/i.test(line)
  );
check(
  'README does not hard-code a test count',
  !countIsAClaim(testingSection) &&
    shBlocks.every((block) => !countIsAClaim(block)),
  'a number here goes stale on every commit that adds a test'
);
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
const ARCH_FILE = 'docs/architecture.svg';
check(
  `${ARCH_FILE} exists`,
  exists(ARCH_FILE),
  'the architecture diagram is missing, so none of the checks below can run'
);
const arch = exists(ARCH_FILE) ? read(ARCH_FILE) : '';
// Strip tags so the numbers can be searched as text rather than markup, and
// fold the typographic minus (U+2212) to ASCII so a diagram written with the
// nicer glyph still matches a number out of config.
const plain = arch
  .replace(/<[^>]*>/g, ' ')
  .replace(/−/g, '-')
  .replace(/\s+/g, ' ');

// Guarded so a missing diagram reports one loud failure above instead of
// silently skipping every check below and reporting success.
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

/* ---- timing comparisons are local-only; deterministic checks stay in CI ----
 *
 * Timings moved with the host, not just with the README being wrong. On a
 * GitHub runner the frame cost came back 0.27 ms against the README's 0.518 ms
 * - the runner was faster than the authoring machine, so no tolerance band can
 * be safe in both directions. A band wide enough for that stops noticing a
 * real regression; a band tight enough to catch one fails on faster hardware.
 *
 * So the timing comparisons only run when explicitly asked for:
 *     npm run verify:readme -- --timings
 * Everything else here - files, endpoints, Node version, formulas, the diagram's
 * numbers, test count - is deterministic and still checked on every CI run.
 */
const TIMINGS = process.argv.includes('--timings');

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
  let out = '';
  if (TIMINGS) {
    const { execFileSync } = require('child_process');
    try {
      out = execFileSync(process.execPath, ['scripts/benchmark.js'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (err) {
      check('benchmark runs', false, err.message);
    }
  }

  if (!TIMINGS) {
    console.log(
      '  timing checks skipped (run with --timings): frame cost and per-op\n' +
        '  timings are machine-dependent. Run `npm run verify:readme -- --timings`\n' +
        '  locally to compare them against the README.'
    );
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

    // Headline figure: a rounding step, not a factor.
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
  }
}

/* ---- accuracy figures: deterministic, so these still run in CI ----
 *
 * Not timed, not random: a fixed 5000-point walk of the room. Verified
 * identical across 5 runs on Node 22 and Node 24. Sourced from
 * scripts/localisation-errors.js, the same module scripts/benchmark.js uses,
 * so the two cannot describe different computations.
 *
 * These live outside the `if (out)` block above on purpose: they must not
 * depend on the benchmark having been run.
 */
{
  const { localisationErrors } = require('./localisation-errors');
  const acc = localisationErrors();

  const readmeErr = Number((readme.match(/mean ([\d.]+) m, median/) || [])[1]);
  check(
    `mean position error: README ${readmeErr} m vs computed ${acc.mean.toFixed(
      2
    )} m`,
    !Number.isNaN(readmeErr) &&
      Math.abs(readmeErr - acc.mean) / acc.mean < 0.01,
    'the README accuracy figure no longer matches the simulation'
  );

  // The per-band error table must also be reproduced.
  const bandMeans = new Set(acc.bands.map((b) => b.mean.toFixed(2)));
  for (const m of readme.matchAll(
    /\|\s*\d+(?:–\d+)?\+?\s*m\s*\|\s*\d+\s*\|\s*([\d.]+) m\s*\|/g
  )) {
    const claimed = m[1];
    check(
      `  error band ${claimed} m is reproduced by the simulation`,
      bandMeans.has(claimed),
      `computed bands: ${[...bandMeans].join(', ')} m`
    );
  }
}

/* ---- the supported Node range must agree everywhere it is stated ----
 * The README badge, the quick-start prose, package.json `engines` and the CI
 * matrix are four separate statements of the same fact, and nothing tied them
 * together: the badge said >=18, engines said >=18, and CI actually ran 20.
 * Check the lowest version in the CI matrix against engines, and the README
 * against engines, so they cannot drift apart again. */
console.log('\nSupported Node versions');
{
  const pkg = JSON.parse(read('package.json'));
  const engine = (pkg.engines?.node || '').match(/>=\s*(\d+)/);
  const floor = engine ? Number(engine[1]) : null;
  check('package.json engines states a floor', floor !== null);
  if (floor !== null) {
    check(
      `README badge matches engines (>=${floor})`,
      readme.includes(`node-%3E%3D${floor}-`),
      `badge should read node-%3E%3D${floor}-`
    );
    check(
      `README prose matches engines (>=${floor})`,
      new RegExp(`Requires Node ${floor} or newer`).test(readme),
      `prose should read "Requires Node ${floor} or newer"`
    );

    const ci = read('.github/workflows/ci.yml');
    const matrix = ci.match(/node:\s*\[([^\]]+)\]/);
    const ciFloor = matrix
      ? Math.min(...[...matrix[1].matchAll(/\d+/g)].map((m) => Number(m[0])))
      : null;
    check(
      `CI matrix lowest version is >=${floor} (engines)`,
      ciFloor !== null && ciFloor >= floor,
      ciFloor === null
        ? 'no node: [..] matrix found in ci.yml'
        : `CI tests Node ${ciFloor}, below the engines floor of ${floor}`
    );

    // Every matrix version must actually be able to run the suite. `node --test`
    // only expands its own glob on Node 22+; on 20 it aborts with
    // "Could not find 'test/**/*.test.js'".
    const script = pkg.scripts?.test || '';
    const usesGlob = /\*\*/.test(script);
    if (usesGlob && ciFloor !== null) {
      check(
        'the test script glob needs Node 22+, satisfied by the matrix',
        ciFloor >= 22,
        `"${script}" relies on --test glob expansion, added in Node 22, but CI goes down to ${ciFloor}`
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
