'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

// Which compose services read which secret. The BFF is the catch-all because it
// resolves every key through configStore.
const SERVICE_MAP = {
  PINGONE_MCP_GATEWAY_CLIENT_SECRET: ['mcp-gateway', 'demo-api-server'],
  TE_CLIENT_SECRET: ['demo-api-server', 'ping-gateway'],
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
  try {
    // 'pipe', never 'inherit': this process's stdout/stderr is redirected into a
    // run log the BFF serves over HTTP, and a failing child's raw output can
    // echo request bodies. Captured and discarded; only the fixed remediation
    // below is ever surfaced.
    execFile(path.join(REPO_ROOT, 'run-docker.sh'), ['restart', ...services], {
      cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (_err) {
    throw new Error('container restart failed — run '
      + '`./run-docker.sh restart ' + services.join(' ') + '` on the host to finish');
  }
}

/**
 * Secret goes on stdin — argv is echoed in execFile error messages.
 * Uses `stringData` (plaintext; kubectl base64-encodes server-side) rather than
 * pre-encoding into `data` ourselves, so the value on stdin stays literally the
 * value being rotated — nothing silently transformed en route.
 */
function applyK8sPatch(vaultKey, secret, deps = {}) {
  const execFile = deps.execFile || execFileSync;
  // Namespace and merge type match k8s/create-secrets.sh, which passes
  // --namespace="$NS" (K8S_NAMESPACE, default ai-demo) --type merge on every
  // equivalent call. Without them this only worked by accident, via whatever
  // namespace the current kubectl context happened to default to.
  const namespace = process.env.K8S_NAMESPACE || 'ai-demo';
  const patch = JSON.stringify({ stringData: { [vaultKey]: secret } });
  try {
    // 'pipe', never 'inherit' — kubectl echoes request bodies on some 4xx
    // responses, and this process's output is an HTTP-served run log.
    execFile('kubectl', ['patch', 'secret', 'ai-demo-secrets',
      '--namespace', namespace, '--type', 'merge', '--patch-file', '/dev/stdin'], {
      input: patch, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (_err) {
    throw new Error('k8s secret patch failed — patch '
      + vaultKey + ' into secret ai-demo-secrets in namespace ' + namespace + ' by hand to finish');
  }
}

module.exports = { servicesForVaultKey, applyRestart, applyK8sPatch };
