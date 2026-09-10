'use strict';

// The pingone-admin door signs in through a LOOPBACK callback with PingOne's
// built-in `pingone-mcp-server` client, because that is the only client whose
// tokens the hosted MCP accepts and its redirect allowlist is loopback-only.
// An HTTPS callback on our own origin is refused with "Redirect URI mismatch",
// and the client is system-owned so the allowlist cannot be edited.
//
// The callback lands on localhost:<port>, a different host from the one the
// session cookie is scoped to, so it arrives with no cookie. `state` is the
// correlation handle instead — single-use and expiring.

// Set in beforeAll and RESTORED in afterAll. Setting these at module scope
// leaked them into every later suite under --runInBand, which is how this file
// broke privilegeMcpClient.config.test.js — its oauthKey reads PUBLIC_APP_ORIGIN.
const ENV_UNDER_TEST = {
  PINGONE_ENVIRONMENT_ID: '01d89b06-66d5-430e-9f28-65636843788b',
  PINGONE_MCP_ADMIN_LOOPBACK_PORT: '7474',
  PUBLIC_APP_URL: 'https://local.ping-devops.com:4000',
  PINGONE_REGION: 'com',
};
const SAVED_ENV = {};
beforeAll(() => {
  for (const [k, v] of Object.entries(ENV_UNDER_TEST)) { SAVED_ENV[k] = process.env[k]; process.env[k] = v; }
});
afterAll(() => {
  for (const k of Object.keys(ENV_UNDER_TEST)) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

const express = require('express');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: () => undefined }));
jest.mock('../../services/pingoneAdminSession', () => ({ remember: jest.fn(), getAccessToken: () => null }));

const pingoneAdminSession = require('../../services/pingoneAdminSession');
const route = require('../../routes/mcpPingOneAdminAuth');

const ENV = ENV_UNDER_TEST.PINGONE_ENVIRONMENT_ID;
const BUILTIN = 'pingone-mcp-server';

function buildApp() {
  const app = express();
  const sess = { user: { username: 'demoUser' } };
  app.use((req, _res, next) => {
    req.session = sess;
    req.session.save = (cb) => cb && cb(null);
    next();
  });
  app.use('/api/mcp/inspector/pingone-admin', route);
  return app;
}

// The loopback listener is a bare http handler, not an express router.
function callLoopback(url) {
  return new Promise((resolve) => {
    const res = {
      writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; },
      end(body) { resolve({ status: this.statusCode, headers: this.headers, body }); },
    };
    route.handleLoopbackCallback({ url }, res);
  });
}

describe('the pingone-admin door signs in over loopback with the built-in client', () => {
  test('/login authorizes the BUILT-IN client against a loopback redirect', async () => {
    const res = await request(buildApp()).get('/api/mcp/inspector/pingone-admin/login').expect(302);

    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe(`https://auth.pingone.com/${ENV}/as/authorize`);
    expect(url.searchParams.get('client_id')).toBe(BUILTIN);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:7474/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Same environment as the app session, so the demo user is a valid hint.
    expect(url.searchParams.get('login_hint')).toBe('demoUser');
  });

  test('the loopback callback redeems the code and publishes the token', async () => {
    const login = await request(buildApp()).get('/api/mcp/inspector/pingone-admin/login').expect(302);
    const state = new URL(login.headers.location).searchParams.get('state');

    axios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } });
    const res = await callLoopback(`/callback?code=abc&state=${state}`);

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [endpoint, bodyStr] = axios.post.mock.calls[0];
    expect(endpoint).toBe(`https://auth.pingone.com/${ENV}/as/token`);
    const body = new URLSearchParams(bodyStr);
    expect(body.get('client_id')).toBe(BUILTIN);
    expect(body.get('code_verifier')).toBeTruthy();
    // The built-in client is public — sending a secret is what got the previous
    // attempt refused with "Unsupported authentication method".
    expect(body.get('client_secret')).toBeNull();

    expect(pingoneAdminSession.remember).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'tok' }),
    );
    // Back to the app, not left on a dead localhost tab.
    expect(res.status).toBe(302);
    expect(res.headers.Location).toContain('https://local.ping-devops.com:4000');
    expect(res.headers.Location).toContain('pingone_admin_login=success');
  });

  test('an unknown state is refused outright, not redirected', async () => {
    const res = await callLoopback('/callback?code=abc&state=never-issued');

    expect(res.status).toBe(400);
    expect(res.body).toMatch(/Unknown or expired/);
  });

  test('a state is single-use — a replayed callback is refused', async () => {
    const login = await request(buildApp()).get('/api/mcp/inspector/pingone-admin/login').expect(302);
    const state = new URL(login.headers.location).searchParams.get('state');

    axios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } });
    await callLoopback(`/callback?code=abc&state=${state}`);
    const replay = await callLoopback(`/callback?code=abc&state=${state}`);

    expect(replay.status).toBe(400);
  });
});
