'use strict';

/**
 * Guard: never hand a raw error OBJECT to a logger in a file that uses axios.
 *
 * An axios error's `.config` carries the Authorization/Basic header and the
 * token-call body. `console.error('msg:', err)` makes Node's formatter walk
 * into it, so the bearer lands in the logs. Verified empirically against a
 * real axios 401 -- `err.stack`, `err.message` and `String(err)` are all clean,
 * the raw object is not.
 *
 * `err.stack` is the preferred replacement rather than `err.message`: these
 * catches also handle ordinary local errors, and the stack keeps their
 * debugging value while staying credential-safe.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['services', 'routes', 'middleware'];

/** console.error('label:', err) / logger.warn('label:', error) — the raw object. */
const RAW_LOG = /(?:console|logger)\.(?:error|warn|log)\([^)]*,\s*(?:err|error)\s*\)/;
/** A safe accessor on the same line means the match is not a raw object. */
const SAFE = /\.(message|stack|code|response)\b|String\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

describe('axios-using files never log a raw error object', () => {
  it('finds no raw error passed to a logger', () => {
    const offenders = [];

    for (const dir of DIRS) {
      const dirPath = path.join(ROOT, dir);
      if (!fs.existsSync(dirPath)) continue;

      for (const file of walk(dirPath)) {
        const src = fs.readFileSync(file, 'utf8');
        // Only axios-importing files: those are the ones where a caught error
        // can carry credentials in .config.
        if (!src.includes("require('axios')")) continue;

        src.split('\n').forEach((line, i) => {
          if (RAW_LOG.test(line) && !SAFE.test(line)) {
            offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
          }
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
