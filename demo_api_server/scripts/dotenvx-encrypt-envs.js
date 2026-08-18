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
 * the vault migration allowlist (single source of truth) unioned with the four
 * service-key names — exactly the values that were vault-resident before.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { ALLOWED_ENV_VARS } = require('./vault-migrate');
const { SERVICE_KEY_ENV_NAMES } = require('./ensure-service-keys');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHARED_KEYS_FILE = path.join(REPO_ROOT, '.env.keys');

// The four secret-loading services already on @dotenvx/dotenvx loaders
// (BFF + agent + gateway + oauth-mcp). Their `.env` files are the ones encrypted.
const TARGET_ENV_FILES = [
  path.join(REPO_ROOT, 'demo_api_server', '.env'),
  path.join(REPO_ROOT, 'demo_agent_service', '.env'),
  path.join(REPO_ROOT, 'demo_mcp_gateway', '.env'),
  path.join(REPO_ROOT, 'oauth-mcp', '.env'),
];

// Only TRUE secrets are encrypted. Single source of truth for the secret list is
// vault-migrate's closed allowlist; the four service-key names are unioned on
// (two are already in the allowlist — the Set dedupes them).
const SECRET_NAMES = Array.from(new Set([...ALLOWED_ENV_VARS, ...SERVICE_KEY_ENV_NAMES]));

function readPublicKey(envFile, fsImpl = fs) {
  if (!fsImpl.existsSync(envFile)) return null;
  const m = fsImpl.readFileSync(envFile, 'utf8').match(/^DOTENV_PUBLIC_KEY=(.*)$/m);
  return m ? m[1].replace(/^["']|["']$/g, '').trim() : null;
}

/** Prepend DOTENV_PUBLIC_KEY to a file that lacks one, so it adopts the shared key. */
function seedPublicKey(envFile, publicKey, fsImpl = fs) {
  const cur = fsImpl.readFileSync(envFile, 'utf8');
  if (/^DOTENV_PUBLIC_KEY=/m.test(cur)) return false; // already keyed — leave it
  fsImpl.writeFileSync(envFile, `DOTENV_PUBLIC_KEY=${publicKey}\n${cur}`);
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
} = {}) {
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
  SHARED_KEYS_FILE,
  readPublicKey,
  seedPublicKey,
  encryptArgs,
  encryptAll,
};

if (require.main === module) {
  encryptAll();
}
