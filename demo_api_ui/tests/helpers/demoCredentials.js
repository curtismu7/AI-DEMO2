'use strict';

/**
 * Seed the E2E demo credentials from the ONE place that defines them.
 *
 * `demo_api_server/.env` is what the demo users actually authenticate with —
 * PingOne provisioning reads it, and realLogin's API-cookie path already prefers
 * `DEMO_USER_PASSWORD` over the E2E copy. But nothing loaded that file into the
 * Playwright process, so `tests/e2e/.env.e2e` carried a hand-copied duplicate
 * that silently went stale on the next password change.
 *
 * Observed 2026-09-07: the copy in `.env.e2e` was rejected by PingOne with
 * "Incorrect username or password" for BOTH the customer and admin accounts
 * (they shared one stale value), while `demo_api_server/.env` logged in fine.
 * Every `*.real.spec.js` was failing at the login step, which reads exactly like
 * an auth outage rather than a bad fixture.
 *
 * Call this BEFORE loading `.env.e2e`. Both Playwright configs only fill vars
 * that are unset, so ordering alone gives:
 *
 *     shell env  >  demo_api_server/.env  >  tests/e2e/.env.e2e
 *
 * A deliberate one-off (a different PingOne user, a remote deployment with its
 * own accounts) still works by exporting the variable in the shell; what stops
 * working is a stale duplicate silently outranking the real value.
 */

const fs = require('fs');
const path = require('path');
const { mainCheckoutPath } = require('../e2e/helpers/repoRoots');

// E2E variable  ->  the demo_api_server/.env variable that defines it.
const MAPPING = {
  E2E_CUSTOMER_USERNAME: 'DEMO_USER_USERNAME',
  E2E_CUSTOMER_PASSWORD: 'DEMO_USER_PASSWORD',
  E2E_ADMIN_USERNAME: 'DEMO_ADMIN_USERNAME',
  E2E_ADMIN_PASSWORD: 'DEMO_ADMIN_PASSWORD',
};

function parseEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // A quoted value is a real trap here: the BFF strips the quotes at runtime,
    // so a literal `"pw"` in the file logs in as `pw` — copy the same meaning.
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) ||
                             (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * @param {string} [serverEnvPath] override for tests
 * @returns {string[]} the E2E var names seeded (names only — never values)
 */
function seedDemoCredentials(serverEnvPath) {
  // demo_api_server/.env is gitignored, so it exists ONLY in the main checkout —
  // a relative path from here resolves inside whichever worktree is running and
  // finds nothing. repoRoots derives the main checkout from any of them.
  const envPath = serverEnvPath || mainCheckoutPath('demo_api_server', '.env');
  if (!envPath || !fs.existsSync(envPath)) return [];

  let parsed;
  try {
    parsed = parseEnvFile(envPath);
  } catch {
    return []; // unreadable is not fatal — .env.e2e may still carry usable values
  }

  const seeded = [];
  for (const [e2eVar, serverVar] of Object.entries(MAPPING)) {
    if (process.env[e2eVar]) continue;          // shell wins
    const value = parsed[serverVar];
    if (!value) continue;
    // dotenvx ciphertext decrypts inside the BFF process only; passing it to a
    // login form would fail in a thoroughly confusing way.
    if (value.startsWith('encrypted:')) continue;
    process.env[e2eVar] = value;
    seeded.push(e2eVar);
  }
  return seeded;
}

module.exports = { seedDemoCredentials, MAPPING, parseEnvFile };
