#!/usr/bin/env node
'use strict';
/**
 * dotenvx-encrypt-envs — OPERATOR-RUN vault→dotenvx cutover step.
 *
 * Encrypts the TRUE secrets in each secret-loading service's `.env` at rest with
 * ONE shared ECIES keypair, so a single DOTENV_PRIVATE_KEY (delivered at runtime
 * like VAULT_PASSWORD is today) decrypts them all. Non-secret config stays
 * plaintext, so the files remain diff-reviewable.
 *
 *   npm --prefix demo_api_server run secrets:encrypt
 *
 * ⚠️  This MUTATES real `.env` files and writes the private key to a gitignored
 * repo-root `.env.keys`. It is deliberately NOT wired into run.sh / run-docker.sh
 * / CI / tests — it is a one-time cutover the operator runs by hand (see
 * docs/superpowers/plans/2026-08-18-vault-dotenvx-cutover-runbook.md).
 *
 * How the shared keypair is guaranteed (deterministic, no reliance on dotenvx's
 * internal key-reuse heuristics):
 *   - If any target `.env` already carries a DOTENV_PUBLIC_KEY, that IS the
 *     shared key — every other file is seeded with it before encrypting, so no
 *     new keypair is ever generated (rerun-safe; no key rotation).
 *   - On a first run where none is keyed yet, the first file is encrypted to
 *     generate the keypair (dotenvx writes DOTENV_PUBLIC_KEY into it and
 *     DOTENV_PRIVATE_KEY into the shared `.env.keys`); its public key is then
 *     seeded into the remaining files before they are encrypted.
 *
 * Selective encryption: `dotenvx encrypt -k <NAME>` per secret name. The set is
 * the vault migration allowlist (single source of truth for what the OLD vault
 * held) unioned with the four service-key names AND `ADDITIONAL_SECRET_NAMES`
 * below (real secrets added to these `.env` files directly over time, never
 * vault-resident, so `vault-migrate.js`'s allowlist never had to know about
 * them). `vault-migrate.js`'s list intentionally stays scoped to vault history
 * — it is a real record, still read by the vault CLIs until Task 8 — rather
 * than being widened to mean "everything dotenvx should encrypt".
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { ALLOWED_ENV_VARS } = require('./vault-migrate');
const { SERVICE_KEY_ENV_NAMES } = require('./ensure-service-keys');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHARED_KEYS_FILE = path.join(REPO_ROOT, '.env.keys');

// Recurrence guard (2026-08-18 incident): this tool encrypted all four services'
// `.env` files while the BFF entrypoint had NO dotenvx decrypt path (plan Task 5
// hit a Step-0 STOP and was never re-run) — on restart the BFF read raw
// ciphertext (login client secret literally `encrypted:...`, ConfigStore key
// mismatch, New Relic resolving `collector.encrypted:...`). Never encrypt until
// the BFF entrypoint provably contains the bootstrap that decrypts.
const BFF_ENTRYPOINT = path.join(REPO_ROOT, 'demo_api_server', 'server.js');
const BFF_BOOTSTRAP_MARKER = "require('./services/dotenvxBootstrap')";

/** Throw (refusing the whole run) unless server.js carries the dotenvx bootstrap. */
function assertBffDecryptCapable({ entrypoint = BFF_ENTRYPOINT, fsImpl = fs } = {}) {
  let src = '';
  try {
    src = fsImpl.readFileSync(entrypoint, 'utf8');
  } catch (_err) {
    src = '';
  }
  if (!src.includes(BFF_BOOTSTRAP_MARKER)) {
    throw new Error(
      'refusing to encrypt demo_api_server/.env: server.js has no dotenvx bootstrap '
      + `(${BFF_BOOTSTRAP_MARKER} not found in ${entrypoint}) — secrets would become `
      + 'unreadable at startup (2026-08-18 incident). Merge the BFF bootstrap '
      + '(services/dotenvxBootstrap.js, required before newrelic) first, then re-run.',
    );
  }
}

// The four secret-loading services already on @dotenvx/dotenvx loaders
// (BFF + agent + gateway + oauth-mcp). Their `.env` files are the ones encrypted.
const TARGET_ENV_FILES = [
  path.join(REPO_ROOT, 'demo_api_server', '.env'),
  path.join(REPO_ROOT, 'demo_agent_service', '.env'),
  path.join(REPO_ROOT, 'demo_mcp_gateway', '.env'),
  path.join(REPO_ROOT, 'oauth-mcp', '.env'),
];

// Found 2026-08-18 during the cutover runbook: real secrets present across the
// four target `.env` files that were never migrated into the vault (added
// directly to `.env` after the vault's allowlist was last updated), so they
// were never covered by ALLOWED_ENV_VARS. Deliberately excludes lookalikes
// that are NOT secrets needing encryption: `DOTENV_PUBLIC_KEY` (meant to stay
// plaintext — that's the whole point of it), `VAULT_PASSWORD` (belongs to the
// vault being retired at Task 8, not this file's own ciphertext), and the
// `DEMO_*_PASSWORD` trio (intentionally-public demo sign-in credentials
// documented for presenters, not access-control secrets).
const ADDITIONAL_SECRET_NAMES = Object.freeze([
  'GW_INTROSPECTION_CLIENT_SECRET',
  'PINGONE_AGENT_CLIENT_SECRET',
  'PINGONE_CLIENT_SECRET',
  'PINGONE_MCP_EXCHANGER_CLIENT_SECRET',
  'PRIVILEGE_SSO_CLIENT_SECRET',
  'HITL_INTERNAL_SECRET',
  'MCP_SERVER_ENCRYPTION_KEY',
  'LANGCHAIN_ENCRYPTION_MASTER_KEY',
  'ENCRYPTION_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'NR_LICENSE_KEY',
  'NR_USER_API_KEY',
  'NR_CLI_API_KEY',
  'PINGONE_A2A_INVESTMENT_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_RECORDS_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_PURCHASE_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_PAYROLL_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_TAX_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_FINAID_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_SUPPLIER_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_HOLDINGS_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_PASSENGER_AGENT_CLIENT_SECRET',
  'PINGONE_A2A_IDENTITY_AGENT_CLIENT_SECRET',
]);

// Only TRUE secrets are encrypted. Single source of truth for the secret list is
// vault-migrate's closed allowlist; the four service-key names and the
// additional-secrets list above are unioned on (the Set dedupes overlaps).
const SECRET_NAMES = Array.from(
  new Set([...ALLOWED_ENV_VARS, ...SERVICE_KEY_ENV_NAMES, ...ADDITIONAL_SECRET_NAMES]),
);

/**
 * Real dotenvx output quotes the value and always appends a trailing
 * `# -fk <keysFile>` hint comment, e.g.:
 *   DOTENV_PUBLIC_KEY="026ace...054e2" # -fk ../.env.keys
 * A naive `(.*)$` capture swallows that comment into the value; only stripping
 * a LEADING quote then leaves the trailing quote + comment text glued on,
 * which breaks dotenvx's hex parse the moment that garbage is seeded into the
 * next file. Match the quoted-or-bare TOKEN explicitly instead of the rest of
 * the line, so the comment is never part of the capture.
 */
function readPublicKey(envFile, fsImpl = fs) {
  if (!fsImpl.existsSync(envFile)) return null;
  const m = fsImpl
    .readFileSync(envFile, 'utf8')
    .match(/^DOTENV_PUBLIC_KEY=(?:"([^"]*)"|'([^']*)'|(\S+))/m);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

/** Prepend DOTENV_PUBLIC_KEY to a file that lacks one, so it adopts the shared key. */
function seedPublicKey(envFile, publicKey, fsImpl = fs) {
  const cur = fsImpl.readFileSync(envFile, 'utf8');
  if (/^DOTENV_PUBLIC_KEY=/m.test(cur)) return false; // already keyed — leave it
  fsImpl.writeFileSync(envFile, `DOTENV_PUBLIC_KEY="${publicKey}"\n${cur}`);
  return true;
}

/** `dotenvx encrypt` argv for one file: shared keys file + selective -k per secret. */
function encryptArgs(envFile, secretNames = SECRET_NAMES, keysFile = SHARED_KEYS_FILE) {
  const args = ['encrypt', '-f', envFile, '-fk', keysFile];
  for (const name of secretNames) args.push('-k', name);
  return args;
}

/** Resolve a dotenvx binary: a service's local install first, else npx. */
function resolveDotenvxRunner() {
  const local = path.join(REPO_ROOT, 'demo_mcp_gateway', 'node_modules', '.bin', 'dotenvx');
  if (fs.existsSync(local)) {
    return (args) => execFileSync(local, args, { cwd: REPO_ROOT, stdio: 'inherit', env: process.env });
  }
  return (args) => execFileSync('npx', ['--yes', '@dotenvx/dotenvx', ...args], {
    cwd: REPO_ROOT, stdio: 'inherit', env: process.env,
  });
}

/**
 * Encrypt every present target file under one shared keypair. Pure orchestration
 * — the dotenvx invocation and fs are injectable so this is unit-testable
 * without touching real secrets or running dotenvx.
 */
function encryptAll({
  files = TARGET_ENV_FILES,
  runDotenvx = resolveDotenvxRunner(),
  fsImpl = fs,
  log = console.log,
  bffEntrypoint = BFF_ENTRYPOINT,
} = {}) {
  // Refuse BEFORE touching any file — see the incident note on the guard above.
  assertBffDecryptCapable({ entrypoint: bffEntrypoint, fsImpl });

  const present = files.filter((f) => fsImpl.existsSync(f));
  if (present.length === 0) {
    log('[dotenvx-encrypt] No target .env files found — nothing to encrypt.');
    return { encrypted: [], sharedPublicKey: null };
  }

  // Reuse an existing shared public key if any file already carries one
  // (rerun-safe; never regenerate → never rotate the keypair).
  let sharedPub = present.map((f) => readPublicKey(f, fsImpl)).find(Boolean) || null;

  const encrypted = [];
  for (const f of present) {
    if (sharedPub) seedPublicKey(f, sharedPub, fsImpl);
    runDotenvx(encryptArgs(f));
    encrypted.push(f);
    if (!sharedPub) {
      // First-run: adopt the keypair dotenvx just generated for this file.
      sharedPub = readPublicKey(f, fsImpl);
    }
    log(`[dotenvx-encrypt] encrypted ${path.relative(REPO_ROOT, f)}`);
  }

  log(`[dotenvx-encrypt] Done. Private key written to ${path.relative(REPO_ROOT, SHARED_KEYS_FILE)} (gitignored).`);
  log('[dotenvx-encrypt] Deliver it at runtime as DOTENV_PRIVATE_KEY (run.sh / run-docker.sh read .env.keys).');
  return { encrypted, sharedPublicKey: sharedPub };
}

module.exports = {
  TARGET_ENV_FILES,
  SECRET_NAMES,
  ADDITIONAL_SECRET_NAMES,
  SHARED_KEYS_FILE,
  BFF_ENTRYPOINT,
  BFF_BOOTSTRAP_MARKER,
  assertBffDecryptCapable,
  readPublicKey,
  seedPublicKey,
  encryptArgs,
  encryptAll,
};

if (require.main === module) {
  encryptAll();
}
