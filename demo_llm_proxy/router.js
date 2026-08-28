#!/usr/bin/env node

// Touched 2026-08-28 to exercise the CI build-and-push path end to end: a
// change inside demo_llm_proxy/ must select exactly one service (llm) and push
// ghcr.io/<owner>/ai-demo-llm-proxy:sha-<commit> without moving :latest.

const http = require('http');
const httpProxy = require('http-proxy');
const crypto = require('crypto');
const {
  captureGeneration,
  modelFromRequest,
} = require('./posthogAi');

// ── Config ──────────────────────────────────────────────────────────────────
// host.docker.internal lets the container reach llama-server processes running
// on the host; override with LLAMA_HOST for non-Docker runs.
const HOST = process.env.LLAMA_HOST || 'host.docker.internal';

// Per-IP rate limit for inference routes (not /health, /refresh, /status).
// Window and max are tunable via env; defaults are generous for demo use.
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.LLM_PROXY_RATE_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX       = parseInt(process.env.LLM_PROXY_RATE_MAX       || '60',    10);
const rateLimitDisabled    = ['1', 'true', 'yes'].includes(
  String(process.env.LLM_PROXY_DISABLE_RATE_LIMIT || '').toLowerCase(),
);

// Sliding-window per-IP counters. Each entry: { count, windowStart }.
const _rateLimitMap = new Map();

function checkRateLimit(ip) {
  if (rateLimitDisabled) return true;
  const now = Date.now();
  let entry = _rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    entry = { count: 1, windowStart: now };
    _rateLimitMap.set(ip, entry);
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

// Periodically evict expired entries so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _rateLimitMap) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) _rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();
const HEALTH_TTL_MS = 30000;           // don't re-probe a backend more often than this
const HEALTH_INTERVAL_MS = HEALTH_TTL_MS; // sweep cadence — matches the TTL so no wasted passes

// Per-tier host override for in-cluster K8 (llama-tier1 / llama-tier5 Services).
// Falls back to LLAMA_HOST (host.docker.internal in Docker) when unset.
const tierHost = (envKey) => process.env[envKey] || HOST;

// Swap mode: only ONE tier is loaded at a time ("smallest that does the job").
// The tier-manager daemon on the HOST performs the actual llama-server
// start/stop (this container cannot manage host processes).
const TIER_MANAGER = process.env.TIER_MANAGER_URL || `http://${HOST}:8097`;
const SWAP_TIMEOUT_MS = 180000;        // cold load of the 11GB gpt-oss can be slow
const SWAP_POLL_MS = 1500;             // health-poll cadence while a swap is loading
const DRAIN_MAX_MS = 30000;            // wait for in-flight requests before unloading
// Idle decay: after IDLE_DECAY_MS with no traffic, drop back to the smallest
// tier. Default 0 = keep-warm (demo latency). Opt back into classic 5-min decay
// with LLM_PROXY_IDLE_DECAY_MS=300000. Any <= 0 also disables.
const IDLE_DECAY_MS = parseInt(
  process.env.LLM_PROXY_IDLE_DECAY_MS !== undefined && process.env.LLM_PROXY_IDLE_DECAY_MS !== ''
    ? process.env.LLM_PROXY_IDLE_DECAY_MS
    : '0',
  10,
);
const IDLE_DECAY_DISABLED = !Number.isFinite(IDLE_DECAY_MS) || IDLE_DECAY_MS <= 0;
const PIN_TIER_PORT = parseInt(process.env.LLM_PROXY_PIN_TIER || '', 10);

// Resident set: tier ports kept loaded at all times (comma-separated). Swap mode
// keeps ONE tier loaded, so the BFF (pins phi-4-mini) and the agent (pins
// gpt-oss-20b) evict each other — whichever is used second pays a full model
// swap, and when that swap outruns the caller the BFF falls back to the
// heuristic catalog. Listing both ports here loads both at boot, so the router
// always finds a loaded tier covering the class and never swaps.
// Unset ⇒ classic swap mode, unchanged.
const RESIDENT_PORTS = new Set(
  (process.env.LLM_PROXY_RESIDENT_TIERS || '')
    .split(',')
    .map((p) => parseInt(p.trim(), 10))
    .filter((p) => Number.isFinite(p) && p > 0),
);

// Three tiers (US-origin): small (Phi-4-mini, :8091), big (gpt-oss-20b, :8096),
// and an experimental mid-size tool-calling tier (Llama-3-Groq-8B-Tool-Use,
// :8093) appended LAST (class 2) so it never changes the existing class-0/
// class-1 routing for phi-4-mini/gpt-oss — it is reached only via an explicit
// LLM_PROXY_PIN_TIER=8093 for evaluation, not by keyword classification.
// Names/sizes MUST match the processes start-local-models.sh launches on each
// port. health/load/lastCheck live on the tier object itself.
const TIERS = [
  { name: 'phi-4-mini-instruct', port: 8091, size: '3.8B', host: tierHost('LLAMA_TIER1_HOST') },
  // gpt-oss-20b: complex technical/reasoning prompts and any agent that pins
  // model=gpt-oss-20b. MoE (~3.6B active params), so fast despite the size.
  // On :8096 because mcp-code-search publishes :8095.
  { name: 'gpt-oss-20b',         port: 8096, size: '20B',  host: tierHost('LLAMA_TIER5_HOST') },
  // Experimental — evaluating as a faster tool-calling alternative to gpt-oss-20b
  // on CPU-only nodes. Groq itself deprecated this model's hosted-API preview in
  // favor of larger models, so treat tool-call reliability as unproven here too.
  // `pinOnly` encodes the invariant in the comment above as data: this tier is
  // reachable ONLY when a route explicitly targets it (LLM_PROXY_PIN_TIER=8093,
  // or a model= pin resolving to class 2 in MODEL_CLASS). It must never be a
  // health-based substitution target for a lower class — smallestLoadedCovering
  // skips it unless the requested class equals its index. keyword classification
  // (classifyText) only ever emits class 0 or 1, so it can never reach it.
  { name: 'llama-3-groq-8b-tool-use', port: 8093, size: '8B', host: tierHost('LLAMA_TIER3_HOST'), pinOnly: true },
].map((t) => ({ ...t, healthy: false, load: 0, lastCheck: 0 }));

const PIN_TIER_INDEX = Number.isFinite(PIN_TIER_PORT) && PIN_TIER_PORT > 0
  ? TIERS.findIndex((t) => t.port === PIN_TIER_PORT)
  : -1;
if (PIN_TIER_INDEX < 0 && Number.isFinite(PIN_TIER_PORT) && PIN_TIER_PORT > 0) {
  console.warn(`[llm-proxy] LLM_PROXY_PIN_TIER=${PIN_TIER_PORT} does not match a known tier — pin ignored`);
}

/** Cap routing class when LLM_PROXY_PIN_TIER locks swap mode to one backend. */
function effectiveClass(cls) {
  if (PIN_TIER_INDEX < 0) return Math.min(cls, TIERS.length - 1);
  return PIN_TIER_INDEX;
}

// ── Per-agent routing: honor the request's `model` field ───────────────────
// Each agent pins its class via LLAMACPP_MODEL (BFF → phi-4-mini-instruct,
// agent-service → gpt-oss-20b). The value is a MINIMUM capability class: a
// bigger loaded tier serves it without a swap. Unknown/absent model falls back
// to keyword classification.
const MODEL_CLASS = [
  [/phi-4-mini|gemma-3-4b/, 0], // legacy gemma-3-4b pin still routes to small
  [/gpt-oss/, 1],
  [/llama-3-groq|groq-tool-use/, 2], // experimental — see TIERS comment above
];

function classFromModel(model) {
  if (typeof model !== 'string' || !model) return null;
  const m = model.toLowerCase();
  for (const [re, idx] of MODEL_CLASS) if (re.test(m)) return idx;
  return null;
}

// ── Request classifier: determine minimum tier needed ──────────────────────
// Split once at load time: plain substrings use a cheap includes() scan; only
// the genuine `.*` patterns pay for a precompiled RegExp.
const partition = (kws) => {
  const substrings = kws.filter((k) => !/[.*+?^${}()|[\]\\]/.test(k));
  const patterns = kws
    .filter((k) => /[.*+?^${}()|[\]\\]/.test(k))
    .map((k) => new RegExp(k));
  return { substrings, patterns };
};

// Two tiers: small (Phi-4-mini) and big (gpt-oss-20b). Complex/reasoning and
// code prompts route to the big tier; everything else stays on small.
const COMPLEX = partition([
  'demonstrate', 'show.*flow', 'show.*diagram', 'token exchange', 'rfc 8693',
  'act and may_act', 'delegation', 'pkce', 'confused deputy', 'introspection',
  'authorization code flow', 'client credentials',
]);
const CODE = partition([
  'write.*code', 'code.*example', 'implement', 'function', 'script', 'snippet',
  'regex', 'sql', 'json.*schema', 'refactor', 'debug',
]);
// MODERATE no longer needs a separate tier — anything that would have been
// "moderate" (how does / what is / token) is handled fine by the small tier.

const matchesAny = (text, { substrings, patterns }) =>
  substrings.some((s) => text.includes(s)) || patterns.some((re) => re.test(text));

function classifyText(text) {
  const t = (typeof text === 'string' ? text : '').toLowerCase();
  if (matchesAny(t, CODE)) return 1;     // gpt-oss-20b: code generation / debugging
  if (matchesAny(t, COMPLEX)) return 1;  // gpt-oss-20b: complex technical / token flows / reasoning
  return 0;                              // default: small tier (Phi-4-mini)
}

// Pull only the USER-VISIBLE text out of an OpenAI-style body. Classifying the
// raw JSON was a bug: the literal `"max_tokens"` field matched the keyword
// `token`, so almost every API request classified as MODERATE or above.
function extractPromptText(parsed) {
  if (Array.isArray(parsed.messages)) {
    return parsed.messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
      .join('\n');
  }
  if (typeof parsed.prompt === 'string') return parsed.prompt;
  return '';
}

// Decide the minimum capability class for a request: explicit model pin first
// (per-agent routing), keyword classification of the prompt text second.
function requiredClass(bodyBuffer) {
  let parsed = null;
  try { parsed = JSON.parse(bodyBuffer.toString('utf8')); } catch { /* non-JSON body */ }
  if (parsed) {
    const pinned = classFromModel(parsed.model);
    if (pinned !== null) return { cls: pinned, via: `model=${parsed.model}` };
    return { cls: classifyText(extractPromptText(parsed)), via: 'classified' };
  }
  return { cls: classifyText(bodyBuffer.toString('utf8')), via: 'classified-raw' };
}

// ── Health probes ───────────────────────────────────────────────────────────
function probeTier(tier) {
  return new Promise((resolve) => {
    const req = http.get(`http://${tier.host}:${tier.port}/health`, (res) =>
      resolve(res.statusCode === 200),
    );
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function checkHealth() {
  const now = Date.now();
  for (const tier of TIERS) {
    if (now - tier.lastCheck < HEALTH_TTL_MS) continue;
    tier.healthy = await probeTier(tier);
    tier.lastCheck = now;
  }
}

// ── Swap-mode tier selection ────────────────────────────────────────────────
// Serve with the smallest LOADED tier whose capability covers the request;
// swap up (unloading everything else) only when nothing loaded covers it.
let lastRequestAt = Date.now();
// `swapInFlight` coalesces concurrent asks for the SAME class (single-flight).
// `swapChain` is a GLOBAL lock: every swap runs behind the previous one, so a
// cross-class swap waits for the in-flight one instead of starting a second
// tier-manager ensure concurrently — which would unload the tier the first swap
// just loaded (ECONNRESET/502, or a full poll to a now-dead tier).
let swapInFlight = null; // { cls, promise }
let swapChain = Promise.resolve();

function smallestLoadedCovering(cls) {
  for (let i = cls; i < TIERS.length; i++) {
    if (!TIERS[i].healthy) continue;
    // Never let health-based substitution (i > cls) fall onto a pin-only tier
    // (e.g. the unproven :8093). It may be served only when the route targets
    // its class exactly (i === cls) — i.e. an explicit LLM_PROXY_PIN_TIER or a
    // model= pin, never a substitute-up for a lower class.
    if (TIERS[i].pinOnly && i !== cls) continue;
    return TIERS[i];
  }
  return null;
}

function callTierManager(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${TIER_MANAGER}/ensure?port=${port}`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () =>
        res.statusCode === 200
          ? resolve()
          : reject(new Error(`tier-manager ${res.statusCode}: ${data.slice(0, 200)}`)),
      );
    });
    req.on('error', (e) => reject(new Error(`tier-manager unreachable: ${e.message}`)));
    req.setTimeout(SWAP_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('tier-manager timeout'));
    });
  });
}

async function drainInFlight() {
  const deadline = Date.now() + DRAIN_MAX_MS;
  while (TIERS.some((t) => t.load > 0) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Swap so that TIERS[cls] is the loaded tier. Single-flight: a swap already
// heading to the same class is awaited, not duplicated. Cross-class swaps are
// serialized behind `swapChain` — one tier-manager ensure runs at a time, so a
// second swap can never unload the tier a first swap just loaded. The per-swap
// SWAP_TIMEOUT_MS deadline is measured from when this swap actually starts
// (after any queued swap ahead of it completes).
function swapTo(cls) {
  if (swapInFlight && swapInFlight.cls === cls) return swapInFlight.promise;
  const target = TIERS[cls];
  const promise = swapChain.then(async () => {
    console.log(`[proxy] swap → ${target.name} (:${target.port}) — draining in-flight requests`);
    await drainInFlight();
    await callTierManager(target.port);
    const deadline = Date.now() + SWAP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await probeTier(target)) {
        // The others were just unloaded — refresh the whole health map now
        // instead of serving stale "healthy" flags for stopped tiers. Resident
        // tiers are NOT unloaded by a swap (the tier-manager keeps them), so
        // marking them dead here would force a pointless swap back.
        for (const t of TIERS) {
          if (t !== target && RESIDENT_PORTS.has(t.port)) continue;
          t.healthy = t === target;
          t.lastCheck = Date.now();
        }
        console.log(`[proxy] swap complete — ${target.name} is the loaded tier`);
        return;
      }
      await new Promise((r) => setTimeout(r, SWAP_POLL_MS));
    }
    throw new Error(`${target.name} did not become healthy within ${SWAP_TIMEOUT_MS / 1000}s`);
  });
  const entry = { cls, promise };
  swapInFlight = entry;
  // Advance the global lock even if this swap rejects, so one failure cannot
  // wedge the queue. Clear the single-flight slot when this swap settles, unless
  // a newer swap has already taken the slot.
  swapChain = promise.catch(() => {});
  promise.finally(() => { if (swapInFlight === entry) swapInFlight = null; });
  return promise;
}

async function selectTier(cls) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const loaded = smallestLoadedCovering(cls);
    if (loaded) return loaded;
    await swapTo(cls); // throws on failure
  }
  const loaded = smallestLoadedCovering(cls);
  if (loaded) return loaded;
  throw new Error('no tier available after swap');
}

// Idle decay: after IDLE_DECAY_MS with no traffic, drop back to the smallest
// tier so the big model's memory is freed. Disabled when IDLE_DECAY_MS <= 0
// (demo keep-warm) or when a pin is set — decaying after a pin forced the next
// request to sit through a multi-minute reload (or 503 with the downgrade guard).
// Guarded by require.main so `require('./router.js')` (unit tests) does not start
// a non-unref'd timer that pins live tier state and keeps the process alive.
if (require.main === module) {
  setInterval(() => {
    if (IDLE_DECAY_DISABLED || PIN_TIER_INDEX >= 0) return;
    // A resident tier is meant to stay warm; decaying it away would re-introduce
    // the swap on the next request — the exact stall residency exists to remove.
    if (TIERS.slice(1).some((t) => RESIDENT_PORTS.has(t.port))) return;
    if (Date.now() - lastRequestAt < IDLE_DECAY_MS) return;
    if (swapInFlight) return;
    const biggerLoaded = TIERS.slice(1).some((t) => t.healthy);
    if (!biggerLoaded) return;
    console.log(`[proxy] idle ${Math.round(IDLE_DECAY_MS / 1000)}s — decaying to ${TIERS[0].name}`);
    swapTo(0).catch((err) => console.error(`[proxy] idle decay failed: ${err.message}`));
  }, 60000);
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
// completed (proxyRes) or failed (error). Without this, `load` drifts upward
// and the drain-before-swap wait never completes.
function releaseTier(req) {
  if (req.proxyTarget && !req._released) {
    req._released = true;
    req.proxyTarget.load = Math.max(0, req.proxyTarget.load - 1);
  }
}

proxy.on('proxyRes', (proxyRes, req) => {
  releaseTier(req);

  // Tee response bytes for PostHog LLM Analytics ($ai_generation) without
  // altering the client stream. Metadata only — no prompt/completion text.
  if (!req._aiStartedAt) return;
  const chunks = [];
  let firstByteAt = null;
  const onData = (chunk) => {
    if (firstByteAt == null) firstByteAt = Date.now();
    // Cap buffer so a runaway stream cannot OOM the proxy.
    if (chunks.length < 512) chunks.push(chunk);
  };
  const onEnd = () => {
    proxyRes.off('data', onData);
    const latencySec = (Date.now() - req._aiStartedAt) / 1000;
    const ttft = firstByteAt != null ? (firstByteAt - req._aiStartedAt) / 1000 : null;
    captureGeneration({
      distinctId: req.headers['x-posthog-distinct-id'] || 'llm-proxy',
      traceId: req._aiTraceId,
      requestModel: req._aiRequestModel,
      responseBody: Buffer.concat(chunks),
      latencySec,
      timeToFirstTokenSec: ttft,
      httpStatus: proxyRes.statusCode,
      tierName: req.proxyTarget?.name || null,
      streamHint: /text\/event-stream/i.test(String(proxyRes.headers['content-type'] || '')),
    });
  };
  proxyRes.on('data', onData);
  proxyRes.once('end', onEnd);
  proxyRes.once('error', () => {
    proxyRes.off('data', onData);
  });
});

proxy.on('error', (err, req, res) => {
  console.error(`[proxy] Error: ${err.message}`);
  // The target is likely gone (e.g. swapped out behind our back by a UI
  // pre-warm) — mark it unhealthy NOW so the next request re-selects instead
  // of riding the stale health cache for up to HEALTH_TTL_MS.
  if (req.proxyTarget) {
    req.proxyTarget.healthy = false;
    req.proxyTarget.lastCheck = 0;
  }
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

/** Active LLM_PROXY_PIN_TIER summary for BFF/UI — null when unset. */
function pinSummary() {
  if (PIN_TIER_INDEX < 0) return null;
  const t = TIERS[PIN_TIER_INDEX];
  return { name: t.name, port: t.port };
}

// ── Main request handler ───────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // GET /livez — LIVENESS only: "is this process still serving HTTP", never
  // "is a backend ready". Deliberately unconditional 200.
  //
  // /health answers the readiness question and returns 503 while no tier is
  // loaded, which is correct for readiness and wrong for liveness. Pointing a
  // liveness probe at it means a cold start gets SIGTERM'd on a timer: the 20B
  // tier takes ~11 minutes to pull and load, while liveness gives up after
  // ~100s (10s initial + 3 x 30s), so Kubernetes killed llm-proxy roughly every
  // 100 seconds while it waited — six restarts on 2026-08-27. Restarting cannot
  // make a model load faster; it only resets the wait.
  if (req.url === '/livez' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'alive' }));
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    checkHealth(); // fire-and-forget refresh
    // Swap mode: exactly one tier loaded is the NORMAL state — healthy means
    // at least one backend can serve.
    const anyHealthy = TIERS.some((t) => t.healthy);
    res.writeHead(anyHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: anyHealthy ? 'healthy' : 'degraded',
      mode: 'swap',
      pin: pinSummary(),
      models: TIERS.map(modelSummary),
    }));
    return;
  }

  // POST /refresh — force an immediate re-probe of every tier, bypassing the
  // health-cache TTL. Called by the BFF right after a UI-triggered pre-warm
  // (the tier-manager swapped models behind our back, so the cache is stale).
  if (req.url === '/refresh' && req.method === 'POST') {
    for (const t of TIERS) t.lastCheck = 0;
    checkHealth().then(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pin: pinSummary(), models: TIERS.map(modelSummary) }));
    });
    return;
  }

  if (req.url === '/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      proxy: 'multi-model-llm-proxy',
      mode: 'swap',
      pin: pinSummary(),
      swapping: swapInFlight ? TIERS[swapInFlight.cls].name : null,
      models: TIERS.map(modelSummary),
    }));
    return;
  }

  // Per-IP rate limit — applied to inference routes only (not /health etc.).
  const clientIp = req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    console.warn(`[proxy] rate-limited ${clientIp} (>${RATE_LIMIT_MAX} req/${RATE_LIMIT_WINDOW_MS}ms)`);
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) });
    res.end(JSON.stringify({ error: 'rate_limit_exceeded', message: 'Too many requests. Please wait before retrying.' }));
    return;
  }

  // Buffer the body once (for classification), then re-stream it in proxyReq.
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    const bodyBuffer = Buffer.concat(chunks);
    lastRequestAt = Date.now();
    const { cls, via } = requiredClass(bodyBuffer);
    const routedCls = effectiveClass(cls);

    // A pin (or missing tier) may only substitute UP. Serving a class-N request
    // with a weaker tier silently degrades quality — on K8s this answered
    // gpt-oss-20b tool loops with phi-4-mini, which cannot drive tool calls,
    // and the failure surfaced as "agent shows no result" with nothing in the
    // logs. Refuse loudly instead (LLM_PROXY_ALLOW_DOWNGRADE=true opts back in).
    if (routedCls < cls && process.env.LLM_PROXY_ALLOW_DOWNGRADE !== 'true') {
      console.error(
        `[proxy] REFUSED downgrade: request needs ${TIERS[cls].name} (class ${cls}) but routing is capped to ${TIERS[routedCls].name} (class ${routedCls})`,
      );
      if (!res.headersSent) {
        res.writeHead(503, {
          'Content-Type': 'application/json',
          'X-LLM-Proxy-Downgrade-Refused': `${TIERS[cls].name}->${TIERS[routedCls].name}`,
        });
        res.end(JSON.stringify({
          error: 'model_downgrade_refused',
          message: `Requested ${TIERS[cls].name} but routing is capped to ${TIERS[routedCls].name} (LLM_PROXY_PIN_TIER). Set LLM_PROXY_ALLOW_DOWNGRADE=true to serve the weaker model anyway.`,
          requested: TIERS[cls].name,
          available: TIERS[routedCls].name,
        }));
      }
      return;
    }

    let selectedTier;
    try {
      selectedTier = await selectTier(routedCls);
    } catch (err) {
      console.error(`[proxy] tier selection failed: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No model available', message: err.message }));
      }
      return;
    }

    req.proxyTarget = selectedTier; // for load tracking
    req.bodyBuffer = bodyBuffer;    // re-streamed in proxyReq (body was drained above)
    req._aiStartedAt = Date.now();
    req._aiTraceId = crypto.randomUUID();
    req._aiRequestModel = modelFromRequest(bodyBuffer);

    console.log(
      `[proxy] ${req.method} ${req.url} → ${selectedTier.name} (class ${routedCls}${routedCls !== cls ? ` capped from ${cls}` : ''} via ${via}) | load=${selectedTier.load}`,
    );
    proxy.web(req, res, { target: `http://${selectedTier.host}:${selectedTier.port}` });
  });
});

// ── Runtime side effects ────────────────────────────────────────────────────
// Only when launched directly (`node router.js`). Guarding lets tests
// `require('./router.js')` for its pure functions without binding :8090 or
// starting non-unref'd health/startup timers that would keep the process alive.
if (require.main === module) {
// ── Periodic health checks ─────────────────────────────────────────────────
setInterval(checkHealth, HEALTH_INTERVAL_MS);
checkHealth(); // initial probe

// ── Startup ────────────────────────────────────────────────────────────────
const PORT = process.env.LLM_PROXY_PORT || 8090;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[llm-proxy] Smart router listening on 0.0.0.0:${PORT} (swap mode — one tier loaded at a time)`);
  console.log('[llm-proxy] Tiers:');
  TIERS.forEach((t, i) => {
    console.log(`  Tier ${i + 1}: ${t.name} (${t.size}) on :${t.port}`);
  });
  const pinNote = PIN_TIER_INDEX >= 0
    ? `, pinned to ${TIERS[PIN_TIER_INDEX].name} (:${TIERS[PIN_TIER_INDEX].port})`
    : '';
  const decayNote = IDLE_DECAY_DISABLED
    ? ', idle decay disabled (keep-warm)'
    : `, decay to ${TIERS[0].name} after ${IDLE_DECAY_MS / 1000}s idle`;
  console.log(`[llm-proxy] Routing: request model pin (per agent) → keyword class; serve with smallest loaded tier that covers, swap up via ${TIER_MANAGER}${decayNote}${pinNote}`);
  if (PIN_TIER_INDEX >= 0) {
    swapTo(PIN_TIER_INDEX).catch((err) =>
      console.error(`[llm-proxy] pin warm-up failed: ${err.message}`),
    );
  }
});

process.on('SIGTERM', () => {
  console.log('[llm-proxy] SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('[llm-proxy] Server closed');
    process.exit(0);
  });
});
} // end require.main === module

// Exported for unit tests only (no effect on `node router.js`).
module.exports = { TIERS, swapTo, smallestLoadedCovering };
