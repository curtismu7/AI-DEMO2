'use strict';

// AGENT_GATEWAY_BROKER_CLIENT_ID names a client pre-registered on the demo's own
// Agent Gateway broker and nowhere else. It used to be applied to EVERY
// self-advertising authorization server, which handed the Privilege agentless
// gateway a client_id PingOne Privilege has never heard of — `unknown_client`,
// and agentless sign-in was impossible in Docker (the only place the var is set).
// The broker's own doors must still get it.

const express = require('express');
const request = require('supertest');

const BROKER_CLIENT = 'ai-demo-bff-audit';
const BROKER_AS = 'http://localhost:3005';

const PRIVILEGE_MCP_URL = 'https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp';
const PRIVILEGE_AUTH_URI = 'https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/authorize';
const PRIVILEGE_TOKEN_URI = 'https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/token';

const BROKER_MCP_URL = 'http://localhost:3002/mcp-facade/audit/mcp';
const BROKER_AUTH_URI = `${BROKER_AS}/oauth/authorize`;
const BROKER_TOKEN_URI = `${BROKER_AS}/oauth/token`;

function buildApp(sessionId) {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = sessionId;
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

// Discovery for a gateway that mints its own authorize/token endpoints
// (selfAdvertised), plus a DCR endpoint that hands back a fresh client.
function mockSelfAdvertisingGateway({ mcpUrl, authUri, tokenUri, dcrClientId }) {
  const registerUri = authUri.replace(/\/authorize$/, '/register');
  const calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(String(url));
    if (String(url) === mcpUrl) {
      return jsonResponse({ authorization_uri: authUri, token_uri: tokenUri });
    }
    if (String(url) === registerUri) {
      return jsonResponse({ client_id: dcrClientId, client_secret: 'dcr-secret' }, { status: 201 });
    }
    return jsonResponse({}, { status: 404 });
  });
  return { calls, registerUri };
}

async function startAuth(app, mcpUrl) {
  await request(app).post('/api/privilege-mcp/config')
    .send({ mcpUrl, clientId: 'pingone-app-id' })
    .expect(200);
  const start = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
  return new URL(start.body.authUrl);
}

describe('broker client id is scoped to the Agent Gateway broker', () => {
  const savedEnv = { ...process.env };
  const savedFetch = global.fetch;

  beforeEach(() => {
    process.env.AGENT_GATEWAY_BROKER_CLIENT_ID = BROKER_CLIENT;
    delete process.env.MCP_FACADE_AGENT_GATEWAY_AS;
    delete process.env.MCP_FACADE_AGENT_GATEWAY_AS_INTERNAL;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    global.fetch = savedFetch;
  });

  test('Privilege agentless gateway uses its own DCR client, not the broker client', async () => {
    const { registerUri } = mockSelfAdvertisingGateway({
      mcpUrl: PRIVILEGE_MCP_URL,
      authUri: PRIVILEGE_AUTH_URI,
      tokenUri: PRIVILEGE_TOKEN_URI,
      dcrClientId: 'privilege-dcr-client',
    });

    const authUrl = await startAuth(buildApp('privilege-broker-scope'), PRIVILEGE_MCP_URL);

    expect(authUrl.origin).toBe('https://cmuir-agentless-mcpgw.ping-devops.com');
    expect(authUrl.searchParams.get('client_id')).toBe('privilege-dcr-client');
    expect(authUrl.searchParams.get('client_id')).not.toBe(BROKER_CLIENT);
    expect(global.fetch.mock.calls.map((c) => String(c[0]))).toContain(registerUri);
  });

  test("the broker's own door still uses the pre-registered broker client", async () => {
    mockSelfAdvertisingGateway({
      mcpUrl: BROKER_MCP_URL,
      authUri: BROKER_AUTH_URI,
      tokenUri: BROKER_TOKEN_URI,
      dcrClientId: 'should-not-be-used',
    });

    const authUrl = await startAuth(buildApp('broker-door-scope'), BROKER_MCP_URL);

    expect(authUrl.searchParams.get('client_id')).toBe(BROKER_CLIENT);
    // The broker client short-circuits DCR entirely.
    expect(global.fetch.mock.calls.map((c) => String(c[0])))
      .not.toContain(`${BROKER_AS}/oauth/register`);
  });
});
