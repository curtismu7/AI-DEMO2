'use strict';

// 2026-09-07 — every path and every door on /privilege-mcp-client was broken.
// Two independent root causes, both guarded here. Neither was caught by any
// existing test, because both only appear when a REAL request leaves this
// process: one is about which token gets attached, the other about which host
// gets dialled.
//
// A. getClientSession() seeded session.oauth.accessToken from the main banking
//    app's user token (req.session.oauthTokens.accessToken, aud
//    enduser.ping.demo). No door on this page accepts that audience — the
//    façade doors and oauth-mcp want mcpgateway.ping.demo, and the Privilege AI
//    Gateway only accepts a token it minted itself. So the Privilege path 401'd
//    "Bearer token required" on every door. Worse, /state reports
//    `authenticated: Boolean(session.oauth.accessToken)`, so the page thought it
//    was signed in and never ran the silent sign-in that would have fixed it.
//
// B. The Direct and Façade door URLs are built from PUBLIC_APP_ORIGIN() — right
//    for the browser, wrong for this process, which fetches those doors itself.
//    With PUBLIC_APP_URL=https://local.ping-devops.com:4000 that name resolves
//    to 127.0.0.1 inside the BFF container, where nothing listens on 4000:
//    every Direct/Façade door died with `fetch failed`, and Façade sign-in then
//    fell through to PingOne and bounced the browser to a NOT_FOUND page.

const express = require('express');
const request = require('supertest');

const PUBLIC_ORIGIN = 'https://local.ping-devops.com:4000';
const FACADE_DOOR = `${PUBLIC_ORIGIN}/mcp-facade/opensearch/mcp`;
const GATEWAY_DOOR = 'https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp';
const APP_TOKEN = 'main-app-token-aud-enduser-ping-demo';

let sessionSeq = 0;

function buildApp({ withAppSession = true } = {}) {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  // One id for the life of this app, not one per request: the route keys its
  // in-memory client session off sessionID, so a fresh id per request would
  // silently discard every POST /config and leave each test on the defaults.
  const sid = `door-reach-${sessionSeq += 1}`;
  app.use((req, _res, next) => {
    req.sessionID = sid;
    req.session = withAppSession
      ? { oauthTokens: { accessToken: APP_TOKEN } }
      : {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => JSON.stringify(body),
  };
}

describe('privilege-mcp-client door reachability (2026-09-07 regression)', () => {
  const envBackup = {};
  beforeEach(() => {
    for (const key of ['PUBLIC_APP_URL', 'MCP_FACADE_HTTP_PORT']) envBackup[key] = process.env[key];
    process.env.PUBLIC_APP_URL = PUBLIC_ORIGIN;
    process.env.MCP_FACADE_HTTP_PORT = '3002';
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete global.fetch;
  });

  // ---- A. the main app's token is not a gateway credential --------------

  test('the main app session does NOT make the page look authenticated', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    // The whole auto-connect contract: mainAppAuthenticated true (so the page
    // knows it MAY silently sign in) while oauth.authenticated stays false (so
    // it actually does). Seeding the app token inverted the second one and the
    // sign-in never ran.
    expect(res.body.mainAppAuthenticated).toBe(true);
    expect(res.body.oauth.authenticated).toBe(false);
  });

  test('the main app token is never attached to a gateway request', async () => {
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: GATEWAY_DOOR, clientId: 'client-abc' })
      .expect(200);

    global.fetch = jest.fn(async () => jsonResponse({ result: { tools: [] } }));

    // With no real gateway token the relay must refuse locally rather than
    // spend the app's token upstream: that 401 is what triggers sign-in.
    await request(app).post('/api/privilege-mcp/tools/list').send({}).expect(401);

    const sentAuthHeaders = global.fetch.mock.calls
      .map(([, init]) => init?.headers?.Authorization)
      .filter(Boolean);
    expect(sentAuthHeaders.every((h) => !h.includes(APP_TOKEN))).toBe(true);
  });

  // ---- B. self-called doors go to the loopback listener ------------------

  test('a façade door is fetched on the internal listener, not the public host', async () => {
    const app = buildApp({ withAppSession: false });
    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: FACADE_DOOR, clientId: 'client-abc' })
      .expect(200);

    global.fetch = jest.fn(async () => jsonResponse(
      { authorization_uri: 'https://as.example/authorize', token_uri: 'https://as.example/token' },
    ));

    await request(app).post('/api/privilege-mcp/auth/start').send({});

    const dialled = global.fetch.mock.calls.map(([url]) => String(url));
    expect(dialled.length).toBeGreaterThan(0);
    // The public origin is what the operator SEES; it must never be what we DIAL.
    expect(dialled.some((u) => u.startsWith(PUBLIC_ORIGIN))).toBe(false);
    expect(dialled.some((u) => u === 'http://localhost:3002/mcp-facade/opensearch/mcp')).toBe(true);
  });

  test('the door the operator selected is still what /state reports', async () => {
    const app = buildApp({ withAppSession: false });
    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: FACADE_DOOR, clientId: 'client-abc' })
      .expect(200);

    // The rewrite is a fetch-time detail. If it ever leaks into stored config,
    // the page's door picker (which groups doors by origin) loses the door and
    // the operator sees a localhost URL they cannot share.
    const res = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(res.body.config.mcpUrl).toBe(FACADE_DOOR);
  });

  test('an external door is dialled exactly as configured', async () => {
    const app = buildApp({ withAppSession: false });
    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: GATEWAY_DOOR, clientId: 'client-abc' })
      .expect(200);

    global.fetch = jest.fn(async () => jsonResponse(
      { authorization_uri: 'https://as.example/authorize', token_uri: 'https://as.example/token' },
    ));

    await request(app).post('/api/privilege-mcp/auth/start').send({});

    const dialled = global.fetch.mock.calls.map(([url]) => String(url));
    // The rewrite must be scoped to our own origin — never redirect a Privilege
    // or PingOne host at the loopback listener.
    expect(dialled.some((u) => u.startsWith('http://localhost:3002'))).toBe(false);
    expect(dialled.some((u) => u.startsWith(GATEWAY_DOOR))).toBe(true);
  });
});
