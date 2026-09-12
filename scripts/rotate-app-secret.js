#!/usr/bin/env node
'use strict';

/**
 * rotate-app-secret.js — rotate one PingOne client secret and propagate it.
 *
 * Runs as a detached process so it survives the container recreate in step 6:
 * when the rotated app is one ai-demo-api-server itself authenticates with,
 * an in-BFF design would kill itself moments after PingOne destroyed the old
 * secret, losing the answer to "did the vault write land?".
 *
 * Order matters. Everything fallible is preflighted BEFORE the regenerate call,
 * because that call is irreversible and has no grace period.
 *
 * Usage: node scripts/rotate-app-secret.js --app-id <id> [--restart] [--k8s]
 */

const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..');
// Only isWorkerApp is used below — the driver in rotateAppSecretCli.js imports
// regenerateClientSecret/verifySecret/fingerprint itself.
const { isWorkerApp } = require(path.join(REPO_ROOT, 'demo_api_server/services/pingOneSecretRotation'));
const { openVault } = require(path.join(REPO_ROOT, 'demo_api_server/lib/vault'));

const SECRETFUL_AUTH_METHODS = new Set(['CLIENT_SECRET_BASIC', 'CLIENT_SECRET_POST', 'CLIENT_SECRET_JWT']);

/** Throws on any condition that must stop us BEFORE the irreversible rotate. */
async function preflight({ app, vaultPath, vaultPassword }) {
  if (isWorkerApp(app)) {
    throw new Error(
      `Refusing to rotate "${app.name}": it is the configured worker app. `
      + 'Rotating it would destroy the credential this tool uses to reach the Management API.');
  }
  const method = String(app.tokenEndpointAuthMethod || '').toUpperCase();
  if (!SECRETFUL_AUTH_METHODS.has(method)) {
    throw new Error(`Refusing to rotate "${app.name}": tokenEndpointAuthMethod is ${method || 'unset'}, so it has no client secret.`);
  }
  if (!vaultPassword) {
    throw new Error('Refusing to rotate: no vault password available, so the new secret could not be persisted.');
  }
  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Refusing to rotate: vault not found at ${vaultPath}.`);
  }
  // Prove the vault actually opens with this password BEFORE the irreversible
  // call — existsSync only proves a file is there, not that it's writable.
  // openVault() alone proves decryptability without mutating anything, so no
  // set/save round-trip is needed here.
  let vault;
  try {
    vault = await openVault(vaultPath, vaultPassword);
  } catch (err) {
    throw new Error(`Refusing to rotate: vault at ${vaultPath} could not be opened — ${err.message}`);
  } finally {
    if (vault) vault.close();
  }
}

// Load-bearing order: this export MUST run before the require.main block below.
// rotateAppSecretCli.js requires this file for `preflight` while this file
// requires rotateAppSecretCli.js for its `main` — a circular require that only
// resolves correctly because module.exports is populated before the CLI driver
// (which closes the cycle) is ever require()'d. Move this below the
// require.main block and the CLI breaks with "preflight is not a function".
module.exports = { preflight };

if (require.main === module) {
  // CLI path is exercised manually; see the plan's Task 3 manual verification.
  // .catch() is required: an uncaught rejection here hits Node's default
  // handler, which util.inspect()s the whole error — and an axios failure
  // from regenerateClientSecret carries the management bearer token in
  // err.config.headers.Authorization. Print err.message only, never err.
  //
  // The DONE line is the run's single terminal sentinel — the BFF's /runs/:id
  // keys its status off these EXACT strings. Without it a refused rotation
  // (which matches none of the success/failure words) polled as "running"
  // forever, and the page rendered a secret mask for a rotation that never
  // happened. Write it LAST on every path, and to stdout so it lands in the
  // same redirected run log the route tails.
  //   DONE ok           — rotated, propagated, verified
  //   DONE failed: ...  — something after the irreversible rotate went wrong
  //   DONE aborted: ... — refused before anything was touched
  require(path.join(REPO_ROOT, 'scripts/lib/rotateAppSecretCli')).main(process.argv.slice(2))
    .then(() => {
      process.stdout.write('[rotate] DONE ok\n');
    })
    .catch((err) => {
      const kind = err && err.aborted ? 'aborted' : 'failed';
      process.stdout.write(`[rotate] DONE ${kind}: ${err.message.split('\n')[0]}\n`);
      process.exitCode = 1;
    });
}
