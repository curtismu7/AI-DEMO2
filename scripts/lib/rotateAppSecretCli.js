'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const { preflight } = require(path.join(REPO_ROOT, 'scripts/rotate-app-secret'));
const {
  regenerateClientSecret, verifySecret, fingerprint,
} = require(path.join(REPO_ROOT, 'demo_api_server/services/pingOneSecretRotation'));
const { propagateServiceEnvs } = require(path.join(REPO_ROOT, 'demo_api_server/scripts/refresh-service-envs'));

const VAULT_CLI = path.join(REPO_ROOT, 'demo_api_server/scripts/vault.js');

function log(msg) { process.stdout.write(`[rotate] ${msg}\n`); }

/** Writes the value on STDIN — never argv, which execFileSync echoes on error. */
function vaultSet(name, value) {
  execFileSync('node', [VAULT_CLI, 'set', name], {
    input: value, stdio: ['pipe', 'ignore', 'pipe'], cwd: REPO_ROOT,
  });
}

async function main(argv) {
  const appId = argv[argv.indexOf('--app-id') + 1];
  const vaultKey = argv[argv.indexOf('--vault-key') + 1];
  if (!appId || !vaultKey) throw new Error('usage: --app-id <id> --vault-key <NAME> [--restart] [--k8s]');

  const app = JSON.parse(execFileSync('node', [
    path.join(REPO_ROOT, 'demo_api_server/scripts/describeApp.js'), appId,
  ], { encoding: 'utf8', cwd: REPO_ROOT }));

  const vaultPath = process.env.VAULT_PATH || path.join(REPO_ROOT, 'secrets.vault');
  await preflight({ app, vaultPath, vaultPassword: process.env.VAULT_PASSWORD || '' });
  log(`preflight ok for "${app.name}"`);

  log('rotating in PingOne — the old secret dies now');
  const secret = await regenerateClientSecret(appId);
  log(`rotated. fingerprint=${fingerprint(secret)}`);

  vaultSet(vaultKey, secret);
  log(`vault updated: ${vaultKey} = ••••••••`);

  await propagateServiceEnvs();
  log('service .env files re-derived from PingOne');

  const check = await verifySecret(app, secret);
  log(check.ok ? `verified (${check.code})` : `VERIFY FAILED (${check.code})`);
  if (!check.ok) process.exitCode = 1;

  if (argv.includes('--restart')) log('restart requested — implemented in Task 7');
  if (argv.includes('--k8s')) log('k8s patch requested — implemented in Task 7');
}

module.exports = { main };
