'use strict';

// /auth/start and /chat used to take the OAuth callback host (and scheme)
// straight from X-Forwarded-Host/-Proto. That header decides where the gateway
// delivers the authorization code, and every distinct value cost one gateway
// /register call plus one dcrClientCache entry that was never evicted. The
// forwarded origin may now only choose among origins configuration names.

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://mcpgw.example.com/opensearch22/mcp';
const AUTH_URI = 'https://mcpgw.example.com/opensearch22/authorize';
const TOKEN_URI = 'https://mcpgw.example.com/opensearch22/token';
const REGISTER_URI = 'https://mcpgw.example.com/opensearch22/register';
const CALLBACK_PATH = '/api/privilege-mcp/auth/callback';
const ENV_KEYS = ['PRIVILEGE_MCP_CALLBACK_HOST', 'PUBLIC_APP_URL', 'CORS_ORIGIN'];

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-callback-origin-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return { app, cache: router.__test.dcrClientCache };
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

// Any door: <origin>/<app>/mcp advertises its own /authorize, /token, /register.
function gatewayFetch(registerBodies) {
  let issued = 0;
  return jest.fn(async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/mcp')) {
      const base = target.replace(/\/mcp$/, '');
      return jsonResponse({ authorization_uri: `${base}/authorize`, token_uri: `${base}/token` });
    }
    if (target.endsWith('/register')) {
      registerBodies.push(JSON.parse(options.body));
      issued += 1;
      return jsonResponse({ client_id: `dcr-client-${issued}` });
    }
    // The liveness probe: the client is known, only the code is bad.
    return { ok: false, status: 400, headers: { get: () => null }, text: async () => 'Invalid or expired authorization code' };
  });
}

async function configure(app, mcpUrl = MCP_URL) {
  await request(app).post('/api/privilege-mcp/config').send({ mcpUrl }).expect(200);
}

async function startAuth(app, headers = {}) {
  const res = await request(app).post('/api/privilege-mcp/auth/start').set(headers).send({}).expect(200);
  return new URL(res.body.authUrl).searchParams.get('redirect_uri');
}

describe('privilege MCP client OAuth callback origin', () => {
  const originalFetch = global.fetch;
  let originalEnv;
  let registerBodies;

  beforeEach(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    registerBodies = [];
    global.fetch = gatewayFetch(registerBodies);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  test('a forged X-Forwarded-Host on /auth/start does not become the redirect URI', async () => {
    const { app } = buildApp();
    await configure(app);

    const redirectUri = await startAuth(app, { 'X-Forwarded-Host': 'attacker.example.com', 'X-Forwarded-Proto': 'https' });

    expect(redirectUri).toBe(`https://local.ping-devops.com:4000${CALLBACK_PATH}`);
    expect(JSON.stringify(registerBodies)).not.toContain('attacker.example.com');
  });

  test('distinct forged hosts and schemes cost no extra registration or cache entry', async () => {
    const { app, cache } = buildApp();
    await configure(app);

    await startAuth(app);
    await startAuth(app, { 'X-Forwarded-Host': 'attacker-1.example.com', 'X-Forwarded-Proto': 'https' });
    await startAuth(app, { 'X-Forwarded-Host': 'attacker-2.example.com', 'X-Forwarded-Proto': 'https' });
    await startAuth(app, { 'X-Forwarded-Host': 'local.ping-devops.com:4000', 'X-Forwarded-Proto': 'forged-scheme' });

    expect(global.fetch.mock.calls.filter(([url]) => String(url) === REGISTER_URI)).toHaveLength(1);
    expect(cache.size).toBe(1);
  });

  test('a forged X-Forwarded-Host on /chat does not become the redirect URI', async () => {
    const { app } = buildApp();
    await configure(app);

    const res = await request(app).post('/api/privilege-mcp/chat')
      .set('X-Forwarded-Host', 'attacker.example.com')
      .set('X-Forwarded-Proto', 'https')
      .send({ prompt: 'hi' })
      .expect(200);

    expect(new URL(res.body.authUrl).searchParams.get('redirect_uri')).toBe(`https://local.ping-devops.com:4000${CALLBACK_PATH}`);
  });

  test('with no forwarded host the callback is the configured host', async () => {
    const { app } = buildApp();
    await configure(app);
    expect(await startAuth(app)).toBe(`https://local.ping-devops.com:4000${CALLBACK_PATH}`);

    process.env.PRIVILEGE_MCP_CALLBACK_HOST = 'demo.example.com:8443';
    expect(await startAuth(app)).toBe(`https://demo.example.com:8443${CALLBACK_PATH}`);
  });

  test.each([
    ['the local sign-in host', 'local.ping-devops.com:4000', {}],
    ['the local API host', 'api.ping.demo:4000', {}],
    ['the SE host named by PUBLIC_APP_URL', 'ai-demo.ping-devops.com', { PUBLIC_APP_URL: 'https://ai-demo.ping-devops.com/' }],
    ['a host named by CORS_ORIGIN', 'other.example.com:4000', { CORS_ORIGIN: 'https://local.ping-devops.com:4000, https://other.example.com:4000' }],
    ['PRIVILEGE_MCP_CALLBACK_HOST itself', 'demo.example.com:8443', { PRIVILEGE_MCP_CALLBACK_HOST: 'demo.example.com:8443' }],
  ])('a forwarded host that is %s is still used', async (_label, host, env) => {
    Object.assign(process.env, env);
    const { app } = buildApp();
    await configure(app);

    const redirectUri = await startAuth(app, { 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https' });

    expect(redirectUri).toBe(`https://${host}${CALLBACK_PATH}`);
    expect(registerBodies[0].redirect_uris).toEqual([redirectUri]);
  });

  test('the registration cache stays bounded when callers keep naming new gateways', async () => {
    const { app, cache } = buildApp();

    for (let i = 0; i < 105; i += 1) {
      await configure(app, `https://mcpgw.example.com/app-${i}/mcp`);
      await startAuth(app);
    }

    expect(registerBodies).toHaveLength(105);
    expect(cache.size).toBeLessThanOrEqual(100);
    // Oldest out: the most recent registration is still cached.
    expect([...cache.keys()].some((key) => key.includes('/app-104/'))).toBe(true);
  });
});
