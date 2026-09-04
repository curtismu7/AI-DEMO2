/**
 * @file mcpPingOneAdminAuth.test.js
 * @description Authorization Code + PKCE login for the built-in "PingOne MCP"
 * Generic MCP Inspector profile. PingOneProvisionService and axios are mocked;
 * requireAdmin is the REAL middleware (gated on req.user.role === 'admin').
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockCreateApplication = jest.fn();
const mockUpdateApplication = jest.fn();
const mockInitialize = jest.fn();

jest.mock('../../services/pingoneProvisionService', () => ({
  PingOneProvisionService: jest.fn().mockImplementation(() => ({
    initialize: (...args) => mockInitialize(...args),
    createApplication: (...args) => mockCreateApplication(...args),
    updateApplication: (...args) => mockUpdateApplication(...args),
  })),
}));

const mockAxiosPost = jest.fn();
jest.mock('axios', () => ({ post: (...args) => mockAxiosPost(...args) }));

function buildApp({ authed = true } = {}) {
  const app = express();
  const sharedSession = { save: (cb) => cb && cb() };
  app.use((req, res, next) => {
    req.session = sharedSession;
    if (authed) {
      req.user = { id: 'admin-1', role: 'admin', username: 'demoAdmin' };
      // The router is mounted without authenticateToken, so its gate reads
      // session.user.role rather than req.user — seed both.
      sharedSession.user = { id: 'admin-1', role: 'admin', username: 'demoAdmin' };
    } else {
      delete sharedSession.user;
    }
    next();
  });
  const routes = require('../../routes/mcpPingOneAdminAuth');
  app.use('/', routes);
  return { app, session: sharedSession };
}

const EXISTING_APP = {
  id: 'app-1',
  clientId: 'client-1',
  redirectUris: ['http://localhost:7464/callback'],
};

const ENV_KEYS = [
  'PINGONE_ENVIRONMENT_ID',
  'PINGONE_REGION',
  'PINGONE_WORKER_CLIENT_ID',
  'PINGONE_WORKER_CLIENT_SECRET',
  'PUBLIC_APP_URL',
];

describe('mcpPingOneAdminAuth', () => {
  let originalEnv;

  beforeEach(() => {
    jest.resetModules();
    mockCreateApplication.mockReset();
    mockUpdateApplication.mockReset();
    mockInitialize.mockReset();
    mockAxiosPost.mockReset();

    originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.PINGONE_ENVIRONMENT_ID = 'env-123';
    process.env.PINGONE_REGION = 'com';
    process.env.PINGONE_WORKER_CLIENT_ID = 'worker-id';
    process.env.PINGONE_WORKER_CLIENT_SECRET = 'worker-secret';
    process.env.PUBLIC_APP_URL = 'https://api.ping.demo:3001';

    mockCreateApplication.mockResolvedValue({ exists: true, application: { ...EXISTING_APP } });
    mockUpdateApplication.mockResolvedValue({ ...EXISTING_APP, clientId: 'client-1' });
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  describe('GET /login', () => {
    it('401s when not signed in as admin (requireAdmin)', async () => {
      const { app } = buildApp({ authed: false });
      const res = await request(app).get('/login');
      expect(res.status).toBe(401);
    });

    it('finds-or-creates the PingOne MCP Server app, registers our callback, pushes PAR, and redirects to /authorize with request_uri', async () => {
      mockAxiosPost.mockResolvedValue({ data: { request_uri: 'urn:pingone:par:req-1', expires_in: 60 } });
      const { app, session } = buildApp();
      const res = await request(app).get('/login');

      expect(res.status).toBe(302);
      expect(mockCreateApplication).toHaveBeenCalledWith(
        'PingOne MCP Server',
        expect.any(String),
        'WORKER',
        ['authorization_code', 'refresh_token'],
        'none'
      );
      // Our callback wasn't in the existing redirectUris — updateApplication adds it.
      expect(mockUpdateApplication).toHaveBeenCalledWith(
        'app-1',
        expect.objectContaining({
          redirectUris: expect.arrayContaining([
            'http://localhost:7464/callback',
            'https://api.ping.demo:3001/api/mcp/inspector/pingone-admin/callback',
          ]),
        })
      );

      // RFC 9126: authorization details are pushed to /par, not carried inline
      // on /authorize — the hosted PingOne MCP server rejects an inline
      // `resource` param with "401 Invalid authentication".
      const [parEndpoint, parBody] = mockAxiosPost.mock.calls[0];
      expect(parEndpoint).toBe('https://auth.pingone.com/env-123/as/par');
      const parParams = new URLSearchParams(parBody);
      expect(parParams.get('client_id')).toBe('client-1');
      expect(parParams.get('response_type')).toBe('code');
      expect(parParams.get('code_challenge_method')).toBe('S256');
      expect(parParams.get('redirect_uri')).toBe(
        'https://api.ping.demo:3001/api/mcp/inspector/pingone-admin/callback'
      );
      expect(parParams.get('state')).toBe(session.pingoneMcpAdminOAuth.state);
      expect(session.pingoneMcpAdminOAuth.codeVerifier).toBeTruthy();

      // Per RFC 9126, the visible redirect carries only client_id + request_uri.
      const location = new URL(res.headers.location);
      expect(location.origin + location.pathname).toBe('https://auth.pingone.com/env-123/as/authorize');
      expect(location.searchParams.get('client_id')).toBe('client-1');
      expect(location.searchParams.get('request_uri')).toBe('urn:pingone:par:req-1');
      expect(location.searchParams.get('code_challenge_method')).toBeNull();
    });

    it('does not duplicate the redirect URI on a second login once it is already registered', async () => {
      mockCreateApplication.mockResolvedValue({
        exists: true,
        application: {
          ...EXISTING_APP,
          redirectUris: [
            ...EXISTING_APP.redirectUris,
            // All inspectorCallbackUrls() hosts must already be present or the
            // route registers the missing ones (api.ping.demo:4000 +
            // local.ping-devops.com:4000 were added alongside :3001).
            'https://api.ping.demo:3001/api/mcp/inspector/pingone-admin/callback',
            'https://local.ping-devops.com:4000/api/mcp/inspector/pingone-admin/callback',
            'https://api.ping.demo:4000/api/mcp/inspector/pingone-admin/callback',
          ],
        },
      });
      const { app } = buildApp();
      const res = await request(app).get('/login');
      expect(res.status).toBe(302);
      expect(mockUpdateApplication).not.toHaveBeenCalled();
    });
  });

  describe('GET /callback', () => {
    async function loginThenGetSession(app) {
      const { app: loginApp, session } = app;
      await request(loginApp).get('/login');
      return session;
    }

    it('redirects with pingone_admin_error on state mismatch', async () => {
      const built = buildApp();
      await loginThenGetSession(built);
      const res = await request(built.app).get('/callback?code=abc&state=WRONG');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^\/pingone-mcp-inspector\?source=custom&pingone_admin_error=invalid_state/);
    });

    it('redirects with pingone_admin_error when PingOne returns an OAuth error', async () => {
      const built = buildApp();
      await loginThenGetSession(built);
      const res = await request(built.app).get('/callback?error=access_denied&error_description=nope');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('pingone_admin_error=nope');
    });

    it('exchanges the code for a token and stores it in session on success', async () => {
      const built = buildApp();
      const session = await loginThenGetSession(built);
      const state = session.pingoneMcpAdminOAuth.state;
      mockAxiosPost.mockResolvedValue({ data: { access_token: 'admin-mcp-token', expires_in: 3600 } });

      const res = await request(built.app).get(`/callback?code=abc123&state=${state}`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/pingone-mcp-inspector?source=custom');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://auth.pingone.com/env-123/as/token',
        expect.stringContaining('grant_type=authorization_code'),
        expect.any(Object)
      );
      expect(session.pingoneMcpAdminToken.accessToken).toBe('admin-mcp-token');
      expect(session.pingoneMcpAdminToken.expiresAt).toBeGreaterThan(Date.now());
      expect(session.pingoneMcpAdminOAuth).toBeUndefined();
    });

    it('redirects with pingone_admin_error when the token exchange fails', async () => {
      const built = buildApp();
      const session = await loginThenGetSession(built);
      const state = session.pingoneMcpAdminOAuth.state;
      mockAxiosPost.mockRejectedValue({
        response: { data: { error_description: 'invalid_grant: code expired' } },
      });

      const res = await request(built.app).get(`/callback?code=abc123&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('pingone_admin_error=');
      expect(decodeURIComponent(res.headers.location)).toContain('invalid_grant: code expired');
    });
  });
});
