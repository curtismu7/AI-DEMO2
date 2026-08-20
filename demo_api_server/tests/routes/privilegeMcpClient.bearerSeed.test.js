'use strict';

// #1764 seeded session.oauth.accessToken from Authorization: Bearer but left
// any prior browser-OAuth refreshToken/expiresAt/tokenUri in place. Near
// expiry (or on upstream 401), refreshAccessToken() then silently replaced the
// presented Bearer with the previous login's access token — wrong identity on
// the MCP hop.
//
// When a Bearer is present, refresh metadata must be cleared so the relay uses
// only the presented credential for that request.

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://privilege.pingone.com/api/mcp';
const TOKEN_URI = 'https://auth.pingone.com/test-env/as/token';
const AUTH_URI = 'https://auth.pingone.com/test-env/as/authorize';

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-bearer-seed-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => JSON.stringify(body),
  };
}

/** Completes config → auth/start → callback so the session holds OAuth refresh state. */
async function signIn(app, { expiresIn }) {
  global.fetch = jest.fn(async (url) => {
    if (String(url) === MCP_URL) {
      return jsonResponse({ authorization_uri: AUTH_URI, token_uri: TOKEN_URI });
    }
    return jsonResponse({
      access_token: 'oauth-access-1',
      refresh_token: 'oauth-refresh-1',
      expires_in: expiresIn,
      scope: 'openid profile email',
    });
  });

  await request(app).post('/api/privilege-mcp/config')
    .send({ mcpUrl: MCP_URL, clientId: 'client-abc' })
    .expect(200);

  const start = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
  const state = new URL(start.body.authUrl).searchParams.get('state');

  await request(app)
    .get(`/api/privilege-mcp/auth/callback?code=code-1&state=${encodeURIComponent(state)}`)
    .expect(302);
}

describe('privilege MCP Bearer seed must not inherit OAuth refresh identity', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('near-expiry OAuth session + Bearer does not refresh to the prior login', async () => {
    const app = buildApp();
    // expiresIn inside the 60s skew so accessTokenExpiring() would refresh if
    // refreshToken/expiresAt/tokenUri were still present after Bearer seeding.
    await signIn(app, { expiresIn: 10 });

    const requests = [];
    global.fetch = jest.fn(async (url, options) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      if (String(url) === TOKEN_URI) {
        return jsonResponse({
          access_token: 'oauth-refreshed-WRONG-IDENTITY',
          refresh_token: 'oauth-refresh-2',
          expires_in: 3600,
        });
      }
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    });

    await request(app)
      .post('/api/privilege-mcp/rpc')
      .set('Authorization', 'Bearer headless-bearer-token')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(200);

    expect(requests.some((r) => r.url === TOKEN_URI)).toBe(false);
    const mcpCall = requests.find((r) => r.url === MCP_URL);
    expect(mcpCall).toBeDefined();
    expect(mcpCall.headers.Authorization).toBe('Bearer headless-bearer-token');
  });

  test('upstream 401 with Bearer does not retry via the prior OAuth refresh token', async () => {
    const app = buildApp();
    await signIn(app, { expiresIn: 3600 });

    const requests = [];
    global.fetch = jest.fn(async (url, options) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      if (String(url) === TOKEN_URI) {
        return jsonResponse({
          access_token: 'oauth-refreshed-WRONG-IDENTITY',
          expires_in: 3600,
        });
      }
      return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    });

    const res = await request(app)
      .post('/api/privilege-mcp/rpc')
      .set('Authorization', 'Bearer headless-bearer-token')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(401);

    expect(res.body.error).toContain('401');
    expect(requests.some((r) => r.url === TOKEN_URI)).toBe(false);
    const mcpCalls = requests.filter((r) => r.url === MCP_URL);
    expect(mcpCalls).toHaveLength(1);
    expect(mcpCalls[0].headers.Authorization).toBe('Bearer headless-bearer-token');
  });

  test('accepts case-insensitive Bearer scheme', async () => {
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: MCP_URL, clientId: 'client-abc' })
      .expect(200);

    global.fetch = jest.fn(async (_url, options) => {
      const rpc = JSON.parse(options.body);
      if (rpc.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: rpc.id,
          result: { protocolVersion: '2024-11-05', capabilities: {} },
        });
      }
      if (rpc.method === 'notifications/initialized') {
        return { ok: true, status: 202, headers: { get: () => null }, text: async () => '' };
      }
      return jsonResponse({ jsonrpc: '2.0', id: rpc.id, result: { tools: [] } });
    });

    await request(app)
      .post('/api/privilege-mcp/tools/list')
      .set('Authorization', 'bearer case-insensitive-token')
      .send({})
      .expect(200);

    expect(global.fetch).toHaveBeenCalled();
    const auth = global.fetch.mock.calls[0][1].headers.Authorization;
    expect(auth).toBe('Bearer case-insensitive-token');
  });
});
