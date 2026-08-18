/**
 * demo_mcp_proxy — HTTP-to-MCP sidecar proxy.
 */
'use strict';

const http = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
const { URL } = require('node:url');

const MCP_BASE = (process.env.MCP_GATEWAY_HTTP_URL || 'http://127.0.0.1:3005').replace(/\/$/, '');
const PORT = parseInt(process.env.PORT || '8895', 10);

// Tool list cache — keyed per caller (tools/list is scope/vertical-dependent),
// cleared for that caller on any MCP error so it refreshes on next request.
// A successful entry was previously cached for the process lifetime, so (a)
// rotating tokens accumulated without bound and (b) scope/vertical changes that
// alter the gateway's filtered tools/list were never picked up. Entries now
// carry a TTL (re-fetched on expiry) and the map is size-bounded (LRU eviction).
const _toolCacheByCaller = new Map();
const _TOOL_CACHE_TTL_MS = parseInt(process.env.MCP_PROXY_TOOLS_TTL_MS || '30000', 10);
const _TOOL_CACHE_MAX = parseInt(process.env.MCP_PROXY_TOOLS_MAX || '500', 10);

function cacheKeyFor(bearerToken) {
  return bearerToken ? createHash('sha256').update(bearerToken).digest('hex') : '';
}

// Returns cached tools for the caller, or undefined if absent or expired.
function toolCacheGet(cacheKey) {
  const entry = _toolCacheByCaller.get(cacheKey);
  if (!entry) return undefined;
  if (Date.now() - entry.ts >= _TOOL_CACHE_TTL_MS) {
    _toolCacheByCaller.delete(cacheKey);
    return undefined;
  }
  // LRU touch: re-insert so the most-recently-used key sorts last for eviction.
  _toolCacheByCaller.delete(cacheKey);
  _toolCacheByCaller.set(cacheKey, entry);
  return entry.tools;
}

function toolCacheSet(cacheKey, tools) {
  _toolCacheByCaller.set(cacheKey, { tools, ts: Date.now() });
  // Evict oldest entries when over the size bound (Map preserves insertion order).
  while (_toolCacheByCaller.size > _TOOL_CACHE_MAX) {
    const oldest = _toolCacheByCaller.keys().next().value;
    _toolCacheByCaller.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP JSON-RPC over Streamable HTTP
// ---------------------------------------------------------------------------

function mcpRpc(method, params, bearerToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params });
    const parsed = new URL(`${MCP_BASE}/mcp`);

    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        // Both upstreams the proxy is wired to reject any other value on a
        // non-initialize request: the Node gateway 400s
        // `unsupported_protocol_version` unless this equals its
        // MCP_PROTOCOL_VERSION (2025-11-25), and PingGateway's MCP path is
        // built around 2025-11-25 too. The proxy is stateless (no initialize
        // handshake), so it must advertise the accepted version outright.
        'MCP-Protocol-Version': '2025-11-25',
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      },
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const err = Object.assign(new Error(`MCP gateway HTTP ${res.statusCode}`), {
            status: res.statusCode,
            body: data.slice(0, 500),
          });
          return reject(err);
        }
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(Object.assign(new Error(json.error.message || 'MCP error'), { mcpError: json.error }));
          resolve(json.result);
        } catch (e) {
          reject(new Error(`MCP response parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    const timeout = setTimeout(() => { req.destroy(new Error('MCP RPC timeout')); }, 30_000);
    req.on('close', () => clearTimeout(timeout));

    req.write(body);
    req.end();
  });
}

// --------------------------------ll---------------------------
// Request router
// ---------------------------------------------------------------------------

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function bearerFrom(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || undefined;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { 
        // Handle empty body string
        resolve(data ? JSON.parse(data) : {}); 
      } catch (e) { 
        reject(Object.assign(e, { status: 400 })); 
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // 1. GET /health
  if (method === 'GET' && url === '/health') {
    return send(res, 200, { ok: true, mcp: MCP_BASE });
  }

  // 2. GET /tools
  if (method === 'GET' && url === '/tools') {
    const bearer = bearerFrom(req);
    const cacheKey = cacheKeyFor(bearer);
    try {
      let tools = toolCacheGet(cacheKey);
      if (tools === undefined) {
        const result = await mcpRpc('tools/list', {}, bearer);
        tools = result.tools || [];
        toolCacheSet(cacheKey, tools);
      }
      return send(res, 200, { tools });
    } catch (err) {
      _toolCacheByCaller.delete(cacheKey);
      return send(res, err.status || 502, { error: err.message });
    }
  }

  // 3. POST /tools/:toolName
  const toolMatch = url && url.match(/^\/tools\/([^/?#]+)$/);
  if (method === 'POST' && toolMatch) {
    const toolName = decodeURIComponent(toolMatch[1]);
    try {
      // We await the body, then pass it as 'arguments' to MCP
      const args = await readBody(req);
      const result = await mcpRpc('tools/call', { name: toolName, arguments: args }, bearerFrom(req));
      return send(res, 200, result);
    } catch (err) {
      const status = [400, 401, 403].includes(err.status) ? err.status : 502;
      return send(res, status, { error: err.message, mcpError: err.mcpError || null });
    }
  }

  // 4. Default 404
  send(res, 404, { error: 'Not found' });
});

// Only bind the port when run directly (node server.js) — importing the module
// (e.g. from tests) must not start listening.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[mcp-proxy] Listening on :${PORT}  →  ${MCP_BASE}/mcp`);
  });
}

module.exports = { server, cacheKeyFor, toolCacheGet, toolCacheSet, _toolCacheByCaller };
