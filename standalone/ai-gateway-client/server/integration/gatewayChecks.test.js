'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runGatewayChecks } = require('./gatewayChecks');
const { formatInteractiveFailure } = require('./interactive');

test('reports the denied-door upstream status without response text or bearer', async () => {
  const token = 'dummy-private-test-token';
  const deniedUrl = 'https://gateway.example.test/denied/mcp';
  const fixture = {
    allowed: {
      url: 'https://gateway.example.test/allowed/mcp',
      tool: { name: 'ClusterHealthTool', arguments: {} },
    },
    deniedDoor: { url: deniedUrl },
  };
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume the request body */ }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/gateway/config') {
      return res.end('{"ok":true}');
    }
    if (req.url === '/api/gateway/tools/list') {
      return res.end('{"tools":[{"name":"ClusterHealthTool"}]}');
    }
    if (req.url === '/api/gateway/tools/call') {
      return res.end('{"result":{"content":[{"type":"text","text":"green"}]}}');
    }
    if (req.url === '/api/gateway/doors/probe') {
      return res.end(JSON.stringify({
        results: [{ url: deniedUrl, ok: false, status: 401, error: 'MCP request failed: 401 Unauthorized' }],
      }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await assert.rejects(runGatewayChecks({ baseUrl, fixture, token }), (err) => {
      const message = formatInteractiveFailure(err);
      assert.equal(message,
        'Interactive live Gateway check failed: denied door must return policy denial, not 401 or 5xx (upstream HTTP 401)\n');
      assert.ok(!message.includes(token));
      assert.ok(!message.includes('Unauthorized'));
      return true;
    });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
