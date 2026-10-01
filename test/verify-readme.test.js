/**
 * verify:readme's default mode must not run the benchmark.
 *
 * The timing comparisons failed on GitHub because a runner measured the frame
 * cost at 0.27 ms against the README's 0.518 ms. No tolerance band survives
 * that in both directions, so timings moved behind `--timings`.
 *
 * These tests keep that gate honest: the default path must never spawn the
 * benchmark, and the deterministic accuracy check must still run without it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VERIFY = path.join(ROOT, 'scripts/verify-readme.js');

function runVerify(args = []) {
  try {
    return {
      ok: true,
      out: execFileSync(process.execPath, [VERIFY, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 4 * 1024 * 1024,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      out: `${err.stdout || ''}${err.stderr || ''}`,
    };
  }
}

test('default mode says the timing checks were skipped', () => {
  const r = runVerify();
  assert.match(r.out, /timing checks skipped \(run with --timings\)/);
});

test('default mode does not run the benchmark', () => {
  const r = runVerify();
  // This test is about what default mode does and does not execute, so it does
  // not assert that every check passes - that would couple it to unrelated
  // claims, such as whether docs/screenshot.png has been added yet. It still
  // fails loudly if the verifier crashes or never reaches its summary.
  assert.doesNotMatch(
    r.out,
    /TypeError|ReferenceError|SyntaxError|at Object\.<anonymous>/,
    `verify:readme crashed in default mode:\n${r.out}`
  );
  assert.match(r.out, /check\(s\) failed|all README claims check out/);
  // These only appear when `out` was populated, which now requires --timings.
  assert.doesNotMatch(r.out, /frame cost: README .* vs live/);
  assert.doesNotMatch(r.out, /vs live .*us/);
  assert.doesNotMatch(r.out, /benchmark runs/);
});

test('default mode still checks the deterministic accuracy figures', () => {
  const r = runVerify();
  // Gating the timings must not have taken the accuracy check with it: that
  // figure is pure geometry and is verified identical across 5 runs on Node
  // 22 and 24.
  assert.match(r.out, /mean position error: README .* m vs computed/);
});

test('default mode does not require the benchmark on disk', () => {
  const src = fs.readFileSync(VERIFY, 'utf8');
  // The spawn must sit behind the TIMINGS guard, not run unconditionally.
  const spawn = src.indexOf("['scripts/benchmark.js']");
  const guard = src.indexOf('if (TIMINGS)');
  assert.ok(spawn > -1, 'expected a benchmark spawn to exist');
  assert.ok(
    guard > -1 && guard < spawn,
    'the benchmark spawn is not behind the TIMINGS guard'
  );
});

test('--timings runs the benchmark and compares the frame cost', () => {
  const r = runVerify(['--timings']);
  assert.match(r.out, /frame cost: README .*ms vs live .*ms/);
  assert.doesNotMatch(r.out, /timing checks skipped/);
});

test('the frame-cost badge is gone from the README and the verifier', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /frame%20cost/);
  const src = fs.readFileSync(VERIFY, 'utf8');
  assert.doesNotMatch(src, /frame%20cost|frame-cost badge/);
});

test('the accuracy module is deterministic', () => {
  const { localisationErrors } = require('../scripts/localisation-errors');
  const a = localisationErrors();
  const b = localisationErrors();
  // This is the property that lets the accuracy check stay in CI. If it ever
  // stops holding, that check has to move behind --timings too.
  assert.strictEqual(a.mean, b.mean);
  assert.strictEqual(a.count, b.count);
  assert.deepStrictEqual(
    a.bands.map((x) => x.mean),
    b.bands.map((x) => x.mean)
  );
});

test("package.json and the CHANGELOG's top heading name the same release", () => {
  // The invariant, asserted directly rather than by trusting the verifier: a
  // version bump in package.json without a matching changelog heading ships
  // release notes that describe a version nobody is on.
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  );
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const headings = [...changelog.matchAll(/^##\s+\[?([\d.]+)\]?/gm)].map(
    (m) => m[1]
  );
  assert.ok(headings.length > 0, 'no version heading found in CHANGELOG.md');
  assert.strictEqual(
    headings[0],
    pkg.version,
    `CHANGELOG.md top heading is ${headings[0]}, package.json says ${pkg.version}`
  );
});

test('the verifier checks that pairing itself', () => {
  // Otherwise the check above is the only thing standing between a version bump
  // and an inconsistent release, and deleting the verifier check would go
  // unnoticed.
  const src = fs.readFileSync(VERIFY, 'utf8');
  assert.match(src, /newest entry matches package\.json/);
  assert.match(src, /pkg\.version/);
});
