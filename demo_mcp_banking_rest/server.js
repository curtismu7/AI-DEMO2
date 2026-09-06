/**
 * demo_mcp_banking_rest — thin REST proxy fronting demo_mcp_resource_server's
 * GET /banking, /banking/:id and /openapi/banking-rest.json, built to the same
 * shape as demo_mcp_grafana/demo_mcp_brave: zero dependencies, one file.
 *
 * Runs as an extraContainer inside the Privilege gateway pod. Unlike the MCP
 * catalog apps (Grafana, Brave), this backs an "Add OpenAPI MCP" application,
 * which takes a REST API Endpoint + OpenAPI Spec URL directly — no MCP
 * JSON-RPC/SSE handshake needed, just the plain REST surface the spec
 * describes, reachable at the console's chosen localhost port.
 */
'use strict';

const http = require('node:http');

const PORT = parseInt(process.env.PORT || '8082', 10);
const UPSTREAM_URL = (process.env.BANKING_UPSTREAM_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.BANKING_API_KEY || '';

/**
 * One GET against the real mcp-resource-server, over in-cluster DNS.
 * withApiKey attaches X-API-Key — omitted for the unauthenticated OpenAPI doc.
 */
function upstreamGet(path, withApiKey) {
  return new Promise((resolve, reject) => {
    if (!UPSTREAM_URL) return reject(new Error('BANKING_UPSTREAM_URL is not set'));
    let target;
    try { target = new URL(UPSTREAM_URL + path); }
    catch (e) { return reject(new Error(`BANKING_UPSTREAM_URL is not a valid URL: ${e.message}`)); }
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname + target.search,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(withApiKey ? { 'X-API-Key': API_KEY } : {}),
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('upstream request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function send(res, status, contentType, body) {
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function proxy(res, path, withApiKey) {
  try {
    const { status, body } = await upstreamGet(path, withApiKey);
    send(res, status, 'application/json', body);
  } catch (e) {
    send(res, 502, 'application/json', JSON.stringify({ error: 'upstream_unreachable', message: e.message }));
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') return send(res, 404, 'application/json', JSON.stringify({ error: 'not_found' }));

  if (req.url === '/health') {
    return send(res, 200, 'application/json', JSON.stringify({ ok: true, hasUpstream: !!UPSTREAM_URL, hasKey: !!API_KEY }));
  }
  if (req.url === '/openapi/banking-rest.json') return proxy(res, '/openapi/banking-rest.json', false);
  if (req.url === '/banking') return proxy(res, '/banking', true);
  if (req.url.startsWith('/banking/')) return proxy(res, req.url, true);

  return send(res, 404, 'application/json', JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(`[mcp-banking-rest] listening on :${PORT} (hasUpstream=${!!UPSTREAM_URL} hasKey=${!!API_KEY})`);
});
