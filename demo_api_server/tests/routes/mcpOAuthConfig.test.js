'use strict';

// Illustrative OAuth-config admin route for banking-mcp: save/read config
// (secret masked), and a Test Connection that mints a real token then calls
// the live Privilege gateway door and passes its status straight through —
// per privilege/CURRENT-CONFIGURATION.md that's expected to be a 401 today,
// and the route must report that honestly rather than swallowing it as a
// 500 or faking a success.

const express = require('express');
const request = require('supertest');

function buildApp() {
  const router = require('../../routes/mcpOAuthConfig');
  const app = express();
  app.use(express.json());
  app.use('/api/mcp-oauth-config', router);
  return app;
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

describe('mcp OAuth config route', () => {
  const lmdb = require('../../services/lmdb/mcpOAuthConfigStore.lmdb');
  const originalFetch = global.fetch;

  beforeEach(() => {
    lmdb.deleteConfig('banking-mcp');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('GET returns an empty config with no secret before anything is saved', async () => {
    const res = await request(buildApp()).get('/api/mcp-oauth-config').expect(200);
    expect(res.body).toEqual({
      clientId: '', issuer: '', tokenEndpoint: '', scopes: '', audience: '', hasClientSecret: false,
    });
  });

  test('PUT saves config and never echoes the secret back', async () => {
    const res = await request(buildApp())
      .put('/api/mcp-oauth-config')
      .send({
        clientId: 'client-1',
        clientSecret: 'super-secret',
        issuer: 'https://auth.pingone.com/env-1/as',
        tokenEndpoint: 'https://auth.pingone.com/env-1/as/token',
        scopes: 'read mcp:invoke',
        audience: 'mcpgateway.ping.demo',
      })
      .expect(200);

    expect(res.body.hasClientSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('super-secret');
  });

  test('POST /test with nothing saved fails with a named cause, not a crash', async () => {
    const res = await request(buildApp()).post('/api/mcp-oauth-config/test').expect(400);
    expect(res.body.error).toMatch(/clientId|clientSecret|tokenEndpoint/i);
  });

  test('POST /test mints a token then reports the live gateway door status as-is', async () => {
    await request(buildApp()).put('/api/mcp-oauth-config').send({
      clientId: 'client-1',
      clientSecret: 'super-secret',
      issuer: 'https://auth.pingone.com/env-1/as',
      tokenEndpoint: 'https://auth.pingone.com/env-1/as/token',
      scopes: 'read mcp:invoke',
      audience: 'mcpgateway.ping.demo',
    });

    const calls = [];
    global.fetch = jest.fn(async (url, opts) => {
      calls.push({ url, opts });
      if (calls.length === 1) {
        return jsonResponse(200, { access_token: 'tok-1', expires_in: 3600 });
      }
      // The documented, currently-expected result against the live door.
      return jsonResponse(401, { error: 'invalid_token', error_description: 'Bearer token required' });
    });

    const res = await request(buildApp()).post('/api/mcp-oauth-config/test').expect(200);

    expect(res.body.step).toBe('mcp');
    expect(res.body.status).toBe(401);
    expect(res.body.body.error).toBe('invalid_token');

    const tokenCall = calls[0];
    expect(tokenCall.url).toBe('https://auth.pingone.com/env-1/as/token');
    expect(tokenCall.opts.body.toString()).toContain('grant_type=client_credentials');

    const mcpCall = calls[1];
    expect(mcpCall.url).toBe('https://mcpgw.ai-demo.ping-devops.com/banking-mcp/mcp');
    expect(mcpCall.opts.headers.Authorization).toBe('Bearer tok-1');
  });

  test('POST /test surfaces a token-mint failure without calling the gateway', async () => {
    await request(buildApp()).put('/api/mcp-oauth-config').send({
      clientId: 'bad-client',
      clientSecret: 'bad-secret',
      issuer: 'https://auth.pingone.com/env-1/as',
      tokenEndpoint: 'https://auth.pingone.com/env-1/as/token',
      scopes: 'read',
      audience: 'mcpgateway.ping.demo',
    });

    global.fetch = jest.fn(async () => jsonResponse(400, { error: 'invalid_client' }));

    const res = await request(buildApp()).post('/api/mcp-oauth-config/test').expect(200);

    expect(res.body.step).toBe('token');
    expect(res.body.status).toBe(400);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
