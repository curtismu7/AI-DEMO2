#!/usr/bin/env node
'use strict';
/**
 * ensure-service-keys — auto-provision the apikey-dispatch demo secrets.
 *
 * The mortgage/invest "legacy backend" demo uses a static service API key the
 * gateway injects as X-API-Key under the names DEMO_API_RESOURCE_SERVER_KEY /
 * DEMO_MCP_RESOURCE_SERVER_KEY (plus the retired aliases DEMO_INVEST_SERVICE_KEY
 * / DEMO_MORTGAGE_SERVICE_KEY — see note below). demo_api_resource_server
 * REFUSES to boot with a known committed default, so a fresh clone deadlocks
 * unless a real key is minted.
 *
 * vault → dotenvx migration (Task 7 tooling): the canonical home for these keys
 * moves from the encrypted `secrets.vault` to demo_api_server/.env, which the
 * dotenvx cutover then encrypts at rest. This script now:
 *   - Resolves the EXISTING key value without requiring the vault, in order:
 *       demo_api_server/.env → repo-root .env → vault (best-effort bridge).
 *   - REUSES that value verbatim — never regenerates it (no rotation). Only a
 *     truly fresh setup (no value anywhere, or only committed defaults) mints one.
 *   - Writes the resolved/minted value to ALL FOUR DEMO_*_KEY names in
 *     demo_api_server/.env, to API_RESOURCE_SERVER_API_KEY in the repo-root .env
 *     (compose interpolates it into api-resource-server), and — only while the
 *     vault still exists (removed in Task 8) — keeps the vault entries in sync.
 *   - ROTATE_SERVICE_KEYS=1 → force-mint a new key regardless.
 *
 * Invoked by run-docker.sh cmd_start (after vault_preflight, before
 * `compose up`, so recreated containers pick up the fresh env). Safe to run
 * by hand: node demo_api_server/scripts/ensure-service-keys.js
 *
 * Fails SOFT (exit 0 with a loud warning): a write failure degrades only the
 * mortgage/invest chips, not the whole demo. VAULT_PASSWORD is optional now —
 * its absence only skips the transitional vault sync.
 *
 * Note on the four names: DEMO_API_RESOURCE_SERVER_KEY and
 * DEMO_MCP_RESOURCE_SERVER_KEY are the live names (read by demo_mcp_gateway's
 * config.ts + the BFF vault-key bridge). DEMO_INVEST_SERVICE_KEY /
 * DEMO_MORTGAGE_SERVICE_KEY are legacy aliases that no runtime code reads today
 * (only scripts/rename-services.sh maps the former). They are provisioned here
 * per the ratified cutover decision so the migration is lossless; all four carry
 * the SAME value. Prune the two legacy names once confirmed unused everywhere.
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '../..');
const ROOT_ENV = path.join(REPO_ROOT, '.env');
const API_SERVER_ENV = path.join(REPO_ROOT, 'demo_api_server', '.env');
const VAULT_CLI = path.join(SCRIPTS_DIR, 'vault.js');
const VAULT_ENTRIES = ['DEMO_API_RESOURCE_SERVER_KEY', 'DEMO_MCP_RESOURCE_SERVER_KEY'];
// All four names the cutover provisions into demo_api_server/.env. The first two
// are live; the last two are legacy aliases (see header). All carry one value.
const SERVICE_KEY_ENV_NAMES = [
  'DEMO_API_RESOURCE_SERVER_KEY',
  'DEMO_MCP_RESOURCE_SERVER_KEY',
  'DEMO_INVEST_SERVICE_KEY',
  'DEMO_MORTGAGE_SERVICE_KEY',
];
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

/**
 * Read the current service key from the vault. Best-effort bridge that only
 * works while the vault still exists AND VAULT_PASSWORD is available. Never
 * throws — a missing password / vault / entry returns null so the caller falls
 * through to the .env sources.
 */
function defaultVaultGet() {
  if (!process.env.VAULT_PASSWORD) return null;
  try {
    return vault(['get', VAULT_ENTRIES[0]]).replace(/\n$/, '');
  } catch (_) {
    return null;
  }
}

/**
 * Resolve the EXISTING service key without requiring the vault, so this keeps
 * working after the vault is removed (Task 8). Precedence — first non-default
 * wins; a committed default at any layer is skipped, never returned:
 *   1. demo_api_server/.env DEMO_API_RESOURCE_SERVER_KEY (the new canonical home)
 *   2. repo-root .env API_RESOURCE_SERVER_API_KEY (legacy home / compose input)
 *   3. vault DEMO_API_RESOURCE_SERVER_KEY (transitional bridge, best-effort)
 * Returns null when nothing but defaults exist — the caller then mints.
 */
function resolveExistingServiceKey({
  apiEnvPath = API_SERVER_ENV,
  rootEnvPath = ROOT_ENV,
  vaultGet = defaultVaultGet,
} = {}) {
  const fromApiEnv = readEnvValue(apiEnvPath, 'DEMO_API_RESOURCE_SERVER_KEY');
  if (fromApiEnv && !KNOWN_DEFAULTS.has(fromApiEnv)) return fromApiEnv;
  const fromRootEnv = readEnvValue(rootEnvPath, ENV_KEY);
  if (fromRootEnv && !KNOWN_DEFAULTS.has(fromRootEnv)) return fromRootEnv;
  try {
    const fromVault = vaultGet();
    if (fromVault && !KNOWN_DEFAULTS.has(fromVault)) return fromVault;
  } catch (_) { /* vault is optional during/after the migration */ }
  return null;
}

/** Mint only when forced, or when no real value exists anywhere yet. */
function decideNeedsMint(existing, force) {
  return !!force || existing === null || KNOWN_DEFAULTS.has(existing);
}

/**
 * Upsert ALL FOUR DEMO_*_KEY names into demo_api_server/.env in a single
 * read-modify-write pass, every name set to the SAME value. In-place for names
 * already present (no duplicate lines, no reordering); appended under one
 * comment header on first insert. Written 0600 — the file now holds the minted
 * plaintext service key until dotenvx encryption runs.
 */
function upsertApiEnvServiceKeys(file, names, value) {
  let s = '';
  try {
    s = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // Same guard as upsertEnvValue: only a genuinely absent file may be created;
    // a transient read error must not blow away a populated .env.
    if (err.code !== 'ENOENT') {
      throw new Error(`refusing to rewrite ${file}: could not read it (${err.code || err.message})`);
    }
  }
  let headerAdded = false;
  for (const key of names) {
    if (new RegExp(`^${key}=`, 'm').test(s)) {
      s = s.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
    } else {
      if (!headerAdded) {
        s += `${s.endsWith('\n') || s === '' ? '' : '\n'}\n# apikey-dispatch demo: service API key (dotenvx-encrypted at rest after cutover).\n# All four names carry the SAME value; the last two are legacy aliases.\n`;
        headerAdded = true;
      }
      s += `${key}=${value}\n`;
    }
  }
  fs.writeFileSync(file, s, { mode: 0o600 });
}

// Export helpers for tests; only run provisioning when invoked directly
// (node ensure-service-keys.js), never when required as a module.
module.exports = {
  readEnvValue,
  resolveExistingServiceKey,
  decideNeedsMint,
  upsertApiEnvServiceKeys,
  SERVICE_KEY_ENV_NAMES,
  KNOWN_DEFAULTS,
};

if (require.main === module) main();

function main() {
// VAULT_PASSWORD: env first, then demo_api_server/.env (same source the BFF uses).
// Optional now — its only remaining use is the transitional vault sync below.
if (!process.env.VAULT_PASSWORD) {
  const fromEnvFile = readEnvValue(API_SERVER_ENV, 'VAULT_PASSWORD');
  if (fromEnvFile) process.env.VAULT_PASSWORD = fromEnvFile;
}
const haveVaultPw = !!process.env.VAULT_PASSWORD;

const force = process.env.ROTATE_SERVICE_KEYS === '1';
const existing = resolveExistingServiceKey();
const needsMint = decideNeedsMint(existing, force);
const value = needsMint
  ? `mortgage-${crypto.randomBytes(12).toString('hex')}` // truly fresh: mint
  : existing;                                            // REUSE — never rotate

try {
  // New canonical home: demo_api_server/.env (dotenvx-encrypted at rest post-cutover).
  upsertApiEnvServiceKeys(API_SERVER_ENV, SERVICE_KEY_ENV_NAMES, value);
  // Compose interpolates this into api-resource-server (${API_RESOURCE_SERVER_API_KEY}).
  upsertEnvValue(ROOT_ENV, ENV_KEY, value);
  // Transitional bridge: keep the vault entries in sync while the vault still
  // exists (removed in Task 8). Best-effort — a vault failure never blocks boot.
  let vaultSynced = false;
  if (haveVaultPw) {
    try {
      for (const name of VAULT_ENTRIES) vault(['set', name], value);
      vaultSynced = true;
    } catch (err) {
      console.warn(`[ensure-service-keys] ⚠️  vault sync skipped: ${err.message}`);
    }
  }
  const action = needsMint ? (force ? 'Rotated' : 'Provisioned a fresh') : 'Reused existing (no rotation)';
  console.log(
    `[ensure-service-keys] ${action} service API key → demo_api_server/.env `
    + `(${SERVICE_KEY_ENV_NAMES.join(', ')}) + root .env ${ENV_KEY}`
    + `${vaultSynced ? ` + vault ${VAULT_ENTRIES.join(', ')}` : ''}.`,
  );
} catch (err) {
  console.warn(`[ensure-service-keys] ⚠️  Failed: ${err.message} — mortgage/invest chips may reject the service key.`);
  process.exit(0); // fail soft: never block stack start
}
}
