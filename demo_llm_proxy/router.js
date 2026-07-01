#!/usr/bin/env node

const http = require('http');
const httpProxy = require('http-proxy');

// ── Model tiers (smallest to largest) ──────────────────────────────────────
// Use host.docker.internal to access host services from Docker
// Fall back to localhost for non-Docker environments
const HOST = process.env.LLAMA_HOST || 'host.docker.internal';

const MODELS = {
  tier1: { name: 'phi-2', port: 8091, size: '2.7B', weight: 1, host: HOST },
  tier2: { name: 'phi-3', port: 8092, size: '3.8B', weight: 2, host: HOST },
  tier3: { name: 'qwen3-8b', port: 8093, size: '8B', weight: 3, host: HOST },
  tier4: { name: 'gemma-4-12b', port: 8094, size: '12B', weight: 4, host: HOST },
};

const TIERS = [MODELS.tier1, MODELS.tier2, MODELS.tier3, MODELS.tier4];

// Track health and load per model
const health = {
  [MODELS.tier1.port]: { healthy: false, load: 0, lastCheck: 0 },
  [MODELS.tier2.port]: { healthy: false, load: 0, lastCheck: 0 },
  [MODELS.tier3.port]: { healthy: false, load: 0, lastCheck: 0 },
  [MODELS.tier4.port]: { healthy: false, load: 0, lastCheck: 0 },
};

let roundRobinIndex = 0;

// ── Request classifier: determine minimum tier needed ──────────────────────
function classifyRequest(body) {
  let text = '';
  try {
    if (typeof body === 'string') text = body;
    else if (body) text = JSON.stringify(body);
  } catch (_) {}
  text = text.toLowerCase();

  // Complex prompts that need larger models
  const complexKeywords = [
    'demonstrate',
    'show.*flow',
    'show.*diagram',
    'token exchange',
    'rfc 8693',
    'act and may_act',
    'delegation',
    'pkce',
    'confused deputy',
    'introspection',
    'authorization code flow',
    'client credentials',
  ];

  // Moderate prompts
  const moderateKeywords = [
    'how does',
    'how to',
    'explain.*flow',
    'what is.*scope',
    'what is.*delegation',
    'token',
    'exchange',
  ];

  // Check text length as proxy for complexity
  const isLong = text.length > 150;

  // Classify by keywords (complex takes priority)
  for (const kw of complexKeywords) {
    if (new RegExp(kw).test(text)) return 3; // Tier 3 (Qwen)
  }
  for (const kw of moderateKeywords) {
    if (new RegExp(kw).test(text)) return isLong ? 2 : 1; // Tier 2 or 1
  }

  // Default: use smallest tier for simple questions
  return isLong ? 1 : 0; // Tier 1 or Tier 0 (Phi-2)
}

// ── Health check: ping backend instances ────────────────────────────────────
async function checkHealth() {
  for (const tier of TIERS) {
    const now = Date.now();
    if (now - health[tier.port].lastCheck < 30000) continue; // Check every 30s

    try {
      const response = await new Promise((resolve) => {
        const req = http.get(`http://${tier.host}:${tier.port}/health`, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => {
          req.destroy();
          resolve(false);
        });
      });
      health[tier.port].healthy = response;
      health[tier.port].lastCheck = now;
    } catch (_) {
      health[tier.port].healthy = false;
      health[tier.port].lastCheck = now;
    }
  }
}

// ── Route selection: pick smallest capable tier, cascade on overload ────────
function selectTier(requestTier) {
  // Try to use the classified tier first
  let tier = TIERS[requestTier];
  if (health[tier.port].healthy && health[tier.port].load < 3) {
    return tier;
  }

  // Cascade: try next tier if current is unhealthy or overloaded
  for (let i = requestTier + 1; i < TIERS.length; i++) {
    tier = TIERS[i];
    if (health[tier.port].healthy) return tier;
  }

  // Fallback: return the largest tier even if unhealthy (it should boot up)
  return TIERS[TIERS.length - 1];
}

// ── Proxy setup ────────────────────────────────────────────────────────────
const proxy = httpProxy.createProxyServer({ changeOrigin: true });

proxy.on('proxyReq', (proxyReq, req, res) => {
  // Mark request as in-flight
  const target = req.proxyTarget;
  if (target) {
    const port = target.port || 8093;
    if (health[port]) health[port].load = (health[port].load || 0) + 1;
  }
  // Re-stream the body we consumed for classification. Without this the upstream
  // request has no body (the stream was drained by req.on('data')), so llama-server
  // hangs / the socket closes and http-proxy emits ECONNRESET → "Bad Gateway".
  if (req.bodyBuffer && req.bodyBuffer.length) {
    proxyReq.setHeader('Content-Length', Buffer.byteLength(req.bodyBuffer));
    proxyReq.write(req.bodyBuffer);
    proxyReq.end();
  }
});

proxy.on('proxyRes', (proxyRes, req, res) => {
  // Unmark request as in-flight
  const target = req.proxyTarget;
  if (target) {
    const port = target.port || 8093;
    if (health[port]) health[port].load = Math.max(0, (health[port].load || 1) - 1);
  }
});

proxy.on('error', (err, req, res) => {
  console.error(`[proxy] Error: ${err.message}`);
  res.writeHead(502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
});

// ── Main request handler ───────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // Health check endpoint
  if (req.url === '/health' && req.method === 'GET') {
    checkHealth(); // Async, don't await
    const allHealthy = TIERS.every((t) => health[t.port].healthy);
    res.writeHead(allHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: allHealthy ? 'healthy' : 'degraded',
        models: TIERS.map((t) => ({
          name: t.name,
          port: t.port,
          healthy: health[t.port].healthy,
          load: health[t.port].load || 0,
        })),
      }),
    );
    return;
  }

  // Status endpoint (no auth needed)
  if (req.url === '/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        proxy: 'multi-model-llm-proxy',
        models: TIERS.map((t) => ({
          name: t.name,
          port: t.port,
          size: t.size,
          healthy: health[t.port].healthy,
          load: health[t.port].load || 0,
        })),
      }),
    );
    return;
  }

  // Collect request body for classification
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    // Classify and route
    const requestTier = classifyRequest(body);
    const selectedTier = selectTier(Math.min(requestTier, TIERS.length - 1));

    if (!selectedTier) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No available models' }));
      return;
    }

    const target = `http://${selectedTier.host}:${selectedTier.port}`;
    req.proxyTarget = selectedTier; // For load tracking
    req.bodyBuffer = Buffer.from(body); // Re-streamed in proxyReq (body was drained above)

    // Log routing decision
    const model = TIERS.find((t) => t.port === selectedTier.port);
    console.log(
      `[proxy] ${req.method} ${req.url} → ${model.name} (tier ${TIERS.indexOf(selectedTier) + 1}) | load=${health[selectedTier.port].load}`,
    );

    proxy.web(req, res, { target });
  });
});

// ── Periodic health checks ─────────────────────────────────────────────────
setInterval(checkHealth, 10000);
checkHealth(); // Initial check

// ── Startup ────────────────────────────────────────────────────────────────
const PORT = process.env.LLM_PROXY_PORT || 8090;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[llm-proxy] Smart router listening on 0.0.0.0:${PORT}`);
  console.log(`[llm-proxy] Backends:`);
  TIERS.forEach((t, i) => {
    console.log(`  Tier ${i + 1}: ${t.name} (${t.size}) on :${t.port}`);
  });
  console.log(`[llm-proxy] Classification: simple → Phi-2 → Phi-3 → Qwen → Gemma`);
  console.log(`[llm-proxy] Health checks every 10s, load balancing with cascade fallback`);
});

process.on('SIGTERM', () => {
  console.log('[llm-proxy] SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('[llm-proxy] Server closed');
    process.exit(0);
  });
});
