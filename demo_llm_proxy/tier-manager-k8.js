#!/usr/bin/env node

// tier-manager-k8.js — in-cluster swap daemon for the 2-tier LLM stack.
//
// Mirrors demo_llm_proxy/tier-manager.js but scales llama-tier1 / llama-tier5
// Deployments instead of running start-local-models.sh on the host. Only one
// tier runs at a time (swap mode) to stay within namespace memory quota.
//
// Requires a ServiceAccount with patch/update on deployments llama-tier1 and
// llama-tier5 (see k8s/56-llm-stack.yaml).

const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PORT = process.env.TIER_MANAGER_PORT || 8097;
const NS = process.env.K8S_NAMESPACE || 'ai-demo';
const ROLLOUT_TIMEOUT = process.env.TIER_ROLLOUT_TIMEOUT || '600s';

const DEPLOYMENTS = {
  8091: 'llama-tier1',
  8096: 'llama-tier5',
};

let VALID_PORTS = new Set(Object.keys(DEPLOYMENTS));
try {
  const { TIERS } = require('./modelCatalog');
  VALID_PORTS = new Set(TIERS.map((t) => String(t.port)));
} catch (_) {
  /* modelCatalog optional — fall back to DEPLOYMENTS keys */
}

let queue = Promise.resolve();
let inFlight = null;

/** Run kubectl against the in-cluster API (pod ServiceAccount auth). */
async function kubectl(...args) {
  const { stdout } = await execFileAsync(
    'kubectl',
    ['-n', NS, ...args],
    { timeout: 620000, maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout;
}

/** Scale tiers so only the requested port's Deployment is replicas:1. */
async function ensureTier(port) {
  const target = DEPLOYMENTS[port];
  if (!target) throw new Error(`no deployment mapped for port ${port}`);

  for (const dep of Object.values(DEPLOYMENTS)) {
    const replicas = dep === target ? '1' : '0';
    await kubectl('scale', `deployment/${dep}`, `--replicas=${replicas}`);
  }

  if (target) {
    await kubectl('rollout', 'status', `deployment/${target}`, `--timeout=${ROLLOUT_TIMEOUT}`);
  }
}

function ensureTierQueued(port) {
  if (inFlight && inFlight.port === port) return inFlight.promise;
  const promise = (queue = queue
    .catch(() => {})
    .then(() => ensureTier(port))
    .finally(() => {
      if (inFlight && inFlight.promise === promise) inFlight = null;
    }));
  inFlight = { port, promise };
  return promise;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', swapping: inFlight ? inFlight.port : null, mode: 'k8' }));
    return;
  }

  if (url.pathname === '/ensure') {
    const port = url.searchParams.get('port');
    if (!VALID_PORTS.has(port)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `invalid port ${port}` }));
      return;
    }
    console.log(`[tier-manager-k8] ensure ${port} requested`);
    ensureTierQueued(port)
      .then(() => {
        console.log(`[tier-manager-k8] ensure ${port} done`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, port, deployment: DEPLOYMENTS[port] }));
      })
      .catch((err) => {
        console.error(`[tier-manager-k8] ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, port, error: err.message }));
      });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[tier-manager-k8] listening on 0.0.0.0:${PORT} namespace=${NS}`);
});
