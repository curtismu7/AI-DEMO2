/**
 * demo_mcp_brave — hand-written MCP-over-HTTP server fronting Brave's real
 * News Search API. No child-process bridge (unlike demo_mcp_weather, which
 * wraps a stdio-only third-party npm package) — this server calls Brave's
 * HTTPS API directly inside its own tools/call handler.
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');

const PORT = parseInt(process.env.PORT || '8897', 10);
const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY || '';

const TOOLS = [
  {
    name: 'brave_news_search',
    description: 'Search recent news via the Brave Search API.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (default 10, max 50)' },
      },
      required: ['query'],
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

/** Real outbound call to Brave's News Search API. Returns the parsed JSON body. */
function braveNewsSearch(query, count) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ q: query });
    if (count) params.set('count', String(count));
    const options = {
      hostname: 'api.search.brave.com',
      path: `/res/v1/news/search?${params.toString()}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          reject(new Error(`Brave API responded ${res.statusCode}: ${data.slice(0, 300)}`));
        });
        return;
      }
      let stream = res;
      if (res.headers['content-encoding'] === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      }
      let data = '';
      stream.on('data', (c) => { data += c; });
      stream.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Brave API returned invalid JSON: ${e.message}`)); }
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Brave API request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function handleToolsCall(rpc) {
  const { name, arguments: args } = rpc.params || {};
  if (name !== 'brave_news_search') {
    return { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Unknown tool: ${name}` } };
  }
  const query = args && args.query;
  if (!query || typeof query !== 'string') {
    return { jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'query (string) is required' } };
  }
  try {
    const result = await braveNewsSearch(query, args.count);
    return {
      jsonrpc: '2.0',
      id: rpc.id,
      result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    };
  } catch (e) {
    return { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: e.message } };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, hasApiKey: !!BRAVE_API_KEY });
  }

  if (req.method === 'POST' && req.url === '/mcp') {
    let rpc;
    try {
      rpc = await readBody(req);
    } catch (e) {
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    if (rpc.method === 'initialize') {
      return send(res, 200, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          protocolVersion: (rpc.params && rpc.params.protocolVersion) || '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'demo-mcp-brave', version: '1.0.0' },
        },
      });
    }
    if (rpc.method === 'notifications/initialized') {
      res.writeHead(202);
      return res.end();
    }
    if (rpc.method === 'tools/list') {
      return send(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { tools: TOOLS } });
    }
    if (rpc.method === 'tools/call') {
      const result = await handleToolsCall(rpc);
      return send(res, 200, result);
    }

    return send(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Unknown method: ${rpc.method}` } });
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[mcp-brave] listening on :${PORT} (hasApiKey=${!!BRAVE_API_KEY})`);
});
