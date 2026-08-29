'use strict';

/**
 * A secret interpolated into a log line outlives every rotation: it lands in
 * `docker logs` / `kubectl logs` for every deployment, and anyone who can read
 * pod logs can read it. Found live on 2026-08-29 — the BFF printed the seeded
 * EMA Inspector client_secret in full on every boot.
 *
 * There are exactly two legitimate reasons to interpolate `client_secret=` into
 * a template literal, and both build an x-www-form-urlencoded request body, so
 * both wrap the value in encodeURIComponent(). A log line never does. That is
 * the discriminator this guard uses — it catches the whole class rather than
 * the one line that was reported.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['routes', 'services', 'middleware', 'utils'];
const SECRET_INTERPOLATION = /(?:client_secret|password)=\$\{([^}]*)\}/g;

function sourceFiles() {
  const files = [path.join(ROOT, 'server.js')];
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(path.join(entry.parentPath || abs, entry.name));
      }
    }
  }
  return files;
}

describe('no secret values interpolated outside request bodies', () => {
  it('every client_secret= / password= interpolation is encodeURIComponent-wrapped', () => {
    const offenders = [];

    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      for (const match of src.matchAll(SECRET_INTERPOLATION)) {
        if (match[1].includes('encodeURIComponent')) continue;
        const line = src.slice(0, match.index).split('\n').length;
        offenders.push(`${path.relative(ROOT, file)}:${line} — ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('finds the two known request-body sites, so the guard is not vacuously green', () => {
    const wrapped = sourceFiles().flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(SECRET_INTERPOLATION)]
        .filter((m) => m[1].includes('encodeURIComponent')),
    );

    expect(wrapped.length).toBeGreaterThanOrEqual(2);
  });
});
