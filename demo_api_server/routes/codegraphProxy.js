/**
 * BFF proxy for the CodeGraph Explorer endpoints.
 * Forwards POST /api/codegraph/query   → langchain_agent /codegraph/query (SSE).
 * Forwards POST /api/codegraph/reindex → langchain_agent /codegraph/reindex (JSON).
 */
const http = require('http');

const LANGCHAIN_AGENT_URL = process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://127.0.0.1:8888';

// The agent's FastAPI app (port 8888) gates every route on this shared secret,
// so the BFF must present it — the same value agentRun.js sends on /run.
function internalSecret() {
  return process.env.BFF_INTERNAL_SECRET || 'dev-shared-secret-change-me';
}

/**
 * Forward a POST to the langchain_agent and stream its response back.
 * @param {string} path                 upstream path (e.g. '/codegraph/query')
 * @param {string} defaultContentType   used when upstream omits Content-Type
 * @param {object} [extraHeaders]        extra response headers (e.g. SSE no-cache)
 * @param {number} [timeout]            socket timeout in ms (omit for none)
 */
function proxyToAgent(req, res, opts) {
  const { path, defaultContentType, timeout } = opts;
  const extraHeaders = opts.extraHeaders || {};
  const parsedUrl = new URL(LANGCHAIN_AGENT_URL);
  // express.json() upstream has already consumed the request stream, so piping
  // req forwards an empty body and the upstream 500s on JSON parse. Re-serialize
  // the parsed body and send it with an explicit Content-Length.
  const payload = Buffer.from(JSON.stringify(req.body || {}));
  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 8888,
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
      'x-internal-gateway-secret': internalSecret(),
    },
  };
  if (timeout) options.timeout = timeout;

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || defaultContentType,
      ...extraHeaders,
    });
    // Flush immediately so nginx/ALB see the SSE response headers (and early
    // status frames) before the LLM starts producing tokens.
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    proxyRes.pipe(res);
  });

  // SSE answers can take minutes; a default socket timeout mid-stream shows up
  // in the browser as a generic network error.
  proxyReq.setTimeout(timeout || 0);
  if (timeout) {
    proxyReq.on('timeout', () => proxyReq.destroy(new Error('upstream timed out')));
  }

  proxyReq.on('error', (err) => {
    console.error('[codegraphProxy] upstream error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'CodeGraph service unavailable' });
    }
  });

  proxyReq.end(payload);
}

function codegraphProxy(req, res) {
  proxyToAgent(req, res, {
    path: '/codegraph/query',
    defaultContentType: 'text/event-stream',
    extraHeaders: { 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

// Returns JSON (not SSE); a full re-index can take many seconds, so allow a
// generous socket timeout before giving up.
function codegraphReindexProxy(req, res) {
  proxyToAgent(req, res, {
    path: '/codegraph/reindex',
    defaultContentType: 'application/json',
    timeout: 180000,
  });
}

module.exports = { codegraphProxy, codegraphReindexProxy };
