#!/usr/bin/env node
'use strict';
/**
 * ensure-service-keys — auto-provision the apikey-dispatch demo secrets.
 *
 * The mortgage/invest "legacy backend" demo uses a static service API key the
 * gateway injects as X-API-Key under the names DEMO_API_RESOURCE_SERVER_KEY /
 * DEMO_MCP_RESOURCE_SERVER_KEY. demo_api_resource_server REFUSES to boot with
 * a known committed default, so a fresh clone deadlocks unless a real key is
 * minted.
 *
 * vault → dotenvx migration (Task 7 tooling): the canonical home for these keys
 * moves from the encrypted `secrets.vault` to demo_api_server/.env, which the
 * dotenvx cutover then encrypts at rest. This script now:
 *   - Resolves the EXISTING key value without requiring the vault, in order:
 *       demo_api_server/.env → repo-root .env → vault (best-effort bridge).
 *   - REUSES that value verbatim — never regenerates it (no rotation). Only a
 *     truly fresh setup (no value anywhere, or only committed defaults) mints one.
 *   - Writes the resolved/minted value to both live DEMO_*_KEY names in
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
 * 2026-08-21: pruned the two legacy aliases DEMO_INVEST_SERVICE_KEY /
 * DEMO_MORTGAGE_SERVICE_KEY (never read by any runtime code — confirmed via
 * repo-wide grep before removal). They were provisioned only for a lossless
 * migration copy per the original cutover decision; that decision's own note
 * said to prune them "once confirmed unused everywhere."
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
// The two live names the cutover provisions into demo_api_server/.env (see
// header note on the pruned legacy aliases).
const SERVICE_KEY_ENV_NAMES = [
  'DEMO_API_RESOURCE_SERVER_KEY',
  'DEMO_MCP_RESOURCE_SERVER_KEY',
];
const ENV_KEY = 'API_RESOURCE_SERVER_API_KEY';

// The shared secret behind every internal hop. docker-compose runs the BFF with
// VAULT_INTERNAL_STRICT=true, so it refuses to START on the committed default;
// this script therefore has to leave a real value behind before `compose up`.
const INTERNAL_SECRET_KEY = 'BFF_INTERNAL_SECRET';
// Must match demo_api_server/utils/internalSecret.js DEFAULT_INTERNAL_SECRET.
const INTERNAL_SECRET_DEFAULT = 'dev-shared-secret-change-me';
// The env file of every compose service whose code reads the secret. They must
// all hold the SAME value as the BFF, so a mint goes to all of them at once.
const INTERNAL_SECRET_ENV_FILES = [
  'demo_agent_service/.env',
  'demo_mcp_gateway/.env',
  'ping-gateway/.env',
  'oauth-mcp/.env',
  'demo_hitl_service/.env',
  'demo_mcp_resource_server/.env',
  'langchain_agent/.env',
  'demo_authz_server/.env',
];
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

function upsertEnvValue(file, key, value, comment = '# apikey-dispatch demo: auto-provisioned; must equal vault DEMO_API_RESOURCE_SERVER_KEY') {
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
    s += `${s.endsWith('\n') || s === '' ? '' : '\n'}\n${comment}\n${key}=${value}\n`;
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
function defaultVaultGet(name = VAULT_ENTRIES[0]) {
  if (!process.env.VAULT_PASSWORD) return null;
  try {
    return vault(['get', name]).replace(/\n$/, '');
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
        s += `${s.endsWith('\n') || s === '' ? '' : '\n'}\n# apikey-dispatch demo: service API key (dotenvx-encrypted at rest after cutover).\n# Both names carry the SAME value.\n`;
        headerAdded = true;
      }
      s += `${key}=${value}\n`;
    }
  }
  fs.writeFileSync(file, s, { mode: 0o600 });
}

/**
 * Leave a real BFF_INTERNAL_SECRET behind for the BFF, without ever rotating one.
 *   - a real value already in demo_api_server/.env  → 'kept', nothing written
 *     (a dotenvx-encrypted value is real: it is decrypted at container start)
 *   - none there, but a real one in the vault       → 'copied-from-vault' into
 *     the BFF env only. The BFF's strict check runs when its routes load, long
 *     before the vault is opened, so a vault-only secret would still read as
 *     the default at that moment.
 *   - none anywhere (a fresh clone)                 → 'minted', and written to
 *     the BFF env AND every consumer's env file, so they agree.
 */
function ensureInternalSecret({
  apiEnvPath = API_SERVER_ENV,
  consumerEnvPaths = INTERNAL_SECRET_ENV_FILES.map((rel) => path.join(REPO_ROOT, rel)),
  vaultGet = () => defaultVaultGet(INTERNAL_SECRET_KEY),
  mint = () => crypto.randomBytes(32).toString('base64url'),
} = {}) {
  const isReal = (v) => !!v && v !== INTERNAL_SECRET_DEFAULT;
  const comment = '# Shared internal-hop secret: auto-provisioned on first start; every service must hold the same value.';
  if (isReal(readEnvValue(apiEnvPath, INTERNAL_SECRET_KEY))) return { action: 'kept', written: [] };

  let fromVault = null;
  try { fromVault = vaultGet(); } catch (_) { /* vault is optional */ }
  if (isReal(fromVault)) {
    upsertEnvValue(apiEnvPath, INTERNAL_SECRET_KEY, fromVault, comment);
    return { action: 'copied-from-vault', written: [apiEnvPath] };
  }

  const value = mint();
  const written = [apiEnvPath, ...consumerEnvPaths];
  for (const file of written) upsertEnvValue(file, INTERNAL_SECRET_KEY, value, comment);
  return { action: 'minted', written };
}

// Export helpers for tests; only run provisioning when invoked directly
// (node ensure-service-keys.js), never when required as a module.
module.exports = {
  readEnvValue,
  resolveExistingServiceKey,
  decideNeedsMint,
  upsertApiEnvServiceKeys,
  ensureInternalSecret,
  SERVICE_KEY_ENV_NAMES,
  INTERNAL_SECRET_ENV_FILES,
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

// First, and in its own try: the service-key step below exits the process on
// failure, and this one must run regardless. It is not soft in effect — without
// a real secret the BFF refuses to start — so a failure says exactly that.
try {
  const { action, written } = ensureInternalSecret();
  if (action === 'minted') {
    console.log(`[ensure-service-keys] Provisioned a fresh ${INTERNAL_SECRET_KEY} → ${written.length} env files (the BFF and every service that shares it).`);
  } else if (action === 'copied-from-vault') {
    console.log(`[ensure-service-keys] Copied ${INTERNAL_SECRET_KEY} from the vault → demo_api_server/.env (the BFF checks it before the vault opens).`);
  }
} catch (err) {
  console.warn(`[ensure-service-keys] ⚠️  Could not provision ${INTERNAL_SECRET_KEY}: ${err.message} — the BFF refuses to start on the default secret (VAULT_INTERNAL_STRICT). Set a real value in demo_api_server/.env.`);
}

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
