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
const { resolveEnsureArgs, parseResidentPorts } = require('./ensureArgs');
const { recoverDeadResidents } = require('./residentRecover');

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
const RECOVER_MS = parseInt(process.env.LLM_RESIDENT_RECOVER_MS || '20000', 10);

// Must match compose LLM_PROXY_RESIDENT_TIERS — run-docker.sh exports this when
// starting the manager. Empty ⇒ classic one-tier swap.
const RESIDENT_CSV = process.env.LLM_PROXY_RESIDENT_TIERS || '';

// When the proxy is hard-pinned and residency does not keep that pin loaded,
// refuse ensure of any other port — otherwise opportunistic gpt-oss prewarm
// unloads phi, then the pin immediately swaps phi back (observed thrash).
const PIN_PORT = String(process.env.LLM_PROXY_PIN_TIER || '').trim();

let queue = Promise.resolve();     // serializes swaps
let inFlight = null;               // { port, promise } — coalesce duplicate asks

function runEnsure(port) {
  const portStr = String(port);
  const residents = parseResidentPorts(RESIDENT_CSV);
  if (
    PIN_PORT
    && VALID_PORTS.has(PIN_PORT)
    && portStr !== PIN_PORT
    && !residents.includes(PIN_PORT)
  ) {
    return Promise.resolve({
      skipped: true,
      reason: 'pinned',
      pin: Number(PIN_PORT),
      requested: Number(portStr),
      output: `skipped ensure ${portStr}: LLM_PROXY_PIN_TIER=${PIN_PORT}`,
    });
  }
  const args = resolveEnsureArgs(port, RESIDENT_CSV);
  return new Promise((resolve, reject) => {
    execFile('bash', [SCRIPT, ...args], { timeout: ENSURE_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${args[0]} ${portStr} failed: ${err.message}\n${stdout}\n${stderr}`));
      else resolve({ skipped: false, output: stdout });
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

/** Restart any resident tier that died (OOM / crash) without waiting for a swap. */
function scheduleResidentRecovery() {
  const ports = parseResidentPorts(RESIDENT_CSV);
  if (!ports.length || !(RECOVER_MS > 0)) return;
  setInterval(() => {
    recoverDeadResidents({
      residentCsv: RESIDENT_CSV,
      ensureFn: ensureTier,
      isBusy: () => !!inFlight,
    })
      .then((r) => {
        if (r.recovered) {
          console.log(`[tier-manager] recovered dead resident(s): ${r.dead.join(',')}`);
        }
      })
      .catch((err) => {
        console.error(`[tier-manager] resident recover failed: ${err.message}`);
      });
  }, RECOVER_MS).unref();
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
      .then((result) => {
        const skipped = Boolean(result && result.skipped);
        const raw = typeof result === 'string' ? result : (result?.output || '');
        console.log(`[tier-manager] ensure ${port} ${skipped ? 'skipped' : 'done'}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          port,
          skipped: skipped || undefined,
          reason: skipped ? result.reason : undefined,
          pin: skipped ? result.pin : undefined,
          output: String(raw).trim().split('\n').slice(-3),
        }));
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
  const residents = parseResidentPorts(RESIDENT_CSV);
  console.log(
    `[tier-manager] listening on 0.0.0.0:${PORT} — swaps via ${SCRIPT}`
      + (residents.length ? `; residents ${residents.join(',')} (recover every ${RECOVER_MS}ms)` : ''),
  );
  scheduleResidentRecovery();
});
