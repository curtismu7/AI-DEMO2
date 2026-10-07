'use strict';

// Client identity mode on the Privilege MCP client: 'dcr' registers with the gateway (the default and the
// behaviour before this existed); 'cimd' presents the URL of our client document as the client_id instead,
// so nothing is registered and the token request carries no secret.

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://mcpgw.example.com/opensearch22/mcp';
const BASE = 'https://mcpgw.example.com/opensearch22';
const DOC_URL = 'https://local.ping-devops.com:4000/api/cimd/privilege/privilege-mcp-client/client-metadata.json';
const ENV_KEYS = ['PRIVILEGE_MCP_CALLBACK_HOST', 'PUBLIC_APP_URL', 'CORS_ORIGIN', 'PINGONE_MCP_GATEWAY_CLIENT_SECRET', 'PRIVILEGE_SSO_CLIENT_SECRET'];

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-cimd-signin-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
  json: async () => body
});

// A gateway whose AS metadata says whether it takes client documents.
function gatewayFetch({ supportsCimd, seen }) {
  return jest.fn(async (url, options = {}) => {
    const target = String(url);
    seen.push({ target, options });
    if (target.endsWith('/mcp')) return json({ authorization_uri: `${BASE}/authorize`, token_uri: `${BASE}/token` });
    if (target.endsWith('/.well-known/oauth-authorization-server')) {
      return json({ client_id_metadata_document_supported: supportsCimd ? true : undefined });
    }
    if (target.endsWith('/register')) return json({ client_id: 'dcr-client-1' });
    if (target.endsWith('/token')) {
      const body = String(options.body || '');
      // The DCR liveness probe is a token call with a placeholder code; the real exchange carries the real one.
      return body.includes('dcr-liveness-probe')
        ? { ok: false, status: 400, headers: { get: () => null }, text: async () => 'Invalid or expired authorization code' }
        : json({ access_token: 'access-token', token_type: 'Bearer', expires_in: 3600 });
    }
    return json({}, 404);
  });
}

async function configure(app) {
  await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: MCP_URL }).expect(200);
}

describe('privilege MCP client identity mode', () => {
  const originalFetch = global.fetch;
  let originalEnv;
  let seen;

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    seen = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  test('defaults to dynamic registration, exactly as before', async () => {
    global.fetch = gatewayFetch({ supportsCimd: true, seen });
    const app = buildApp();
    await configure(app);

    const state = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(state.body.clientIdentity).toBe('dcr');

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    expect(new URL(res.body.authUrl).searchParams.get('client_id')).toBe('dcr-client-1');
    expect(seen.some((s) => s.target.endsWith('/register'))).toBe(true);
  });

  test('cimd: the client_id is our document URL and nothing is registered', async () => {
    global.fetch = gatewayFetch({ supportsCimd: true, seen });
    const app = buildApp();
    await configure(app);
    await request(app).post('/api/privilege-mcp/client-identity').send({ mode: 'cimd' }).expect(200);

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    const authUrl = new URL(res.body.authUrl);
    expect(authUrl.searchParams.get('client_id')).toBe(DOC_URL);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://local.ping-devops.com:4000/api/privilege-mcp/auth/callback');
    expect(seen.some((s) => s.target.endsWith('/register'))).toBe(false);
  });

  test('cimd refuses, before any redirect, when the gateway does not advertise support', async () => {
    global.fetch = gatewayFetch({ supportsCimd: false, seen });
    const app = buildApp();
    await configure(app);
    await request(app).post('/api/privilege-mcp/client-identity').send({ mode: 'cimd' }).expect(200);

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(500);
    expect(res.body.error).toMatch(/does not advertise client_id_metadata_document_supported/);
    expect(seen.some((s) => s.target.endsWith('/register'))).toBe(false);
  });

  test('cimd token exchange is a public client: no secret, even with unrelated secrets in the environment', async () => {
    process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET = 'unrelated-pingone-secret';
    process.env.PRIVILEGE_SSO_CLIENT_SECRET = 'another-unrelated-secret';
    global.fetch = gatewayFetch({ supportsCimd: true, seen });
    const app = buildApp();
    await configure(app);
    await request(app).post('/api/privilege-mcp/client-identity').send({ mode: 'cimd' }).expect(200);
    const start = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    const state = new URL(start.body.authUrl).searchParams.get('state');

    await request(app).get('/api/privilege-mcp/auth/callback').query({ code: 'real-code', state });

    const exchange = seen.find((s) => s.target.endsWith('/token') && String(s.options.body || '').includes('real-code'));
    expect(exchange).toBeTruthy();
    const body = new URLSearchParams(String(exchange.options.body));
    expect(body.get('client_id')).toBe(DOC_URL);
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.has('client_secret')).toBe(false);
  });

  test('an unknown mode is a 400 and leaves the current mode alone', async () => {
    global.fetch = gatewayFetch({ supportsCimd: true, seen });
    const app = buildApp();
    await configure(app);
    await request(app).post('/api/privilege-mcp/client-identity').send({ mode: 'cimd' }).expect(200);
    await request(app).post('/api/privilege-mcp/client-identity').send({ mode: 'whatever' }).expect(400);
    const state = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(state.body.clientIdentity).toBe('cimd');
  });
});
