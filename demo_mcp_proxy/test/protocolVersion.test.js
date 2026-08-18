'use strict';

/**
 * Regression test for the advertised MCP-Protocol-Version.
 *
 * The proxy is stateless — it fires tools/list and tools/call directly, with no
 * initialize handshake to negotiate a version. Both upstreams it is wired to
 * enforce the version on every non-initialize request: the Node gateway
 * (demo_mcp_gateway) 400s `unsupported_protocol_version` unless the header
 * equals its MCP_PROTOCOL_VERSION (2025-11-25), and PingGateway's MCP path is
 * built around 2025-11-25 as well. The proxy previously pinned the stale
 * 2025-03-26, so a tools/list / tools/call through the Node gateway 400ed
 * before doing any work. This asserts the proxy now advertises the accepted
 * version so the upstream version check passes.
 *
 * Uses the built-in node:test runner — the proxy has no jest/dev deps. No
 * running gateway is needed: a stub upstream captures the header and mirrors
 * the gateway's contract (200 for the accepted version).
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// The gateway's legacy header check accepts exactly its MCP_PROTOCOL_VERSION on
// a non-initialize request (demo_mcp_gateway/src/proxy.ts:31,
// GatewayServer.ts:753-760).
const GATEWAY_ACCEPTED_VERSION = '2025-11-25';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('the proxy advertises the gateway-accepted MCP-Protocol-Version on upstream calls', async () => {
  // Stub upstream standing in for the gateway: record the version header the
  // proxy sends, and answer tools/list the way the gateway would on an accepted
  // version.
  let seenVersion;
  const gateway = http.createServer((req, res) => {
    seenVersion = req.headers['mcp-protocol-version'];
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const rpc = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [] } }));
    });
  });
  const gwPort = await listen(gateway);

  // MCP_BASE is read at import time — point the proxy at the stub first.
  process.env.MCP_GATEWAY_HTTP_URL = `http://127.0.0.1:${gwPort}`;
  const { server } = require('../server');
  const proxyPort = await listen(server);

  // Drive a real GET /tools through the proxy → it issues tools/list upstream.
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: proxyPort, path: '/tools' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });

  try {
    assert.strictEqual(
      seenVersion,
      GATEWAY_ACCEPTED_VERSION,
      `proxy must advertise ${GATEWAY_ACCEPTED_VERSION}; the gateway 400s any other value on tools/list`,
    );
    // Proxy surfaced the upstream 200 rather than mapping a 400 to a 502.
    assert.strictEqual(status, 200);
  } finally {
    await close(server);
    await close(gateway);
  }
});
