/**
 * The diagram XML check must actually run.
 *
 * This exists because verify:diagrams once shelled out to `xmllint`, which is
 * not installed on GitHub's ubuntu-24.04 runner image. It passed locally and
 * failed in CI, and the fallback that was supposed to cover the missing binary
 * was unreachable. These tests pin the behaviour so the check cannot silently
 * degrade into a no-op again.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { validateXmlFile } = require('../scripts/svg-xml');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');

test('rejects a deliberately malformed SVG', () => {
  const result = validateXmlFile(path.join(FIXTURES, 'malformed.svg'));
  assert.strictEqual(result.ok, false, 'the malformed fixture must not pass');
  assert.match(result.reason, /malformed\.svg/);
});

test('reports a line and column for a malformed SVG', () => {
  const result = validateXmlFile(path.join(FIXTURES, 'malformed.svg'));
  // The point of using a real validator is a locatable error, not a boolean.
  assert.match(result.reason, /line \d+/);
  assert.match(result.reason, /column \d+/);
});

test('the malformed fixture really is malformed', () => {
  // Guards the fixture itself: if someone "tidies up" the broken file, this
  // fails loudly rather than leaving the test above passing vacuously.
  const src = fs.readFileSync(path.join(FIXTURES, 'malformed.svg'), 'utf8');
  assert.match(src, /stroke=#00e5ff>/, 'the unclosed attribute was repaired');
});

test('accepts a well-formed SVG', () => {
  const result = validateXmlFile(path.join(ROOT, 'docs/architecture.svg'));
  assert.strictEqual(result.ok, true, result.reason);
});

test('accepts the structure banner', () => {
  const result = validateXmlFile(path.join(ROOT, 'docs/structure-banner.svg'));
  assert.strictEqual(result.ok, true, result.reason);
});

test('a missing file fails loudly rather than passing', () => {
  const result = validateXmlFile(path.join(FIXTURES, 'does-not-exist.svg'));
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /does not exist/);
});

test('an empty file fails loudly rather than passing', () => {
  const empty = path.join(FIXTURES, '.empty-probe.svg');
  fs.writeFileSync(empty, '   \n');
  try {
    const result = validateXmlFile(empty);
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /empty/);
  } finally {
    fs.unlinkSync(empty);
  }
});

test('a directory fails loudly rather than passing', () => {
  const result = validateXmlFile(FIXTURES);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /cannot read|directory/);
});

test('needs no external binary', () => {
  // The regression that actually broke CI: xmllint is absent on the runner.
  // Validation must not depend on anything on PATH.
  const src = fs.readFileSync(path.join(ROOT, 'scripts/svg-xml.js'), 'utf8');
  assert.doesNotMatch(src, /execFileSync|execSync|spawnSync|child_process/);
});
