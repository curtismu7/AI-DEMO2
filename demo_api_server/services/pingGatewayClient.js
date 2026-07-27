'use strict';
const http = require('http');
const https = require('https');
const { URL } = require('url');

function callPingGateway(method, path, body = null) {
  return new Promise((resolve, reject) => {
    // MCP_PINGGATEWAY_URL is the canonical name — it is what docker-compose
    // sets, what configStore maps to mcp_pinggateway_url, and what
    // mcpGatewayClient / agentMcpTokenService read. This file read the ORPHAN
    // name PINGGATEWAY_URL, which nothing writes, so it silently fell back to
    // https://localhost:3036 — inside the BFF container that is the BFF itself,
    // and 3036 is the HOST port anyway (PingGateway listens on 8080 in-network).
    // Result: gateway.real_path failed ECONNREFUSED on every run while
    // PingGateway was up and reachable at http://ping-gateway:8080.
    // Same class as the compose environment/env_file trap: reading a name
    // nothing writes.
    const gwUrl = process.env.PINGGATEWAY_URL
      || process.env.MCP_PINGGATEWAY_URL
      || (() => { try { return require('./configStore').getEffective('mcp_pinggateway_url'); } catch (_) { return null; } })()
      || 'https://localhost:3036';
    const url = new URL(path, gwUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const opts = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {}),
      },
      timeout: 10000,
      ...(isHttps && process.env.NODE_ENV !== 'production' ? { rejectUnauthorized: false } : {}),
    };

    const req = transport.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

module.exports = { callPingGateway };
