'use strict';

/**
 * Vault loader for BFF startup (Phase 269 Plan 03).
 *
 * Reads a secrets.vault file (Plan 01 lib/vault) and copies every entry into
 * configStore via setRaw(data, {persist: false}) — the in-memory cache only,
 * never SQLite. Subsequent configStore.getEffective(name) calls see the
 * vault-supplied values; restarting the process without the vault password
 * causes them to disappear (which is the security property the vault offers).
 *
 * Trust model:
 *   - Vault file is encrypted at rest; safe in `ls -la`, safe in `git diff`.
 *   - VAULT_PASSWORD env var is the auth factor; deleted immediately after
 *     vault.close() to shrink the /proc/<pid>/environ leak window (T-269-06).
 *   - KEK + DEKs are zeroed in vault.close() (T-269-08).
 *
 * Vercel: when process.env.VERCEL === '1', this loader is bypassed entirely
 * (Vercel uses Encrypted Environment Variables — see RESEARCH.md "Serverless
 * treatment" and REQ-VAULT-11).
 *
 * Errors:
 *   - VAULT_PASSWORD missing → throws (fail-fast; caller should exit 1).
 *   - VaultAuthError / VaultIntegrityError → rethrown (no oracle).
 *   - Only err.message is logged — never err.stack (no argon/kek/dek leak).
 *
 * DI shape — every dependency is overridable for tests:
 *   loadVaultIntoConfigStore({
 *     vaultPath,    // default: process.env.VAULT_PATH || REPO_ROOT/secrets.vault
 *     password,     // default: process.env.VAULT_PASSWORD
 *     configStore,  // default: require('./configStore')
 *     vaultLib,     // default: require('../lib/vault')
 *     logger,       // default: console
 *     isVercel,     // default: process.env.VERCEL === '1'
 *   }) → { loaded: boolean, entries: number, reason?: string }
 */

const path = require('node:path');
const fs = require('node:fs');

/**
 * On a boot env-id reconcile, drop env-scoped keys from the vault batch so a
 * stale secret from the previous environment cannot shadow the new .env.
 * Mutates `data` in place; returns the dropped key names (lowercase).
 */
function filterVaultForReconcile(data, cs) {
  if (!cs || typeof cs.getEnvReconcileVerdict !== 'function') return [];
  if (cs.getEnvReconcileVerdict() !== 'reconcile') return [];
  const dropped = [];
  for (const k of Object.keys(data)) {
    if (cs.isEnvScoped(k)) { dropped.push(k); delete data[k]; }
  }
  return dropped;
}

// REPO_ROOT = banking_api_server's parent directory.
// Default vault path is REPO_ROOT/secrets.vault — single source of truth
// shared with Plan 04 (docs) and Plan 05 (setupFresh wiring).
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_VAULT_PATH = path.join(REPO_ROOT, 'secrets.vault');

// Phase 269.1 — in-process unlocked state. Flipped to true ONLY after a
// successful vault open (startup OR runtime). Used by GET /api/admin/vault/status
// to answer "is the vault unlocked" without enumerating configStore.
let _unlocked = false;
let _entriesLoaded = 0;

// Vault entries that must also land in process.env, because their consumers read
// process.env directly and never consult configStore. Keep this list minimal and
// explicit — a prefix match would let a hostile vault entry set LD_PRELOAD
// (T-269-17). Add a name here only when a consumer genuinely cannot use
// configStore.
// INTENT_TOKEN_SECRET added 2026-08-27. intentTokenService.getSigningKey()
// reads process.env directly and cannot use configStore: it must resolve the
// SAME bytes the gateways verify with, and configStore's env-first order lets a
// stale .env copy shadow the vault. Because the loop below OVERWRITES
// process.env, listing it here makes the VAULT the final answer for this key —
// a diverged .env value can no longer decide what signs intent tokens.
// getSigningKey() reads lazily, per the "read process.env lazily" note above,
// so it sees the injected value rather than a require-time capture.
const ENV_EXPORT_ALLOWLIST = Object.freeze(['BFF_INTERNAL_SECRET', 'INTENT_TOKEN_SECRET']);

async function loadVaultIntoConfigStore(opts = {}) {
  // run-demo.sh exports VAULT_PATH="" (empty string) when the operator did not
  // set it. `??` only falls through on null/undefined, so an empty string was
  // treated as a real path → the vault at DEFAULT_VAULT_PATH was never loaded
  // ("[vault] no vault file at  — skipping") and the BFF silently ran env-only.
  // Treat empty/whitespace-only VAULT_PATH as unset. Behavior is otherwise
  // unchanged (Row 73: persist:false load, close() in finally, delete
  // VAULT_PASSWORD, Vercel bypass, fail-fast when vault present + no password).
  const _envVaultPath = (process.env.VAULT_PATH || '').trim();
  const vaultPath  = opts.vaultPath ?? (_envVaultPath || DEFAULT_VAULT_PATH);
  const password   = opts.password    ?? process.env.VAULT_PASSWORD;
  const configStore = opts.configStore ?? require('./configStore');
  const vaultLib    = opts.vaultLib    ?? require('../lib/vault');
  const logger      = opts.logger      ?? console;
  const isVercel    = opts.isVercel    ?? (process.env.VERCEL === '1');

  // 1. Vercel bypass — Encrypted Environment Variables are the source of truth there.
  if (isVercel) {
    logger.log('[vault] Vercel environment detected — skipping vault load (use Encrypted Environment Variables)');
    return { loaded: false, entries: 0, reason: 'vercel' };
  }

  // 2. No vault file → no-op by default (env-var + configStore values still
  //    resolve), because a fresh clone with no vault must still run.
  //
  //    This check runs BEFORE the missing-password fail-fast below, so deleting
  //    or failing to mount the file bypassed that guard entirely: the BFF booted
  //    with every vault secret absent and only an info-level log to show for it
  //    (server.js logs only when result.loaded is true). VAULT_REQUIRED=true is
  //    the opt-in for deployments where a vault is always expected — it turns
  //    the one condition an attacker or a broken bind-mount can arrange into a
  //    hard failure, without breaking env-only development.
  if (!fs.existsSync(vaultPath)) {
    if (String(process.env.VAULT_REQUIRED).toLowerCase() === 'true') {
      const msg = '[vault] VAULT_REQUIRED=true but no vault file at ' + vaultPath + ' — refusing to start';
      logger.error(msg);
      const err = new Error(msg);
      err.code = 'VAULT_FILE_MISSING';
      throw err;
    }
    logger.log('[vault] no vault file at ' + vaultPath + ' — skipping (env-var + configStore values will be used)');
    return { loaded: false, entries: 0, reason: 'no_vault_file' };
  }

  // 3. Vault file exists but no password → fail-fast.
  //    NEVER silently fall through to env-only mode (T-269-14): operator must resolve.
  if (!password) {
    const msg = '[vault] secrets.vault exists but VAULT_PASSWORD not set — refusing to start';
    logger.error(msg);
    const err = new Error(msg);
    err.code = 'VAULT_PASSWORD_MISSING';
    throw err;
  }

  // 3a. Ensure the env-id reconcile verdict is computed before we consult it below.
  //     ensureInitialized is idempotent + memoised and does not depend on the vault
  //     (it only reads LMDB + process.env), so this is safe and cheap here.
  await configStore.ensureInitialized();

  // 4. Open the vault. lib/vault returns the same opaque error for wrong-password
  //    and tampered-file — we log only err.message (no err.stack — no argon2 names).
  let vault;
  try {
    // Name ourselves in the audit trail. Without this every line said 'vault.js'
    // and a boot-time load was indistinguishable from a CLI or web unlock.
    vault = await vaultLib.openVault(vaultPath, password, { caller: 'vaultLoader' });
  } catch (err) {
    logger.error('[vault] open failed:', err.message);
    throw err;
  }

  // 5. Copy entries into configStore in a single setRaw batch + 6. close in finally.
  let entryCount = 0;
  try {
    const data = {};
    for (const name of vault.list()) {
      data[name.toLowerCase()] = vault.read(name);
      entryCount++;
    }
    const droppedForReconcile = filterVaultForReconcile(data, configStore);
    if (Object.keys(data).length > 0) {
      await configStore.setRaw(data, { persist: false });
    }
    // 5a. Bridge a NARROW allowlist into process.env as well.
    //
    // vault-migrate.js tells operators to delete migrated entries from .env, but
    // these names are read straight off process.env by internal-auth routes — so
    // following that instruction made them fall back to the committed public
    // default 'dev-shared-secret-change-me'. configStore alone cannot serve them
    // because those routes never consult it.
    //
    // Deliberately tiny: an entry named LD_PRELOAD must never reach process.env
    // (T-269-17), which is why this is an explicit name list and not a prefix.
    // Consumers must also read process.env lazily — routes mount long before this
    // runs, so a require-time capture would still miss it.
    for (const name of ENV_EXPORT_ALLOWLIST) {
      const value = data[name.toLowerCase()];
      if (typeof value === 'string' && value !== '') {
        process.env[name] = value;
      }
    }
    if (droppedForReconcile.length && typeof configStore.recordVaultDropped === 'function') {
      configStore.recordVaultDropped(droppedForReconcile);
    }
  } finally {
    // KEK + DEKs get zeroed even if the read loop threw partway through —
    // a leaked-key process is worse than a partially-cached one.
    try { vault.close(); } catch (_) { /* ignore */ }
    // 7. Shrink the /proc/<pid>/environ leak window (T-269-06).
    //    Idempotent: delete on an unset var is a no-op.
    delete process.env.VAULT_PASSWORD;
  }

  _unlocked = true;
  _entriesLoaded = entryCount;
  logger.log('[vault] loaded ' + entryCount + ' entries from ' + vaultPath);
  return { loaded: true, entries: entryCount };
}

/**
 * Runtime unlock (Phase 269.1) — sibling of loadVaultIntoConfigStore.
 *
 * Called from POST /api/admin/vault/unlock so the operator can unlock the
 * vault from the web UI without restarting the BFF. Differences vs. the
 * startup loader:
 *   - password is REQUIRED (no process.env fallback) — caller supplies via req.body
 *   - does NOT consult process.env.VERCEL (route handler enforces the 503)
 *   - does NOT call delete process.env.VAULT_PASSWORD (the password never came from env)
 * Same as the startup loader:
 *   - configStore.setRaw(data, {persist: false}) — values stay in memory only
 *   - vault.close() runs in finally — KEK + DEKs always get zeroed
 *   - logger.error logs only err.message (never err.stack) on open failure
 *
 * @returns {Promise<{loaded: true, entries: number}>}
 * @throws {Error} with code 'VAULT_PASSWORD_MISSING' if password missing/empty
 * @throws {Error} with code 'VAULT_FILE_NOT_FOUND' if vault file does not exist
 * @throws {VaultAuthError | VaultIntegrityError} from lib/vault.openVault on bad/tampered vault
 */
async function unlockVaultAtRuntime(opts = {}) {
  const password    = opts.password;
  // Same empty-string VAULT_PATH guard as loadVaultIntoConfigStore (above).
  const _envVaultPathRT = (process.env.VAULT_PATH || '').trim();
  const vaultPath   = opts.vaultPath ?? (_envVaultPathRT || DEFAULT_VAULT_PATH);
  const configStore = opts.configStore ?? require('./configStore');
  const vaultLib    = opts.vaultLib    ?? require('../lib/vault');
  const logger      = opts.logger      ?? console;
  // Audit attribution flows in from the route so a web unlock is distinguishable
  // from a CLI one; 'vaultLoader' is the fallback for a direct programmatic call.
  const caller      = opts.caller      ?? 'vaultLoader';

  if (typeof password !== 'string' || password.length === 0) {
    const err = new Error('vault: password required');
    err.code = 'VAULT_PASSWORD_MISSING';
    throw err;
  }
  if (!fs.existsSync(vaultPath)) {
    const err = new Error('vault: file not found');
    err.code = 'VAULT_FILE_NOT_FOUND';
    throw err;
  }

  let vault;
  try {
    vault = await vaultLib.openVault(vaultPath, password, { caller });
  } catch (err) {
    // Generic log — never err.stack (no argon/kek/dek leak). Mirrors loadVaultIntoConfigStore.
    logger.error('[vault] runtime open failed:', err.message);
    throw err;
  }

  let entryCount = 0;
  try {
    const data = {};
    for (const name of vault.list()) {
      data[name.toLowerCase()] = vault.read(name);
      entryCount++;
    }
    if (entryCount > 0) {
      await configStore.setRaw(data, { persist: false });
    }
  } finally {
    // KEK + DEKs zeroed even on partial-read failure.
    try { vault.close(); } catch (_) { /* ignore */ }
    // DELIBERATELY do NOT delete process.env.VAULT_PASSWORD —
    // runtime password came from req.body, not env.
  }

  _unlocked = true;
  _entriesLoaded = entryCount;
  logger.log('[vault] runtime unlock complete — ' + entryCount + ' entries cached');
  return { loaded: true, entries: entryCount };
}

/** Phase 269.1 — returns whether THIS PROCESS has successfully unlocked a vault since boot. */
function isVaultUnlockedThisProcess() { return _unlocked; }

/** Phase 269.1 — entry count from the last successful unlock (or 0). */
function vaultEntryCountThisProcess() { return _entriesLoaded; }

module.exports = {
  // Exported so the vault-wins guarantee is testable: a name dropped from this
  // list silently returns that key to "whichever copy wins", which for
  // INTENT_TOKEN_SECRET is an outage nothing reports.
  ENV_EXPORT_ALLOWLIST,
  filterVaultForReconcile,
  loadVaultIntoConfigStore,
  unlockVaultAtRuntime,
  isVaultUnlockedThisProcess,
  vaultEntryCountThisProcess,
  DEFAULT_VAULT_PATH,
};
