'use strict';

// privilegeGatewaySession.remember() hands the façade's privilege-gateway/<app>
// door a token for the upstream leg. It must only be called when the exchange
// actually happened against the REAL gateway's own token endpoint (Privilege
// mode's DCR/federated flow) — every other mode (Direct's opensearch/brave,
// Façade's own base doors) mints a token from OUR broker instead, whose
// resource happens to be named `mcpgateway.ping.demo` too (a name collision
// with the real gateway's identifier, not an actual gateway-issued token).
// Remembering that overwrote a working gateway session, so the façade's
// privilege-gateway door then forwarded a token the real gateway rejects as
// "Bearer token required" — reproduced live 2026-09-04.

const express = require('express');
const request = require('supertest');

const GATEWAY_URL = 'https://mcpgw.test.example.com/opensearch22/mcp';
const GATEWAY_AUTH_URI = 'https://mcpgw.test.example.com/opensearch22/authorize';
const GATEWAY_TOKEN_URI = 'https://mcpgw.test.example.com/opensearch22/token';

const BROKER_URL = 'https://ai-demo.test.example.com/mcp-facade/opensearch/mcp';
const BROKER_AUTH_URI = 'https://ai-demo.test.example.com/oauth/authorize';
const BROKER_TOKEN_URI = 'https://ai-demo.test.example.com/oauth/token';

const mockRemember = jest.fn();
jest.mock('../../services/privilegeGatewaySession', () => ({
  remember: (...args) => mockRemember(...args),
  clear: jest.fn(),
  status: jest.fn(() => ({ ready: false, reason: 'no_session' })),
  getAccessToken: jest.fn(async () => null),
}));

function mockDiscovery(mcpUrl, authUri, tokenUri) {
  global.fetch = jest.fn(async (url) => {
    const body = String(url) === mcpUrl
      ? { authorization_uri: authUri, token_uri: tokenUri }
      : { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: 'openid' };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  });
}

function buildApp(sessionStore = {}) {
  jest.resetModules();
  mockRemember.mockClear();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'gateway-session-remember-test';
    req.session = sessionStore;
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

async function completeAuth(app, mcpUrl) {
  await request(app).post('/api/privilege-mcp/config').send({ mcpUrl, clientId: 'client-abc' }).expect(200);
  const startRes = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
  const authUrl = new URL(startRes.body.authUrl);
  const state = authUrl.searchParams.get('state');
  return request(app).get(`/api/privilege-mcp/auth/callback?code=code-1&state=${encodeURIComponent(state)}`);
}

describe('privilegeGatewaySession.remember() gating', () => {
  const origFetch = global.fetch;
  const origPrivilegeUrl = process.env.PRIVILEGE_MCPGW_URL;

  beforeEach(() => {
    process.env.PRIVILEGE_MCPGW_URL = GATEWAY_URL;
  });
  afterEach(() => {
    global.fetch = origFetch;
    process.env.PRIVILEGE_MCPGW_URL = origPrivilegeUrl;
    jest.restoreAllMocks();
  });

  test('remembers the token when the callback exchanged against the real gateway token endpoint', async () => {
    mockDiscovery(GATEWAY_URL, GATEWAY_AUTH_URI, GATEWAY_TOKEN_URI);
    const app = buildApp({});
    const res = await completeAuth(app, GATEWAY_URL);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth=success/);
    expect(mockRemember).toHaveBeenCalledTimes(1);
    expect(mockRemember.mock.calls[0][0].accessToken).toBe('access-1');
  });

  test('does NOT remember a broker-issued token, even though its resource is also named mcpgateway.ping.demo', async () => {
    mockDiscovery(BROKER_URL, BROKER_AUTH_URI, BROKER_TOKEN_URI);
    const app = buildApp({});
    const res = await completeAuth(app, BROKER_URL);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/auth=success/);
    expect(mockRemember).not.toHaveBeenCalled();
  });
});
