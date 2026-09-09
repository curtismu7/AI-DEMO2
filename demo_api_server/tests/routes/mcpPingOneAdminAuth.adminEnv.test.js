'use strict';

// PingOne serves the admin-plane MCP from the ORGANISATION'S ADMINISTRATORS
// environment, so the delegated PKCE token has to be minted by THAT
// environment's authorization server. Authenticating in the resource
// environment produced a valid token from the wrong issuer — the 401 this door
// showed for weeks (REGRESSION_PLAN 2026-09-09).
//
// ensureApp() cannot help here: it needs a worker credential in the environment
// it provisions into, and we hold none in the admin env. PingOne's built-in
// `pingone-mcp-server` client cannot either — loopback-redirect-only and
// system-owned. Hence an operator-registered app, read from config.
//
// Env vars are set at module scope, before the route is required: mirroring the
// harness that was verified to drive this flow end to end. Mocking the endpoint
// resolver and the provision service as well left the route holding a different
// axios instance than the test stubbed, so the token POST silently returned
// undefined — a green-looking harness that proved nothing.

process.env.PINGONE_MCP_ENVIRONMENT_ID = '9e2f2f0c-f9fa-46da-b6f0-7eda4d3ccca2';
process.env.PINGONE_MCP_ADMIN_CLIENT_ID = 'admin-env-client-id';
process.env.PINGONE_MCP_ADMIN_CLIENT_SECRET = 'admin-env-secret';
process.env.PUBLIC_APP_URL = 'https://local.ping-devops.com:4000';
process.env.PINGONE_REGION = 'com';

const express = require('express');
const request = require('supertest');
const axios = require('axios');

// Explicit factory, not the automock: jest.config.js sets clearMocks:true, which
// wiped the automocked post()'s implementation between tests — the route then
// received undefined from its token POST while the test saw zero calls, a
// harness failing on code that was correct.
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: () => undefined }));
jest.mock('../../services/pingoneAdminSession', () => ({ remember: jest.fn(), getAccessToken: () => null }));

const ADMIN_ENV = process.env.PINGONE_MCP_ENVIRONMENT_ID;
const ADMIN_CLIENT = process.env.PINGONE_MCP_ADMIN_CLIENT_ID;
const ADMIN_SECRET = process.env.PINGONE_MCP_ADMIN_CLIENT_SECRET;
const CALLBACK = `${process.env.PUBLIC_APP_URL}/api/mcp/inspector/pingone-admin/callback`;

function buildApp(session) {
  const router = require('../../routes/mcpPingOneAdminAuth');
  const app = express();
  const sess = session || { user: { username: 'demoUser' } };
  app.use((req, _res, next) => {
    req.session = sess;
    req.session.save = (cb) => cb(null);
    next();
  });
  app.use('/api/mcp/inspector/pingone-admin', router);
  return app;
}

const login = (app) => request(app).get('/api/mcp/inspector/pingone-admin/login');

describe('the delegated PKCE flow runs in the ADMIN environment when one is configured', () => {
  beforeEach(() => {
    axios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } });
    process.env.PINGONE_MCP_ENVIRONMENT_ID = ADMIN_ENV;
    process.env.PINGONE_MCP_ADMIN_CLIENT_ID = ADMIN_CLIENT;
    process.env.PINGONE_MCP_ADMIN_CLIENT_SECRET = ADMIN_SECRET;
  });

  test('/login authorizes against the ADMIN environment, with the configured client', async () => {
    const res = await login(buildApp()).expect(302);

    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe(`https://auth.pingone.com/${ADMIN_ENV}/as/authorize`);
    expect(url.searchParams.get('client_id')).toBe(ADMIN_CLIENT);
    expect(url.searchParams.get('redirect_uri')).toBe(CALLBACK);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('it does not push to PAR, and never provisions an app it has no worker for', async () => {
    const before = axios.post.mock.calls.length;
    await login(buildApp()).expect(302);
    expect(axios.post.mock.calls.length).toBe(before);
  });

  test('no login_hint — the signed-in username belongs to the OTHER environment', async () => {
    const res = await login(buildApp()).expect(302);
    expect(new URL(res.headers.location).searchParams.get('login_hint')).toBeNull();
  });

  test('a code minted in the admin env is never redeemed after the config is removed', async () => {
    const app = buildApp();
    const loginRes = await login(app).expect(302);
    const state = new URL(loginRes.headers.location).searchParams.get('state');

    const before = axios.post.mock.calls.length;
    delete process.env.PINGONE_MCP_ADMIN_CLIENT_ID;
    const res = await request(app)
      .get(`/api/mcp/inspector/pingone-admin/callback?code=abc&state=${state}`)
      .expect(302);

    // Never redeemed anywhere — not against the resource env's token endpoint either.
    expect(axios.post.mock.calls.length).toBe(before);
    expect(decodeURIComponent(res.headers.location)).toMatch(/disappeared mid-flow/);
  });

  test('with no admin client configured it does not touch the admin environment', async () => {
    delete process.env.PINGONE_MCP_ENVIRONMENT_ID;
    delete process.env.PINGONE_MCP_ADMIN_CLIENT_ID;
    delete process.env.PINGONE_MCP_ADMIN_CLIENT_SECRET;

    const res = await login(buildApp()).expect(302);
    expect(res.headers.location).not.toContain(ADMIN_ENV);
  });

  test('a signed-out caller is still refused', async () => {
    await login(buildApp({})).expect(401);
  });
});
