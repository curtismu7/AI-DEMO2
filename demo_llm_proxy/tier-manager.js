#!/usr/bin/env node

// tier-manager.js — tiny HOST daemon that swaps llama-server tiers on demand.
//
// The llm-proxy router runs in a container and cannot start/stop host
// processes, so it calls this manager instead. One model loaded at a time:
// POST/GET /ensure?port=<tier port> runs
//   bash start-local-models.sh ensure <port>
// which stops every other tier and starts the requested one.
//
// Binds 0.0.0.0:8097 so the container reaches it via host.docker.internal.
// Swaps are serialized — concurrent /ensure calls for the same port coalesce,
// calls for a different port wait their turn.
//
// Start: node demo_llm_proxy/tier-manager.js  (startup scripts do this)

const http = require('http');
const { execFile } = require('child_process');
const path = require('path');

const PORT = process.env.TIER_MANAGER_PORT || 8097;
const SCRIPT = path.join(__dirname, 'start-local-models.sh');
// Derive the valid tier ports from modelCatalog.js (SSOT) so this file never
// drifts when tiers change. Falls back to the historical 5-tier set only if
// the catalog can't be required (e.g. running from a stripped copy).
let VALID_PORTS;
try {
  const { TIERS } = require('./modelCatalog');
  VALID_PORTS = new Set(TIERS.map((t) => String(t.port)));
} catch (_) {
  VALID_PORTS = new Set(['8091', '8096']);
}
const ENSURE_TIMEOUT_MS = 180000; // cold load of the 11GB gpt-oss can be slow

// Resident tiers must survive a swap. `ensure <port>` stops every OTHER tier, so
// a router swap-up would evict a tier that residency had just loaded (observed:
// ensure-set loaded 8091+8096, then a gpt-oss request drove `ensure 8096` and
// killed phi 1s later). With residency configured we ensure the resident SET
// plus the requested port instead, so a swap only ever adds.
const RESIDENT_PORTS = (process.env.LLM_PROXY_RESIDENT_TIERS || '')
  .split(',')
  .map((p) => p.trim())
  .filter((p) => /^\d+$/.test(p));

let queue = Promise.resolve();     // serializes swaps
let inFlight = null;               // { port, promise } — coalesce duplicate asks

function runEnsure(port) {
  // With residency configured, keep the resident tiers loaded alongside the
  // requested one (ensure-set = load these, stop the rest). Without it, classic
  // `ensure` semantics: this port only, everything else stopped.
  const args = RESIDENT_PORTS.length
    ? ['ensure-set', [...new Set([...RESIDENT_PORTS, port])].join(',')]
    : ['ensure', port];
  return new Promise((resolve, reject) => {
    execFile('bash', [SCRIPT, ...args], { timeout: ENSURE_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${args[0]} ${port} failed: ${err.message}\n${stdout}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

function ensureTier(port) {
  if (inFlight && inFlight.port === port) return inFlight.promise;
  const promise = (queue = queue
    .catch(() => {})                 // a failed swap must not poison the queue
    .then(() => runEnsure(port))
    .finally(() => { if (inFlight && inFlight.promise === promise) inFlight = null; }));
  inFlight = { port, promise };
  return promise;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', swapping: inFlight ? inFlight.port : null }));
    return;
  }

  if (url.pathname === '/ensure') {
    const port = url.searchParams.get('port');
    if (!VALID_PORTS.has(port)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `invalid port ${port}` }));
      return;
    }
    console.log(`[tier-manager] ensure ${port} requested`);
    ensureTier(port)
      .then((out) => {
        console.log(`[tier-manager] ensure ${port} done`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, port, output: out.trim().split('\n').slice(-3) }));
      })
      .catch((err) => {
        console.error(`[tier-manager] ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, port, error: err.message }));
      });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[tier-manager] listening on 0.0.0.0:${PORT} — swaps tiers via ${SCRIPT}`);
});
