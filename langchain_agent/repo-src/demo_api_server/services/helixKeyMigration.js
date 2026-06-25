// banking_api_server/services/helixKeyMigration.js
'use strict';
/**
 * One-time migration: lift the Helix key from the downloaded <agentName>.json
 * keyfile into BOTH the encrypted vault (at rest) and SQLite configStore
 * (survives restart). helixAgentKeyLoader stays as the runtime fallback.
 *
 * Vault and SQLite are INDEPENDENT targets — vaultLoader loads with
 * persist:false, so a vault entry never reaches SQLite on its own.
 *
 * Idempotent: if configStore already resolves a helix_api_key (operator set
 * it via /setup, env, or a prior migration into SQLite/vault), do nothing.
 * Never overwrite an operator-provided key.
 *
 * All collaborators injected — no side effects on import.
 */
const VAULT_KEY_NAME = 'HELIX_API_KEY'; // matches configStore env mapping helix_api_key ← HELIX_API_KEY

async function migrateHelixKey(opts = {}) {
  const agentName    = opts.agentName    || 'LLM2';
  const vaultPath    = opts.vaultPath;
  const vaultPassword = opts.vaultPassword;
  const configStore  = opts.configStore  || require('./configStore');
  const vaultLib     = opts.vaultLib     || require('../lib/vault');
  const keyLoader    = opts.keyLoader    || require('./helixAgentKeyLoader');
  const logger       = opts.logger       || console;

  // 1. Idempotent guard — anything already resolvable wins (operator intent).
  let existing = '';
  try { existing = configStore.get('helix_api_key') || ''; } catch (_) { existing = ''; }
  if (existing && String(existing).trim()) {
    return { migrated: false, reason: 'already_present' };
  }

  // 2. Discover the keyfile via the existing loader (repo root/~/Documents/~/Downloads).
  const key = keyLoader.loadAgentKey(agentName);
  if (!key) {
    return { migrated: false, reason: 'no_keyfile' };
  }

  // 3. Vault write (only when a password + path are available).
  let vaultWritten = false;
  if (vaultPassword && vaultPath) {
    let vault;
    try {
      vault = await vaultLib.openVault(vaultPath, vaultPassword);
      vault.set(VAULT_KEY_NAME, key);
      await vault.save();
      vaultWritten = true;
    } finally {
      try { if (vault) vault.close(); } catch (_) { /* ignore */ }
    }
  } else {
    logger.log('[helixKeyMigration] no vault password/path — SQLite only');
  }

  // 4. SQLite write (always — survives restart without VAULT_PASSWORD).
  await configStore.setConfig({ helix_api_key: key });
  const sqliteWritten = true;

  logger.log(
    `[helixKeyMigration] migrated Helix key from ${agentName}.json ` +
    `(vault=${vaultWritten}, sqlite=${sqliteWritten})`,
  );
  return { migrated: true, vaultWritten, sqliteWritten, reason: 'migrated_from_keyfile' };
}

module.exports = { migrateHelixKey, VAULT_KEY_NAME };
