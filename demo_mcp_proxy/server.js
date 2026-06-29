/**
 * demo_mcp_proxy — HTTP-to-MCP sidecar proxy.
 */
'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { URL } = require('node:url');

const MCP_BASE = (process.env.MCP_GATEWAY_HTTP_URL || 'http://127.0.0.1:3005').replace(/\/$/, '');
const PORT = parseInt(process.env.PORT || '8895', 10);

// Tool list cache — cleared on any MCP error so it refresfishes on next request.
let _toolCache = null;

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
        'MCP-Protocol-Version': '2025-03-26',
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
    try {
      if (!_toolCache) {
        const result = await mcpRpc('tools/list', {}, bearerFrom(req));
        _toolCache = result.tools || [];
      }
      return send(res, 200, { tools: _toolCache });
    } catch (err) {
      _toolCache = null;
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

server.listen(PORT, () => {
  console.log(`[mcp-proxy] Listening on :${PORT}  →  ${MCP_BASE}/mcp`);
});
