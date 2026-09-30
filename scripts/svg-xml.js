/**
 * XML well-formedness for the SVG assets.
 *
 * This lives in its own module so `test/diagrams.test.js` can exercise it
 * against a deliberately malformed fixture. An earlier version of this check
 * shelled out to `xmllint`, which is not installed on GitHub's ubuntu-24.04
 * runner image, and its intended fallback was unreachable: on ENOENT there is
 * no stderr, so the guard that was supposed to run the fallback short-circuited
 * and the check failed with an empty message. That is why the validation is
 * pure Node with no external binary and no silent branches.
 */
const fs = require('fs');
const path = require('path');
const { XMLValidator } = require('fast-xml-parser');

/**
 * Validate one file as well-formed XML.
 *
 * A missing, empty, or unreadable file is a failure, never a pass: this check
 * exists to catch a broken asset, and returning `ok` for a file it could not
 * read would make the whole verifier vacuous.
 *
 * @param {string} filePath absolute path to the file to validate
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function validateXmlFile(filePath) {
  const name = path.basename(filePath);

  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const why =
      err.code === 'ENOENT'
        ? 'file does not exist'
        : err.code === 'EACCES'
          ? 'file is not readable'
          : err.code === 'EISDIR'
            ? 'path is a directory'
            : err.message;
    return { ok: false, reason: `${name}: ${why}` };
  }

  if (source.trim() === '') {
    return { ok: false, reason: `${name}: file is empty` };
  }

  // `allowBooleanAttributes` covers valueless SVG attributes such as
  // `hidden`, which are common in SVG and would otherwise read as malformed.
  const result = XMLValidator.validate(source, {
    allowBooleanAttributes: true,
  });

  // fast-xml-parser returns literal `true` on success.
  if (result === true) {
    return { ok: true };
  }

  const err = result && result.err;
  if (!err) {
    return { ok: false, reason: `${name}: validator returned no result` };
  }
  return {
    ok: false,
    reason: `${name}: line ${err.line}, column ${err.col}: ${err.msg}`,
  };
}

module.exports = { validateXmlFile };
