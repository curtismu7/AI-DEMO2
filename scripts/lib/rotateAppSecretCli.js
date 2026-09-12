'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
// See the same constant in scripts/rotate-app-secret.js: reaching a
// demo_api_server module (or CLI) through REPO_ROOT resolves node_modules to
// the HOST bind at /repo/demo_api_server/node_modules inside the container,
// which carries a darwin lmdb binding. /app is the same sources with the
// image's linux node_modules beside them. Everything NOT under
// demo_api_server/ stays on REPO_ROOT, which is already correct.
const DEMO_API_SERVER_ROOT = fs.existsSync('/app/services')
  ? '/app'
  : path.join(REPO_ROOT, 'demo_api_server');

const { preflight } = require(path.join(REPO_ROOT, 'scripts/rotate-app-secret'));
const {
  regenerateClientSecret, verifySecret, fingerprint,
} = require(path.join(DEMO_API_SERVER_ROOT, 'services/pingOneSecretRotation'));
const { propagateServiceEnvs } = require(path.join(DEMO_API_SERVER_ROOT, 'scripts/refresh-service-envs'));
const { servicesForVaultKey, applyRestart, applyK8sPatch } =
  require(path.join(REPO_ROOT, 'scripts/lib/rotationTargets'));

const VAULT_CLI = path.join(DEMO_API_SERVER_ROOT, 'scripts/vault.js');
const DESCRIBE_APP_CLI = path.join(DEMO_API_SERVER_ROOT, 'scripts/describeApp.js');

function log(msg) { process.stdout.write(`[rotate] ${msg}\n`); }

/** Writes the value on STDIN — never argv, which execFileSync echoes on error. */
function vaultSet(name, value) {
  execFileSync('node', [VAULT_CLI, 'set', name], {
    input: value, stdio: ['pipe', 'ignore', 'pipe'], cwd: REPO_ROOT,
  });
}

/** Marks an error as "nothing was touched" so the caller can emit DONE aborted. */
function markAborted(err) {
  err.aborted = true;
  return err;
}

/** `argv[indexOf(f) + 1]` silently returns argv[0] for a MISSING flag (-1 + 1). */
function flagValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(argv) {
  const appId = flagValue(argv, '--app-id');
  const vaultKey = flagValue(argv, '--vault-key');
  if (!appId || !vaultKey) {
    throw markAborted(new Error('usage: --app-id <id> --vault-key <NAME> [--restart] [--k8s]'));
  }

  // Everything before this flips true is recoverable — nothing has changed yet.
  let rotated = false;
  try {
    const app = JSON.parse(execFileSync('node', [
      DESCRIBE_APP_CLI, appId,
    ], { encoding: 'utf8', cwd: REPO_ROOT }));

    const vaultPath = process.env.VAULT_PATH || path.join(REPO_ROOT, 'secrets.vault');
    await preflight({ app, vaultPath, vaultPassword: process.env.VAULT_PASSWORD || '' });
    log(`preflight ok for "${app.name}"`);

    log('rotating in PingOne — the old secret dies now');
    const secret = await regenerateClientSecret(appId);
    rotated = true;
    log(`rotated. fingerprint=${fingerprint(secret)}`);

    vaultSet(vaultKey, secret);
    log(`vault updated: ${vaultKey} = ••••••••`);

    // Propagation is non-fatal by design (design spec, "Failure modes":
    // "Vault already holds the new value; log names the remaining .env files").
    // It also used to be able to process.exit() the whole rotation out from
    // under us — it throws now, and either way we continue to verify/restart.
    try {
      await propagateServiceEnvs();
      log('service .env files re-derived from PingOne');
    } catch (err) {
      log(`PROPAGATION INCOMPLETE (${err.message.split('\n')[0]}) — service .env files still hold the OLD secret; `
        + 'the vault is correct. Re-run demo_api_server/scripts/refresh-service-envs.js on the host.');
    }

    const check = await verifySecret(app, secret);
    log(check.ok ? `verified (${check.code})` : `VERIFY FAILED (${check.code})`);
    if (!check.ok) process.exitCode = 1;

    if (argv.includes('--restart')) {
      const services = servicesForVaultKey(vaultKey);
      log(`recreating: ${services.join(', ')}`);
      applyRestart(services);
      log('containers recreated');
    }
    if (argv.includes('--k8s')) {
      applyK8sPatch(vaultKey, secret);
      log('k8s secret patched');
    }

    // Raised last so the restart/k8s steps still run (unchanged behaviour), but
    // the caller's DONE sentinel reports the rotation as failed rather than ok.
    if (!check.ok) throw new Error(`verify failed (${check.code})`);
  } catch (err) {
    if (!rotated) markAborted(err);
    throw err;
  } finally {
    // The page that starts this runs inside the BFF container, which ships no
    // docker CLI — so --restart is normally NOT passed and the operator has to
    // finish by hand. Print the exact command on every post-rotate path,
    // immediately before the DONE sentinel, success or failure.
    if (rotated) {
      log(`to finish on the host: ./run-docker.sh restart ${servicesForVaultKey(vaultKey).join(' ')}`);
    }
  }
}

module.exports = { main, DEMO_API_SERVER_ROOT, VAULT_CLI, DESCRIBE_APP_CLI };
