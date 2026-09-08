'use strict';

// GET /state reported authenticated/source/expiresAt/scope but never whether a
// refresh token exists — the one fact that says if an expiring session can
// recover silently or will bounce the user back to login. Measured against the
// live agentless gateway on 2026-09-08: its AS omits offline_access from
// scopes_supported and issues no refresh_token, so this flag reads false there
// and the re-login prompts are expected rather than a defect. Without it the
// only way to tell was to sign in and wait out the token lifetime.
//
// The flag is a BOOLEAN on purpose. The token itself must never reach the page.

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
    req.sessionID = 'privilege-hasrefresh-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

// Completes /config -> /auth/start -> /auth/callback. `refreshToken: null`
// reproduces the live gateway, which returns a token response with no
// refresh_token member at all.
async function signIn(app, { refreshToken }) {
  global.fetch = jest.fn(async (url) => {
    if (String(url) === MCP_URL) {
      return jsonResponse({ authorization_uri: AUTH_URI, token_uri: TOKEN_URI });
    }
    const token = { access_token: 'access-1', expires_in: 3600, scope: 'openid profile email' };
    if (refreshToken) token.refresh_token = refreshToken;
    return jsonResponse(token);
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

describe('GET /api/privilege-mcp/state — oauth.hasRefreshToken', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('is false before anyone signs in', async () => {
    const app = buildApp();

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.oauth.authenticated).toBe(false);
    expect(res.body.oauth.hasRefreshToken).toBe(false);
  });

  test('is false when the token response carries no refresh_token (live gateway behaviour)', async () => {
    const app = buildApp();
    await signIn(app, { refreshToken: null });

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.oauth.authenticated).toBe(true);
    expect(res.body.oauth.hasRefreshToken).toBe(false);
  });

  test('is true when the token response carries a refresh_token', async () => {
    const app = buildApp();
    await signIn(app, { refreshToken: 'refresh-1' });

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.oauth.authenticated).toBe(true);
    expect(res.body.oauth.hasRefreshToken).toBe(true);
  });

  test('never exposes the refresh token itself', async () => {
    const app = buildApp();
    await signIn(app, { refreshToken: 'super-secret-refresh' });

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(JSON.stringify(res.body)).not.toContain('super-secret-refresh');
  });
});
