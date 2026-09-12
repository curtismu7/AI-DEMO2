'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

// Which compose services read which secret. The BFF is the catch-all because it
// resolves every key through configStore.
const SERVICE_MAP = {
  PINGONE_MCP_GATEWAY_CLIENT_SECRET: ['demo-mcp-gateway', 'demo-api-server'],
  TE_CLIENT_SECRET: ['demo-api-server'],
};

function servicesForVaultKey(vaultKey) {
  return SERVICE_MAP[vaultKey] || ['demo-api-server'];
}

/**
 * `docker restart` keeps the old env: Compose resolves env_file at container-CREATE
 * time. run-docker.sh recreates, which is the only thing that picks up a new secret.
 */
function applyRestart(services, deps = {}) {
  const execFile = deps.execFile || execFileSync;
  execFile(path.join(REPO_ROOT, 'run-docker.sh'), ['restart', ...services], {
    cwd: REPO_ROOT, stdio: ['ignore', 'inherit', 'inherit'],
  });
}

/**
 * Secret goes on stdin — argv is echoed in execFile error messages.
 * Uses `stringData` (plaintext; kubectl base64-encodes server-side) rather than
 * pre-encoding into `data` ourselves, so the value on stdin stays literally the
 * value being rotated — nothing silently transformed en route.
 */
function applyK8sPatch(vaultKey, secret, deps = {}) {
  const execFile = deps.execFile || execFileSync;
  const patch = JSON.stringify({ stringData: { [vaultKey]: secret } });
  execFile('kubectl', ['patch', 'secret', 'ai-demo-secrets', '--patch-file', '/dev/stdin'], {
    input: patch, stdio: ['pipe', 'inherit', 'inherit'],
  });
}

module.exports = { servicesForVaultKey, applyRestart, applyK8sPatch };
