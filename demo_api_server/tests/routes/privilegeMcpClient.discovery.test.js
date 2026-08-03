'use strict';

// Privilege MCP client discovery: an unreachable MCP URL must not abort sign-in.
// discoverAuth() fetched the MCP URL unguarded, so a network failure threw
// straight out of the function and /auth/start answered 500 {"error":"fetch
// failed"} — sign-in was impossible whenever the gateway was down, even though
// the PingOne OIDC fallback below it would have resolved the endpoints.

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
    req.sessionID = 'privilege-discovery-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function oidcMetadata() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ authorization_endpoint: AUTH_EP, token_endpoint: TOKEN_EP }),
    json: async () => ({ authorization_endpoint: AUTH_EP, token_endpoint: TOKEN_EP }),
  };
}

describe('privilege MCP discovery survives an unreachable gateway', () => {
  const originalFetch = global.fetch;
  const originalEnvId = process.env.PRIVILEGE_SSO_ENV_ID;

  beforeEach(() => { process.env.PRIVILEGE_SSO_ENV_ID = ENV_ID; });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnvId === undefined) delete process.env.PRIVILEGE_SSO_ENV_ID;
    else process.env.PRIVILEGE_SSO_ENV_ID = originalEnvId;
    jest.restoreAllMocks();
  });

  test('gateway down: auth/start still returns an authUrl from the OIDC fallback', async () => {
    const app = buildApp();
    global.fetch = jest.fn(async (url) => {
      if (String(url) === GATEWAY_URL) throw new TypeError('fetch failed');
      return oidcMetadata();
    });

    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: GATEWAY_URL, clientId: 'client-abc' })
      .expect(200);

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);

    expect(res.body.authUrl).toContain(AUTH_EP);
    expect(res.body.authUrl).toContain('code_challenge_method=S256');
  });

  test('gateway down AND no env id: the error names the cause, not "fetch failed"', async () => {
    delete process.env.PRIVILEGE_SSO_ENV_ID;
    const savedPingOneEnv = process.env.PINGONE_ENVIRONMENT_ID;
    delete process.env.PINGONE_ENVIRONMENT_ID;
    const app = buildApp();
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); });

    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: GATEWAY_URL, clientId: 'client-abc' })
      .expect(200);

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(500);

    expect(res.body.error).toMatch(/unreachable/i);
    expect(res.body.error).toMatch(/mcpgw|PRIVILEGE_MCPGW_URL/);
    if (savedPingOneEnv !== undefined) process.env.PINGONE_ENVIRONMENT_ID = savedPingOneEnv;
  });

  test('gateway up and self-advertising: its own endpoints win over the fallback', async () => {
    const app = buildApp();
    const gwAuth = 'https://gateway.example/authorize';
    const gwToken = 'https://gateway.example/token';
    global.fetch = jest.fn(async (url) => {
      if (String(url) === GATEWAY_URL) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          text: async () => JSON.stringify({ authorization_uri: gwAuth, token_uri: gwToken }),
        };
      }
      return oidcMetadata();
    });

    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: GATEWAY_URL, clientId: 'client-abc' })
      .expect(200);

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);

    expect(res.body.authUrl).toContain(gwAuth);
  });
});
