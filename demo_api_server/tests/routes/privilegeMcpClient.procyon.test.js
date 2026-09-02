'use strict';

// The agent-based AI Gateway publishes per-app frontends under
// *.applications.procyon.ai, where the workstation's Priv Agent supplies the
// caller's identity. The relay must let those through without a Privilege SSO
// sign-in and without an Authorization header (a PingOne bearer would only hit
// the gateway's kid wall) — while every other gateway URL keeps requiring
// sign-in exactly as before.

const express = require('express');
const request = require('supertest');

const PROCYON_URL = 'https://opensearch.default.applications.procyon.ai:8643/mcp';
const OTHER_MCP_URL = 'https://privilege.pingone.com/api/mcp';
const TOKEN_URI = 'https://auth.pingone.com/test-env/as/token';
const AUTH_URI = 'https://auth.pingone.com/test-env/as/authorize';

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-procyon-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

// JSON-RPC MCP server: answers initialize / notifications/initialized /
// tools/list. Shape mirrors what decodeMcpBody expects.
function mcpFetchMock() {
  return jest.fn(async (url, opts = {}) => {
    const body = JSON.parse(opts.body || '{}');
    const result = body.method === 'tools/list'
      ? { tools: [{ name: 'search_index', description: '', inputSchema: {} }] }
      : { protocolVersion: '2024-11-05', capabilities: {} };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result }),
      json: async () => ({}),
    };
  });
}

function authHeadersSent(fetchMock) {
  return fetchMock.mock.calls
    .map(([, opts]) => opts?.headers?.Authorization)
    .filter(Boolean);
}

describe('procyon agent-gateway frontends relay without Privilege SSO', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('tools/list against a procyon frontend needs no sign-in and sends no Authorization', async () => {
    const app = buildApp();
    global.fetch = mcpFetchMock();

    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: PROCYON_URL }).expect(200);
    const res = await request(app).post('/api/privilege-mcp/tools/list').send({});

    expect(res.status).toBe(200);
    expect(res.body.tools).toHaveLength(1);
    expect(authHeadersSent(global.fetch)).toHaveLength(0);
    // The dispatcher is the reachability mechanism from inside Docker
    // (host.docker.internal + relaxed TLS for the procyon TenantRoot chain).
    for (const [, opts] of global.fetch.mock.calls) {
      expect(opts.dispatcher).toBeDefined();
    }
  });

  test('a non-procyon URL still requires sign-in', async () => {
    const app = buildApp();
    global.fetch = mcpFetchMock();

    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: OTHER_MCP_URL }).expect(200);
    const res = await request(app).post('/api/privilege-mcp/tools/list').send({});

    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an existing Privilege SSO token is not forwarded to a procyon frontend', async () => {
    const app = buildApp();

    // Sign in against a normal gateway first (discovery -> code exchange).
    global.fetch = jest.fn(async (url) => {
      if (String(url) === OTHER_MCP_URL) {
        return {
          ok: true, status: 200, headers: { get: () => null },
          text: async () => JSON.stringify({ authorization_uri: AUTH_URI, token_uri: TOKEN_URI }),
        };
      }
      return {
        ok: true, status: 200, headers: { get: () => null },
        text: async () => JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: 'openid' }),
        json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, scope: 'openid' }),
      };
    });
    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: OTHER_MCP_URL, clientId: 'client-abc' }).expect(200);
    const start = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    const state = new URL(start.body.authUrl).searchParams.get('state');
    await request(app)
      .get(`/api/privilege-mcp/auth/callback?code=code-1&state=${encodeURIComponent(state)}`)
      .expect(302);

    // Switch to the procyon frontend: the stored bearer must stay home.
    global.fetch = mcpFetchMock();
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: PROCYON_URL }).expect(200);
    const res = await request(app).post('/api/privilege-mcp/tools/list').send({});

    expect(res.status).toBe(200);
    expect(authHeadersSent(global.fetch)).toHaveLength(0);
  });

  test('chat against a procyon frontend skips the OAuth redirect and discovers tools', async () => {
    const app = buildApp();
    global.fetch = mcpFetchMock();

    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: PROCYON_URL }).expect(200);
    const res = await request(app).post('/api/privilege-mcp/chat').send({ prompt: 'list tools' });

    expect(res.status).toBe(200);
    expect(res.body.authUrl).toBeUndefined();
    expect(res.body.steps).toContain('tools_discovered:1');
  });

  test('chat reports gateway-filtered tools and never attempts their execution', async () => {
    const app = buildApp();
    global.fetch = jest.fn(async (_url, opts = {}) => {
      const body = JSON.parse(opts.body || '{}');
      const result = body.method === 'tools/list'
        ? {
            tools: [{ name: 'read_health', description: 'Read cluster health', inputSchema: {}, annotations: { readOnlyHint: true } }],
            _meta: { deniedTools: [{ name: 'delete_index', description: 'Delete an index', deniedReason: 'admin policy' }] },
          }
        : { protocolVersion: '2024-11-05', capabilities: {} };
      return {
        ok: true, status: 200, headers: { get: () => null },
        text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result }),
      };
    });

    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: PROCYON_URL }).expect(200);
    const res = await request(app).post('/api/privilege-mcp/chat').send({ prompt: 'delete index' }).expect(200);

    expect(res.body.policy).toMatchObject({ total: 2, permitted: 1, filtered: 1 });
    expect(res.body.decision).toMatchObject({ outcome: 'FILTERED', tool: 'delete_index' });
    expect(global.fetch.mock.calls.map(([, opts]) => JSON.parse(opts.body || '{}').method)).not.toContain('tools/call');
  });

  test('/state lists a preset per path, and the Privilege one honours the URL override', async () => {
    // The agent frontend is no longer a preset: its gateway was torn down, so
    // offering it only produced "authenticated, 0 tools".
    process.env.PRIVILEGE_MCPGW_URL = 'https://aidemo.mcpgw.local.ping-devops.com/mcp';
    const app = buildApp();

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    const presets = res.body.presets || [];
    const urls = presets.map((p) => p.url);
    expect(urls).toContain('https://aidemo.mcpgw.local.ping-devops.com/mcp');
    expect(urls).not.toContain(PROCYON_URL);
    expect(presets.map((p) => p.mode)).toEqual(expect.arrayContaining(['direct', 'privilege', 'facade']));
    delete process.env.PRIVILEGE_MCPGW_URL;
  });
});
