#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * One-shot migration tool: copy selected secrets from process.env (typically
 * supplied by .env via dotenv) into the encrypted vault.
 *
 * Usage:
 *   npm run vault:migrate-from-env                 # actual migration
 *   npm run vault:migrate-from-env -- --dry-run    # preview only
 *   npm run vault:migrate-from-env -- --force      # overwrite existing entries
 *   npm run vault:migrate-from-env -- --vault /path/to/secrets.vault
 *
 * Closed allowlist — only these names are considered. Anything else in
 * process.env is ignored. This is a safety property; the script should
 * never sweep "everything in env" into the vault.
 *
 * NEVER logs values — only entry name and character length.
 *
 * Phase 269 / Plan 05 Task 1.
 * Threat model: T-269-21 (no value leak), T-269-22 (skip-on-exists default),
 *               T-269-23 (closed allowlist — no arbitrary env names).
 */

const path = require('node:path');
const fs = require('node:fs');
const { Command } = require('commander');
const vaultLib = require('../lib/vault');

// Load dotenv exactly as the BFF does so the same env vars are visible.
// Repo-root .env first (some installs put shared values there), then the
// banking_api_server/.env (the canonical location after setupFresh). `override:
// false` means an already-set process.env wins, mirroring dotenv's normal
// precedence used elsewhere in this repo.
try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), override: false });
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: false });
} catch (_e) {
  // dotenv missing is fatal for migration — bail loudly.
  console.error('vault-migrate: dotenv is required to load .env values');
  process.exit(1);
}

// T-269-23: closed allowlist. ONLY these names are considered for migration.
// Adding new entries requires a code change + REGRESSION_PLAN audit; this is
// the safety property that protects against an attacker (or accident) writing
// `LD_PRELOAD` / `PATH` / etc. into the vault.
const ALLOWED_ENV_VARS = Object.freeze([
  'HELIX_API_KEY',
  'PINGONE_ADMIN_CLIENT_SECRET',
  'PINGONE_AI_CORE_CLIENT_SECRET',
  'PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET',
  'PINGONE_AI_AGENT_CLIENT_SECRET',
  'PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET',
  'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET',
  'PINGONE_MCP_GATEWAY_CLIENT_SECRET',
  'PINGONE_MCP_GATEWAY_CLIENT_ID',
  'MCP_GW_CLIENT_SECRET',
  'MCP_GW_CLIENT_ID',
  'AGENT_CLIENT_ID',
  'AGENT_CLIENT_SECRET',
  'BFF_INTERNAL_SECRET',
  'CONFIG_ENCRYPTION_KEY',
  'SESSION_SECRET',
  // Added 2026-05-15 (vault-bootstrap audit): secrets classified public:false
  // in configStore SECRET_KEYS but previously absent from this allowlist, so
  // they could never reach the vault and a .env re-strip would lose them.
  // Names only — closed-allowlist + LD_PRELOAD/PATH guard unchanged.
  'PINGONE_USER_CLIENT_SECRET',
  'PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET',
  'PINGONE_MANAGEMENT_CLIENT_SECRET',
  'PINGONE_MGMT_CLIENT_SECRET',
  'PINGONE_SESSION_SECRET',
  'PINGONE_INTROSPECTION_CLIENT_SECRET',
  'POSTHOG_API_KEY',
  // Phase 269 / Plan 04: mortgage service API key stored in vault and loaded
  // by MCP Gateway's DEMO_ allowlist prefix. Must be present here so that
  // vault:migrate-from-env copies it from .env on a fresh install.
  'DEMO_MORTGAGE_SERVICE_KEY',
  'DEMO_INVEST_SERVICE_KEY',
]);

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function resolveVaultPath(explicitFromFlag) {
  return explicitFromFlag || process.env.VAULT_PATH || path.join(REPO_ROOT, 'secrets.vault');
}

async function _promptForPassword(message) {
  // Thin wrapper for ESM dynamic import — keeps the rest of the module CJS.
  const mod = await import('@inquirer/password');
  return mod.default({ message, mask: '*' });
}

async function getPassword({ isTTY = !!process.stdin.isTTY, envPassword = process.env.VAULT_PASSWORD } = {}) {
  if (envPassword) return envPassword;
  if (!isTTY) {
    const err = new Error('vault password required: set VAULT_PASSWORD env or run interactively');
    err.exitCode = 1;
    throw err;
  }
  return module.exports._promptForPassword('Vault password:');
}

async function migrate({ dryRun = false, force = false, vaultPathArg } = {}) {
  const vaultPath = resolveVaultPath(vaultPathArg);

  if (!fs.existsSync(vaultPath)) {
    console.error('vault: file not found at ' + vaultPath);
    console.error('Create one with: npm run vault:create (or npm run vault:set <NAME>)');
    process.exitCode = 4;
    return;
  }

  const password = await getPassword();
  let vault;
  try {
    vault = await vaultLib.openVault(vaultPath, password);
  } catch (err) {
    // Opaque error — never leak which axis (password / file / format) failed.
    console.error('vault: open failed: ' + err.message);
    process.exitCode = 1;
    return;
  }
  // T-269-06: shrink the env-var leak window after the password has done its job.
  delete process.env.VAULT_PASSWORD;

  const existingNames = new Set(vault.list());
  let copied = 0;
  let skippedAlreadyPresent = 0;
  let skippedNotSet = 0;

  try {
    for (const name of ALLOWED_ENV_VARS) {
      const value = process.env[name];
      if (!value || value.trim() === '') {
        console.error('[migrate] skipping ' + name + ' (not set in env)');
        skippedNotSet++;
        continue;
      }
      if (existingNames.has(name) && !force) {
        console.error('[migrate] skipping ' + name + ' (already in vault; use --force to overwrite)');
        skippedAlreadyPresent++;
        continue;
      }
      if (dryRun) {
        // T-269-21: name + length only; NEVER the value.
        console.error('[migrate-dry] would copy ' + name + ' (length=' + value.length + ' chars)');
        copied++;
        continue;
      }
      vault.set(name, value);
      // T-269-21: name + length only; NEVER the value.
      console.error('[migrate] copied ' + name + ' (length=' + value.length + ' chars)');
      copied++;
    }

    if (!dryRun && copied > 0) {
      await vault.save();
    }

    console.error('---');
    console.error(
      '[migrate] ' + (dryRun ? 'would copy' : 'copied') + ' ' + copied + ' entries; '
        + 'skipped ' + skippedAlreadyPresent + ' (already in vault); '
        + 'skipped ' + skippedNotSet + ' (not set in env)',
    );
    if (!dryRun && copied > 0) {
      console.error('');
      console.error('⚠️  Next step: remove the migrated entries from your .env file (or set them to empty).');
      console.error('   The BFF will read them from the vault on next restart, IF VAULT_PASSWORD is set.');
    }
  } finally {
    try {
      vault.close();
    } catch (_e) { /* close errors are non-fatal */ }
  }
}

function parseArgs(argv) {
  const program = new Command();
  program
    .name('vault-migrate')
    .description('Copy selected .env secrets into the encrypted vault')
    .exitOverride();
  program.option('--dry-run', 'Preview only; do not write to vault');
  program.option('--force', 'Overwrite existing vault entries');
  program.option('--vault <path>', 'Override vault path (default: VAULT_PATH env or repo-root/secrets.vault)');
  program.parse(['node', 'vault-migrate.js', ...argv], { from: 'node' });
  return program.opts();
}

async function main() {
  const argv = process.argv.slice(2);
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error('vault-migrate: ' + err.message);
    process.exit(64);
  }
  try {
    await migrate({
      dryRun: !!opts.dryRun,
      force: !!opts.force,
      vaultPathArg: opts.vault,
    });
  } catch (err) {
    console.error('vault-migrate: ' + (err.message || err));
    process.exit(err.exitCode || 1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWED_ENV_VARS,
  migrate,
  parseArgs,
  resolveVaultPath,
  getPassword,
  _promptForPassword,
};
