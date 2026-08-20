'use strict';

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://cmuir-agentless-mcpgw.ping-devops.com/opensearch-mcp-server/mcp';

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'streamable-http-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function response({ status = 200, body = '', headers = {} } = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => normalized[String(name).toLowerCase()] || null },
    text: async () => body,
  };
}

describe('Privilege MCP Streamable HTTP client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('performs initialize, initialized notification, and tools/list with negotiated session headers', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, options) => {
      const rpc = JSON.parse(options.body);
      calls.push({ url: String(url), options, rpc });
      if (rpc.method === 'initialize') {
        return response({
          body: `event: message\ndata: ${JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'opensearch-mcp-server', version: '1.28.1' },
            },
          })}\n\n`,
          headers: { 'MCP-Session-Id': 'session-123', 'Content-Type': 'text/event-stream' },
        });
      }
      if (rpc.method === 'notifications/initialized') return response({ status: 202 });
      return response({
        body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'GetShardsTool' }] } }),
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const app = buildApp();
    await request(app).post('/api/privilege-mcp/config').send({
      gatewayMode: 'agentless',
      mcpUrl: MCP_URL,
      clientId: 'client-id',
    }).expect(200);
    const result = await request(app)
      .post('/api/privilege-mcp/tools/list')
      .set('Authorization', 'Bearer test-token')
      .send({})
      .expect(200);

    expect(result.body.tools).toEqual([{ name: 'GetShardsTool' }]);
    expect(calls.map(({ rpc }) => rpc.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    expect(calls.map(({ rpc }) => rpc.id)).toEqual([1, undefined, 2]);

    const [initialize, initialized, toolsList] = calls;
    expect(initialize.rpc.params.protocolVersion).toBe('2024-11-05');
    expect(initialize.options.headers.Accept).toBe('application/json, text/event-stream');
    expect(initialize.options.headers.Origin).toBe('https://cmuir-agentless-mcpgw.ping-devops.com');
    expect(initialize.options.headers['MCP-Session-Id']).toBeUndefined();
    expect(initialize.options.headers['MCP-Protocol-Version']).toBeUndefined();

    for (const call of [initialized, toolsList]) {
      expect(call.options.headers['MCP-Session-Id']).toBe('session-123');
      expect(call.options.headers['MCP-Protocol-Version']).toBe('2024-11-05');
    }
  });

  test('rejects a JSON-RPC response whose id does not match the request', async () => {
    global.fetch = jest.fn(async (_url, options) => {
      const rpc = JSON.parse(options.body);
      if (rpc.method === 'initialize') {
        return response({
          body: JSON.stringify({
            jsonrpc: '2.0', id: rpc.id + 1,
            result: { protocolVersion: '2024-11-05', capabilities: {} },
          }),
        });
      }
      return response({ status: 202 });
    });

    const app = buildApp();
    await request(app).post('/api/privilege-mcp/config').send({
      gatewayMode: 'agentless', mcpUrl: MCP_URL, clientId: 'client-id',
    }).expect(200);
    const result = await request(app)
      .post('/api/privilege-mcp/tools/list')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(result.status).toBe(500);
    expect(result.body.error).toContain('MCP response id mismatch');
  });
});
