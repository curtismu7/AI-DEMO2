#!/usr/bin/env node

const http = require('http');
const httpProxy = require('http-proxy');

// ── Config ──────────────────────────────────────────────────────────────────
// host.docker.internal lets the container reach llama-server processes running
// on the host; override with LLAMA_HOST for non-Docker runs.
const HOST = process.env.LLAMA_HOST || 'host.docker.internal';
const COMPLEXITY_CHAR_THRESHOLD = 150; // prompt length above which we bump a tier
const MAX_TIER_LOAD = 3;               // in-flight requests before cascading to a bigger tier
const HEALTH_TTL_MS = 30000;           // don't re-probe a backend more often than this
const HEALTH_INTERVAL_MS = HEALTH_TTL_MS; // sweep cadence — matches the TTL so no wasted passes

// Model tiers, smallest → largest. Names/sizes MUST match the processes that
// start-local-models.sh actually launches on each port, so proxy logs, /health,
// and /status report the real model. health/load/lastCheck live on the tier
// object itself (single source of truth — no parallel port-keyed map to sync).
const TIERS = [
  { name: 'gemma-3-4b',      port: 8091, size: '4B',  host: HOST },
  { name: 'gemma-4-12b-qat', port: 8092, size: '12B', host: HOST },
  { name: 'qwen2.5-coder-14b', port: 8093, size: '14B', host: HOST },
  { name: 'gemma-4-12b',     port: 8094, size: '12B', host: HOST },
].map((t) => ({ ...t, healthy: false, load: 0, lastCheck: 0 }));

// ── Request classifier: determine minimum tier needed ──────────────────────
// Split once at load time: plain substrings use a cheap includes() scan; only
// the genuine `.*` patterns pay for a precompiled RegExp. Recompiling these on
// every request (the old code did) was pure hot-path waste.
const partition = (kws) => {
  const substrings = kws.filter((k) => !/[.*+?^${}()|[\]\\]/.test(k));
  const patterns = kws
    .filter((k) => /[.*+?^${}()|[\]\\]/.test(k))
    .map((k) => new RegExp(k));
  return { substrings, patterns };
};

// Complex prompts → tier 3; moderate → tier 2 (long) or 1 (short).
const COMPLEX = partition([
  'demonstrate', 'show.*flow', 'show.*diagram', 'token exchange', 'rfc 8693',
  'act and may_act', 'delegation', 'pkce', 'confused deputy', 'introspection',
  'authorization code flow', 'client credentials',
]);
const MODERATE = partition([
  'how does', 'how to', 'explain.*flow', 'what is.*scope', 'what is.*delegation',
  'token', 'exchange',
]);

const matchesAny = (text, { substrings, patterns }) =>
  substrings.some((s) => text.includes(s)) || patterns.some((re) => re.test(text));

function classifyRequest(body) {
  const text = (typeof body === 'string' ? body : '').toLowerCase();
  const isLong = text.length > COMPLEXITY_CHAR_THRESHOLD;

  if (matchesAny(text, COMPLEX)) return 2;        // Qwen2.5-Coder-14B: complex technical / token flows
  if (matchesAny(text, MODERATE)) return isLong ? 2 : 1;
  return isLong ? 1 : 0;                           // default: smallest tier
}

// ── Health check: ping backend instances ────────────────────────────────────
async function checkHealth() {
  const now = Date.now();
  for (const tier of TIERS) {
    if (now - tier.lastCheck < HEALTH_TTL_MS) continue;
    tier.healthy = await new Promise((resolve) => {
      const req = http.get(`http://${tier.host}:${tier.port}/health`, (res) =>
        resolve(res.statusCode === 200),
      );
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });
    tier.lastCheck = now;
  }
}

// ── Route selection: pick smallest capable tier, cascade on overload ────────
function selectTier(requestTier) {
  const tier = TIERS[requestTier];
  if (tier.healthy && tier.load < MAX_TIER_LOAD) return tier;

  // Cascade to the next healthy larger tier if the target is down or saturated.
  for (let i = requestTier + 1; i < TIERS.length; i++) {
    if (TIERS[i].healthy) return TIERS[i];
  }
  // Last resort: the largest tier, even if unhealthy (it may still be booting).
  return TIERS[TIERS.length - 1];
}

// ── Proxy setup ────────────────────────────────────────────────────────────
const proxy = httpProxy.createProxyServer({ changeOrigin: true });

proxy.on('proxyReq', (proxyReq, req) => {
  if (req.proxyTarget) req.proxyTarget.load += 1;
  // Re-stream the body we consumed for classification. Without this the upstream
  // request has no body (the stream was drained by req.on('data')), so llama-server
  // hangs / the socket closes and http-proxy emits ECONNRESET → "Bad Gateway".
  if (req.bodyBuffer && req.bodyBuffer.length) {
    proxyReq.setHeader('Content-Length', req.bodyBuffer.length);
    proxyReq.write(req.bodyBuffer);
    proxyReq.end();
  }
});

// Release the tier's load slot exactly once per request, whether the request
// completed (proxyRes) or failed (error). Without this, requests that error
// after proxyReq incremented the counter never decrement it, so `load` drifts
// upward and selectTier permanently cascades away from an otherwise-healthy tier.
function releaseTier(req) {
  if (req.proxyTarget && !req._released) {
    req._released = true;
    req.proxyTarget.load = Math.max(0, req.proxyTarget.load - 1);
  }
}

proxy.on('proxyRes', (proxyRes, req) => {
  releaseTier(req);
});

proxy.on('error', (err, req, res) => {
  console.error(`[proxy] Error: ${err.message}`);
  releaseTier(req);
  // Guard against writing headers after a partial/streamed response has begun,
  // which would throw ERR_HTTP_HEADERS_SENT and crash the proxy uncaught.
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
  } else {
    res.end();
  }
});

// Serializable view of a tier for the /health and /status endpoints.
const modelSummary = (t) => ({ name: t.name, port: t.port, size: t.size, healthy: t.healthy, load: t.load });

// ── Main request handler ───────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    checkHealth(); // fire-and-forget refresh
    const allHealthy = TIERS.every((t) => t.healthy);
    res.writeHead(allHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: allHealthy ? 'healthy' : 'degraded', models: TIERS.map(modelSummary) }));
    return;
  }

  if (req.url === '/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proxy: 'multi-model-llm-proxy', models: TIERS.map(modelSummary) }));
    return;
  }

  // Buffer the body once (for classification), then re-stream it in proxyReq.
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const bodyBuffer = Buffer.concat(chunks);
    const requestTier = Math.min(classifyRequest(bodyBuffer.toString('utf8')), TIERS.length - 1);
    const selectedTier = selectTier(requestTier);

    req.proxyTarget = selectedTier; // for load tracking
    req.bodyBuffer = bodyBuffer;    // re-streamed in proxyReq (body was drained above)

    console.log(
      `[proxy] ${req.method} ${req.url} → ${selectedTier.name} (tier ${TIERS.indexOf(selectedTier) + 1}) | load=${selectedTier.load}`,
    );
    proxy.web(req, res, { target: `http://${selectedTier.host}:${selectedTier.port}` });
  });
});

// ── Periodic health checks ─────────────────────────────────────────────────
setInterval(checkHealth, HEALTH_INTERVAL_MS);
checkHealth(); // initial probe

// ── Startup ────────────────────────────────────────────────────────────────
const PORT = process.env.LLM_PROXY_PORT || 8090;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[llm-proxy] Smart router listening on 0.0.0.0:${PORT}`);
  console.log('[llm-proxy] Backends:');
  TIERS.forEach((t, i) => {
    console.log(`  Tier ${i + 1}: ${t.name} (${t.size}) on :${t.port}`);
  });
  console.log(`[llm-proxy] Classification: simple → ${TIERS.map((t) => t.name).join(' → ')}`);
  console.log(`[llm-proxy] Health checks every ${HEALTH_INTERVAL_MS / 1000}s, cascade fallback on overload`);
});

process.on('SIGTERM', () => {
  console.log('[llm-proxy] SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('[llm-proxy] Server closed');
    process.exit(0);
  });
});
