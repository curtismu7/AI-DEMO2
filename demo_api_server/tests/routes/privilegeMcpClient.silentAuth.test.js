'use strict';

// Verifies the prompt=none silent-auth path:
//   - /auth/start adds prompt=none when the main app has an active PingOne session
//   - /auth/start omits prompt=none when no main app session or already failed
//   - /auth/callback with login_required → ?auth=silent_failed (not a generic error)
//   - successful callback clears the privilegePromptNoneFailed flag

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://privilege.pingone.com/api/mcp';
const TOKEN_URI = 'https://auth.pingone.com/test-env/as/token';
const AUTH_URI = 'https://auth.pingone.com/test-env/as/authorize';

function mockDiscovery() {
  global.fetch = jest.fn(async (url) => {
    const body = String(url) === MCP_URL
      ? { authorization_uri: AUTH_URI, token_uri: TOKEN_URI }
      : { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: 'openid' };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  });
}

// sessionStore is mutated in-place so values set during one request survive the next.
function buildApp(sessionStore = {}) {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'silent-auth-test';
    req.session = sessionStore;
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

async function configure(app) {
  await request(app)
    .post('/api/privilege-mcp/config')
    .send({ mcpUrl: MCP_URL, clientId: 'client-abc' })
    .expect(200);
}

// Start auth and return the parsed auth URL.
async function startAuth(app) {
  const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
  return new URL(res.body.authUrl);
}

// Extract the state param from an auth URL and call the callback with it.
async function callbackWithError(app, authUrl, error) {
  const state = authUrl.searchParams.get('state');
  return request(app)
    .get(`/api/privilege-mcp/auth/callback?error=${encodeURIComponent(error)}&state=${encodeURIComponent(state)}`);
}

describe('privilege silent auth — prompt=none', () => {
  const origFetch = global.fetch;
  beforeEach(() => { mockDiscovery(); });
  afterEach(() => { global.fetch = origFetch; jest.restoreAllMocks(); });

  describe('/auth/start prompt param', () => {
    test('adds prompt=none when main app has an active access token', async () => {
      const app = buildApp({ oauthTokens: { accessToken: 'main-app-token' } });
      await configure(app);
      const authUrl = await startAuth(app);
      expect(authUrl.searchParams.get('prompt')).toBe('none');
    });

    test('omits prompt=none when no main app session', async () => {
      const app = buildApp({});
      await configure(app);
      const authUrl = await startAuth(app);
      expect(authUrl.searchParams.has('prompt')).toBe(false);
    });

    test('uses a cookie-restored dashboard session for prompt=none', async () => {
      const app = buildApp({
        user: { id: 'customer-1', role: 'customer' },
        _restoredFromCookie: true,
        oauthTokens: { accessToken: '_cookie_session' },
      });
      const state = await request(app).get('/api/privilege-mcp/state').expect(200);
      expect(state.body.mainAppAuthenticated).toBe(true);

      await configure(app);
      const authUrl = await startAuth(app);
      expect(authUrl.searchParams.get('prompt')).toBe('none');
    });

    test('omits prompt=none when privilegePromptNoneFailed is set', async () => {
      const app = buildApp({ oauthTokens: { accessToken: 'main-app-token' }, privilegePromptNoneFailed: true });
      await configure(app);
      const authUrl = await startAuth(app);
      expect(authUrl.searchParams.has('prompt')).toBe(false);
    });
  });

  describe('/auth/callback login_required handling', () => {
    test('redirects to ?auth=silent_failed when login_required after prompt=none attempt', async () => {
      const session = { oauthTokens: { accessToken: 'main-app-token' } };
      const app = buildApp(session);
      await configure(app);
      const authUrl = await startAuth(app);
      expect(authUrl.searchParams.get('prompt')).toBe('none'); // confirm prompt=none was set

      const res = await callbackWithError(app, authUrl, 'login_required');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/auth=silent_failed/);
      expect(res.headers.location).not.toMatch(/auth=error/);
      expect(session.privilegePromptNoneFailed).toBe(true);
    });

    test('normal error redirect when login_required without a prompt=none attempt', async () => {
      const app = buildApp({});
      await configure(app);
      const authUrl = await startAuth(app);
      expect(authUrl.searchParams.has('prompt')).toBe(false);

      const res = await callbackWithError(app, authUrl, 'login_required');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/auth=error/);
      expect(res.headers.location).not.toMatch(/silent_failed/);
    });

    test('successful callback clears the privilegePromptNoneFailed flag', async () => {
      const session = { oauthTokens: { accessToken: 'main-app-token' }, privilegePromptNoneFailed: false };
      // Simulate a previous silent-auth failure by setting the flag first.
      session.privilegePromptNoneFailed = true;
      const app = buildApp(session);
      await configure(app);
      // Start auth without prompt=none (flag is set), complete it successfully.
      const authUrl = await startAuth(app);
      const state = authUrl.searchParams.get('state');
      const res = await request(app)
        .get(`/api/privilege-mcp/auth/callback?code=code-1&state=${encodeURIComponent(state)}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/auth=success/);
      expect(session.privilegePromptNoneFailed).toBe(false);
    });
  });
});
