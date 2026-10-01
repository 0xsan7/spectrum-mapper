/**
 * Check the README's factual claims against the code, so a stale number or an
 * unimplemented feature cannot ship as documentation.
 *
 *   node scripts/verify-readme.js
 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const YAML = require('yaml');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const readme = read('README.md');
const pkg = JSON.parse(read('package.json'));

/* ---- the split-out documentation ----
 *
 * "The model", "Performance" and "Testing" live in docs/ so the front page can
 * be read in a minute. That means several claims are no longer in README.md,
 * and a verifier that kept looking there would report them missing - or worse,
 * quietly skip them.
 *
 * These files are required. A missing one is a failure, never an empty string
 * that every regex then declines to match: an absent document would otherwise
 * turn a dozen checks green by having nothing to say.
 */
const DOCS = {
  'docs/model.md': null,
  'docs/performance.md': null,
  'docs/testing.md': null,
  'docs/architecture.md': null,
};

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

/* ---- the screenshot the README shows ----
 *
 * The README embeds docs/screenshot.png. A missing file renders as a broken
 * image, which is exactly the "implies something exists that does not" problem
 * the hero placeholder was deleted for, so this has to be a hard failure.
 */
const SCREENSHOT = 'docs/screenshot.png';
check(
  'README embeds docs/screenshot.png',
  new RegExp(`<img src="${SCREENSHOT.replace(/\//g, '\\/')}"[^>]*>`).test(
    readme
  )
);
check(
  `${SCREENSHOT} exists`,
  exists(SCREENSHOT),
  'the README references it; see docs/README-hero.md for how to capture one'
);
if (exists(SCREENSHOT)) {
  const abs = path.join(ROOT, SCREENSHOT);
  const bytes = fs.readFileSync(abs);
  // read() above returns utf8 text, so the PNG signature has to be read as
  // bytes - asking a string for .subarray() throws and takes the verifier down
  // with it instead of reporting a failure.
  check(
    `${SCREENSHOT} is a non-empty PNG`,
    bytes.length > 8 && bytes.subarray(1, 4).toString('latin1') === 'PNG',
    `${bytes.length} bytes, or no PNG signature`
  );
}

/* ---- load the split-out docs, failing loudly if any is absent ---- */
for (const file of Object.keys(DOCS)) {
  if (!exists(file)) {
    check(`${file} exists`, false, 'the README links to it; it was moved out');
    // Keep the key present as an empty string so the regex checks below run
    // and fail, rather than throwing on undefined.
    DOCS[file] = '';
  } else {
    DOCS[file] = read(file);
    check(`${file} exists`, true);
  }
}
const modelDoc = DOCS['docs/model.md'];
const perfDoc = DOCS['docs/performance.md'];
const testingDoc = DOCS['docs/testing.md'];
const archDoc = DOCS['docs/architecture.md'];

// The README must link to each of them, or the content is unreachable.
for (const file of [
  'docs/model.md',
  'docs/performance.md',
  'docs/testing.md',
  'docs/architecture.md',
]) {
  check(`README links to ${file}`, readme.includes(`(${file})`));
}

/* ---- the suite runner ----
 *
 * There used to be a check that the README's hard-coded test count matched the
 * number of `test(` calls in test/. It was correct, and it fired on every
 * commit that added or removed a test - including commits that had nothing to
 * do with the README. The count is now stated nowhere in the docs, so there is
 * nothing to keep in sync; what is still worth checking is that the project
 * keeps using the built-in runner and not a framework.
 */

// Scoped to the two places a suite size would be stated, and it has to be a
// claim about the suite rather than a number in passing prose. A blanket
// search for "N tests" also matches the bug history - "15 of 28 tests fail"
// describes a past run of an earlier suite, and failing on that would be
// wrong. So: a number that is not part of "N of M", and not adjacent to
// words like "fail" or "passed".
// Where a hard-coded suite count could hide. This used to read a "## Testing"
// section, which no longer exists on the front page - and matching a section
// that is not there yields an empty string, which no regex can match, which
// made the check pass by finding nothing. So it scans the whole README plus
// every split-out document instead, and keys off no section name at all.
const countScopes = [['README.md', readme], ...Object.entries(DOCS)];
// Every `sh` block, not just the first: the first one is the clone
// instructions, and the npm command block is a different one further down.
const shBlocks = [...readme.matchAll(/^```sh[\s\S]*?^```/gm)].map((m) => m[0]);
// A number that is not part of "N of M", and not adjacent to words like
// "fail" or "passed". Those two shapes describe a past run of an earlier suite,
// and failing on them would be wrong.
const countIsAClaim = (s) =>
  [...s.matchAll(/^.*?\b\d+\s+tests?\b.*$/gm)].some(
    (line) =>
      !/\d+\s+of\s+\d+\s+tests?\b/.test(line) &&
      !/\b(fail|failed|pass|passed|broke|broken|green|red)\b/i.test(line)
  );
const countOffenders = countScopes
  .filter(([, body]) => countIsAClaim(body))
  .map(([file]) => file);
check(
  'no document hard-codes a test count',
  countOffenders.length === 0 && shBlocks.every((b) => !countIsAClaim(b)),
  countOffenders.length
    ? `a bare number goes stale on every commit that adds a test: ${countOffenders.join(', ')}`
    : ''
);
check(
  'the suite is described as running on node:test',
  /node:test/.test(readme) || /node:test/.test(testingDoc),
  'say how the suite is run, in the README summary or docs/testing.md'
);
/* ---- the Docs table ----
 *
 * Six documents, one row each, every target a real file. A table that quietly
 * loses a row is worse than no table: the reader assumes the list is complete.
 */
const DOCS_TABLE = [
  ['Model', 'docs/model.md'],
  ['Architecture', 'docs/architecture.md'],
  ['Performance', 'docs/performance.md'],
  ['Testing', 'docs/testing.md'],
  ['Real data', 'docs/real-data.md'],
  ['File tree', 'docs/tree.md'],
  ['Changelog', 'CHANGELOG.md'],
];
const docsSection =
  (readme.match(/^## Docs\b[\s\S]*?(?=^## )/m) || [])[0] || '';
check('README has a Docs section', docsSection.length > 0);
for (const [label, target] of DOCS_TABLE) {
  check(
    `Docs table links ${label} to ${target}`,
    docsSection.includes(`[${label}](${target})`)
  );
  check(`${target} exists`, exists(target));
}
check(
  'Docs section links nothing else',
  (docsSection.match(/\]\(([^)]+)\)/g) || []).length === DOCS_TABLE.length,
  'every row must be one of the documents above'
);
check(
  'the stub sections are gone',
  !/^## (Testing|Performance)\b/m.test(readme),
  'the Docs table replaced them'
);

check(
  'docs/testing.md describes the suite',
  /node:test/.test(testingDoc),
  'the moved testing document must say how the suite runs'
);
check('README does not claim a framework', !/jest|mocha|vitest/i.test(readme));

/* ---- bug history belongs in the changelog ----
 *
 * The docs used to carry retrospectives - "an earlier version set it to zero",
 * "made 15 of 28 tests fail". They are good writing and they belong in one
 * place: CHANGELOG.md, where the reader goes looking for them. Left in the
 * reference docs they read as caveats about the current behaviour rather than
 * as history, and they duplicate what the changelog already says.
 */
check(
  'CHANGELOG.md exists',
  exists('CHANGELOG.md'),
  'the bug history has to live somewhere'
);
if (exists('CHANGELOG.md')) {
  const changelog = read('CHANGELOG.md');
  check(
    'CHANGELOG has a 1.1.0 entry',
    /^##\s+\[?1\.1\.0\]?/m.test(changelog),
    'expected a "## [1.1.0]" heading'
  );
  check(
    'CHANGELOG records the fixed bugs',
    /###\s+Fixed/.test(changelog),
    'expected a Fixed section'
  );
  // The changelog heading and package.json must name the same release, or the
  // notes describe a version nobody is on.
  const newest = (changelog.match(/^##\s+\[?([\d.]+)\]?/m) || [])[1];
  check(
    `CHANGELOG's newest entry matches package.json (${pkg.version})`,
    newest === pkg.version,
    newest
      ? `changelog says ${newest}, package.json says ${pkg.version}`
      : 'no version heading'
  );
}
const RETROSPECTIVES =
  /earlier version|previous version|the previous (README|version)|used to report|real bug\b|motivated it/i;
for (const [file, body] of [
  ['docs/model.md', modelDoc],
  ['docs/performance.md', perfDoc],
  ['docs/testing.md', testingDoc],
]) {
  const offenders = body.split('\n').filter((l) => RETROSPECTIVES.test(l));
  check(
    `${file} carries no bug history`,
    offenders.length === 0,
    offenders.length
      ? `move to CHANGELOG.md: "${offenders[0].trim().slice(0, 60)}"`
      : ''
  );
}

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
// Every server module must be accounted for somewhere in the documentation.
// The module table lives in docs/architecture.md now, so "documented" spans the
// front page and the architecture doc rather than the README alone.
const documented = `${readme}\n${archDoc}`;
for (const f of named) {
  check(
    `${f} exists and is named in the docs`,
    exists(f) && documented.includes(f)
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

/*
 * Every key in CONFIG is a knob somebody will read about. Adding a knob and
 * forgetting to document it is the usual way this docs rot, and nothing else in
 * the suite notices: the value simply works, undocumented.
 *
 * Both surfaces are checked because they drift independently - the README table
 * is for readers, .env.example is what gets copied into a real .env.
 */
{
  const constants = read('src/config/constants.js');
  const keys = [
    ...new Set(
      [...constants.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1])
    ),
  ].sort();

  const envExample = read('.env.example');
  // The docs count as coverage for a key, since a few of them are only
  // meaningful with prose rather than a table row.
  // The tracked-file list comes from git rather than a glob, so an untracked
  // doc cannot quietly satisfy the check.
  const docs = execFileSync('git', ['ls-files', 'docs/*.md'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((f) => read(f))
    .join('\n');
  const prose = `${readme}${docs}`;

  const missingEverywhere = keys.filter((k) => !prose.includes(k));
  check(
    `every CONFIG key is documented somewhere (${keys.length} keys)`,
    missingEverywhere.length === 0,
    `undocumented: ${missingEverywhere.join(', ')}`
  );

  // .env.example is stricter on purpose: it is what gets copied into a real
  // .env, so prose in the README is not a substitute for the key being there.
  // Reading it the other way - "documented anywhere counts" - let
  // DEMO_MAX_CLIENTS be dropped from .env.example while the README table still
  // mentioned it, which is exactly the drift this is meant to catch.
  // Assigned, not merely named: the demo-mode prose in .env.example lists its
  // variables in a comment, so an "includes the name" check passed even after
  // the assignment line was deleted.
  const assigned = new Set(
    [...envExample.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1])
  );
  const missingFromEnv = keys.filter((k) => !assigned.has(k));
  check(
    `every CONFIG key is in .env.example (${keys.length} keys)`,
    missingFromEnv.length === 0,
    `missing from .env.example: ${missingFromEnv.join(', ')}`
  );
}

/*
 * render.yaml, checked rather than trusted.
 *
 * A blueprint is configuration: it can be wrong and nothing fails until
 * somebody deploys it, which is exactly when it is expensive. These are the
 * three values a public demo cannot work without, and a blueprint that has
 * silently lost one of them should fail here rather than in someone's browser.
 */
{
  check('render.yaml exists', exists('render.yaml'));

  if (exists('render.yaml')) {
    const blueprint = read('render.yaml');
    // YAML parse, not just a grep: a blueprint that is valid-looking but does
    // not parse is the failure mode worth catching.
    let parsed = null;
    try {
      parsed = YAML.parse(blueprint);
    } catch (err) {
      check('render.yaml parses as YAML', false, err.message);
    }
    if (parsed) {
      check('render.yaml parses as YAML', true);

      const svc = (parsed.services || [])[0] || {};
      check(
        'render.yaml declares one web service',
        (parsed.services || []).length === 1
      );
      check(
        'render.yaml builds from Docker',
        svc.type === 'web' && svc.runtime === 'docker'
      );
      check('render.yaml uses the free plan', svc.plan === 'free');
      // Render would default this to ./Dockerfile, so a wrong or missing path
      // is a build failure on deploy rather than a lint failure here.
      check(
        'render.yaml points at the Dockerfile',
        svc.dockerfilePath === './Dockerfile',
        `got ${JSON.stringify(svc.dockerfilePath)}`
      );
      check(
        'the path render.yaml names is a file in the repository',
        exists(String(svc.dockerfilePath || '').replace(/^\.\//, ''))
      );
      check(
        'render.yaml health-checks /healthz',
        svc.healthCheckPath === '/healthz',
        `got ${svc.healthCheckPath}`
      );

      // The values, not just the keys. Quoting matters: `value: 1` parses as the
      // number 1, and DEMO_MODE is compared against the string '1'.
      const vars = Object.fromEntries(
        (svc.envVars || []).map((v) => [v.key, v.value])
      );
      check(
        'render.yaml sets DEMO_MODE=1',
        vars.DEMO_MODE === '1',
        `got ${JSON.stringify(vars.DEMO_MODE)}`
      );
      check(
        'render.yaml sets HOST=0.0.0.0',
        vars.HOST === '0.0.0.0',
        `got ${JSON.stringify(vars.HOST)}`
      );

      // Cross-checked against the server, so a rename on either side is caught.
      const constants = read('src/config/constants.js');
      // DEMO_MODE is compared against the string '1' rather than parsed as a
      // number, so 'true' does not silently enable it. Match that shape.
      check(
        'DEMO_MODE is the name src/config/constants.js reads',
        /process\.env\.DEMO_MODE === '1'/.test(constants),
        "expected DEMO_MODE: process.env.DEMO_MODE === '1'"
      );
      check(
        'HOST is the name src/config/constants.js reads',
        constants.includes('process.env.HOST')
      );
      const serverSrc = read('src/server.js');
      check(
        '/healthz is the route the server actually serves',
        /app\.get\(\s*['"]\/healthz['"]/.test(serverSrc)
      );
    }
  }
}

// The reverse direction: a route that exists but is undocumented is the more
// likely drift, since adding an endpoint rarely prompts a README edit.
//
// Every HTTP method, not just GET. The first version matched only app.get, so
// the two ingest routes added later were checked in neither direction: the
// forward list did not contain them and the reverse scan could not see them.
// A route nobody documents is exactly the drift this is here to catch.
const registered = [
  ...new Set(
    [
      ...serverSrc.matchAll(
        /app\.(get|post|put|patch|delete)\(\s*'(\/[^']+)'/g
      ),
    ].map((m) => m[2])
  ),
];
for (const e of registered) {
  // Routes are documented in docs/architecture.md, which holds the API table.
  check(`${e} is documented in the docs`, archDoc.includes(e));
}

// A route the docs claim but the server does not serve is the other direction,
// and it is what catches a rename that leaves the table behind.
for (const m of archDoc.matchAll(
  /(GET|POST|PUT|PATCH|DELETE)\s+(\/[a-zA-Z0-9._/-]+)/g
)) {
  check(
    `${m[2]} is a real route (docs claim ${m[1]})`,
    registered.includes(m[2])
  );
}

// The ingest surface has its own page, and it is linked from the README's Docs
// table. Both directions.
check('docs/real-data.md exists', exists('docs/real-data.md'));
if (exists('docs/real-data.md')) {
  const realData = read('docs/real-data.md');
  for (const needle of [
    '/api/readings',
    '/api/import/readings.csv',
    '/api/export/measured.csv',
  ]) {
    check(`docs/real-data.md documents ${needle}`, realData.includes(needle));
  }
  // The page is only useful with a worked example, and the curl one is the
  // reason most people will open it.
  check(
    'docs/real-data.md has a curl example',
    /curl[^\n]*\/api\/readings/.test(realData)
  );
  // The sketch itself, not the word. Matching /ESP32/ passed even with the
  // example deleted, because the prose still said ESP32.
  check(
    'docs/real-data.md has the ESP32 sketch',
    /#include\s*<WiFi\.h>/.test(realData) && /HTTPClient/.test(realData)
  );
  check('docs/real-data.md states the CSV header', /x,y,rssi/.test(realData));
  check(
    'the README links to docs/real-data.md',
    /\]\(docs\/real-data\.md\)/.test(readme)
  );
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

/* ---- no fabricated demo ----
 *
 * There is no hero image. One used to be a grey placeholder block, kept so the
 * gap was visible rather than silent - but a placeholder still put an image
 * where a reader expects a recording, and the alt text had to spend a sentence
 * explaining that what they were looking at was not a demo. A comment saying
 * no recording exists is more honest and costs no vertical space.
 *
 * docs/README-hero.md is kept: it is the note saying how to make a real one.
 */
check('docs/README-hero.md exists', exists('docs/README-hero.md'));
check(
  'README references docs/README-hero.md',
  readme.includes('docs/README-hero.md')
);
check(
  // A screenshot is not a recording. docs/screenshot.png is a still capture of
  // the dashboard and is honest about what it is; what must not appear is
  // anything that reads as a demo having been captured - an animated GIF or
  // video, since none has been recorded.
  'README embeds no demo animation',
  !/<img[^>]+src="[^"]*\.(gif|webp|mov|mp4)"/i.test(readme),
  'no recording has been made; do not imply otherwise'
);
check(
  'README carries no hero placeholder image',
  !readme.includes('hero-placeholder.svg'),
  'the placeholder was removed on purpose'
);
check(
  'README says no recording has been made',
  /no demo gif yet|has not been made/i.test(readme),
  'state plainly that the demo is absent'
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

  // The full formula, in order. The old check only looked for
  // "RSSI = Tx - 10n", which matched a formula that had the reference loss in
  // the wrong place and omitted the wall term entirely.
  //
  // Expected: RSSI = Tx - PL(d0) - 10n*log10(d/d0) - walls - fading
  // Compared against `plain`, where the typographic minus is already ASCII and
  // the subscript zero / centred dot are normalised below.
  const formula = (s) =>
    s
      .replace(/−/g, '-') // U+2212 minus sign
      .replace(/₁/g, '1') // subscript one, in log₁₀
      .replace(/₀/g, '0') // subscript zero, in d₀
      .replace(/[·*]/g, ' ') // middot and asterisk
      .replace(/\s+/g, ' ');

  const formulaRe =
    /RSSI\s*=\s*Tx\s*-\s*PL\(d0\)\s*-\s*10\s*n\s*log10\(d\s*\/\s*d0\)\s*-\s*walls\s*-\s*fading/;

  // Every RSSI expression the diagram states must match, not just one of them.
  // The formula appears twice - once as the Path Loss block's label and once in
  // the footer - and a check built on .test() passes when the other copy still
  // says the right thing. So collect them all and require every match.
  const statedFormulas = (s) =>
    [...formula(s).matchAll(/RSSI\s*=\s*[^|]*?(?=RSSI|$)/g)]
      .map((m) => m[0].trim())
      .filter((t) => t.length > 8);

  const archFormulas = statedFormulas(plain);
  check(
    'diagram states at least one RSSI expression',
    archFormulas.length > 0,
    'found no "RSSI =" in the diagram'
  );
  const badArch = archFormulas.filter((t) => !formulaRe.test(`${t} `));
  check(
    `all ${archFormulas.length} diagram RSSI expressions state the full formula`,
    badArch.length === 0,
    badArch.length ? `wrong: ${badArch[0].slice(0, 70)}` : ''
  );
  check(
    'Mermaid fallback states the same formula',
    formulaRe.test(formula(archDoc)),
    'the fallback must match the diagram'
  );
  // The front page states the formula itself, in a fenced block under "The
  // model", so it is checked against the diagram like every other copy. An
  // earlier revision of this branch had no formula on the front page and no
  // check either; this one came back when the formula did.
  check(
    'README model section states the full formula',
    formulaRe.test(formula(readme)),
    'the fenced formula must match the diagram'
  );
  check(
    'docs/model.md derives the same expression',
    formulaRe.test(formula(modelDoc)),
    'the moved model document must match the diagram'
  );
  check(
    'docs/model.md states the log-distance law',
    /PL\(d\)\s*=\s*PL\(d0\)\s*\+\s*10/.test(formula(modelDoc)),
    'expected PL(d) = PL(d0) + 10 * n * log10(d / d0)'
  );
  check(
    'formula names the wall term',
    /-\s*walls\s*-/.test(formula(plain)) || /wallLoss/.test(plain),
    'walls contribute attenuation and the diagram must say so'
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
const block = (perfDoc.match(/```\n(Room 20x15 m[\s\S]*?)```/) || [])[1];
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

  const readmeErr = Number((perfDoc.match(/mean ([\d.]+) m, median/) || [])[1]);
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
  for (const m of perfDoc.matchAll(
    /\|\s*\d+(?:–\d+)?\+?\s*m\s*\|\s*\d+\s*\|\s*([\d.]+) m\s*\|/g
  )) {
    const claimed = m[1];
    check(
      `  error band ${claimed} m is reproduced by the simulation`,
      bandMeans.has(claimed),
      `computed bands: ${[...bandMeans].join(', ')} m`
    );
  }

  /* ---- the front page's headline accuracy figures ----
   *
   * The features list claims "about 1.8 m near the centre and 5.5 m at the
   * edges". Those are the first and last distance bands - errors bucketed by
   * how far the target was from the middle of the room, which is what
   * localisation-errors.js computes. "About" means the claim is checked at the
   * precision it is written to: 1.8 against 1.80 exactly, 5.5 against 5.46
   * rounded to one decimal. Comparing to full precision would fail on a figure
   * that is correct as written, and comparing loosely would pass on a wrong one.
   */
  const centre = acc.bands[0];
  const edge = acc.bands[acc.bands.length - 1];
  // Matched against a whitespace-flattened copy: Prettier wraps this bullet
  // between "at" and "the edges", and a pattern spanning that break never
  // matches however correct the text is.
  const flat = readme.replace(/\s+/g, ' ');
  const claim = (() => {
    const m = flat.match(
      /Localises the mobile transmitter to about ([\d.]+) m near the centre and ([\d.]+) m at the edges/i
    );
    return m ? { centre: Number(m[1]), edge: Number(m[2]) } : null;
  })();
  check(
    'README states the centre and edge accuracy figures',
    claim !== null,
    'expected "about X m near the centre and Y m at the edges"'
  );
  if (claim) {
    check(
      `centre figure: README ${claim.centre} m vs computed ${centre.mean.toFixed(1)} m`,
      Math.abs(claim.centre - centre.mean) < 0.05,
      `computed ${centre.mean.toFixed(2)} m over ${centre.n} samples 0-${centre.hi} m from the centre`
    );
    check(
      `edge figure: README ${claim.edge} m vs computed ${edge.mean.toFixed(1)} m`,
      Math.abs(claim.edge - edge.mean) < 0.05,
      `computed ${edge.mean.toFixed(2)} m over ${edge.n} samples ${edge.lo}-${edge.hi} m from the centre`
    );
    check(
      'the accuracy claim names its conditions',
      /simulated/i.test(flat) && /3\s*dB fading/i.test(flat),
      'say it is simulated and name the fading'
    );
  }
}

/* ---- the supported Node range must agree everywhere it is stated ----
 * The README badge, the quick-start prose, package.json `engines` and the CI
 * matrix are four separate statements of the same fact, and nothing tied them
 * together: the badge said >=18, engines said >=18, and CI actually ran 20.
 * Check the lowest version in the CI matrix against engines, and the README
 * against engines, so they cannot drift apart again. */
/* ---- the bind address, in all four places it is stated ----
 *
 * constants.js, .env.example, the README table and the README limitations
 * bullet are four statements of one security-relevant default. They agreed
 * before this change; nothing held them together. The test suite covers each
 * of them too - this check exists so the README table cannot drift from the
 * code on its own, the way the Node badge did.
 */
{
  const constants = fs.readFileSync(
    path.join(ROOT, 'src/config/constants.js'),
    'utf8'
  );
  const hostMatch = constants.match(
    /HOST:\s*process\.env\.HOST\s*\|\|\s*'([^']+)'/
  );
  const defaultHost = hostMatch ? hostMatch[1] : null;
  check(
    'constants.js declares a HOST default',
    defaultHost !== null,
    "expected HOST: process.env.HOST || '<address>'"
  );
  if (defaultHost) {
    // Built by locating the row and reading the cell, rather than by matching
    // a pattern full of backticks: nesting those inside a template literal is
    // where this went wrong once.
    const hostRow = readme.split('\n').find((l) => /^\|\s*.HOST./.test(l));
    check(
      `README config table has a HOST row`,
      hostRow !== undefined,
      'the configuration table should list HOST'
    );
    if (hostRow !== undefined) {
      const cell = hostRow
        .split('|')
        .map((c) => c.trim().replace(/^[`]+|[`]+$/g, ''))
        .find((c) => c && c !== 'HOST' && c !== 'Default' && c !== 'Meaning');
      check(
        `README config table shows the HOST default (${defaultHost})`,
        cell === defaultHost,
        `the table says ${cell}, src/config/constants.js says ${defaultHost}`
      );
    }

    const escaped = defaultHost.replace(/\./g, '\\.');
    check(
      `.env.example shows the HOST default (${defaultHost})`,
      new RegExp(`^HOST=${escaped}$`, 'm').test(read('.env.example')),
      'a stale .env.example silently overrides the new default'
    );

    // The bullet has to describe the default that is actually in force, and
    // still say how to opt out of it.
    const stated = (readme.match(/binds `([\d.]+)` by default/) || [])[1];
    check(
      `limitations bullet names the HOST default (${defaultHost})`,
      stated === defaultHost,
      stated
        ? `the bullet says ${stated}, the code says ${defaultHost}`
        : 'no "binds `<address>` by default" in the limitations'
    );
    check(
      'limitations bullet still says how to expose it',
      readme.includes(
        `HOST=${defaultHost === '127.0.0.1' ? '0.0.0.0' : defaultHost}`
      ),
      'the change is only defensible if the escape hatch is documented'
    );

    // The image has to opt in, or `docker run -p 3000:3000` connects to nothing.
    //
    // Matched against the ENV instruction rather than the bare string: a
    // `/HOST=0\.0\.0\.0/` test also matches a comment saying the value used to
    // be there, which is precisely the case worth catching. Reinstating it as
    // prose is how the setting silently disappears.
    const dockerfile = read('Dockerfile');
    // ENV spans continuation lines:
    //   ENV NODE_ENV=production \
    //       PORT=3000 \
    //       HOST=0.0.0.0
    // so collect the instruction plus every line the previous one continues
    // into, then split it into KEY=VALUE pairs. A single regex over the raw
    // text stops at the first backslash, which silently drops HOST.
    const envPairs = (() => {
      const lines = dockerfile.split('\n');
      const start = lines.findIndex((l) => /^ENV\s/.test(l));
      if (start === -1) return [];
      const block = [lines[start].replace(/^ENV\s+/, '')];
      for (let k = start + 1; k < lines.length; k++) {
        if (!/\\\s*$/.test(lines[k - 1])) break;
        block.push(lines[k]);
      }
      return block
        .join(' ')
        .replace(/\\/g, ' ')
        .split(/\s+/)
        .map((p) => p.replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    })();
    const envHost = envPairs.find((p) => p.startsWith('HOST='));
    check(
      'the Dockerfile has an ENV instruction',
      envPairs.length > 0,
      'expected an ENV block'
    );
    check(
      'the Dockerfile ENV sets HOST=0.0.0.0',
      envHost === 'HOST=0.0.0.0',
      `ENV carries ${envHost || 'no HOST at all'}`
    );
    check(
      'the Dockerfile ENV still sets PORT=3000',
      envPairs.includes('PORT=3000'),
      `ENV pairs: ${envPairs.join(', ')}`
    );
    // And the whole point: the code's own default must still be loopback, or
    // this override is redundant and the safety came from somewhere else.
    check(
      'the code default is still loopback, so the override is load-bearing',
      defaultHost === '127.0.0.1',
      `CONFIG.HOST defaults to ${defaultHost}`
    );
  }
}

/* ---- the npm listing metadata ----
 *
 * package.json's description is what npm and GitHub show, and the README tagline
 * is what a reader sees on the page. They describe the same project, so the
 * README's key phrase has to appear in the description - otherwise the two
 * drift and the registry says one thing while the repo says another.
 *
 * The URLs are checked too, because they are easy to get wrong in a way that
 * still looks plausible: an ssh remote that does not exist, or a bugs URL
 * pointing somewhere harmless.
 */
{
  const meta = JSON.parse(read('package.json'));
  const desc = (meta.description || '').trim();
  check('package.json description is non-empty', desc.length > 20, desc);
  check(
    'package.json description mentions trilateration',
    /trilateration/i.test(desc)
  );

  // The README's tagline, read from the centred line under the title.
  const tagline =
    (readme.match(/<p align="center">\s*([^<\n]+?)\s*<\/p>/) || [])[1] || '';
  const keyPhrase = tagline.match(
    /(\d+\.\d+\s*GHz\s+RF\s+coverage\s+simulator)/i
  );
  check(
    'README has a tagline with the key phrase',
    keyPhrase !== undefined,
    tagline ? `tagline reads: ${tagline}` : 'no tagline found'
  );
  if (keyPhrase) {
    check(
      `package.json description carries the tagline phrase ("${keyPhrase[1]}")`,
      desc.toLowerCase().includes(keyPhrase[1].toLowerCase()),
      `description: ${desc}`
    );
  }

  const repoUrl = meta.repository?.url || '';
  const homepage = meta.homepage || '';
  const bugs = meta.bugs?.url || '';
  check('package.json has a repository URL', /spectrum-mapper/.test(repoUrl));
  check(
    'repository URL is a real https git URL',
    /^git\+https:\/\/github\.com\/0xsan7\/spectrum-mapper(\.git)?$/.test(
      repoUrl
    ),
    repoUrl
  );
  check(
    'homepage points at the README',
    homepage === 'https://github.com/0xsan7/spectrum-mapper#readme',
    homepage
  );
  check(
    'bugs URL is the issues page',
    bugs === 'https://github.com/0xsan7/spectrum-mapper/issues',
    bugs
  );
  check('package.json has an author', (meta.author || '').trim().length > 0);

  const kws = meta.keywords || [];
  check(
    'package.json has keywords',
    kws.length >= 10,
    `${kws.length} keywords`
  );
  check(
    'keywords are lower-case and hyphenated',
    kws.every((k) => /^[a-z0-9-]+$/.test(k)),
    kws.filter((k) => !/^[a-z0-9-]+$/.test(k)).join(', ')
  );
  // npm truncates a keywords list at 5 per field and this one fits, but a
  // keyword the README never mentions is dead weight in the listing.
  for (const k of ['rssi', 'heatmap', 'trilateration', 'path-loss']) {
    check(`keyword "${k}" is used in the project`, kws.includes(k));
  }
}

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
