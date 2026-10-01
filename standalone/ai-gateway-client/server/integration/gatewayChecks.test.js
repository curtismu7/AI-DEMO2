'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runGatewayChecks } = require('./gatewayChecks');
const { formatInteractiveFailure } = require('./interactive');

test('uses the allowed audience for cross-door probing, then a door-scoped token for policy denial', async () => {
  const token = 'dummy-allowed-private-test-token';
  const deniedToken = 'dummy-denied-private-test-token';
  const deniedUrl = 'https://gateway.example.test/denied/mcp';
  const allowedUrl = 'https://gateway.example.test/allowed/mcp';
  const received = [];
  let probeStatus = 401;
  const fixture = {
    allowed: {
      url: allowedUrl,
      tool: { name: 'ClusterHealthTool', arguments: {} },
    },
    deniedDoor: { url: deniedUrl },
  };
  const server = http.createServer(async (req, res) => {
    const authorization = req.headers.authorization;
    for await (const _chunk of req) { /* consume the request body */ }
    received.push({ url: req.url, authorization });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/gateway/config') {
      return res.end('{"ok":true}');
    }
    if (req.url === '/api/gateway/tools/list') {
      if (authorization === `Bearer ${deniedToken}`) {
        res.statusCode = 403;
        return res.end('{"error":"policy denied"}');
      }
      return res.end('{"tools":[{"name":"ClusterHealthTool"}]}');
    }
    if (req.url === '/api/gateway/tools/call') {
      return res.end('{"result":{"content":[{"type":"text","text":"green"}]}}');
    }
    if (req.url === '/api/gateway/doors/probe') {
      return res.end(JSON.stringify({
        results: [{ url: deniedUrl, ok: false, status: probeStatus, error: `MCP request failed: ${probeStatus} upstream detail` }],
      }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await runGatewayChecks({ baseUrl, fixture, token, deniedToken });
    assert.deepEqual(received.map(({ url, authorization }) => ({ url, authorization })), [
      { url: '/api/gateway/config', authorization: `Bearer ${token}` },
      { url: '/api/gateway/tools/list', authorization: `Bearer ${token}` },
      { url: '/api/gateway/tools/call', authorization: `Bearer ${token}` },
      { url: '/api/gateway/doors/probe', authorization: `Bearer ${token}` },
      { url: '/api/gateway/config', authorization: `Bearer ${deniedToken}` },
      { url: '/api/gateway/tools/list', authorization: `Bearer ${deniedToken}` },
    ]);

    // A changed upstream failure remains safe and reports only its numeric status.
    probeStatus = 403;
    await assert.rejects(runGatewayChecks({ baseUrl, fixture, token, deniedToken }), (err) => {
      const message = formatInteractiveFailure(err);
      assert.equal(message,
        'Interactive live Gateway check failed: allowed-door audience must be rejected by the other app (upstream HTTP 403)\n');
      assert.ok(!message.includes('upstream detail'));
      assert.ok(!message.includes(token));
      assert.ok(!message.includes(deniedToken));
      return true;
    });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
