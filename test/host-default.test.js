/**
 * The bind address defaults to loopback, and the container overrides it.
 *
 * The app has no authentication: anything that can reach it can move every
 * transmitter and draw walls. Binding 0.0.0.0 by default meant a developer who
 * ran `npm start` on a shared network was serving an open control panel. The
 * default is now 127.0.0.1, which is only the developer's own machine.
 *
 * The Dockerfile has to set HOST=0.0.0.0 explicitly, because inside a container
 * loopback is unreachable from outside. That is the whole reason this override
 * exists, so the Dockerfile is asserted here rather than trusted: if someone
 * drops the line, the image builds and then every published port connects to
 * nothing, which looks like a networking problem rather than a missing
 * environment variable.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('HOST defaults to loopback', () => {
  const constants = read('src/config/constants.js');
  assert.match(
    constants,
    /HOST:\s*process\.env\.HOST\s*\|\|\s*'127\.0\.0\.1'/,
    'CONFIG.HOST must fall back to 127.0.0.1'
  );
  // Belt and braces: nothing may reintroduce the wildcard default.
  assert.doesNotMatch(
    constants,
    /HOST:[^\n]*'0\.0\.0\.0'/,
    'the wildcard bind address must not be the default'
  );
});

test('HOST is still overridable by the environment', () => {
  // The || form is what makes the override work; assert the key is read from
  // the environment at all, so a refactor to a hard-coded constant is caught.
  assert.match(read('src/config/constants.js'), /HOST:\s*process\.env\.HOST/);
});

test('.env.example documents the loopback default', () => {
  assert.match(read('.env.example'), /^HOST=127\.0\.0\.1$/m);
  assert.doesNotMatch(read('.env.example'), /^HOST=0\.0\.0\.0$/m);
});

test('the Dockerfile overrides HOST to the wildcard', () => {
  // Loopback inside a container is not reachable from the host, so the image
  // must opt in explicitly or `docker run -p 3000:3000` silently connects to
  // nothing.
  assert.match(read('Dockerfile'), /HOST=0\.0\.0\.0/);
});

test('the README config table and limitations match the default', () => {
  const readme = read('README.md');
  assert.match(readme, /\| `HOST`\s*\|\s*`127\.0\.0\.1`/);
  assert.doesNotMatch(readme, /\| `HOST`\s*\|\s*`0\.0\.0\.0`/);
  // The limitations bullet must not still claim it binds the wildcard by
  // default, which was true before this change and is now false.
  assert.doesNotMatch(readme, /binds `0\.0\.0\.0` by default/);
  assert.match(readme, /binds `127\.0\.0\.1` by default/);
  // ...and it must still say how to expose it deliberately.
  assert.match(readme, /HOST=0\.0\.0\.0/);
});
