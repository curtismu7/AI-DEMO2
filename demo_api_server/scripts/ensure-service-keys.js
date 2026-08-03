#!/usr/bin/env node
'use strict';
/**
 * ensure-service-keys — auto-provision the apikey-dispatch demo secrets.
 *
 * The mortgage/invest "legacy backend" demo uses a static service API key the
 * gateway pulls from the encrypted vault (DEMO_API_RESOURCE_SERVER_KEY /
 * DEMO_MCP_RESOURCE_SERVER_KEY) and injects as X-API-Key. demo_api_resource_server
 * REFUSES to boot with a known committed default — so a fresh clone deadlocks
 * (vault holds the default, service rejects it) unless a real key is minted.
 *
 * This script makes that automatic and idempotent:
 *   - If the vault key is missing or a known committed default → mint a random
 *     key, write it to BOTH vault entries and to API_RESOURCE_SERVER_API_KEY in
 *     the repo-root .env (compose interpolates it into api-resource-server).
 *   - If a real key already exists and vault/.env agree → no-op.
 *   - If they disagree → re-align .env to the vault value.
 *   - ROTATE_SERVICE_KEYS=1 → force-mint a new key regardless.
 *
 * Invoked by run-docker.sh cmd_start (after vault_preflight, before
 * `compose up`, so recreated containers pick up the fresh env). Safe to run
 * by hand: node demo_api_server/scripts/ensure-service-keys.js
 *
 * Requires VAULT_PASSWORD (run-docker.sh exports it; falls back to
 * demo_api_server/.env). Fails SOFT (exit 0 with a loud warning) so a missing
 * vault password degrades only the mortgage/invest chips, not the whole demo.
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '../..');
const ROOT_ENV = path.join(REPO_ROOT, '.env');
const VAULT_CLI = path.join(SCRIPTS_DIR, 'vault.js');
const VAULT_ENTRIES = ['DEMO_API_RESOURCE_SERVER_KEY', 'DEMO_MCP_RESOURCE_SERVER_KEY'];
const ENV_KEY = 'API_RESOURCE_SERVER_API_KEY';
// Committed defaults the mortgage service hard-rejects (see its boot guard).
const KNOWN_DEFAULTS = new Set(['', 'demo-mortgage-key-0000', 'mortgage-compose-dev-key']);

function readEnvValue(file, key) {
  try {
    const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (!m) return null;
    let v = m[1].trim();
    // dotenv (used by the BFF) and docker compose env_file both strip ONE pair of
    // surrounding matching quotes. This hand-rolled reader must match them: a
    // VAULT_PASSWORD="..." line was otherwise passed to vault.js with the quotes
    // still attached, giving "bad password" and blocking service-key provisioning
    // while the BFF (quote-stripped) opened the same vault fine.
    if (v.length >= 2 &&
        ((v[0] === '"' && v[v.length - 1] === '"') ||
         (v[0] === "'" && v[v.length - 1] === "'"))) {
      v = v.slice(1, -1);
    }
    return v;
  } catch (_) {
    return null;
  }
}

function upsertEnvValue(file, key, value) {
  let s = '';
  try {
    s = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // ONLY a genuinely absent file may fall through to "create". This catch used
    // to swallow every error, so a transient EACCES/EISDIR (a chmod, a bind-mount
    // hiccup during run-docker.sh) left s = '' and the writeFile below replaced a
    // populated .env with a 3-line file — destroying every other
    // compose-interpolated var, with no backup, while still exiting 0.
    if (err.code !== 'ENOENT') {
      throw new Error(`refusing to rewrite ${file}: could not read it (${err.code || err.message})`);
    }
  }
  if (new RegExp(`^${key}=`, 'm').test(s)) {
    s = s.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  } else {
    s += `${s.endsWith('\n') || s === '' ? '' : '\n'}\n# apikey-dispatch demo: auto-provisioned; must equal vault DEMO_API_RESOURCE_SERVER_KEY\n${key}=${value}\n`;
  }
  // 0600: a fresh .env holds the minted plaintext service key, and the default
  // umask made it world-readable (the vault itself is written 0600).
  fs.writeFileSync(file, s, { mode: 0o600 });
}

function vault(args, input) {
  return execFileSync('node', [VAULT_CLI, ...args], {
    cwd: path.dirname(SCRIPTS_DIR),
    env: process.env,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString();
}

// Export helpers for tests; only run provisioning when invoked directly
// (node ensure-service-keys.js), never when required as a module.
module.exports = { readEnvValue };

if (require.main === module) main();

function main() {
// VAULT_PASSWORD: env first, then demo_api_server/.env (same source the BFF uses).
if (!process.env.VAULT_PASSWORD) {
  const fromEnvFile = readEnvValue(path.join(REPO_ROOT, 'demo_api_server/.env'), 'VAULT_PASSWORD');
  if (fromEnvFile) process.env.VAULT_PASSWORD = fromEnvFile;
}
if (!process.env.VAULT_PASSWORD) {
  console.warn('[ensure-service-keys] ⚠️  VAULT_PASSWORD not available — skipping. Mortgage/invest chips will fail with "backend rejected the service API key" until keys are provisioned.');
  process.exit(0);
}

let current = null;
try {
  current = vault(['get', VAULT_ENTRIES[0]]).replace(/\n$/, '');
} catch (_) {
  current = null; // entry missing — will mint
}

const force = process.env.ROTATE_SERVICE_KEYS === '1';
const needsMint = force || current === null || KNOWN_DEFAULTS.has(current);

try {
  if (needsMint) {
    const key = `mortgage-${crypto.randomBytes(12).toString('hex')}`;
    for (const name of VAULT_ENTRIES) vault(['set', name], key);
    upsertEnvValue(ROOT_ENV, ENV_KEY, key);
    console.log(`[ensure-service-keys] ${force ? 'Rotated' : 'Provisioned'} service API key (vault ${VAULT_ENTRIES.join(', ')} + .env ${ENV_KEY}).`);
  } else if (readEnvValue(ROOT_ENV, ENV_KEY) !== current) {
    upsertEnvValue(ROOT_ENV, ENV_KEY, current);
    console.log(`[ensure-service-keys] Re-aligned .env ${ENV_KEY} to the vault value.`);
  } else {
    console.log('[ensure-service-keys] Service API keys OK (non-default, vault and .env agree).');
  }
} catch (err) {
  console.warn(`[ensure-service-keys] ⚠️  Failed: ${err.message} — mortgage/invest chips may reject the service key.`);
  process.exit(0); // fail soft: never block stack start
}
}
