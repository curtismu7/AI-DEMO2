'use strict';

/**
 * One-click container restart via the Docker Engine API over the mounted
 * /var/run/docker.sock — no docker CLI in the image, no new npm dependency.
 *
 * Only the two allowlisted containers can be restarted, and only when
 * AGENT_GW_ALLOW_RESTART is not explicitly disabled. Mounting the socket grants
 * host-level container control, so callers MUST already be admin-gated.
 */

const http = require('http');
const fs = require('fs');

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

const CONTAINERS = {
  'ping-gateway': process.env.PING_GATEWAY_CONTAINER || 'ai-demo-ping-gateway',
  bff: process.env.BFF_CONTAINER || 'ai-demo-api-server',
};

function restartEnabled() {
  const v = String(process.env.AGENT_GW_ALLOW_RESTART ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

function socketAvailable() {
  try { return fs.existsSync(DOCKER_SOCKET); } catch { return false; }
}

function restartContainer(name) {
  return new Promise((resolve) => {
    const req = http.request({
      socketPath: DOCKER_SOCKET,
      path: `/containers/${encodeURIComponent(name)}/restart`,
      method: 'POST',
      timeout: 30000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        // Docker returns 204 on success, 404 if the container is unknown.
        if (res.statusCode === 204) resolve({ ok: true, container: name });
        else resolve({ ok: false, container: name, error: `Docker API HTTP ${res.statusCode}${body ? ': ' + body.slice(0, 200) : ''}` });
      });
    });
    req.on('error', (err) => resolve({ ok: false, container: name, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, container: name, error: 'Docker API timeout' }); });
    req.end();
  });
}

/**
 * Restart the given logical targets ('ping-gateway' and/or 'bff').
 * Returns { ok, results, error? }. When restart isn't possible (disabled or no
 * socket) returns ok:false with a `manual` fallback command for the UI.
 */
async function restartTargets(targets) {
  const wanted = [...new Set(targets)].filter((t) => CONTAINERS[t]);
  if (!wanted.length) return { ok: false, error: 'No valid restart targets' };

  const manual = `docker compose restart ${wanted.map((t) => (t === 'bff' ? 'demo-api-server' : t)).join(' ')}`;

  if (!restartEnabled()) {
    return { ok: false, error: 'Restart disabled (AGENT_GW_ALLOW_RESTART=false)', manual };
  }
  if (!socketAvailable()) {
    return { ok: false, error: `Docker socket not available at ${DOCKER_SOCKET}`, manual };
  }

  // Restart the BFF LAST — restarting ourselves kills the process handling this
  // request, so the response for a BFF restart may not flush. The UI fires that
  // case detached and polls /health.
  const order = wanted.sort((a, b) => (a === 'bff' ? 1 : 0) - (b === 'bff' ? 1 : 0));
  const results = [];
  for (const t of order) {
    results.push({ target: t, ...(await restartContainer(CONTAINERS[t])) });
  }
  const ok = results.every((r) => r.ok);
  return { ok, results, manual: ok ? undefined : manual };
}

module.exports = { restartTargets, restartEnabled, socketAvailable, CONTAINERS };
