'use strict';

// /facade-link chains the Privilege gateway sign-in into an MCP client's own
// OAuth: the broker (demo_mcp_gateway) sends the browser here after its
// PingOne hop, the BFF signs it in to the gateway for one Agentic App, and
// hands it back to the broker's /oauth/resume. See
// docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md.

const express = require('express');
const request = require('supertest');

const GATEWAY = 'https://mcpgw.test.example.com';
const APP_URL = `${GATEWAY}/opensearch/mcp`;
const AUTH_URI = `${GATEWAY}/opensearch/authorize`;
const TOKEN_URI = `${GATEWAY}/opensearch/token`;
const RESUME = 'http://localhost:3005/oauth/resume?rs=parked-1';
const SID = 'facade-link-test';

const mockRemember = jest.fn();
jest.mock('../../services/privilegeGatewaySession', () => ({
  remember: (...args) => mockRemember(...args),
  clear: jest.fn(),
  clearAll: jest.fn(),
  status: jest.fn(() => ({ ready: false, reason: 'no_session' })),
  statusAll: jest.fn(() => ({})),
  getAccessToken: jest.fn(async () => null),
  defaultApp: () => 'opensearch22',
}));

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

// A self-advertising gateway: each app answers discovery on /<app>/mcp,
// registers DCR clients on /<app>/register, and redeems codes on /<app>/token.
function gatewayFetch({ tokenStatus = 200 } = {}) {
  let registered = 0;
  return jest.fn(async (url, options = {}) => {
    const [, , , app, leaf] = String(url).split('/');
    if (leaf === 'mcp') {
      return jsonResponse({ authorization_uri: `${GATEWAY}/${app}/authorize`, token_uri: `${GATEWAY}/${app}/token` });
    }
    if (leaf === 'register') {
      registered += 1;
      return jsonResponse({ client_id: `dcr-link-${registered}` });
    }
    if (leaf === 'token') {
      if (String(options.body || '').includes('dcr-liveness-probe')) return jsonResponse({ error: 'invalid_grant' }, 400);
      return tokenStatus === 200
        ? jsonResponse({ access_token: 'gateway-token', expires_in: 3600 })
        : jsonResponse({ error: 'invalid_grant' }, tokenStatus);
    }
    return jsonResponse({});
  });
}

function buildApp(sessionStore) {
  jest.resetModules();
  mockRemember.mockClear();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = SID;
    req.session = sessionStore;
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function startLink(app, query) {
  return request(app).get('/api/privilege-mcp/facade-link').query(query);
}

const origFetch = global.fetch;
const origGatewayUrl = process.env.PRIVILEGE_MCPGW_URL;
const origGatewayBase = process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE;

beforeEach(() => {
  process.env.PRIVILEGE_MCPGW_URL = `${GATEWAY}/opensearch22/mcp`;
  process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE = GATEWAY;
  global.fetch = gatewayFetch();
});
afterEach(() => {
  global.fetch = origFetch;
  if (origGatewayUrl === undefined) delete process.env.PRIVILEGE_MCPGW_URL;
  else process.env.PRIVILEGE_MCPGW_URL = origGatewayUrl;
  if (origGatewayBase === undefined) delete process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE;
  else process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE = origGatewayBase;
  jest.restoreAllMocks();
});

describe('gatewayAppFromUrl', () => {
  test('reads the app segment, not the first path segment', () => {
    jest.resetModules();
    const { gatewayAppFromUrl } = require('../../routes/privilegeMcpClient').__test;
    expect(gatewayAppFromUrl('https://gw/opensearch22/mcp')).toBe('opensearch22');
    expect(gatewayAppFromUrl('https://gw/mcp')).toBeNull();
    expect(gatewayAppFromUrl('https://gw/mcpgw/opensearch22/mcp')).toBe('opensearch22');
    expect(gatewayAppFromUrl('not a url')).toBeNull();
  });
});

describe('GET /api/privilege-mcp/facade-link', () => {
  test('refuses a resume URL that is not the broker\'s own /oauth/resume', async () => {
    const app = buildApp({});
    for (const resume of [
      'https://attacker.example.com/oauth/resume?rs=x',
      'http://localhost:3005/oauth/callback?rs=x',
      'http://localhost:3005/oauth/resume',
      'not a url',
    ]) {
      const res = await startLink(app, { app: 'opensearch', resume });
      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
    }
  });

  test('refuses an app name that is not a plain name', async () => {
    const res = await startLink(buildApp({}), { app: '../admin', resume: RESUME });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  test('a repeated app parameter is a 400, not the default app', async () => {
    const res = await request(buildApp({}))
      .get(`/api/privilege-mcp/facade-link?app=a&app=b&resume=${encodeURIComponent(RESUME)}`);
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  test('a gateway that cannot be discovered goes back to the broker as link=error', async () => {
    process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE = 'not a url';
    const res = await startLink(buildApp({}), { app: 'opensearch', resume: RESUME });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('http://localhost:3005/oauth/resume');
    expect(location.searchParams.get('link')).toBe('error');
    expect(location.searchParams.get('reason')).toBeTruthy();
    expect(mockRemember).not.toHaveBeenCalled();
  });

  test('sends the browser to the gateway sign-in for that app, in its own session slot', async () => {
    // Main-app OAuth tokens on the session are what make beginOAuthFlow set
    // prompt=none in the first place — an empty session never would, so the
    // prompt assertion below would pass either way. Seed one so removing it
    // actually proves something.
    const session = { oauthTokens: { accessToken: 'main-app-token' } };
    const res = await startLink(buildApp(session), { app: 'opensearch', resume: RESUME });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(AUTH_URI);
    expect(location.searchParams.get('client_id')).toBe('dcr-link-1');
    expect(location.searchParams.get('redirect_uri')).toMatch(/\/api\/privilege-mcp\/facade-link\/callback$/);
    expect(location.searchParams.get('prompt')).toBeNull();
    expect(session.privilegeFacadeLink).toMatchObject({ app: 'opensearch', resume: RESUME, tokenUri: TOKEN_URI });
    expect(session.privilegeFacadeLink.oauthState).toBe(location.searchParams.get('state'));
  });

  test('signs in to the gateway the façade calls, not PRIVILEGE_MCPGW_URL', async () => {
    process.env.PRIVILEGE_MCPGW_URL = 'https://other-gateway.example.com/opensearch22/mcp';
    const res = await startLink(buildApp({}), { app: 'opensearch', resume: RESUME });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(AUTH_URI);
    // The discovery mock answers from the app/leaf path alone, regardless of
    // host, so the location assertion above can't tell a wrong-gateway
    // discovery fetch from a right one — assert directly on which origin was
    // actually dialed for discovery.
    const discoveryUrl = String(global.fetch.mock.calls[0][0]);
    expect(discoveryUrl.startsWith(GATEWAY)).toBe(true);
    expect(discoveryUrl.startsWith('https://other-gateway.example.com')).toBe(false);
  });

  test('no app means the default app, as the façade reads its bare door', async () => {
    const res = await startLink(buildApp({}), { resume: RESUME });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).pathname).toBe('/opensearch22/authorize');
  });

  test('leaves a sign-in in flight on /privilege-mcp-client, and its selected door, untouched', async () => {
    const session = {};
    const app = buildApp(session);
    const pageDoor = `${GATEWAY}/opensearch22/mcp`;
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: pageDoor, clientId: 'client-abc' }).expect(200);
    const start = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    const pageState = new URL(start.body.authUrl).searchParams.get('state');

    await startLink(app, { app: 'opensearch', resume: RESUME }).expect(302);

    const { getClientSession } = require('../../routes/privilegeMcpClient').__test;
    const page = getClientSession({ sessionID: SID, session });
    expect(page.config.mcpUrl).toBe(pageDoor);
    expect(page.pendingAuth.oauthState).toBe(pageState);
  });

  test('registers its own gateway client for the link callback', async () => {
    const app = buildApp({});
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: APP_URL, clientId: 'client-abc' }).expect(200);
    const start = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    const pageClient = new URL(start.body.authUrl).searchParams.get('client_id');

    const res = await startLink(app, { app: 'opensearch', resume: RESUME }).expect(302);
    const linkClient = new URL(res.headers.location).searchParams.get('client_id');

    // The gateway binds a DCR client to its registered redirect URI; reusing
    // the page's client would send the gateway's callback to /auth/callback.
    expect(linkClient).not.toBe(pageClient);
  });
});

describe('GET /api/privilege-mcp/facade-link/callback', () => {
  async function linked({ tokenStatus } = {}) {
    global.fetch = gatewayFetch({ tokenStatus });
    const session = {};
    const app = buildApp(session);
    const res = await startLink(app, { app: 'opensearch', resume: RESUME }).expect(302);
    return { app, state: new URL(res.headers.location).searchParams.get('state') };
  }

  function callback(app, query) {
    return request(app).get('/api/privilege-mcp/facade-link/callback').query(query);
  }

  test('stores the gateway token for that app and hands the browser back to the broker', async () => {
    const { app, state } = await linked();
    const res = await callback(app, { code: 'gw-code', state });

    expect(res.status).toBe(302);
    const back = new URL(res.headers.location);
    expect(back.origin + back.pathname).toBe('http://localhost:3005/oauth/resume');
    expect(back.searchParams.get('rs')).toBe('parked-1');
    expect(back.searchParams.get('link')).toBe('ok');
    expect(mockRemember).toHaveBeenCalledWith(expect.objectContaining({
      app: 'opensearch', accessToken: 'gateway-token', tokenUri: TOKEN_URI, clientId: 'dcr-link-1',
    }));
  });

  test('a state mismatch goes back to the broker as link=error and stores nothing', async () => {
    const { app } = await linked();
    const back = new URL((await callback(app, { code: 'gw-code', state: 'forged' })).headers.location);
    expect(back.searchParams.get('link')).toBe('error');
    expect(back.searchParams.get('reason')).toMatch(/state/i);
    expect(mockRemember).not.toHaveBeenCalled();
  });

  test('a gateway error goes back to the broker as link=error', async () => {
    const { app, state } = await linked();
    const back = new URL((await callback(app, { error: 'access_denied', error_description: 'policy', state })).headers.location);
    expect(back.searchParams.get('link')).toBe('error');
    expect(back.searchParams.get('reason')).toBe('access_denied: policy');
  });

  test('an issuer mismatch goes back to the broker as link=error and stores nothing', async () => {
    const { app, state } = await linked();
    const back = new URL((await callback(app, { code: 'gw-code', state, iss: 'https://evil.example.com' })).headers.location);
    expect(back.searchParams.get('link')).toBe('error');
    expect(back.searchParams.get('reason')).toMatch(/issuer/i);
    expect(mockRemember).not.toHaveBeenCalled();
  });

  test('a failed token exchange goes back to the broker as link=error', async () => {
    const { app, state } = await linked({ tokenStatus: 400 });
    const back = new URL((await callback(app, { code: 'gw-code', state })).headers.location);
    expect(back.searchParams.get('link')).toBe('error');
    expect(mockRemember).not.toHaveBeenCalled();
  });

  test('is single-use, and a callback with no link in progress is a 400, not a redirect', async () => {
    const { app, state } = await linked();
    await callback(app, { code: 'gw-code', state }).expect(302);

    const again = await callback(app, { code: 'gw-code', state });
    expect(again.status).toBe(400);
    expect(again.headers.location).toBeUndefined();
  });
});
