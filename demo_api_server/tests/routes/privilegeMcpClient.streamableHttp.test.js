'use strict';

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp';

function buildApp(sessionId = 'streamable-http-test') {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = sessionId;
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

function rpcResponse(rpc, result, options = {}) {
  return response({ ...options, body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }) });
}

describe('Privilege MCP dual-era Streamable HTTP client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('uses modern metadata, routing headers, pagination, and x-mcp-header', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, options) => {
      const rpc = JSON.parse(options.body);
      calls.push({ url: String(url), options, rpc });
      if (rpc.method === 'server/discover') {
        return rpcResponse(rpc, {
          resultType: 'complete', supportedVersions: ['2026-07-28'],
          capabilities: { tools: {}, prompts: {}, resources: {} },
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'test-server', version: '2' } },
        });
      }
      if (rpc.method === 'tools/list' && !rpc.params.cursor) {
        return rpcResponse(rpc, {
          resultType: 'complete', nextCursor: 'page-2',
          tools: [{ name: 'search', inputSchema: { type: 'object', properties: {
            region: { type: 'string', 'x-mcp-header': 'Region' },
          } } }],
        });
      }
      if (rpc.method === 'tools/list') {
        return rpcResponse(rpc, { resultType: 'complete', tools: [{ name: 'health' }] });
      }
      return rpcResponse(rpc, { resultType: 'complete', content: [] });
    });

    const app = buildApp();
    await request(app).post('/api/privilege-mcp/config').send({
      gatewayMode: 'agentless', mcpUrl: MCP_URL, clientId: 'client-id',
    }).expect(200);
    const listed = await request(app).post('/api/privilege-mcp/tools/list')
      .set('Authorization', 'Bearer test-token').send({}).expect(200);
    expect(listed.body.tools.map((tool) => tool.name)).toEqual(['search', 'health']);

    await request(app).post('/api/privilege-mcp/tools/call')
      .set('Authorization', 'Bearer test-token')
      .send({ name: 'search', arguments: { region: 'us-west1' } }).expect(200);

    expect(calls.map(({ rpc }) => rpc.method)).toEqual([
      'server/discover', 'tools/list', 'tools/list', 'tools/call',
    ]);
    for (const call of calls) {
      expect(call.options.headers['MCP-Protocol-Version']).toBe('2026-07-28');
      expect(call.options.headers['Mcp-Method']).toBe(call.rpc.method);
      expect(call.rpc.params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
      expect(call.options.headers['MCP-Session-Id']).toBeUndefined();
    }
    const toolCall = calls.at(-1);
    expect(toolCall.options.headers['Mcp-Name']).toBe('search');
    expect(toolCall.options.headers['Mcp-Param-Region']).toBe('us-west1');
  });

  test('falls back to legacy lifecycle only for an unrecognized 400 response', async () => {
    const calls = [];
    global.fetch = jest.fn(async (_url, options) => {
      const rpc = JSON.parse(options.body);
      calls.push({ options, rpc });
      if (rpc.method === 'server/discover') return response({ status: 400, body: 'legacy request rejected' });
      if (rpc.method === 'initialize') {
        return rpcResponse(rpc, {
          protocolVersion: '2024-11-05', capabilities: { tools: {} },
          serverInfo: { name: 'legacy', version: '1' },
        }, { headers: { 'MCP-Session-Id': 'legacy-session' } });
      }
      if (rpc.method === 'notifications/initialized') return response({ status: 202 });
      return rpcResponse(rpc, { tools: [] });
    });

    const app = buildApp('legacy-test');
    await request(app).post('/api/privilege-mcp/config').send({
      gatewayMode: 'agentless', mcpUrl: MCP_URL, clientId: 'client-id',
    });
    await request(app).post('/api/privilege-mcp/tools/list')
      .set('Authorization', 'Bearer test-token').send({}).expect(200);

    expect(calls.map(({ rpc }) => rpc.method)).toEqual([
      'server/discover', 'initialize', 'notifications/initialized', 'tools/list',
    ]);
    expect(calls[1].rpc.params.protocolVersion).toBe('2024-11-05');
    expect(calls[2].options.headers['MCP-Session-Id']).toBe('legacy-session');
  });

  test('does not misclassify a recognized modern protocol error as legacy', async () => {
    global.fetch = jest.fn(async (_url, options) => {
      const rpc = JSON.parse(options.body);
      return response({ status: 400, body: JSON.stringify({
        jsonrpc: '2.0', id: rpc.id,
        error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2027-01-01'] } },
      }) });
    });
    const app = buildApp('modern-error-test');
    await request(app).post('/api/privilege-mcp/config').send({
      gatewayMode: 'agentless', mcpUrl: MCP_URL, clientId: 'client-id',
    });
    const result = await request(app).post('/api/privilege-mcp/tools/list')
      .set('Authorization', 'Bearer test-token').send({});
    expect(result.status).toBe(400);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('opens the modern subscriptions/listen response stream', async () => {
    const calls = [];
    global.fetch = jest.fn(async (_url, options) => {
      const rpc = JSON.parse(options.body);
      calls.push({ options, rpc });
      if (rpc.method === 'server/discover') {
        return rpcResponse(rpc, {
          resultType: 'complete', supportedVersions: ['2026-07-28'],
          capabilities: { tools: {}, subscriptions: {} },
        });
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: { getReader: () => ({ read: async () => ({ done: true }) }) },
      };
    });
    const app = buildApp('subscription-test');
    await request(app).post('/api/privilege-mcp/config').send({
      gatewayMode: 'agentless', mcpUrl: MCP_URL, clientId: 'client-id',
    });
    await request(app).post('/api/privilege-mcp/subscriptions/start')
      .set('Authorization', 'Bearer test-token')
      .send({ types: ['toolsListChanged'] }).expect(202);
    const subscription = calls.at(-1);
    expect(subscription.rpc.method).toBe('subscriptions/listen');
    expect(subscription.rpc.params.types).toEqual(['toolsListChanged']);
    expect(subscription.options.headers.Accept).toBe('text/event-stream');
    expect(subscription.options.headers['Mcp-Method']).toBe('subscriptions/listen');
  });

  test('opens a Streamable HTTP event stream after the legacy handshake, and falls back to POST-only if a later call hangs while it is open', async () => {
    // A short real wait instead of faking timers — faking global timers
    // breaks supertest's own socket layer, since the request under test goes
    // through a real HTTP round trip.
    const originalTimeoutMs = process.env.PRIVILEGE_EVENT_STREAM_GUARD_TIMEOUT_MS;
    process.env.PRIVILEGE_EVENT_STREAM_GUARD_TIMEOUT_MS = '50';
    try {
      let toolsListCalls = 0;
      const eventStreamRequests = [];
      global.fetch = jest.fn(async (_url, options) => {
        if (options.method === 'GET') {
          eventStreamRequests.push(options);
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'text/event-stream' },
            // Stream that never closes — matches a real held-open SSE connection.
            body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
          };
        }
        const rpc = JSON.parse(options.body);
        if (rpc.method === 'server/discover') return response({ status: 400, body: 'legacy request rejected' });
        if (rpc.method === 'initialize') {
          return rpcResponse(rpc, {
            protocolVersion: '2024-11-05', capabilities: { tools: {} },
            serverInfo: { name: 'legacy', version: '1' },
          }, { headers: { 'MCP-Session-Id': 'legacy-session' } });
        }
        if (rpc.method === 'notifications/initialized') return response({ status: 202 });
        if (rpc.method === 'tools/list') {
          toolsListCalls += 1;
          if (toolsListCalls === 1) return rpcResponse(rpc, { tools: [] });
          if (toolsListCalls === 2) return new Promise(() => {}); // hangs — never resolves
          return rpcResponse(rpc, { tools: [{ name: 'recovered' }] }); // fallback retry succeeds
        }
        return rpcResponse(rpc, { tools: [] });
      });

      const app = buildApp('event-stream-fallback-test');
      await request(app).post('/api/privilege-mcp/config').send({
        gatewayMode: 'agentless', mcpUrl: MCP_URL, clientId: 'client-id',
      });

      // First call completes the handshake and fires the fire-and-forget
      // event-stream GET; awaiting the full HTTP round trip gives it time
      // to settle before the next assertion.
      await request(app).post('/api/privilege-mcp/tools/list')
        .set('Authorization', 'Bearer test-token').send({}).expect(200);
      expect(eventStreamRequests).toHaveLength(1);
      expect(eventStreamRequests[0].headers.Accept).toBe('text/event-stream');
      expect(eventStreamRequests[0].headers['MCP-Session-Id']).toBe('legacy-session');

      // Second call hangs while the stream is open — the 50ms guard timeout
      // (set above) should fire and the request should still complete via a
      // retried, POST-only fallback rather than hanging forever.
      const result = await request(app).post('/api/privilege-mcp/tools/list')
        .set('Authorization', 'Bearer test-token').send({});
      expect(result.status).toBe(200);
      expect(result.body.tools.map((t) => t.name)).toEqual(['recovered']);
      expect(toolsListCalls).toBe(3);
    } finally {
      if (originalTimeoutMs === undefined) delete process.env.PRIVILEGE_EVENT_STREAM_GUARD_TIMEOUT_MS;
      else process.env.PRIVILEGE_EVENT_STREAM_GUARD_TIMEOUT_MS = originalTimeoutMs;
    }
  });
});
