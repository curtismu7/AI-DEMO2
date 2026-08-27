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
  // loadDemoEnv covers the same root-then-service precedence and ALSO decrypts:
  // post-dotenvx-cutover a plain config() returns `encrypted:...` ciphertext.
  require('./loadDemoEnv').loadDemoEnv();
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
  // Added 2026-08-18 (dotenvx cutover audit): present in demo_api_server/.env
  // and read as a configStore precedence fallback (pingone_client_secret,
  // authorize_worker_client_secret, pingone_worker_token_client_secret) but
  // absent from this allowlist, so it was missed by the dotenvx encrypt step
  // and stayed plaintext while its sibling worker secrets were encrypted.
  'PINGONE_WORKER_CLIENT_SECRET',
  // Phase 269 / Plan 04: mortgage service API key stored in vault and loaded
  // by MCP Gateway's DEMO_ allowlist prefix. Must be present here so that
  // vault:migrate-from-env copies it from .env on a fresh install.
  'DEMO_API_RESOURCE_SERVER_KEY',
  'DEMO_MCP_RESOURCE_SERVER_KEY',
  // Added 2026-08-25 (vault-in-k8s): GW_INTROSPECTION_CLIENT_ID/SECRET were
  // declared with different values in demo_mcp_gateway/.env vs
  // demo_api_server/.env; ai-demo-secrets (built from the latter) loaded
  // last in K8s envFrom and silently won, breaking live PingOne token
  // introspection on the SE cluster. Vault-backing this key removes the
  // possibility of two files disagreeing.
  'GW_INTROSPECTION_CLIENT_ID',
  'GW_INTROSPECTION_CLIENT_SECRET',
  // Added 2026-08-25 (vault-in-k8s Task 1): the rest of the secret-shaped
  // (`_SECRET`/`_KEY`/`_PASSWORD`-suffixed) names found across all 7
  // secret-loading services' .env files (demo_api_server, demo_mcp_gateway,
  // oauth-mcp, demo_hitl_service, langchain_agent, demo_agent_service,
  // ping-gateway) that weren't already covered above. Same rationale as the
  // GW_INTROSPECTION pair: any name a service treats as a real secret must
  // be vault-backed so two .env files can never silently disagree on it.
  'ANTHROPIC_API_KEY',
  'BRANDFETCH_API_KEY',
  'ENTERPRISE_IDP_PINGONE_CLIENT_SECRET',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'HITL_INTERNAL_SECRET',
  'LANGCHAIN_ENCRYPTION_MASTER_KEY',
  'MCP_SERVER_ENCRYPTION_KEY',
  'NR_CLI_API_KEY',
  'NR_LICENSE_KEY',
  'NR_USER_API_KEY',
  'PINGONE_A2A_FINAID_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_HOLDINGS_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_IDENTITY_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_INVESTMENT_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_PASSENGER_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_PAYROLL_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_PURCHASE_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_RECORDS_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_SUPPLIER_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_TAX_AGENT_CLIENT_SECRET',
  'PINGONE_AGENT_CLIENT_SECRET',
  'PRIVILEGE_SSO_CLIENT_SECRET',
  'ENCRYPTION_KEY',
  'OAUTH_MCP_PINGONE_CLIENT_SECRET',
  'PINGONE_CLIENT_SECRET',
  'PINGONE_MCP_EXCHANGER_CLIENT_SECRET',
  'ENCRYPTION_MASTER_KEY',
  'INTENT_TOKEN_SECRET',
  'INTROSPECT_CLIENT_SECRET',
  'P1AZ_WORKER_CLIENT_SECRET',
  'TE_CLIENT_SECRET',
  // Deliberately NOT added, same judgment call already made and documented
  // for dotenvx encryption in demo_api_server/scripts/dotenvx-encrypt-envs.js
  // (ADDITIONAL_SECRET_NAMES comment, 2026-08-18): `DOTENV_PUBLIC_KEY` (meant
  // to stay plaintext — that's the whole point of an asymmetric public key),
  // `VAULT_PASSWORD` (unlocks the vault; can't be vault-resident itself), and
  // the `DEMO_ADMIN_PASSWORD` / `DEMO_USER_PASSWORD` / `DEMO_DELEGATE_PASSWORD`
  // trio (intentionally-public demo sign-in credentials documented for
  // presenters, not access-control secrets).
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
    vault = await vaultLib.openVault(vaultPath, password, { caller: 'vault-migrate' });
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
