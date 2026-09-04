'use strict';

// The pingone-admin door's local handler is reached by fetchMcp() as a
// server-to-server call to /mcp-facade/pingone-admin/mcp — that request never
// carries the browser's own session cookie, so the delegated PKCE token
// routes/mcpPingOneAdminAuth.js stored on req.session.pingoneMcpAdminToken
// has to be forwarded explicitly as a header instead. This confirms
// getClientSession + fetchMcp actually do that, end to end.

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://ai-demo.test.example.com/mcp-facade/pingone-admin/mcp';

function response(body) {
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
}

// Mirrors privilegeMcpClient.streamableHttp.test.js's own rpcResponse
// helper — echo the request's real id/method so fetchMcp's id-mismatch
// guard and era-detection handshake both pass.
function mockDoor(calls) {
  return jest.fn(async (url, options) => {
    const rpc = JSON.parse(options.body);
    calls.push({ url: String(url), headers: options.headers, rpc });
    if (rpc.method === 'server/discover') {
      return response({ jsonrpc: '2.0', id: rpc.id, result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } });
    }
    if (rpc.method === 'tools/list') {
      return response({ jsonrpc: '2.0', id: rpc.id, result: { tools: [] } });
    }
    return response({ jsonrpc: '2.0', id: rpc.id, result: {} });
  });
}

function buildApp(session) {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'pingone-admin-token-header-test';
    req.session = session;
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

describe('x-pingone-admin-token header forwarding', () => {
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; jest.restoreAllMocks(); });

  test('a token on the real session reaches the door as a header', async () => {
    const calls = [];
    global.fetch = mockDoor(calls);

    const app = buildApp({
      oauthTokens: { accessToken: 'main-app-token' }, // clears the route's own "not authenticated" guard
      pingoneMcpAdminToken: { accessToken: 'delegated-abc' },
    });
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: MCP_URL, clientId: 'client-abc' }).expect(200);
    await request(app).post('/api/privilege-mcp/tools/list').send({}).expect(200);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers['x-pingone-admin-token']).toBe('delegated-abc');
    }
  });

  test('no token on the session means no header at all', async () => {
    const calls = [];
    global.fetch = mockDoor(calls);

    const app = buildApp({ oauthTokens: { accessToken: 'main-app-token' } });
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: MCP_URL, clientId: 'client-abc' }).expect(200);
    await request(app).post('/api/privilege-mcp/tools/list').send({}).expect(200);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers['x-pingone-admin-token']).toBeUndefined();
    }
  });
});
