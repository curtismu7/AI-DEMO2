/**
 * @file mcpPrivilegeAuth.test.js
 * @description Authorization Code + PKCE login for the built-in "Privilege
 * MCP" Generic MCP Inspector profile. axios is mocked (both discovery/DCR GET
 * and POST calls, and the token exchange POST); requireAdminSession is the
 * router's own local session-cookie check (mirrors mcpPingOneAdminAuth.js).
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

const DISCOVERY = {
  issuer: 'https://cmuir-agentless-mcpgw.ping-devops.com/external',
  authorization_endpoint: 'https://cmuir-agentless-mcpgw.ping-devops.com/external/authorize',
  token_endpoint: 'https://cmuir-agentless-mcpgw.ping-devops.com/external/token',
  registration_endpoint: 'https://cmuir-agentless-mcpgw.ping-devops.com/external/register',
};

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

    mockAxiosGet.mockResolvedValue({ data: { ...DISCOVERY } });
    mockAxiosPost.mockResolvedValue({ data: { ...REGISTRATION } });
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  describe('GET /login', () => {
    it('401s when not signed in as admin', async () => {
      const { app } = buildApp({ authed: false });
      const res = await request(app).get('/login');
      expect(res.status).toBe(401);
    });

    it('403s for a signed-in customer', async () => {
      const app = express();
      const session = { save: (cb) => cb && cb(), user: { id: 'u1', role: 'customer' } };
      app.use((req, res, next) => { req.session = session; next(); });
      app.use('/', require('../../routes/mcpPrivilegeAuth'));
      const res = await request(app).get('/login');
      expect(res.status).toBe(403);
    });

    it('discovers the gateway, registers a public DCR client, and redirects to /authorize with PKCE', async () => {
      const { app, session } = buildApp();
      const res = await request(app).get('/login');

      expect(res.status).toBe(302);
      expect(mockAxiosGet).toHaveBeenCalledWith(
        'https://cmuir-agentless-mcpgw.ping-devops.com/external/.well-known/oauth-authorization-server',
        expect.any(Object),
      );
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://cmuir-agentless-mcpgw.ping-devops.com/external/register',
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
      expect(location.origin + location.pathname).toBe('https://cmuir-agentless-mcpgw.ping-devops.com/external/authorize');
      expect(location.searchParams.get('client_id')).toBe('dcr-client-1');
      expect(location.searchParams.get('response_type')).toBe('code');
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('redirect_uri')).toBe(
        'https://api.ping.demo:3001/api/mcp/inspector/privilege/callback',
      );
      expect(location.searchParams.get('state')).toBe(session.privilegeMcpOAuth.state);
      expect(session.privilegeMcpOAuth.codeVerifier).toBeTruthy();
    });

    it('registers the DCR client only once across repeated logins (process-lifetime cache)', async () => {
      const { app } = buildApp();
      await request(app).get('/login');
      await request(app).get('/login');
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /callback', () => {
    async function loginThenGetSession(built) {
      await request(built.app).get('/login');
      return built.session;
    }

    it('redirects with privilege_error on state mismatch', async () => {
      const built = buildApp();
      await loginThenGetSession(built);
      const res = await request(built.app).get('/callback?code=abc&state=WRONG');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^\/pingone-mcp-inspector\?source=custom&privilege_error=invalid_state/);
    });

    it('redirects with privilege_error when the gateway returns an OAuth error', async () => {
      const built = buildApp();
      await loginThenGetSession(built);
      const res = await request(built.app).get('/callback?error=access_denied&error_description=nope');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('privilege_error=nope');
    });

    it('exchanges the code for a token and stores it in session on success', async () => {
      const built = buildApp();
      const session = await loginThenGetSession(built);
      const state = session.privilegeMcpOAuth.state;
      mockAxiosPost.mockImplementation((url) => {
        if (url === DISCOVERY.registration_endpoint) return Promise.resolve({ data: { ...REGISTRATION } });
        return Promise.resolve({ data: { access_token: 'privilege-mcp-token', expires_in: 3600 } });
      });

      const res = await request(built.app).get(`/callback?code=abc123&state=${state}`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/pingone-mcp-inspector?source=custom&profile=built-in-privilege-mcp');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        DISCOVERY.token_endpoint,
        expect.stringContaining('grant_type=authorization_code'),
        expect.any(Object),
      );
      expect(session.privilegeMcpToken.accessToken).toBe('privilege-mcp-token');
      expect(session.privilegeMcpToken.expiresAt).toBeGreaterThan(Date.now());
      expect(session.privilegeMcpOAuth).toBeUndefined();
    });

    it('redirects with privilege_error when the token exchange fails', async () => {
      const built = buildApp();
      const session = await loginThenGetSession(built);
      const state = session.privilegeMcpOAuth.state;
      mockAxiosPost.mockImplementation((url) => {
        if (url === DISCOVERY.registration_endpoint) return Promise.resolve({ data: { ...REGISTRATION } });
        return Promise.reject({ response: { data: { error_description: 'invalid_grant: code expired' } } });
      });

      const res = await request(built.app).get(`/callback?code=abc123&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('privilege_error=');
      expect(decodeURIComponent(res.headers.location)).toContain('invalid_grant: code expired');
    });
  });
});
