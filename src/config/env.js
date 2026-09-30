const fs = require('fs');
const path = require('path');

/**
 * Minimal .env loader. Deliberately dependency-free: this is a ~30 line file
 * parser, and the project has exactly six settings to read.
 *
 * Rules:
 *   - Blank lines and `#` comments are skipped.
 *   - `KEY=value`, with an optional `export ` prefix.
 *   - Values wrapped in matching single or double quotes are unwrapped;
 *     inside double quotes a trailing `\` continues the line.
 *   - An existing process.env value always wins, so real env vars and CI
 *     secrets override the file.
 */
function parseEnv(contents) {
  const result = {};
  const lines = contents.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line
    );
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (quote === '"' && value.endsWith('\\')) {
        // Line continuation inside double quotes.
        let joined = value.slice(1, -1);
        while (i + 1 < lines.length && joined.endsWith('\\')) {
          joined = joined.slice(0, -1) + '\n' + lines[++i].trim();
        }
        value = joined;
      } else if (value.endsWith(quote) && value.length > 1) {
        value = value.slice(1, -1);
      } else {
        // Unterminated quote: take the rest of the line as-is.
        value = value.slice(1);
      }
    } else {
      // Strip a trailing inline comment from an unquoted value.
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    result[key] = value;
  }

  return result;
}

/** Load `.env` into process.env. Missing file is not an error. */
function loadEnv(file = path.resolve(process.cwd(), '.env')) {
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }

  const parsed = parseEnv(contents);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}

/** Read an env var as a number, falling back when unset or unparseable. */
function numEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

module.exports = { loadEnv, parseEnv, numEnv };
