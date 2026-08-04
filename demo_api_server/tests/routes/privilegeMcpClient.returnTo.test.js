'use strict';

// Footprint costume shells start Privilege OAuth from /demo/:shellSlug routes.
// /auth/start accepts a returnTo path so the callback can land back in the
// shell; anything that is not a site-relative path must fall back to the
// classic /privilege-mcp-client page (no open redirect).

const express = require('express');
const request = require('supertest');

const GATEWAY_URL = 'https://local.ping-devops.com:8680/mcp';
const ENV_ID = '01d89b06-66d5-430e-9f28-65636843788b';
const AUTH_EP = `https://auth.pingone.com/${ENV_ID}/as/authorize`;
const TOKEN_EP = `https://auth.pingone.com/${ENV_ID}/as/token`;

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-returnto-test';
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
    json: async () => body,
  };
}

async function startAuth(app, returnTo) {
  await request(app).post('/api/privilege-mcp/config')
    .send({ mcpUrl: GATEWAY_URL, clientId: 'client-abc' })
    .expect(200);
  const res = await request(app).post('/api/privilege-mcp/auth/start')
    .send(returnTo === undefined ? {} : { returnTo })
    .expect(200);
  return new URL(res.body.authUrl).searchParams.get('state');
}

describe('privilege MCP OAuth returnTo', () => {
  const originalFetch = global.fetch;
  const originalEnvId = process.env.PRIVILEGE_SSO_ENV_ID;

  beforeEach(() => {
    process.env.PRIVILEGE_SSO_ENV_ID = ENV_ID;
    global.fetch = jest.fn(async (url) => {
      if (String(url) === TOKEN_EP) {
        return jsonResponse({ access_token: 'at-123', expires_in: 3600, scope: 'openid' });
      }
      return jsonResponse({ authorization_endpoint: AUTH_EP, token_endpoint: TOKEN_EP });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnvId === undefined) delete process.env.PRIVILEGE_SSO_ENV_ID;
    else process.env.PRIVILEGE_SSO_ENV_ID = originalEnvId;
    jest.restoreAllMocks();
  });

  test('callback redirects back to a site-relative returnTo', async () => {
    const app = buildApp();
    const state = await startAuth(app, '/demo/coding-agent');
    const res = await request(app)
      .get(`/api/privilege-mcp/auth/callback?code=abc&state=${state}`)
      .expect(302);
    expect(res.headers.location).toBe('/demo/coding-agent?auth=success');
  });

  test('absolute-URL and protocol-relative returnTo fall back to the client page', async () => {
    for (const bad of ['https://evil.example/phish', '//evil.example', '/x?y=1']) {
      const app = buildApp();
      const state = await startAuth(app, bad);
      const res = await request(app)
        .get(`/api/privilege-mcp/auth/callback?code=abc&state=${state}`)
        .expect(302);
      expect(res.headers.location).toBe('/privilege-mcp-client?auth=success');
    }
  });

  test('no returnTo keeps the classic redirect', async () => {
    const app = buildApp();
    const state = await startAuth(app);
    const res = await request(app)
      .get(`/api/privilege-mcp/auth/callback?code=abc&state=${state}`)
      .expect(302);
    expect(res.headers.location).toBe('/privilege-mcp-client?auth=success');
  });
});
