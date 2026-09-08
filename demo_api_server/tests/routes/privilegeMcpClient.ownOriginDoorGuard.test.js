'use strict';

// A façade/Direct door lives on THIS server's own public origin, and every one
// of them advertises its Authorization Server (RFC 9728). If one answers with no
// challenge it is broken — PingOne is never its AS.
//
// discoverAuth() used to fall through to the PingOne OIDC fallback anyway, which
// authorizes with session.config.clientId (PRIVILEGE_SSO_CLIENT_ID). That client
// does not exist in the demo's PingOne environment, so the browser landed on a
// PingOne error page reading only `code: NOT_FOUND` — naming neither the door
// nor the client. Measured live 2026-09-08 on /mcp-facade/banking/mcp, which
// answers 400 with no WWW-Authenticate because its upstream host was torn down.
//
// The fallback stays for the hosts it was written for (Privilege Cloud, a
// self-hosted gateway frontend); it just no longer applies to our own doors.

const express = require('express');
const request = require('supertest');

const PUBLIC_ORIGIN = 'https://local.ping-devops.com:4000';
const DOOR_URL = `${PUBLIC_ORIGIN}/mcp-facade/banking/mcp`;
const ENV_ID = '01d89b06-66d5-430e-9f28-65636843788b';
const AUTH_EP = `https://auth.pingone.com/${ENV_ID}/as/authorize`;
const TOKEN_EP = `https://auth.pingone.com/${ENV_ID}/as/token`;

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'own-origin-door-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function oidcMetadata() {
  const body = { authorization_endpoint: AUTH_EP, token_endpoint: TOKEN_EP };
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// What the live banking door actually returns: 400, no challenge header.
function noChallenge(status) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify({ error: 'upstream unavailable' }),
    json: async () => ({ error: 'upstream unavailable' }),
  };
}

describe('a door on our own origin never falls back to PingOne', () => {
  const originalFetch = global.fetch;
  const saved = {};

  beforeEach(() => {
    saved.pub = process.env.PUBLIC_APP_URL;
    saved.env = process.env.PRIVILEGE_SSO_ENV_ID;
    process.env.PUBLIC_APP_URL = PUBLIC_ORIGIN;
    process.env.PRIVILEGE_SSO_ENV_ID = ENV_ID;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (saved.pub === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = saved.pub;
    if (saved.env === undefined) delete process.env.PRIVILEGE_SSO_ENV_ID;
    else process.env.PRIVILEGE_SSO_ENV_ID = saved.env;
    jest.restoreAllMocks();
  });

  test('a facade door with no challenge errors by name instead of bouncing to PingOne', async () => {
    const app = buildApp();
    global.fetch = jest.fn(async (url) => {
      // toInternalMcpUrl rewrites our own origin to the plain-HTTP facade port.
      if (String(url).includes('/mcp-facade/banking/mcp')) return noChallenge(400);
      return oidcMetadata();
    });

    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: DOOR_URL, clientId: 'privilege-sso-client' })
      .expect(200);

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(500);

    // The error has to name the door and the reason — the whole point is that
    // `code: NOT_FOUND` from PingOne named neither.
    expect(res.body.error).toMatch(/mcp-facade\/banking/);
    expect(res.body.error).toMatch(/authorization server/i);
    expect(res.body.error).not.toMatch(/fetch failed/);
  });

  test('and it never authorizes against PingOne with the Privilege SSO client', async () => {
    const app = buildApp();
    const seen = [];
    global.fetch = jest.fn(async (url) => {
      seen.push(String(url));
      if (String(url).includes('/mcp-facade/banking/mcp')) return noChallenge(400);
      return oidcMetadata();
    });

    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: DOOR_URL, clientId: 'privilege-sso-client' })
      .expect(200);
    const res = await request(app).post('/api/privilege-mcp/auth/start').send({});

    expect(res.body.authUrl).toBeUndefined();
    expect(seen.some((u) => u.includes('auth.pingone.com'))).toBe(false);
  });

  test('an EXTERNAL unreachable door still uses the PingOne fallback (unchanged)', async () => {
    const app = buildApp();
    const external = 'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp';
    global.fetch = jest.fn(async (url) => {
      if (String(url) === external) throw new TypeError('fetch failed');
      return oidcMetadata();
    });

    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: external, clientId: 'client-abc' })
      .expect(200);

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    expect(res.body.authUrl).toContain(AUTH_EP);
  });
});
