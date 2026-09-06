/**
 * demo_mcp_grafana — hand-written MCP-over-HTTP server fronting a Grafana
 * instance's read API, built to the same shape as demo_mcp_brave: zero
 * dependencies, both transports on /mcp, and no child-process bridge.
 *
 * Runs as an extraContainer inside the Privilege gateway pod, because apps
 * added from the Privilege MCP catalog pin their backend to
 * http://localhost:8080/mcp and that field is not editable.
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

const PORT = parseInt(process.env.PORT || '8080', 10);
const GRAFANA_URL = (process.env.GRAFANA_URL || '').replace(/\/+$/, '');
const GRAFANA_TOKEN = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN || '';

const TOOLS = [
  {
    name: 'grafana_search_dashboards',
    description: 'Search Grafana dashboards by title. Returns matching dashboards with their uid, title and folder.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Title text to match. Omit to list everything.' },
        limit: { type: 'number', description: 'Maximum results (default 20)' },
      },
    },
  },
  {
    name: 'grafana_list_datasources',
    description: 'List the datasources configured in Grafana (name, type, uid).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'grafana_get_dashboard',
    description: 'Fetch one dashboard definition by its uid, including its panels.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: 'Dashboard uid, as returned by grafana_search_dashboards' },
      },
      required: ['uid'],
    },
  },
];

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(Object.assign(e, { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/**
 * One GET against Grafana's HTTP API, authenticated with the service account
 * token. GRAFANA_URL is http:// in-cluster and https:// anywhere else, so the
 * transport is chosen from the URL rather than hardcoded.
 */
function grafanaGet(path) {
  return new Promise((resolve, reject) => {
    if (!GRAFANA_URL) return reject(new Error('GRAFANA_URL is not set'));
    let target;
    try { target = new URL(GRAFANA_URL + path); }
    catch (e) { return reject(new Error(`GRAFANA_URL is not a valid URL: ${e.message}`)); }
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${GRAFANA_TOKEN}` },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Grafana responded ${res.statusCode}: ${data.slice(0, 300)}`));
          }
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`Grafana returned invalid JSON: ${e.message}`)); }
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Grafana request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function pathForTool(name, args) {
  if (name === 'grafana_search_dashboards') {
    const params = new URLSearchParams({ type: 'dash-db' });
    if (args.query) params.set('query', String(args.query));
    params.set('limit', String(args.limit || 20));
    return `/api/search?${params.toString()}`;
  }
  if (name === 'grafana_list_datasources') return '/api/datasources';
  if (name === 'grafana_get_dashboard') {
    if (!args.uid || typeof args.uid !== 'string') {
      throw Object.assign(new Error('uid (string) is required'), { code: -32602 });
    }
    return `/api/dashboards/uid/${encodeURIComponent(args.uid)}`;
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
}

async function handleToolsCall(rpc) {
  const { name, arguments: args } = rpc.params || {};
  let path;
  try {
    path = pathForTool(name, args || {});
  } catch (e) {
    return { jsonrpc: '2.0', id: rpc.id, error: { code: e.code || -32600, message: e.message } };
  }
  try {
    const result = await grafanaGet(path);
    return {
      jsonrpc: '2.0',
      id: rpc.id,
      result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    };
  } catch (e) {
    return { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: e.message } };
  }
}

// One implementation of the protocol, two transports on top of it. Returns the
// JSON-RPC response, or null for a notification (which gets no response at all).
async function dispatch(rpc) {
  if (rpc.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: rpc.id,
      result: {
        protocolVersion: (rpc.params && rpc.params.protocolVersion) || '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'demo-mcp-grafana', version: '1.0.0' },
      },
    };
  }
  if (rpc.method === 'notifications/initialized') return null;
  if (rpc.method === 'tools/list') {
    return { jsonrpc: '2.0', id: rpc.id, result: { tools: TOOLS } };
  }
  if (rpc.method === 'tools/call') return handleToolsCall(rpc);
  return { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Unknown method: ${rpc.method}` } };
}

// SSE transport sessions: id -> the open response stream we write replies to.
const sseSessions = new Map();
const SSE_KEEPALIVE_MS = 25_000;

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, hasUrl: !!GRAFANA_URL, hasToken: !!GRAFANA_TOKEN });
  }

  // --- SSE transport -------------------------------------------------------
  // Privilege's AI Gateway discovers a backend by issuing a GET and waiting for
  // the SSE `endpoint` event; it never POSTs initialize. A server that answers
  // only POST /mcp registers but reports `calling "initialize": Unauthorized`
  // and keeps an empty tool list — see demo_mcp_brave, which hit exactly that.
  if (req.method === 'GET' && (req.url === '/sse' || req.url === '/mcp')) {
    const sessionId = crypto.randomUUID();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    sseSessions.set(sessionId, res);
    // The endpoint event is the handshake: it tells the client where to POST.
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, SSE_KEEPALIVE_MS);
    req.on('close', () => {
      clearInterval(keepAlive);
      sseSessions.delete(sessionId);
    });
    return undefined;
  }

  if (req.method === 'POST' && req.url.startsWith('/messages')) {
    const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId');
    const stream = sseSessions.get(sessionId);
    if (!stream) {
      return send(res, 404, { error: 'Unknown or closed SSE session', sessionId });
    }
    let rpc;
    try {
      rpc = await readBody(req);
    } catch (e) {
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const response = await dispatch(rpc);
    // In this transport the POST is only an ACK; the reply travels on the stream.
    res.writeHead(202);
    res.end();
    if (response) stream.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    return undefined;
  }

  // --- Streamable HTTP transport -------------------------------------------
  if (req.method === 'POST' && req.url === '/mcp') {
    let rpc;
    try {
      rpc = await readBody(req);
    } catch (e) {
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const response = await dispatch(rpc);
    if (!response) {
      res.writeHead(202);
      return res.end();
    }
    return send(res, 200, response);
  }

  return send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[mcp-grafana] listening on :${PORT} (hasUrl=${!!GRAFANA_URL} hasToken=${!!GRAFANA_TOKEN})`);
});
