'use strict';

// Privilege MCP client relay: the access token must be refreshed before it
// expires (and after an upstream 401) instead of dead-ending the page.

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
    req.sessionID = 'privilege-refresh-test';
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

// Completes /config -> /auth/start -> /auth/callback so the session holds
// an access token, a refresh token and the token endpoint.
async function signIn(app, { expiresIn }) {
  const calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(String(url));
    if (String(url) === MCP_URL) {
      return jsonResponse({ authorization_uri: AUTH_URI, token_uri: TOKEN_URI });
    }
    return jsonResponse({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
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

describe('privilege MCP client token refresh', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('refreshes proactively when the access token is about to expire', async () => {
    const app = buildApp();
    await signIn(app, { expiresIn: 10 }); // inside the 60s refresh skew

    const requests = [];
    global.fetch = jest.fn(async (url, options) => {
      requests.push({ url: String(url), body: String(options.body), headers: options.headers });
      if (String(url) === TOKEN_URI) {
        return jsonResponse({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 });
      }
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    });

    await request(app).post('/api/privilege-mcp/rpc')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(200);

    const refresh = requests.find((r) => r.url === TOKEN_URI);
    expect(refresh).toBeDefined();
    expect(refresh.body).toContain('grant_type=refresh_token');
    expect(refresh.body).toContain('refresh_token=refresh-1');

    const mcpCall = requests.find((r) => r.url === MCP_URL);
    expect(mcpCall.headers.Authorization).toBe('Bearer access-2');
  });

  test('refreshes and retries once when the MCP relay returns 401', async () => {
    const app = buildApp();
    await signIn(app, { expiresIn: 3600 }); // not expiring — only the 401 triggers refresh

    const requests = [];
    global.fetch = jest.fn(async (url, options) => {
      requests.push({ url: String(url), headers: options.headers });
      if (String(url) === TOKEN_URI) {
        return jsonResponse({ access_token: 'access-2', expires_in: 3600 });
      }
      const mcpAttempts = requests.filter((r) => r.url === MCP_URL).length;
      if (mcpAttempts === 1) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    });

    await request(app).post('/api/privilege-mcp/rpc')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(200);

    const mcpCalls = requests.filter((r) => r.url === MCP_URL);
    expect(mcpCalls).toHaveLength(2);
    expect(mcpCalls[0].headers.Authorization).toBe('Bearer access-1');
    expect(mcpCalls[1].headers.Authorization).toBe('Bearer access-2');
  });

  test('surfaces the 401 and clears tokens when refresh is rejected', async () => {
    const app = buildApp();
    await signIn(app, { expiresIn: 3600 });

    global.fetch = jest.fn(async (url) => {
      if (String(url) === TOKEN_URI) {
        return jsonResponse({ error: 'invalid_grant' }, { status: 400 });
      }
      return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    });

    const res = await request(app).post('/api/privilege-mcp/rpc')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(500);
    expect(res.body.error).toContain('401');

    const state = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(state.body.oauth.authenticated).toBe(false);
  });
});
