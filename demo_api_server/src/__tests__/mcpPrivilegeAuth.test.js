/**
 * @file mcpPrivilegeAuth.test.js
 * @description Authorization Code + PKCE login for the built-in
 * `transport: 'privilege'` Generic MCP Inspector profiles — one login per
 * door (see the file's own header comment for why). axios is mocked (both
 * discovery/DCR GET and POST calls, and the token exchange POST);
 * requireAdminSession is the router's own local session-cookie check
 * (mirrors mcpPingOneAdminAuth.js). mcpProfileStore is the REAL module — its
 * seeded built-in door profiles and URLs are what a login actually targets.
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockAxiosGet = jest.fn();
const mockAxiosPost = jest.fn();
jest.mock('axios', () => ({
  get: (...args) => mockAxiosGet(...args),
  post: (...args) => mockAxiosPost(...args),
}));

const mcpProfileStore = require('../../services/mcpProfileStore');

// Real seeded doors (see mcpProfileStore.js) — banking-rest2 and grafana are
// used to prove per-door isolation (separate discovery, separate cache entry).
const BANKING_PROFILE_ID = mcpProfileStore.PRIVILEGE_PROFILE_ID;
const GRAFANA_PROFILE_ID = mcpProfileStore.PRIVILEGE_GRAFANA_PROFILE_ID;
const BANKING_ISSUER = 'https://mcpgw.ai-demo.ping-devops.com/banking-rest2';
const GRAFANA_ISSUER = 'https://mcpgw.ai-demo.ping-devops.com/mcp-grafana';

function discoveryFor(issuer) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
  };
}

const REGISTRATION = {
  client_id: 'dcr-client-1',
  redirect_uris: ['https://api.ping.demo:3001/api/mcp/inspector/privilege/callback'],
};

function buildApp({ authed = true } = {}) {
  const app = express();
  const sharedSession = { save: (cb) => cb && cb() };
  app.use((req, res, next) => {
    req.session = sharedSession;
    if (authed) {
      sharedSession.user = { id: 'admin-1', role: 'admin', username: 'demoAdmin' };
    } else {
      delete sharedSession.user;
    }
    next();
  });
  const routes = require('../../routes/mcpPrivilegeAuth');
  app.use('/', routes);
  return { app, session: sharedSession };
}

const ENV_KEYS = ['PUBLIC_APP_URL', 'CORS_ORIGIN'];

describe('mcpPrivilegeAuth', () => {
  let originalEnv;

  beforeEach(() => {
    jest.resetModules();
    mockAxiosGet.mockReset();
    mockAxiosPost.mockReset();

    originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.PUBLIC_APP_URL = 'https://api.ping.demo:3001';
    delete process.env.CORS_ORIGIN;

    mockAxiosGet.mockImplementation((url) => {
      if (url.startsWith(BANKING_ISSUER)) return Promise.resolve({ data: discoveryFor(BANKING_ISSUER) });
      if (url.startsWith(GRAFANA_ISSUER)) return Promise.resolve({ data: discoveryFor(GRAFANA_ISSUER) });
      return Promise.reject(new Error(`unexpected discovery GET ${url}`));
    });
    mockAxiosPost.mockResolvedValue({ data: { ...REGISTRATION } });
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  describe('GET /login', () => {
    it('401s when there is no session at all', async () => {
      const { app } = buildApp({ authed: false });
      const res = await request(app).get(`/login?profile=${BANKING_PROFILE_ID}`);
      expect(res.status).toBe(401);
    });

    it('allows a signed-in customer, not just admin, to log in (any session, not admin-only)', async () => {
      const app = express();
      const session = { save: (cb) => cb && cb(), user: { id: 'u1', role: 'customer' } };
      app.use((req, res, next) => { req.session = session; next(); });
      app.use('/', require('../../routes/mcpPrivilegeAuth'));
      const res = await request(app).get(`/login?profile=${BANKING_PROFILE_ID}`);
      expect(res.status).toBe(302);
    });

    it('400s when no ?profile= is given (there is no login without a door)', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/login');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('profile_required');
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('redirects with privilege_error for an unknown profile id', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/login?profile=not-a-real-profile');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('profile=not-a-real-profile');
      expect(res.headers.location).toContain('privilege_error=');
    });

    it("discovers THIS door's own issuer, registers a public DCR client, and redirects to /authorize with PKCE", async () => {
      const { app, session } = buildApp();
      const res = await request(app).get(`/login?profile=${BANKING_PROFILE_ID}`);

      expect(res.status).toBe(302);
      expect(mockAxiosGet).toHaveBeenCalledWith(
        `${BANKING_ISSUER}/.well-known/oauth-authorization-server`,
        expect.any(Object),
      );
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${BANKING_ISSUER}/register`,
        expect.objectContaining({
          token_endpoint_auth_method: 'none',
          redirect_uris: expect.arrayContaining([
            'https://api.ping.demo:3001/api/mcp/inspector/privilege/callback',
            'https://local.ping-devops.com:4000/api/mcp/inspector/privilege/callback',
            'https://api.ping.demo:4000/api/mcp/inspector/privilege/callback',
          ]),
        }),
        expect.any(Object),
      );

      const location = new URL(res.headers.location);
      expect(location.origin + location.pathname).toBe(`${BANKING_ISSUER}/authorize`);
      expect(location.searchParams.get('client_id')).toBe('dcr-client-1');
      expect(location.searchParams.get('response_type')).toBe('code');
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('redirect_uri')).toBe(
        'https://api.ping.demo:3001/api/mcp/inspector/privilege/callback',
      );
      expect(location.searchParams.get('state')).toBe(session.privilegeMcpOAuth.state);
      expect(session.privilegeMcpOAuth.profileId).toBe(BANKING_PROFILE_ID);
      expect(session.privilegeMcpOAuth.codeVerifier).toBeTruthy();
    });

    it('registers the DCR client only once per door across repeated logins (process-lifetime cache)', async () => {
      const { app } = buildApp();
      await request(app).get(`/login?profile=${BANKING_PROFILE_ID}`);
      await request(app).get(`/login?profile=${BANKING_PROFILE_ID}`);
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    });

    it('discovers and registers SEPARATELY for a different door — no cross-door reuse', async () => {
      const { app } = buildApp();
      await request(app).get(`/login?profile=${BANKING_PROFILE_ID}`);
      const res = await request(app).get(`/login?profile=${GRAFANA_PROFILE_ID}`);

      expect(res.status).toBe(302);
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
      expect(mockAxiosGet).toHaveBeenCalledWith(
        `${GRAFANA_ISSUER}/.well-known/oauth-authorization-server`,
        expect.any(Object),
      );
      const location = new URL(res.headers.location);
      expect(location.origin + location.pathname).toBe(`${GRAFANA_ISSUER}/authorize`);
    });
  });

  describe('GET /callback', () => {
    async function loginThenGetSession(built, profileId) {
      await request(built.app).get(`/login?profile=${profileId}`);
      return built.session;
    }

    it('redirects with privilege_error on state mismatch', async () => {
      const built = buildApp();
      await loginThenGetSession(built, BANKING_PROFILE_ID);
      const res = await request(built.app).get('/callback?code=abc&state=WRONG');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^\/pingone-mcp-inspector\?source=custom&profile=.*&privilege_error=invalid_state/);
    });

    it('redirects with privilege_error when the gateway returns an OAuth error', async () => {
      const built = buildApp();
      await loginThenGetSession(built, BANKING_PROFILE_ID);
      const res = await request(built.app).get('/callback?error=access_denied&error_description=nope');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('privilege_error=nope');
    });

    it('exchanges the code for a token and stores it under this profile only', async () => {
      const built = buildApp();
      const session = await loginThenGetSession(built, BANKING_PROFILE_ID);
      const state = session.privilegeMcpOAuth.state;
      mockAxiosPost.mockImplementation((url) => {
        if (url === `${BANKING_ISSUER}/register`) return Promise.resolve({ data: { ...REGISTRATION } });
        return Promise.resolve({ data: { access_token: 'banking-token', expires_in: 3600 } });
      });

      const res = await request(built.app).get(`/callback?code=abc123&state=${state}`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`/pingone-mcp-inspector?source=custom&profile=${BANKING_PROFILE_ID}`);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${BANKING_ISSUER}/token`,
        expect.stringContaining('grant_type=authorization_code'),
        expect.any(Object),
      );
      expect(session.privilegeMcpTokens[BANKING_PROFILE_ID].accessToken).toBe('banking-token');
      expect(session.privilegeMcpTokens[BANKING_PROFILE_ID].expiresAt).toBeGreaterThan(Date.now());
      expect(session.privilegeMcpTokens[GRAFANA_PROFILE_ID]).toBeUndefined();
      expect(session.privilegeMcpOAuth).toBeUndefined();
    });

    it('a second door logging in adds its own token without touching the first', async () => {
      const built = buildApp();
      let session = await loginThenGetSession(built, BANKING_PROFILE_ID);
      mockAxiosPost.mockImplementation((url) => {
        if (url === `${BANKING_ISSUER}/register`) return Promise.resolve({ data: { ...REGISTRATION } });
        return Promise.resolve({ data: { access_token: 'banking-token', expires_in: 3600 } });
      });
      await request(built.app).get(`/callback?code=abc123&state=${session.privilegeMcpOAuth.state}`);

      session = await loginThenGetSession(built, GRAFANA_PROFILE_ID);
      mockAxiosPost.mockImplementation((url) => {
        if (url === `${GRAFANA_ISSUER}/register`) return Promise.resolve({ data: { ...REGISTRATION } });
        return Promise.resolve({ data: { access_token: 'grafana-token', expires_in: 3600 } });
      });
      await request(built.app).get(`/callback?code=xyz789&state=${session.privilegeMcpOAuth.state}`);

      expect(session.privilegeMcpTokens[BANKING_PROFILE_ID].accessToken).toBe('banking-token');
      expect(session.privilegeMcpTokens[GRAFANA_PROFILE_ID].accessToken).toBe('grafana-token');
    });

    it('redirects with privilege_error when the token exchange fails', async () => {
      const built = buildApp();
      const session = await loginThenGetSession(built, BANKING_PROFILE_ID);
      const state = session.privilegeMcpOAuth.state;
      mockAxiosPost.mockImplementation((url) => {
        if (url === `${BANKING_ISSUER}/register`) return Promise.resolve({ data: { ...REGISTRATION } });
        return Promise.reject({ response: { data: { error_description: 'invalid_grant: code expired' } } });
      });

      const res = await request(built.app).get(`/callback?code=abc123&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('privilege_error=');
      expect(decodeURIComponent(res.headers.location)).toContain('invalid_grant: code expired');
    });
  });
});
