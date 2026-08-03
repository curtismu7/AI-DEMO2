'use strict';

// Privilege MCP client relay: an upstream authorization failure must reach the
// caller as an authorization failure. Every relay error used to collapse to
// 500, so Privilege Cloud answering "401 User is not authorized for
// privilege.pingone.com/api/mcp" rendered as an opaque server error and the
// page could not tell the operator their account lacked the entitlement.

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://privilege.pingone.com/api/mcp';
const TOKEN_URI = 'https://auth.pingone.com/test-env/as/token';
const AUTH_URI = 'https://auth.pingone.com/test-env/as/authorize';
const NOT_AUTHORIZED = 'User is not authorized for privilege.pingone.com/api/mcp\n';

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-status-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function response(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

async function signIn(app) {
  global.fetch = jest.fn(async (url) => {
    if (String(url) === MCP_URL) {
      return response({ authorization_uri: AUTH_URI, token_uri: TOKEN_URI });
    }
    return response({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      scope: 'openid',
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

// Upstream answers `status` for the MCP relay; token refreshes keep succeeding
// so the 401 path exhausts its one retry and surfaces the upstream failure.
function relayFails(status, bodyText) {
  global.fetch = jest.fn(async (url) => {
    if (String(url) === TOKEN_URI) {
      return response({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 });
    }
    return response(bodyText, { status });
  });
}

describe('privilege MCP relay surfaces the upstream status', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('tools/list reports an upstream 401 as 401, not 500', async () => {
    const app = buildApp();
    await signIn(app);
    relayFails(401, NOT_AUTHORIZED);

    const res = await request(app).post('/api/privilege-mcp/tools/list').send({});

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not authorized/i);
  });

  test('tools/list reports an upstream 403 as 403', async () => {
    const app = buildApp();
    await signIn(app);
    relayFails(403, 'Forbidden');

    const res = await request(app).post('/api/privilege-mcp/tools/list').send({});

    expect(res.status).toBe(403);
  });

  test('an upstream 5xx is still a 500 — the relay did not fail on the caller', async () => {
    const app = buildApp();
    await signIn(app);
    relayFails(503, 'upstream down');

    const res = await request(app).post('/api/privilege-mcp/tools/list').send({});

    expect(res.status).toBe(500);
  });

  test('tools/call surfaces the upstream status too', async () => {
    const app = buildApp();
    await signIn(app);
    relayFails(401, NOT_AUTHORIZED);

    const res = await request(app).post('/api/privilege-mcp/tools/call')
      .send({ name: 'whoami', arguments: {} });

    expect(res.status).toBe(401);
  });
});
