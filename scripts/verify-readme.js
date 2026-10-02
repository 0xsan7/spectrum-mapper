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

/**
 * Report a measured number without asserting on it.
 *
 * Separate from `check` on purpose. A measurement that cannot fail is not a
 * check - it is a log line pretending to be one - and when every check is an
 * assertion it is easy to forget which is which. Anything printed here is
 * evidence a human can weigh; anything printed by `check` is load-bearing.
 */
function note(label, detail) {
  console.log(`  note  ${label}${detail ? `  (${detail})` : ''}`);
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
  ['Deploy', 'docs/deploy.md'],
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
 * One deployment URL, used consistently, and described honestly.
 *
 * The README, package.json and the deploy page each link the demo, and a
 * visitor who follows one and then reads another should not find two different
 * addresses. The honesty checks are here for the same reason: a link that works
 * but misdescribes what it leads to is worse than no link.
 */
{
  const DEMO_URL = 'https://spectrum-mapper-demo.onrender.com';
  const readmeText = read('README.md');
  const pkgJson = JSON.parse(read('package.json'));
  const deployText = read('docs/deploy.md');

  // The README link, directly under the nav block and labelled.
  check('README has a Live demo link', /Live demo/.test(readmeText));
  check(
    'the README demo link uses the deployment URL',
    new RegExp(
      `href="${DEMO_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`
    ).test(readmeText),
    'expected the nav link to point at the deployment'
  );
  check(
    'the README demo link sits under the nav links',
    readmeText.indexOf('Live demo') > readmeText.indexOf('#roadmap') &&
      readmeText.indexOf('Live demo') - readmeText.indexOf('#roadmap') < 400,
    'it should be near the top, not buried'
  );
  check(
    'the README says the free host sleeps and the first load is slow',
    /sleeps when idle/i.test(readmeText) &&
      /first load can take a while/i.test(readmeText)
  );
  check(
    'the README says everyone shares one room',
    // Normalised first: prettier reflows the prose, so the phrase spans two
    // lines and a literal match fails on formatting alone.
    /everyone shares one simulated room/i.test(readmeText.replace(/\s+/g, ' ')),
    'the shared-room warning belongs next to the link'
  );

  check(
    'package.json homepage is the deployment URL',
    pkgJson.homepage === DEMO_URL,
    String(pkgJson.homepage)
  );
  check(
    "deploy.md names the URL as the author's deployment",
    deployText.includes(DEMO_URL) &&
      /author/.test(deployText.split(DEMO_URL)[1] || ''),
    "the URL should be attributed, not presented as the reader's own"
  );
  check(
    'deploy.md still explains deploying your own copy',
    /deploy(ing)? \*\*your own\*\*/i.test(deployText) ||
      /New → Blueprint/.test(deployText)
  );

  // All three, one URL.
  check(
    'the README, package.json and deploy.md agree on the demo URL',
    readmeText.includes(DEMO_URL) &&
      pkgJson.homepage === DEMO_URL &&
      deployText.includes(DEMO_URL)
  );
  check(
    'no second onrender.com URL exists in those three files',
    [
      ...new Set(
        [
          ...`${readmeText}\n${pkgJson.homepage}\n${deployText}`.matchAll(
            /https?:\/\/[a-z0-9.-]*onrender\.com[a-z0-9./-]*/gi
          ),
        ].map((m) => m[0].toLowerCase())
      ),
    ].every((u) => u === DEMO_URL.toLowerCase()),
    'more than one deployment URL is present'
  );

  // Honesty: the sample survey must never be described as field data.
  for (const [f, text] of [
    ['README.md', readmeText],
    ['docs/deploy.md', deployText],
  ]) {
    check(
      `${f} does not call the bundled survey real measurements`,
      !/sample survey[^.]{0,80}\breal (measurements|readings|survey data)\b/i.test(
        text
      ) && !/real measurements[^.]{0,80}sample/i.test(text),
      'the shipped CSV is model output with offsets, not field data'
    );
  }
  check(
    'README says the bundled sample is not field data',
    /model output with small offsets/i.test(readmeText),
    'the provenance belongs next to the link'
  );
}

/*
 * The preloaded demo survey, documented and shipped.
 *
 * Four things have to be true at once, and the Dockerfile quietly broke one of
 * them: the Dockerfile copied src/ and public/ only, so a demo container had no
 * sample file to preload and would have failed to start. That is invisible to a
 * unit test, which reads the file from the working tree.
 */
{
  const serverSrc = read('src/server.js');
  const dockerfile = read('Dockerfile');
  const dockerignore = read('.dockerignore');
  const deploy = read('docs/deploy.md');
  const realData = read('docs/real-data.md');

  // The image has to carry the file.
  check(
    'the Dockerfile copies docs/examples into the image',
    /COPY\s+docs\/examples\s+\.\/docs\/examples/.test(dockerfile),
    'a demo container would have no sample file to preload'
  );
  const ignoreLines = dockerignore.split('\n').map((l) => l.trim());
  const samplePath = 'docs/examples/sample-readings.csv';
  check(
    '.dockerignore lets the sample CSV into the build context',
    ignoreLines.includes(`!${samplePath}`),
    'the file would be excluded before the Dockerfile ever sees it'
  );
  // Order matters and reading the file line-by-line does not catch it: a
  // negation above the exclusion it undoes is dead. Docker applies these in
  // order, so the last matching pattern wins.
  {
    const excludes = ignoreLines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l === 'docs/*' || l === 'docs/**' || l === 'docs');
    const negates = ignoreLines
      .map((l, i) => ({ l, i }))
      .filter(
        ({ l }) =>
          l === `!${samplePath}` ||
          l === '!docs/examples/' ||
          l === '!docs/examples'
      );
    const lastExclude = excludes.length ? excludes[excludes.length - 1].i : -1;
    const lastNegate = negates.length ? negates[negates.length - 1].i : -1;
    check(
      'the .dockerignore negation comes after any rule excluding docs/',
      lastNegate > lastExclude,
      'a negation before the exclusion is dead in Docker'
    );
    check(
      'no rule excludes docs/examples after the negation',
      !ignoreLines
        .slice(lastNegate + 1)
        .some((l) => l === 'docs/examples/*' || l === 'docs/examples/**'),
      'something re-excludes the sample file'
    );
  }
  check(
    'the sample file the preload reads is tracked in git',
    execFileSync('git', ['ls-files', 'docs/examples/sample-readings.csv'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim() === 'docs/examples/sample-readings.csv',
    'an untracked sample would work locally and fail in a clean checkout'
  );

  // The code actually does it.
  check(
    'the server preloads the sample only in demo mode',
    /if \(CONFIG\.DEMO_MODE\) \{\s*\n?\s*loadSampleReadings\(\);/.test(
      serverSrc
    )
  );
  check(
    'the preload path is built from docs/examples/sample-readings.csv',
    // Match the path.join segments, not the bare filename: the same literal
    // also appears in two error messages, so a check on the string alone passes
    // when the code has been pointed at a file that does not exist.
    /path\.join\(\s*__dirname,\s*'\.\.',\s*'docs',\s*'examples',\s*'sample-readings\.csv'\s*\)/.test(
      serverSrc.replace(/\s+/g, ' ')
    )
  );
  check(
    'the preload path resolves to a file that exists',
    exists('docs/examples/sample-readings.csv')
  );
  check(
    'the preload validates the file and throws rather than continuing',
    /sample-readings\.csv is invalid/.test(serverSrc)
  );
  check(
    'the reset restores the preload in demo mode',
    /if \(CONFIG\.DEMO_MODE\) \{\s*\n?\s*loadSampleReadings\(\);\s*\n?\s*\} else \{\s*\n?\s*readings\.clear\(\)/.test(
      serverSrc
    ),
    'the reset must put the survey back in a demo and empty the store otherwise'
  );

  // The docs must describe it, in both places a reader would look.
  check(
    'docs/deploy.md says the demo loads the sample survey',
    /sample survey is loaded at boot/i.test(deploy)
  );
  // "42" has to sit next to the survey, not be any 42 on the page: the page
  // quotes other numbers, and an unrelated one satisfied this.
  check(
    'docs/deploy.md states the survey has 42 readings',
    /with the 42 readings/i.test(deploy),
    'the count must be stated with the survey, not anywhere on the page'
  );
  check(
    'docs/deploy.md names the demo panel heading',
    /Sample survey \(demo data\)/.test(deploy)
  );
  check(
    'docs/deploy.md says the import control is hidden',
    /import control is hidden/i.test(deploy)
  );
  check(
    'docs/deploy.md does not claim the panel stays empty in a demo',
    !/stay in the UI and the requests come back/i.test(deploy),
    'the panel is populated now'
  );
  check(
    'docs/real-data.md has a demo section',
    /## In a public demo/.test(realData)
  );
  check(
    'docs/real-data.md says the store starts full in a demo',
    /starts full/i.test(realData)
  );
  check(
    'docs/real-data.md states the survey has 42 points',
    // Anchored to the sentence about the preloaded survey. A looser "42 near
    // the word points" passed on the JSON example, whose "accepted": 42 sits
    // within 40 characters of "points".
    /\*\*The store starts full, not empty\.\*\*[\s\S]{0,200}?\b42\b/.test(
      realData
    ),
    'the count must be stated in the sentence about the preloaded survey'
  );
  check(
    'docs/real-data.md says ingest answers 403 in a demo',
    /403/.test(realData)
  );
  check(
    'docs/real-data.md says the reset restores the survey',
    /reset restores that survey/i.test(realData)
  );
  check(
    'docs/real-data.md links the sample file it names',
    /\]\(examples\/sample-readings\.csv\)/.test(realData),
    'expected a markdown link to examples/sample-readings.csv'
  );
  check(
    'the file real-data.md links is the one the preload reads',
    /\]\(examples\/sample-readings\.csv\)/.test(realData) &&
      /sample-readings\.csv/.test(serverSrc) &&
      exists('docs/examples/sample-readings.csv'),
    'the docs and the code should be talking about the same file'
  );
}

/*
 * The demo-mode UI, checked for the two states that matter.
 *
 * A control that stays visible in a demo invites a click that can only fail
 * (ingest answers 403), and a heading that still says "Measured" implies the
 * readings are somebody's when they are the bundled sample. Both are driven
 * from the server's frame flag, so the checks below are about the wiring, and
 * the browser harness in the scratch directory is what proves the pixels.
 */
{
  const dash = read('public/dashboard.js');
  const html = read('public/index.html');
  const serverSrc = read('src/server.js');

  check(
    'the Measured heading has an id the client can relabel',
    /id="measuredHeading"/.test(html)
  );
  check(
    'the import control is wrapped so the client can hide it',
    /id="csvImportControl"/.test(html)
  );
  check(
    'the demo heading text is "Sample survey (demo data)"',
    /Sample survey \(demo data\)/.test(dash)
  );
  check(
    'the heading reverts to "Measured" outside a demo',
    /demo \? 'Sample survey \(demo data\)' : 'Measured'/.test(dash)
  );
  check(
    'the import control is hidden when the frame says demo',
    /importControl\.hidden = demo/.test(dash)
  );
  check(
    'demo chrome is driven by the server flag, not a build-time constant',
    /updateDemoChrome\(data\)/.test(dash) &&
      /Boolean\(data && data\.demo\)/.test(dash)
  );
  check(
    'the demo chrome runs before the panel body that reads its flag',
    dash.indexOf('this.updateDemoChrome(data);') <
      dash.indexOf('this.updateMeasuredPanel();'),
    'the panel would render one frame with the wrong wording'
  );
  check(
    'clearReadings is refused in demo mode',
    /case 'clearReadings':[\s\S]{0,400}?CONFIG\.DEMO_MODE/.test(serverSrc)
  );
}

/*
 * docs/deploy.md, checked for the things that are easy to state wrongly.
 *
 * A deploy page is read once, by someone about to spend an afternoon on it. The
 * numbers come from the platform's documentation and drift, so the shape of the
 * claim is checked here rather than trusted.
 */
{
  check('docs/deploy.md exists', exists('docs/deploy.md'));

  if (exists('docs/deploy.md')) {
    const deploy = read('docs/deploy.md');

    // It has to describe deploying, not merely exist.
    check(
      'docs/deploy.md describes the blueprint steps',
      /New → Blueprint/.test(deploy) && /fork/i.test(deploy)
    );
    check(
      'docs/deploy.md explains why HOST must be 0.0.0.0',
      /0\.0\.0\.0/.test(deploy) && /loopback/i.test(deploy)
    );
    check(
      'docs/deploy.md says what happens when the free tier sleeps',
      /spin(?:s|ning)? down|sleeping/i.test(deploy) &&
        /15 minutes/i.test(deploy)
    );
    // Both halves, not either: "cold start" alone could sit in a sentence that
    // never says how long it takes, which is the part a visitor feels.
    check(
      'docs/deploy.md names the cold start and how long it takes',
      /cold start/i.test(deploy) && /(about|roughly) a minute/i.test(deploy)
    );
    check(
      'docs/deploy.md cites Render for the spin-down behaviour',
      /render\.com\/docs\/free/.test(deploy)
    );
    // Require the warning rather than negating a list of phrasings. Negating
    // specific wording only catches those wordings: replacing Render's
    // "do not use free instances for production" with "free instances are
    // production ready" sailed past a check that only looked for "free
    // instances are production".
    check(
      'docs/deploy.md warns that the free plan is not for production',
      /not to use free\s+instances for production|free instances are not for production|do not use free instances/i.test(
        deploy.replace(/\s+/g, ' ')
      )
    );

    // Which links are allowed, and why it is an exact-URL allowlist.
    //
    // This used to forbid every host except Render and GitHub. It now permits
    // exactly one deployment URL, and only that one - not "anything on
    // onrender.com". A host-level allowlist would wave through a typo'd or
    // somebody else's service, which is the failure this check exists to catch.
    const DEMO_URL = 'https://spectrum-mapper-demo.onrender.com';
    const allowedExactUrls = new Set([DEMO_URL.toLowerCase()]);

    const urlsIn = (text) => [
      ...new Set(
        [...text.matchAll(/https?:\/\/[^\s)\]>"'`]+/gi)].map((m) =>
          m[0].replace(/[.,;:]$/, '').toLowerCase()
        )
      ),
    ];

    // The hosts this project legitimately links: badge images, Node, GitHub,
    // Render, and localhost in the curl examples. Anything else is a mistake.
    const allowedHosts =
      /^(www\.|dashboard\.)?(render\.com|img\.shields\.io|nodejs\.org|localhost(:\d+)?|127\.0\.0\.1(:\d+)?|github\.com|docs\.github\.com|your-service)$/;
    const stray = urlsIn(deploy).filter((u) => {
      if (allowedExactUrls.has(u)) return false;
      const host = u.replace(/^https?:\/\//, '').split('/')[0];
      return !allowedHosts.test(host);
    });
    check(
      'docs/deploy.md links only to Render, the repository, or the one demo URL',
      stray.length === 0,
      `unexpected URLs: ${stray.join(', ')}`
    );

    // The same rule everywhere, so a stray demo URL cannot be introduced into
    // another file to dodge the deploy.md check.
    for (const f of ['README.md', 'package.json', 'render.yaml']) {
      const strayElsewhere = urlsIn(read(f)).filter((u) => {
        if (allowedExactUrls.has(u)) return false;
        const host = u.replace(/^https?:\/\//, '').split('/')[0];
        return !allowedHosts.test(host);
      });
      check(
        `${f} links only to Render, the repository, or the one demo URL`,
        strayElsewhere.length === 0,
        `unexpected URLs: ${strayElsewhere.join(', ')}`
      );
    }

    // The blueprint values it documents must be the ones in the blueprint, or
    // the page is describing a deploy that does not happen.
    const blueprint = read('render.yaml');
    check(
      'render.yaml is still there to deploy',
      blueprint.includes('services:')
    );
    check(
      'docs/deploy.md states DEMO_MODE=1, as render.yaml sets it',
      deploy.includes('DEMO_MODE=1') && /value: '1'/.test(blueprint)
    );
    check(
      'docs/deploy.md states HOST=0.0.0.0, as render.yaml sets it',
      deploy.includes('HOST=0.0.0.0') && blueprint.includes('value: 0.0.0.0')
    );
    check(
      'docs/deploy.md names the health check the blueprint uses',
      deploy.includes('/healthz') &&
        blueprint.includes('healthCheckPath: /healthz')
    );
  }
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

/* ---- keyboard shortcuts: implemented AND documented ----
 *
 * Both halves are required. The previous form was `implemented || documented`,
 * which passed whenever the README mentioned a key that no code handled - a
 * documented shortcut that silently does nothing is the exact failure worth
 * catching here.
 *
 * The implementation side looks for the key inside its own `case` arm, so an
 * unrelated mention of "r" somewhere in the file cannot stand in for a
 * handler. Comments are stripped first, or a commented-out arm counts.
 */
const shortcuts = read('public/shortcuts.js');
const shortcutSource = shortcuts
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

for (const [key, name, action] of [
  [' ', 'Space', 'pause'],
  ['r', 'R', 'reset'],
  ['w', 'W', 'wall'],
  ['m', 'M', 'cycleMapMode'],
  ['k', 'K', 'cycleRamp'],
]) {
  const arm = shortcutSource.match(
    new RegExp(
      `case '${key === ' ' ? ' ' : key}'\\s*:([\\s\\S]{0,400}?)\\n\\s*break;`
    )
  );
  const implemented = Boolean(arm) && arm[1].includes(action);
  // Required in the Controls table specifically. `readme.includes('K`')` was
  // satisfied by a passing mention in the feature list, which is exactly the
  // failure this is meant to catch: a shortcut nobody can find.
  const controls = (readme.split('### Controls')[1] || '').split('###')[0];
  check(`${name} is implemented`, implemented);
  check(
    `${name} is documented in the controls table`,
    controls.includes(`\`${name}\``)
  );
}

/* ---- the colour ramp is a real, documented choice ----
 *
 * The map, the legend and the badge all have to agree, and the README has to
 * admit the default is not the old blue-red ramp - otherwise the legend in
 * docs/screenshot.png contradicts the claim.
 */
/**
 * Strip comments before matching.
 *
 * Without this a check that greps for a name is satisfied by a comment
 * mentioning it - which is how "the theme toggle is wired" was once satisfied
 * by a commented-out ThemeToggle.wire(), and how the Oklab check below was
 * satisfied by prose describing the conversion.
 */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Whole-line comments, and trailing ones after a line of code. The trailing
    // form was previously missed, so `px[at] = 0; // point.rssi === null` left
    // its comment in place for a grep to find.
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+\/\/[^\n]*$/gm, '');

const colorsJs = read('public/colors.js');
const heatmapJs = read('public/heatmap.js');
check(
  'a perceptual ramp is the default, not the old blue-red one',
  /DEFAULT_RAMP\s*=\s*'inferno'/.test(colorsJs)
);
check(
  'a colour-blind-safe ramp is offered',
  /cividis/.test(colorsJs) && /designed for deuteranopia/.test(colorsJs)
);
const colorsCode = stripComments(colorsJs);
check(
  'interpolation happens in Oklab, not sRGB',
  // Bodies, not names: the file explains the maths in prose, so a name-only
  // match is satisfied by the comment that introduces it.
  /static srgbToOklab\(r, g, b\)\s*\{[\s\S]{80,}?Math\.cbrt/.test(colorsCode) &&
    /static oklabToSrgb\(L, a, bb\)\s*\{[\s\S]{80,}?Math\.pow/.test(colorsCode)
);
check(
  'the colour data carries its licence and provenance',
  /matplotlib/.test(colorsJs) &&
    /redistribution with attribution/.test(colorsJs)
);
check(
  'the renderer reads its ramp at paint time, not once at load',
  /this\.ramp/.test(heatmapJs) && /ColorMapper\.getColor/.test(heatmapJs)
);
check(
  'the legend is generated from the ramp rather than written by hand',
  read('public/legend.js').includes('ColorMapper.toGradient')
);
check(
  'the README names the ramp default and the alternative',
  /inferno/i.test(readme) && /cividis/i.test(readme)
);

/* ---- contours: drawn at the levels the docs state ---- */
check(
  'the contour levels are declared once, in heatmap.js',
  /CONTOUR_LEVELS\s*=\s*\[-50,\s*-70,\s*-85\]/.test(heatmapJs)
);
check(
  'the documented contour levels are the drawn ones',
  /-50[^\n]*-70[^\n]*-85/.test(read('docs/architecture.md')) ||
    /-50[^\n]*-70[^\n]*-85/.test(readme)
);
// \b matters: `contourSegmentsRemoved` satisfies /function contourSegments/,
// so renaming the tracer - or deleting it and leaving a suffixed stub - sailed
// through. Comments stripped so a prose mention cannot stand in for the body.
const heatmapCode = stripComments(heatmapJs);
/* ---- contour visibility, computed rather than asserted ----
 *
 * The contour line has to survive being drawn on top of the field it describes,
 * and the field runs from near-black to near-white. A single white stroke does
 * not: against inferno it scores 14.8:1 at -85 dBm and 3.6:1 at -50, and the
 * ramp's own top end is 1.05:1 against white. So the line is drawn twice - a
 * dark casing under a light core - and each tone is checked for contrast against
 * the *worst* background in the ramp rather than against an average one.
 */
const toLin = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const relLum = ([r, g, b]) =>
  0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Pull the control points out of colors.js without executing it. */
function rampPoints(name) {
  // Bounded by the points array's own brackets, not by a fixed window.
  //
  // The old 900-character slice meant that emptying one ramp's points simply
  // pulled the *next* ramp's control points into the window, so deleting a ramp
  // left the check reading a different ramp - and passing. Three mutations
  // "survived" not because the assertion was weak but because it was being fed
  // the wrong data.
  const at = colorsJs.search(new RegExp(`\\b${name}:\\s*\\{`));
  if (at === -1) return [];
  const declared = colorsJs.indexOf('points', at);
  if (declared === -1) return [];
  const open = colorsJs.indexOf('[', declared);
  if (open === -1) return [];

  let depth = 0;
  let close = -1;
  for (let i = open; i < colorsJs.length; i++) {
    if (colorsJs[i] === '[') depth++;
    else if (colorsJs[i] === ']') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return [];

  return [
    ...colorsJs.slice(open, close + 1).matchAll(/\[(\d+),\s*(\d+),\s*(\d+)\]/g),
  ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
}

const LIGHT_STROKE = [255, 255, 255];
const DARK_CASING = [8, 11, 16];
for (const ramp of ['inferno', 'cividis', 'classic']) {
  const points = rampPoints(ramp);
  check(
    `${ramp} exposes ramp control points to check against`,
    points.length >= 3
  );
  check(`${ramp}: has ramp colours to reason about`, points.length >= 3);

  // Reported, not asserted - see the note on `note` above.
  //
  // An earlier version of this check asserted "for every ramp colour, at least
  // one of the two tones clears 3:1". That is a tautology: with a white core
  // and a near-black casing, max(contrast) bottoms out near 4.4:1 for *any*
  // background, whatever the ramp happens to be. It could not fail, so it
  // proved nothing - and the mutation audit confirmed it, by surviving a ramp
  // colour pushed all the way to white.
  const worst = points.reduce(
    (min, bg) =>
      Math.min(
        min,
        Math.max(contrast(LIGHT_STROKE, bg), contrast(DARK_CASING, bg))
      ),
    Infinity
  );
  note(
    `${ramp}: weakest two-tone contrast anywhere on this ramp`,
    `${worst.toFixed(2)}:1 over ${points.length} colours`
  );
  // A ramp that never leaves the light half cannot be bracketed by a dark
  // casing; one that never leaves the dark half cannot be bracketed by a light
  // core. Both halves have to exist for the two-tone stroke to earn its keep.
  const lums = points.map(relLum);
  check(
    `${ramp}: spans both light and dark, so both contour tones have work to do`,
    Math.min(...lums) < 0.35 && Math.max(...lums) > 0.5,
    `lightness range ${Math.min(...lums).toFixed(2)}..${Math.max(...lums).toFixed(2)}`
  );
}

// The falsifiable core of the claim: the two tones must be far apart from each
// other. Delete either stroke, or paint both the same colour, and this goes
// red - which the per-ramp measurements above, being a tautology, could not do.
/**
 * The two tones are read out of the renderer, not declared next to the check.
 *
 * The first version compared two constants defined in verify-readme itself, so
 * it measured the verifier rather than the drawing code and could not fail for
 * any mutation of heatmap.js - which the audit demonstrated.
 */
function strokeColourIn(source, rgbaMatch) {
  const m = source.match(new RegExp(rgbaMatch));
  // Three capture groups - r, g and b - not one comma-separated run.
  return m ? [m[1], m[2], m[3]].map((n) => Number(n)) : null;
}
// The two greps are the same shape, so each is anchored on what comes *after*
// it: the casing is followed by the wider lineWidth, the core by the narrow
// one. Without that they both return the first rgba in the file.
const actualCasing = strokeColourIn(
  heatmapCode,
  'strokeStyle = `rgba\\(\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),[^`]*`;\\s*\\n\\s*this\\.ctx\\.lineWidth = style\\.width \\+'
);
const actualCore = strokeColourIn(
  heatmapCode,
  'strokeStyle = `rgba\\(\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),[^`]*`;\\s*\\n\\s*this\\.ctx\\.lineWidth = style\\.width;'
);
check(
  'both contour stroke colours are recoverable from the renderer',
  Array.isArray(actualCasing) && Array.isArray(actualCore)
);
/* ---- the legend's level ticks, measured against every ramp ----
 *
 * The ticks turn three arbitrary numbers into a readable scale, and they sit
 * directly on top of the ramp, so they have to work on all three. They did not:
 * drawn in --accent alone they scored 1.30:1 on classic, whose pale stretch is
 * its *middle* - which is where two of the three ticks land. A regression
 * introduced with the ticks, not an inherited one.
 *
 * Recomputed from the ramp's control points at each documented level, for every
 * ramp, rather than asserted.
 */
const TICK_ACCENT = [0x00, 0xe5, 0xff]; // --accent
// `css` is declared inside an earlier block, so it is not in scope here.
const tickCss = read('public/style.css');
const casingToken = /--casing-ink:\s*(#[0-9a-f]{6})/i.exec(
  stripComments(tickCss)
);
check(
  'the casing ink is a token the ticks and the contours share',
  Boolean(casingToken)
);
if (casingToken) {
  const hex = casingToken[1];
  const casingInk = [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  // ColorMapper is a browser classic script, so it cannot be require()d here.
  // Interpolating between two already-known control points needs no colour
  // science - only a straight sRGB mix, which is what ColorMapper.classic does.
  const lerp = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  for (const ramp of ['inferno', 'cividis', 'classic']) {
    const points = rampPoints(ramp);
    for (const level of [-85, -70, -50]) {
      const t = (level + 100) / 80;
      if (t < 0 || t > 1) continue;
      const scaled = t * (points.length - 1);
      const idx = Math.min(Math.floor(scaled), points.length - 2);
      const bar = lerp(points[idx], points[idx + 1], scaled - idx);
      const best = Math.max(
        contrast(TICK_ACCENT, bar),
        contrast(casingInk, bar)
      );
      check(
        `${ramp}: the -${-level} tick clears 3:1 on the colour it sits on ` +
          `(${best.toFixed(2)}:1 over rgb(${bar.join(',')}))`,
        best >= 3
      );
    }
  }
  check(
    'the ticks carry a dark casing, not only the accent',
    /border-left:\s*1px solid var\(--casing-ink\)/.test(
      stripComments(tickCss)
    ) &&
      /border-right:\s*1px solid var\(--casing-ink\)/.test(
        stripComments(tickCss)
      )
  );
}

if (actualCasing && actualCore) {
  const apart = contrast(actualCore, actualCasing);
  check(
    'the contour tones are far enough apart to bracket any background',
    apart >= 12,
    `drawn tones ${apart.toFixed(2)}:1 apart (core rgb(${actualCore.join(',')}) over casing rgb(${actualCasing.join(',')}))`
  );
}
// Tested against heatmapCode, which has its comments stripped - so looking for
// the phrase "dark casing under a light core" there would be looking for prose
// that was deliberately removed. The two strokes are what has to be there.
// The closing backtick comes AFTER the paren in `rgba(8, 11, 16, ${...})`,
// which is the reverse of the obvious `[^`]*`) spelling.
const casingStroke =
  /strokeStyle = `rgba\(8, 11, 16,[^`]*\)`[\s\S]{0,160}?stroke\(\)/;
const coreStroke =
  /strokeStyle = `rgba\(255, 255, 255,[^`]*\)`[\s\S]{0,160}?stroke\(\)/;
check(
  'contours are drawn as a dark casing under a light core',
  casingStroke.test(heatmapCode) && coreStroke.test(heatmapCode)
);
// Order matters: a core painted before its casing would be buried by it.
// Both strokes must be *present* too. Without that, deleting the casing makes
// both indexOf calls return -1 and -1 < 7192 is true — the check passed on the
// exact thing it exists to forbid.
const casingAt = heatmapCode.indexOf('rgba(8, 11, 16');
const coreAt = heatmapCode.indexOf('rgba(255, 255, 255');
check(
  'both contour strokes are present to be ordered',
  casingAt !== -1 && coreAt !== -1
);
check(
  'the dark casing is stroked before the light core',
  casingAt !== -1 && coreAt !== -1 && casingAt < coreAt
);
check(
  'the casing is wider than the core, so the line has an edge everywhere',
  /lineWidth = style\.width \+ 1\.6/.test(heatmapCode) &&
    /lineWidth = style\.width;/.test(heatmapCode)
);

check(
  'contours are traced by marching squares over the grid',
  /function contourSegments\(/.test(heatmapCode) &&
    // A saddle case is the part a naive implementation drops.
    /case 5:/.test(heatmapCode) &&
    /case 10:/.test(heatmapCode)
);
// Two separate guards: the tracer skips nulls, and the painter leaves them
// transparent. Either one alone would let a hole be painted or traced.
// Sliced from each *definition*. A bare indexOf('paintCells(') finds the call
// site in render() first - before the method body - and then asserts against
// the wrong 3000 characters, which fails on correct code.
const bodyOf = (src, signature) => {
  const at = src.indexOf(signature);
  return at === -1 ? '' : src.slice(at, at + 3000);
};
// Stripped, like the painter block below. Unstripped, a commented-out null
// guard satisfied this check - the exact bug class the file's own header warns
// about, reintroduced here.
const contourBlock = bodyOf(heatmapCode, 'function contourSegments');
const paintBlock = bodyOf(
  heatmapCode,
  'paintCells(heatmap, roomWidth, roomHeight, options'
);
check(
  'a null sample is skipped by the contour tracer',
  /point\.rssi === null/.test(contourBlock)
);
// paintCells mentions point.rssi === null three times - in the anyGap probe, the
// per-cell isGap mask and the no-data loop. Requiring "at least one" was
// satisfied by any two of them, so deleting the gap mask passed. Require the
// isGap definition itself.
check(
  'a null sample is left transparent by the painter',
  /const isGap\s*=\s*\n?\s*!point \|\|[\s\S]{0,120}?point\.rssi === null/.test(
    stripComments(paintBlock)
  )
);

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
  // The homepage is the live demo, not the README: a visitor arriving from npm
  // wants the running thing. Kept as an exact value so it cannot drift into a
  // repository URL or somebody else's deployment by accident.
  check(
    'homepage is the live demo',
    homepage === 'https://spectrum-mapper-demo.onrender.com',
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
/*
 * The changelog's 1.2.0 entry, checked against the code it describes.
 *
 * A release note that drifts from the code is worse than none, because it is
 * believed. These read the constants rather than restating them, so renaming
 * MAX_POINTS or changing the neighbour count fails here.
 */
{
  const changelog = read('CHANGELOG.md');
  const i120 = changelog.indexOf('## [1.2.0]');
  check(
    'CHANGELOG.md has a 1.2.0 entry',
    i120 > 0,
    'the version being released must be documented'
  );
  const entry =
    i120 > 0 ? changelog.slice(i120, changelog.indexOf('## [1.1.0]')) : '';
  const norm = (t) => t.replace(/\s+/g, ' ');
  // The formatter reflows the prose, so "5000\n  readings" is the same
  // phrase as "5000 readings". Compare against the flattened entry.
  const normEntry = norm(entry);
  check('CHANGELOG 1.2.0 section found', entry.length > 0);

  for (const h of ['### Added', '### Changed', '### Fixed']) {
    check(
      `CHANGELOG 1.2.0 has a ${h.replace('### ', '')} heading`,
      entry.includes(h)
    );
  }

  const pkgVersion = JSON.parse(read('package.json')).version;
  const lockVersion = JSON.parse(read('package-lock.json')).version;
  check(
    'package.json is the version being released',
    pkgVersion === '1.2.0',
    pkgVersion
  );
  check(
    'package-lock.json matches package.json',
    lockVersion === pkgVersion,
    `lock says ${lockVersion}, package says ${pkgVersion}`
  );

  // The numbers, read from the source of truth.
  const readings = read('src/readings.js');
  const interp = read('src/interpolate.js');
  const cfg = read('src/config/constants.js');
  const claim = (label, cond) =>
    check(`CHANGELOG 1.2.0 matches the code: ${label}`, cond);

  const cap = Number(/MAX_POINTS:\s*(\d+)/.exec(readings)?.[1]);
  const perReq = Number(/MAX_ITEMS:\s*(\d+)/.exec(readings)?.[1]);
  const bodyKb = Number(
    /MAX_BODY_BYTES:\s*(\d+)\s*\*\s*1024/.exec(readings)?.[1]
  );
  const power = Number(/POWER:\s*(\d+)/.exec(interp)?.[1]);
  const nearest = Number(/NEAREST:\s*(\d+)/.exec(interp)?.[1]);
  const maxDist = Number(/MAX_DISTANCE:\s*([\d.]+)/.exec(interp)?.[1]);

  // Interpolated, not written out: a hard-coded 5000 here would let the cap
  // change in readings.js without failing this check, which is exactly what the
  // neighbouring assertions do not do.
  claim(`the ${cap}-reading store cap`, normEntry.includes(`${cap} readings`));
  claim(
    `the ${perReq}-per-request limit`,
    normEntry.includes(`${perReq} readings per request`)
  );
  claim(
    `the ${bodyKb} KB body limit`,
    normEntry.includes(`${bodyKb} KB per body`)
  );
  claim(`IDW power ${power}`, normEntry.includes(`power ${power}`));
  claim(
    `the ${nearest} nearest samples`,
    normEntry.includes(`${nearest} nearest samples`)
  );
  claim(
    `the ${maxDist} m no-data radius`,
    normEntry.includes(`${maxDist} m from every sample`)
  );

  const sampleRows =
    read('docs/examples/sample-readings.csv').trim().split('\n').length - 1;
  claim(
    `the ${sampleRows}-point sample survey`,
    normEntry.includes(`${sampleRows}-point survey`)
  );

  // Features named in the entry must exist as routes / config.
  for (const [label, needle, hay] of [
    ['POST /api/readings', "'/api/readings'", read('src/server.js')],
    [
      'POST /api/import/readings.csv',
      "'/api/import/readings.csv'",
      read('src/server.js'),
    ],
    [
      'GET /api/export/measured.csv',
      "'/api/export/measured.csv'",
      read('src/server.js'),
    ],
    ['GET /healthz', "'/healthz'", read('src/server.js')],
    ['DEMO_MODE', 'DEMO_MODE', cfg],
    ['ALLOWED_ORIGINS', 'ALLOWED_ORIGINS', cfg],
    ['READINGS_TOKEN', 'READINGS_TOKEN', cfg],
  ]) {
    claim(`${label} exists`, hay.includes(needle));
  }

  // The honesty requirement, pinned in the changelog itself.
  claim(
    'it says the sample CSV is model output, not field data',
    /model output with small offsets[^.]*not field measurements/i.test(
      normEntry
    )
  );
  // The two bugs the release notes must name, because both shipped broken.
  // Backticks instead of \s+: the phrase is split across lines by the
  // formatter, and a literal \s+ is a whitespace class that also matches the
  // newline but not the indentation prettier inserts between the words.
  claim(
    'it reports the WebSocket Origin check that enforced nothing',
    normEntry.includes('check enforced nothing')
  );
  claim(
    'it reports the dragged transmitter that survived the idle reset',
    /dragged transmitter survived the idle reset/i.test(normEntry)
  );
}
/*
 * The design system: tokens, palette, theme toggle, and accessibility.
 *
 * The contrast checks below recompute WCAG ratios from the values in
 * public/style.css rather than asserting that a hex string is present. A check
 * that only greps for a colour proves the colour is written down; this proves
 * it is readable, which is the thing that matters and the thing a palette edit
 * can silently break.
 */
{
  const css = read('public/style.css');
  const html = read('public/index.html');
  const theme = read('public/theme.js');
  const dash = read('public/dashboard.js');

  /** Read `--name: value` out of a given selector block. */
  const token = (name, from = ':root') => {
    let scope = '';
    const idx = css.indexOf(from);
    if (idx < 0) return null;
    const start = css.indexOf('{', idx);
    let depth = 0;
    let end = start;
    for (let i = start; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    scope = css.slice(start + 1, end);
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(scope);
    return m ? m[1].trim() : null;
  };

  const hexToRgb = (value) => {
    const h = value.replace('#', '').trim();
    const full =
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h;
    if (!/^[0-9a-f]{6}$/i.test(full)) return null;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };

  /** WCAG relative luminance. */
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const contrast = (a, b) => {
    const la = luminance(hexToRgb(a));
    const lb = luminance(hexToRgb(b));
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  };

  // Every text colour on every surface it is used on, per theme.
  for (const [selector, label] of [
    [':root', 'dark'],
    ["[data-theme='light']", 'light'],
  ]) {
    const surfaces = ['bg', 'surface', 'surface-2', 'surface-3']
      .map((n) => token(n, selector))
      .filter(Boolean);
    if (surfaces.length < 4) {
      check(
        `${label} theme defines the surface tokens`,
        false,
        'a surface token is missing'
      );
      continue;
    }
    check(`${label} theme defines the surface tokens`, true);

    for (const name of [
      'text',
      'text-dim',
      'text-muted',
      'accent',
      'magenta',
      'green',
      'warning',
      'danger',
    ]) {
      const color = token(name, selector);
      if (!color) {
        check(`${label} theme defines --${name}`, false, 'token missing');
        continue;
      }
      // The worst case is the lightest surface, since all of these are lighter
      // than the grounds they sit on.
      let worst = Infinity;
      let worstOn = '';
      for (const surface of surfaces) {
        const r = contrast(color, surface);
        if (r < worst) {
          worst = r;
          worstOn = surface;
        }
      }
      check(
        `${label}: --${name} clears WCAG AA text on every surface`,
        worst >= 4.5,
        `${worst.toFixed(2)}:1 on ${worstOn} (needs 4.5)`
      );
    }

    // A control boundary is non-text: WCAG 1.4.11 asks 3:1.
    const control = token('border-control', selector);
    const worstControl = Math.min(...surfaces.map((s) => contrast(control, s)));
    check(
      `${label}: --border-control clears 3:1 for a control boundary`,
      worstControl >= 3,
      `${worstControl.toFixed(2)}:1 (needs 3)`
    );

    // The grid backdrop is decorative, so it is deliberately faint; it must not
    // be so faint that the layout loses its only non-colour separator.
    const border = token('border', selector);
    check(
      `${label}: --border is a visible but quiet hairline`,
      contrast(border, token('bg', selector)) > 1.1,
      `${contrast(border, token('bg', selector)).toFixed(2)}:1`
    );
  }

  // The palette matches the diagram it claims to match.
  for (const [name, hex] of [
    ['cyan', '#00e5ff'],
    ['magenta', '#ff2bd6'],
    ['green', '#39ff88'],
  ]) {
    check(
      `the dark --accent palette keeps the diagram's ${name}`,
      new RegExp(hex, 'i').test(css),
      `expected ${hex}`
    );
  }
  check(
    'the ground colour matches docs/architecture.svg',
    /#0a0e14/i.test(css)
  );

  // Type and numerals.
  check('tabular numerals are set for the readouts', /tabular-nums/.test(css));
  check(
    'every numeric readout class opts into tabular figures',
    [
      '.stat-row value',
      '.slider-row output',
      '.legend-labels',
      '.fps-badge',
    ].every((sel) => {
      const i =
        css.indexOf(sel + ' {') >= 0
          ? css.indexOf(sel + ' {')
          : css.indexOf(sel + ',');
      if (i < 0) return false;
      const block = css.slice(i, css.indexOf('}', i));
      return /tabular-nums/.test(block);
    }),
    'a readout whose digits jitter as values change'
  );
  check('a monospace stack is defined', /--font-mono:/.test(css));

  // No webfont, and nothing fetched from a third party.
  check(
    'no font is loaded from a CDN',
    !/@import\s+url\(|<link[^>]+href=["']https?:/i.test(css + html),
    'system stacks only'
  );
  check(
    'style.css declares no remote imports',
    !/@import/.test(css),
    'a remote @import would be a third-party dependency'
  );

  // Shape: thin borders, small radii. The brief rules out big soft cards.
  check(
    'borders are 1px hairlines',
    /--border-w:\s*1px/.test(css) && !/border:\s*(2|3|4)px/.test(css),
    'a thick border reads as a card, not an instrument'
  );
  check(
    'radii stay small',
    /--radius-sm:\s*[0-3]px/.test(css) && /--radius-md:\s*[0-4]px/.test(css)
  );
  check(
    'no purple/indigo gradient anywhere in the stylesheet',
    !/linear-gradient\([^)]*(purple|indigo|violet|#8b5cf6|#6366f1)/i.test(css),
    'the default-template look this replaces'
  );

  // Accessibility affordances.
  // Not just /outline:/ - `outline: none` contains that substring, so removing
  // the ring and replacing it with `color` both passed the original check.
  const focusBlock = (/:focus-visible\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
  const focusOutline = /outline:\s*([^;]+);/.exec(focusBlock);
  check(
    'focus is always visible',
    focusOutline !== null,
    'no :focus-visible rule at all'
  );
  check(
    'the focus ring is a real ring, not outline: none',
    focusOutline !== null &&
      !/^none$/i.test(focusOutline[1].trim()) &&
      /\b[2-9]px|\b1\.\d+px/.test(focusOutline[1]),
    `outline: ${focusOutline ? focusOutline[1].trim() : 'missing'}`
  );
  check(
    'the focus ring is offset from the element it marks',
    /outline-offset/.test(focusBlock),
    'a ring flush against a 1px border is easy to lose'
  );
  check(
    'reduced motion is respected',
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css)
  );
  check(
    'forced-colors mode is handled',
    /@media\s*\(forced-colors:\s*active\)/.test(css)
  );

  // Icon-only buttons carry an accessible name.
  const iconButtons = [
    ...html.matchAll(/<button\b[^>]*class="[^"]*icon-btn[^"]*"[^>]*>/g),
  ].map((m) => m[0]);
  check('there is an icon-only button to check', iconButtons.length > 0);
  check(
    'every icon-only button has an aria-label',
    iconButtons.length > 0 && iconButtons.every((b) => /aria-label=/.test(b)),
    'an icon with no label is invisible to a screen reader'
  );
  check(
    'the decorative glyph inside it is hidden from assistive tech',
    /id="themeGlyph"[^>]*aria-hidden="true"/.test(html)
  );

  // The connection pill announces itself.
  // A hidden file dialog has no business in the tab order: the labelled button
  // next to it is the control, and an unnamed input is a dead stop for a
  // keyboard user.
  check(
    'the hidden file picker is out of the tab order and unnamed',
    /id="csvPicker"[\s\S]{0,200}tabindex="-1"/.test(html) &&
      /id="csvPicker"[\s\S]{0,200}aria-hidden="true"/.test(html)
  );
  check(
    'the button that opens the picker does carry a name',
    /id="importCsv"[^>]*>[\s\S]{0,80}?Import readings CSV/.test(html)
  );

  check(
    'the connection pill is a live region',
    /id="statusPill"[\s\S]{0,200}role="status"/.test(html) &&
      /id="statusPill"[\s\S]{0,200}aria-live="polite"/.test(html)
  );
  check('the header shows a mode badge', /id="modeBadge"/.test(html));
  check('the header shows an fps readout', /id="fpsBadge"/.test(html));

  // The theme toggle: persisted, and safe when storage is unavailable.
  check(
    'the theme toggle is wired',
    /getElementById\('themeToggle'\)/.test(theme) &&
      /addEventListener\('click'/.test(theme)
  );
  check(
    'the theme is persisted to localStorage',
    /localStorage\.setItem/.test(theme)
  );
  // Structural, not a count. Counting localStorage references against try
  // blocks passed only because there happened to be an extra try in
  // systemPrefersLight: drop that one and the count balances while an
  // unwrapped setItem sails through.
  const storageCalls = [...theme.matchAll(/localStorage\.[a-zA-Z]+/g)].map(
    (m) => m[0]
  );
  const guardFor = (call) => {
    const at = theme.indexOf(call);
    // Walk back to the start of the method and confirm it opens with a try.
    const before = theme.slice(0, at);
    const methodStart = before.lastIndexOf('static ');
    const body = theme.slice(methodStart, at);
    return /try\s*\{/.test(body);
  };
  check(
    'every storage access is wrapped in try/catch',
    storageCalls.length >= 2 && storageCalls.every(guardFor),
    'a theme preference must never break the page'
  );
  // The listener cannot be attached from the same call that applies the theme:
  // this script runs from <head>, where the button does not exist yet. Wiring
  // it there looked correct and left the button inert.
  // Comments stripped first. Every check below looks for code that has to be
  // *executed*, and a commented-out line still contains all the text a regex
  // wants: `// ThemeToggle.wire();` satisfied "init calls wire" while the button
  // stayed inert, which is the exact bug this block is for.
  const themeCode = theme
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');

  check(
    'the click listener is attached after the DOM exists',
    /DOMContentLoaded/.test(themeCode) &&
      /document\.readyState === 'loading'/.test(themeCode),
    'attaching from <head> finds no button and does nothing'
  );
  check(
    'init actually calls the wiring',
    /static init\(\)[\s\S]{0,900}?ThemeToggle\.wire\(\)/.test(themeCode),
    'a wire() nothing calls leaves the button inert'
  );
  check(
    'the toggle has exactly one click listener',
    (themeCode.match(/addEventListener\('click'/g) || []).length === 1,
    'two would flip the theme twice per click'
  );
  check(
    'the theme is applied before first paint, not deferred',
    /static init\(\)[\s\S]{0,400}?ThemeToggle\.apply/.test(themeCode) &&
      !/DOMContentLoaded[\s\S]{0,200}ThemeToggle\.apply\(stored/.test(
        themeCode
      ),
    'applying on DOMContentLoaded flashes the wrong background'
  );
  check(
    'the label and glyph are refreshed once the button exists',
    /ThemeToggle\.apply\(ThemeToggle\.current\(\), false\)/.test(theme),
    'otherwise the button keeps the aria-label it was parsed with'
  );
  check(
    'matchMedia is guarded too',
    /static systemPrefersLight\(\)\s*\{\s*try\s*\{/.test(theme),
    'matchMedia is absent in some embedded webviews'
  );
  check(
    'the theme script loads before the page renders',
    /<script src="theme\.js"><\/script>/.test(html) &&
      html.indexOf('theme.js') < html.indexOf('<body'),
    'deferred, it flashes the wrong background on every load'
  );
  check(
    'an unknown stored value falls back rather than applying',
    /THEMES\.includes\(stored\)/.test(theme)
  );

  // The pill state is driven by a data attribute, and the badge by the renderer.
  check(
    'the pill state comes from the socket state, not a guess',
    /setConnectionState\(state\)/.test(dash)
  );
  // The assignment must be derived from the argument. Writing a literal
  // 'connected' into dataset.state satisfies /dataset\.state/ while the pill
  // lies about every state but one.
  check(
    'the pill value is derived from the socket state, not hardcoded',
    /this\.statusPill\.dataset\.state = [^;]*\bkey\b/.test(dash) &&
      /const key = String\(state\)\.toLowerCase\(\)/.test(dash)
  );
  check(
    'an unrecognised state falls back rather than showing a wrong one',
    /known\.includes\(key\)/.test(dash),
    'an unknown state must not be written through to the CSS'
  );
  check(
    'the mode badge tracks renderer.mapMode',
    /this\.modeBadge\.dataset\.mode = mode/.test(dash)
  );
  check(
    'the fps window is bounded',
    /while \(this\.frameTimes\.length[\s\S]{0,80}shift\(\)/.test(dash),
    'an unbounded array here is a slow leak on a long-lived tab'
  );
}

/*
 * The canvas palette and the stylesheet palette are one palette.
 *
 * They drifted: the map drew #ff2fd0 and #00ff88 while the chrome beside it
 * used #ff2bd6 and #39ff88. Two shades of "magenta" on the same screen reads
 * as a mistake even when neither is wrong on its own.
 */
{
  const heatmapSrc = read('public/heatmap.js');
  const css = read('public/style.css');
  const token = (name) => {
    const start = css.indexOf(':root');
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css.slice(open, close));
    return m ? m[1].trim() : null;
  };

  for (const [name, why] of [
    ['accent', 'the receiver outline and the label hairline'],
    ['magenta', 'a moving transmitter'],
    ['green', 'a receiver'],
    ['warning', 'a pinned transmitter and the estimate'],
  ]) {
    const hex = token(name);
    if (!hex) {
      check(`the canvas uses the --${name} token`, false, 'token missing');
      continue;
    }
    const rgb = hex
      .replace('#', '')
      .match(/.{2}/g)
      .map((h) => parseInt(h, 16));
    const asRgba = `rgba(${rgb.join(', ')}`;
    check(
      `the canvas uses the --${name} token`,
      heatmapSrc.includes(hex) || heatmapSrc.includes(asRgba),
      `${why}: expected ${hex}`
    );
  }

  // Comments excluded: the block above explains which colours were replaced, so
  // naming them in prose kept failing this.
  const heatmapCode = heatmapSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  check(
    'no near-miss duplicates of the palette remain in the canvas',
    !/#ff2fd0|#00ff88|#ffd400|255, 212, 0/i.test(heatmapCode),
    'a second shade of the same hue reads as an accident'
  );
  // The defect was a *pill* drawn outside drawLabel - its own font, its own
  // background rect, its own colour. A bare fillText is fine (the wall index
  // draws one), so the check looks for the pill pattern specifically.
  const drawLabelAt = heatmapCode.indexOf('drawLabel(text, px, py)');
  const drawLabelEnd = heatmapCode.indexOf('\n  }', drawLabelAt);
  const outside =
    heatmapCode.slice(0, drawLabelAt) + heatmapCode.slice(drawLabelEnd);
  const strayPills = [...outside.matchAll(/fillRect\(/g)].filter((m) => {
    const after = outside.slice(m.index, m.index + 400);
    return /fillText\(/.test(after) && /ctx\.font\s*=/.test(after);
  });
  check(
    'label pills are only drawn by drawLabel',
    strayPills.length === 0,
    'a hand-rolled label drifts from the shared one, as it did'
  );
  check(
    'the tracking error uses the shared label',
    /drawLabel\(\s*`\$\{tracking\.errorMetres[\s\S]{0,120}?drawLabel/.test(
      heatmapCode
    ) || /drawLabel\([\s\S]{0,80}tracking\.errorMetres/.test(heatmapCode)
  );
  check(
    'pinned and moving transmitters still differ',
    /source\.pinned\s*\?\s*'#[0-9a-f]{6}'\s*:\s*'#[0-9a-f]{6}'/i.test(
      heatmapSrc
    ),
    'that difference is state, not decoration'
  );
}

/*
 * The header readouts were measured at 11px and read as too small for the
 * primary status surface.
 *
 * The size is resolved through the token rather than read as a literal: the
 * stylesheet says font-size: var(--text-sm), so a check that greps for a px
 * value reports "unknown" on perfectly correct code - which it did, on the
 * first run, failing the clean tree.
 */
{
  const css = read('public/style.css');

  /** Resolve a font-size declaration to px, following var() into :root. */
  const pxOf = (declaration) => {
    if (!declaration) return 0;
    const value = declaration.trim();
    const root = css.slice(
      css.indexOf(':root'),
      css.indexOf('}', css.indexOf(':root'))
    );
    let resolved = value;
    for (let i = 0; i < 5 && resolved.includes('var('); i++) {
      resolved = resolved.replace(/var\((--[a-z0-9-]+)\)/gi, (_, name) => {
        const m = new RegExp(`${name}:\\s*([^;]+);`).exec(root);
        return m ? m[1].trim() : '';
      });
    }
    const rem = /^([\d.]+)rem$/.exec(resolved);
    if (rem) return parseFloat(rem[1]) * 16;
    const px = /^([\d.]+)px$/.exec(resolved);
    return px ? parseFloat(px[1]) : 0;
  };

  /**
   * The declaration of one property inside the rule that sets `selector`.
   *
   * Handles grouped selectors: .mode-badge is declared in
   * ".mode-badge,\n.fps-badge { ... }", so looking for ".mode-badge {" found
   * nothing and reported the badge as unstyled.
   */
  const declIn = (selector, prop) => {
    const direct = css.indexOf(selector + ' {');
    if (direct >= 0) {
      const block = css.slice(direct, css.indexOf('}', direct));
      const m = new RegExp(`${prop}:\\s*([^;]+);`).exec(block);
      return m ? m[1] : null;
    }
    // Grouped: walk selectors backwards to the '{' that opens the rule.
    let from = 0;
    for (;;) {
      const at = css.indexOf(selector, from);
      if (at < 0) return null;
      const brace = css.indexOf('{', at);
      if (brace < 0) return null;
      // Comments stripped first: a comment between the previous rule and this
      // one becomes part of the "selector" text and breaks the comparison.
      const selectors = css
        .slice(css.lastIndexOf('}', brace) + 1, brace)
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const list = selectors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 1 && list.includes(selector)) {
        const block = css.slice(brace, css.indexOf('}', brace));
        const m = new RegExp(`${prop}:\\s*([^;]+);`).exec(block);
        return m ? m[1] : null;
      }
      from = at + selector.length;
    }
  };

  for (const [selector, label] of [
    ['.status', 'connection pill'],
    ['.fps-badge', 'fps badge'],
    ['.mode-badge', 'mode badge'],
  ]) {
    const px = pxOf(declIn(selector, 'font-size'));
    check(
      `the ${label} is at least 12px`,
      px >= 12,
      `declared ${declIn(selector, 'font-size')} = ${px || 'unknown'}px`
    );
  }

  const glyphPx = pxOf(declIn('#themeGlyph', 'width'));
  check(
    'the theme glyph is big enough to recognise',
    glyphPx >= 15,
    `at ${glyphPx || 'unknown'}px the crescent read as a circular arrow`
  );
}
