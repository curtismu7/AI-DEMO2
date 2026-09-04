'use strict';

// requireSignedInSession loosened the /login gate from admin-only to any
// signed-in user (the resulting token just carries whatever PingOne roles
// that user already has — see the route's own comment). Also covers the new
// ?returnTo= round trip that lets a page other than /pingone-mcp-inspector
// (specifically /privilege-mcp-client's pingone-admin door) drive this login.

jest.mock('../services/pingoneProvisionService', () => ({
  PingOneProvisionService: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    createApplication: jest.fn().mockResolvedValue({
      application: { id: 'app-1', clientId: 'client-1', redirectUris: [] },
    }),
    updateApplication: jest.fn().mockResolvedValue({ clientId: 'client-1' }),
  })),
}));

process.env.PINGONE_ENVIRONMENT_ID = 'env-1';
process.env.PINGONE_WORKER_CLIENT_ID = 'worker-1';
process.env.PINGONE_WORKER_CLIENT_SECRET = 'worker-secret';

const request = require('supertest');
const express = require('express');

function buildApp(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/mcp/inspector/pingone-admin', require('../routes/mcpPingOneAdminAuth'));
  return app;
}

describe('GET /api/mcp/inspector/pingone-admin/login — signed-in gate + returnTo', () => {
  test('401 with no session at all', async () => {
    const app = buildApp({});
    const res = await request(app).get('/api/mcp/inspector/pingone-admin/login');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
  });

  test('a non-admin signed-in user reaches the authorize redirect — no admin gate', async () => {
    const session = { user: { username: 'plainUser', role: 'customer' }, save: (cb) => cb() };
    const app = buildApp(session);
    const res = await request(app).get('/api/mcp/inspector/pingone-admin/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/login_hint=plainUser/);
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
    const axios = require('axios');
    jest.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'tok-1', expires_in: 3600 } });

    const res = await request(app).get('/api/mcp/inspector/pingone-admin/callback').query({ code: 'abc', state: 'xyz' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/privilege-mcp-client?pingone_admin_login=success');
    expect(session.pingoneMcpAdminToken.accessToken).toBe('tok-1');
    axios.post.mockRestore();
  });

  test('failure (invalid_state) with a pending returnTo still redirects to it, with an error', async () => {
    const session = { pingoneMcpAdminOAuth: { state: 'xyz', codeVerifier: 'v', redirectUri: 'http://x/cb', returnTo: '/privilege-mcp-client' } };
    const app = buildApp(session);
    const res = await request(app).get('/api/mcp/inspector/pingone-admin/callback').query({ code: 'abc', state: 'wrong' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/privilege-mcp-client?pingone_admin_login=error&reason=invalid_state');
  });
});
