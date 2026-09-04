'use strict';

// requireSignedInSession loosened the /login gate from admin-only to any
// signed-in user (the resulting token just carries whatever PingOne roles
// that user already has — see the route's own comment). Also covers the new
// ?returnTo= round trip that lets a page other than /pingone-mcp-inspector
// (specifically /privilege-mcp-client's pingone-admin door) drive this login,
// and the PAR (RFC 9126) push that replaced passing params inline on the
// /authorize redirect — the hosted MCP server rejected an inline `resource`
// with "401 Invalid authentication"; PAR is this project's own established
// working pattern for resource-bound PingOne authorization.

jest.mock('../services/pingoneProvisionService', () => ({
  PingOneProvisionService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    createApplication: jest.fn().mockResolvedValue({
      application: { id: 'app-1', clientId: 'client-1', redirectUris: [] },
    }),
    updateApplication: jest.fn().mockResolvedValue({ clientId: 'client-1' }),
  })),
}));

// The project's global tests/setup.js runs jest.resetModules() in an
// afterEach after EVERY test. jest.mock('axios') survives that (it's a
// standing directive, not a captured reference) as long as both this file's
// `axios` var AND the router-under-test are require()'d exactly once, up
// front — matching tests/oauthServiceTokenExchangeTelemetry.test.js. Re-
// require()ing the router per test (e.g. inside a buildApp() helper) would
// re-run its own `require('axios')` against the freshly-cleared cache and
// silently pick up a real, unmocked axios instead — real network calls
// go out and the spy on the OLD axios reference never sees them.
jest.mock('axios');

process.env.PINGONE_ENVIRONMENT_ID = 'env-1';
process.env.PINGONE_WORKER_CLIENT_ID = 'worker-1';
process.env.PINGONE_WORKER_CLIENT_SECRET = 'worker-secret';

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const pingOneAdminAuthRouter = require('../routes/mcpPingOneAdminAuth');

function buildApp(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/mcp/inspector/pingone-admin', pingOneAdminAuthRouter);
  return app;
}

describe('GET /api/mcp/inspector/pingone-admin/login — signed-in gate + returnTo + PAR', () => {
  const postSpy = axios.post;
  beforeEach(() => {
    postSpy.mockResolvedValue({ data: { request_uri: 'urn:pingone:par:req-1', expires_in: 60 } });
  });

  test('401 with no session at all', async () => {
    const app = buildApp({});
    const res = await request(app).get('/api/mcp/inspector/pingone-admin/login');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('a non-admin signed-in user reaches the authorize redirect — no admin gate', async () => {
    const session = { user: { username: 'plainUser', role: 'customer' }, save: (cb) => cb() };
    const app = buildApp(session);
    const res = await request(app).get('/api/mcp/inspector/pingone-admin/login');
    expect(res.status).toBe(302);
    // Per RFC 9126, the visible redirect carries only client_id + request_uri.
    const location = new URL(res.headers.location, 'https://example.com');
    expect(location.searchParams.get('client_id')).toBe('client-1');
    expect(location.searchParams.get('request_uri')).toBe('urn:pingone:par:req-1');
  });

  test('the pushed PAR body carries login_hint as the real signed-in username, not a hardcoded admin', async () => {
    const session = { user: { username: 'plainUser', role: 'customer' }, save: (cb) => cb() };
    const app = buildApp(session);
    await request(app).get('/api/mcp/inspector/pingone-admin/login');
    const [, sentBody] = postSpy.mock.calls[0];
    expect(new URLSearchParams(sentBody).get('login_hint')).toBe('plainUser');
  });

  // Without this, PingOne mints a token for its default resource (Management
  // API) and the hosted MCP server rejects it as "401 Invalid authentication"
  // — verified live against the server's own RFC 9728 metadata, whose
  // `resource` field is exactly this URL, not a bare origin.
  test('the pushed PAR body carries the hosted MCP server as the resource', async () => {
    const session = { user: { username: 'plainUser', role: 'customer' }, save: (cb) => cb() };
    const app = buildApp(session);
    await request(app).get('/api/mcp/inspector/pingone-admin/login');
    const [parEndpoint, sentBody] = postSpy.mock.calls[0];
    expect(parEndpoint).toMatch(/\/par$/);
    expect(new URLSearchParams(sentBody).get('resource')).toBe('https://mcp.pingone.com/admin/env-1/mcp');
  });

  test('a PAR push failure redirects with the error instead of throwing', async () => {
    postSpy.mockReset();
    postSpy.mockRejectedValue({ response: { status: 400, data: { error_description: 'invalid redirect_uri' } } });
    const session = { user: { username: 'plainUser', role: 'customer' }, save: (cb) => cb() };
    const app = buildApp(session);
    const res = await request(app).get('/api/mcp/inspector/pingone-admin/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/pingone-mcp-inspector\?source=custom&pingone_admin_error=/);
  });

  test('?returnTo= is stashed on the pending OAuth state for the callback to use', async () => {
    const session = { user: { username: 'plainUser', role: 'customer' }, save: (cb) => cb() };
    const app = buildApp(session);
    await request(app).get('/api/mcp/inspector/pingone-admin/login').query({ returnTo: '/privilege-mcp-client' });
    expect(session.pingoneMcpAdminOAuth.returnTo).toBe('/privilege-mcp-client');
  });

  test('an unsafe returnTo (not site-relative) is dropped, not stashed', async () => {
    const session = { user: { username: 'plainUser', role: 'customer' }, save: (cb) => cb() };
    const app = buildApp(session);
    await request(app).get('/api/mcp/inspector/pingone-admin/login').query({ returnTo: 'https://evil.example.com' });
    expect(session.pingoneMcpAdminOAuth.returnTo).toBeNull();
  });
});

describe('GET /api/mcp/inspector/pingone-admin/callback — returnTo redirects', () => {
  test('success redirects to returnTo with pingone_admin_login=success, not the inspector page', async () => {
    const session = {
      pingoneMcpAdminOAuth: { state: 'xyz', codeVerifier: 'v', redirectUri: 'http://x/cb', returnTo: '/privilege-mcp-client' },
      save: (cb) => cb(),
    };
    const app = buildApp(session);
    axios.post.mockResolvedValue({ data: { access_token: 'tok-1', expires_in: 3600 } });

    const res = await request(app).get('/api/mcp/inspector/pingone-admin/callback').query({ code: 'abc', state: 'xyz' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/privilege-mcp-client?pingone_admin_login=success');
    expect(session.pingoneMcpAdminToken.accessToken).toBe('tok-1');
    // Same resource as the /login PAR push, on the token exchange too.
    const [, sentBody] = axios.post.mock.calls[0];
    expect(new URLSearchParams(sentBody).get('resource')).toBe('https://mcp.pingone.com/admin/env-1/mcp');
  });

  test('failure (invalid_state) with a pending returnTo still redirects to it, with an error', async () => {
    const session = { pingoneMcpAdminOAuth: { state: 'xyz', codeVerifier: 'v', redirectUri: 'http://x/cb', returnTo: '/privilege-mcp-client' } };
    const app = buildApp(session);
    const res = await request(app).get('/api/mcp/inspector/pingone-admin/callback').query({ code: 'abc', state: 'wrong' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/privilege-mcp-client?pingone_admin_login=error&reason=invalid_state');
  });
});
