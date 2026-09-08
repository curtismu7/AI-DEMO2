'use strict';

// A BFF restart wipes clientSessions (an in-process Map) but not the browser's
// cookie — the Express session survives it (LMDB, server.js). Before this fix
// that pair produced `mainAppAuthenticated: true` alongside
// `oauth.authenticated: false`: signed in to the app, signed out of the
// gateway, with nothing explaining why. See TECH_DEBT.md 2026-09-08.
//
// persistPrivilegeOauth() mirrors ONLY session.oauth and
// session.savedOauthByDoor into req.session; getClientSession() rehydrates
// from that mirror when a session id is unknown to the (now-empty) Map. This
// suite drives the real HTTP handlers — /config, /auth/start, /auth/callback,
// /state, /auth/logout — exactly like production, and simulates the restart
// with __test.reset(), which is the same clientSessions.clear() a real
// process restart produces.

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://privilege.pingone.com/api/mcp';
const TOKEN_URI = 'https://auth.pingone.com/test-env/as/token';
const AUTH_URI = 'https://auth.pingone.com/test-env/as/authorize';

/**
 * A minimal stand-in for the LMDB-backed Express session: one plain object,
 * reused across requests within a test (unlike a real per-request req.session
 * assignment, which would hide the bug this suite exists to catch — a fresh
 * object every request could never demonstrate persistence either way).
 * `.save` is a no-op-with-callback, matching how every store's `save()` is
 * actually consumed here (fire, then invoke the callback).
 */
function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  const fakeSession = { save: (cb) => { if (cb) cb(); } };
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-restart-rehydrate-test';
    req.session = fakeSession;
    next();
  });
  app.use('/api/privilege-mcp', router);
  return { app, fakeSession, __test: router.__test };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => JSON.stringify(body),
  };
}

/** Completes config -> auth/start -> callback so the session holds a real OAuth token. */
async function signIn(app) {
  global.fetch = jest.fn(async (url) => {
    if (String(url) === MCP_URL) {
      return jsonResponse({ authorization_uri: AUTH_URI, token_uri: TOKEN_URI });
    }
    return jsonResponse({
      access_token: 'oauth-access-1',
      refresh_token: 'oauth-refresh-1',
      expires_in: 3600,
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

describe('Privilege OAuth survives a BFF restart', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('sign-in persists the oauth slice into the Express session', async () => {
    const { app, fakeSession } = buildApp();
    await signIn(app);

    const persisted = fakeSession.privilegeMcpClientOAuth;
    expect(persisted).toBeDefined();
    expect(persisted.oauth.accessToken).toBe('oauth-access-1');
    expect(persisted.oauth.refreshToken).toBe('oauth-refresh-1');
    // Narrow on purpose: only these three keys, nothing else off `session`.
    // currentOauthKey is a door tag, not a credential — see persistPrivilegeOauth.
    expect(Object.keys(persisted).sort()).toEqual(['currentOauthKey', 'oauth', 'savedOauthByDoor']);
  });

  test('reports authenticated again after the in-process Map is wiped', async () => {
    const { app, __test } = buildApp();
    await signIn(app);

    // Simulate the restart: same effect as the process dying and coming back
    // with the same LMDB-backed session cookie, but without actually
    // restarting Jest's process.
    __test.reset();

    const state = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(state.body.oauth.authenticated).toBe(true);
    expect(state.body.oauth.hasRefreshToken).toBe(true);
  });

  test('a post-restart /config re-POST does not wipe the rehydrated token', async () => {
    // Found writing this suite: the door-switch logic in POST /config treats
    // the fresh (post-restart) session's env-default door as "previous" and
    // the operator's real door as "next" — a genuine-looking switch, even
    // though the rehydrated token was never for the default door at all. Without
    // recording which door a persisted token belongs to, the very next
    // /config call (which the frontend does routinely, e.g. on page load)
    // stashed the token under the wrong (default) key and found nothing under
    // the real one — silently undoing the restart fix for any door other than
    // the env default.
    const { app, __test } = buildApp();
    await signIn(app);
    __test.reset();

    const cfg = await request(app)
      .post('/api/privilege-mcp/config')
      .send({ mcpUrl: MCP_URL, clientId: 'client-abc' })
      .expect(200);

    expect(cfg.body.oauth.authenticated).toBe(true);
  });

  test('rehydrated session can still be used — no forced re-auth round trip', async () => {
    const { app, __test } = buildApp();
    await signIn(app);
    __test.reset();

    // config/gatewayConfigs are NOT part of the persisted slice (out of scope —
    // the entry asks for oauth + savedOauthByDoor only), so the fresh
    // post-restart session's mcpUrl is back to its env default, not the MCP_URL
    // configured before the restart. That is unrelated to this fix — a restart
    // always reset config, before and after — so the /rpc call here goes
    // wherever the default door is; the only thing this test checks is that
    // the rehydrated access token rides along, unconditionally.
    global.fetch = jest.fn(async (url, options) => {
      if (String(url) === TOKEN_URI) throw new Error('must not need a fresh token — the rehydrated one is not expired');
      const rpc = JSON.parse(options.body);
      return jsonResponse({ jsonrpc: '2.0', id: rpc.id, result: { ok: true } });
    });

    const res = await request(app)
      .post('/api/privilege-mcp/rpc')
      .send({ jsonrpc: '2.0', id: 1, method: 'notifications/initialized', params: {} })
      .expect(200);

    expect(res.body.result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer oauth-access-1');
  });

  test('logout clears the persisted slice too, not just the in-memory one', async () => {
    const { app, fakeSession } = buildApp();
    await signIn(app);

    await request(app).post('/api/privilege-mcp/auth/logout').expect(200);

    expect(fakeSession.privilegeMcpClientOAuth.oauth.accessToken).toBeNull();
  });

  test('never mirrors the operator console credential into the persisted slice', async () => {
    const { app, fakeSession, __test } = buildApp();
    await signIn(app);

    // The console credential is explicitly never persisted (getClientSession's
    // own comment: "In-memory for the life of this session only"). Set it
    // directly on the live in-memory session, the same object every handler
    // shares, then trigger persistPrivilegeOauth via a real handler and prove
    // it never crossed into req.session.
    const liveSession = __test.getClientSession({
      sessionID: 'privilege-restart-rehydrate-test',
      session: fakeSession,
    });
    liveSession.console = { authToken: 'console-secret-token', sessionId: 'console-sid' };

    await request(app).post('/api/privilege-mcp/auth/logout').expect(200);

    const persisted = fakeSession.privilegeMcpClientOAuth;
    expect(JSON.stringify(persisted)).not.toContain('console-secret-token');
    expect(Object.keys(persisted).sort()).toEqual(['currentOauthKey', 'oauth', 'savedOauthByDoor']);
  });

  test('a Bearer-header credential is not persisted — it is re-synced from the header every request, not owned by this session', async () => {
    const { app, fakeSession } = buildApp();

    global.fetch = jest.fn(async (_url, options) => {
      const rpc = JSON.parse(options.body);
      return jsonResponse({ jsonrpc: '2.0', id: rpc.id, result: { ok: true } });
    });

    await request(app)
      .post('/api/privilege-mcp/rpc')
      .set('Authorization', 'Bearer headless-bearer-token')
      .send({ jsonrpc: '2.0', id: 1, method: 'notifications/initialized', params: {} })
      .expect(200);

    expect(fakeSession.privilegeMcpClientOAuth).toBeUndefined();
  });
});
