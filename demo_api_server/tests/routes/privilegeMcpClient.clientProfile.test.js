'use strict';

// Client profiles on the Privilege MCP client. 'default' is what the client sent before
// profiles existed (DCR name "ai-demo-bff", clientInfo "PingOne Privilege MCP Client", no
// custom User-Agent). A named profile (chatgpt, claude, ...) makes the costume introduce
// itself as that client: the DCR client_name, the MCP initialize clientInfo and the
// User-Agent all change together, and nothing else does.

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://mcpgw.example.com/aggregate/mcp';
const BASE = 'https://mcpgw.example.com/aggregate';

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-client-profile-test';
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
  json: async () => body,
});

// A gateway that records every request: registration bodies, and the headers + body of MCP calls.
function gatewayFetch(seen, { legacy = false } = {}) {
  return jest.fn(async (url, options = {}) => {
    const target = String(url);
    seen.push({ target, options });
    if (target.endsWith('/register')) return json({ client_id: `dcr-${JSON.parse(options.body).client_name}` });
    if (target.endsWith('/token')) {
      const body = String(options.body || '');
      return body.includes('dcr-liveness-probe')
        ? { ok: false, status: 400, headers: { get: () => null }, text: async () => 'Invalid or expired authorization code' }
        : json({ access_token: 'access-token', token_type: 'Bearer', expires_in: 3600 });
    }
    if (target.endsWith('/.well-known/oauth-authorization-server')) return json({});
    let rpc = null;
    try { rpc = JSON.parse(options.body); } catch { /* not an MCP call */ }
    // A door that does not speak the modern handshake answers server/discover with "Method not found",
    // which makes the client fall back to the legacy initialize.
    if (rpc && rpc.method === 'server/discover' && legacy) return json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } });
    if (rpc && rpc.method === 'initialize') return json({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2024-11-05', capabilities: {} } });
    if (rpc && rpc.method === 'notifications/initialized') return { ok: true, status: 202, headers: { get: () => null }, text: async () => '' };
    if (rpc) return json({ jsonrpc: '2.0', id: rpc.id, result: { tools: [] } });
    if (target.endsWith('/mcp')) return json({ authorization_uri: `${BASE}/authorize`, token_uri: `${BASE}/token` });
    return json({}, 404);
  });
}

const ENV = 'PRIVILEGE_MCP_CLIENT_PROFILE';

describe('privilege MCP client profiles', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env[ENV];
  let seen;

  beforeEach(() => { seen = []; delete process.env[ENV]; });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env[ENV]; else process.env[ENV] = originalEnv;
  });

  async function registrationName(app) {
    const cfg = await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: MCP_URL });
    expect({ status: cfg.status, body: cfg.body }).toMatchObject({ status: 200 });
    await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    const reg = seen.find((s) => s.target.endsWith('/register'));
    return reg ? JSON.parse(reg.options.body).client_name : null;
  }

  // The first MCP call the client makes, plus where it carries its clientInfo: in
  // params._meta for the modern handshake, in params.clientInfo for legacy initialize.
  async function firstMcpCall(app, profile) {
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: MCP_URL }).expect(200);
    if (profile) await request(app).post('/api/privilege-mcp/client-profile').send({ profile }).expect(200);
    await request(app).post('/api/privilege-mcp/tools/list').set('Authorization', 'Bearer seeded-token').send({}).expect(200);
    const call = seen.find((s) => {
      try { return Boolean(JSON.parse(s.options.body).method); } catch { return false; }
    });
    const rpc = JSON.parse(call.options.body);
    return {
      method: rpc.method,
      clientInfo: rpc.params.clientInfo || rpc.params._meta['io.modelcontextprotocol/clientInfo'],
      userAgent: call.options.headers['User-Agent'],
    };
  }

  test.each(['modern', 'legacy'])('default (%s handshake): registers as ai-demo-bff, original clientInfo, no custom User-Agent', async (era) => {
    global.fetch = gatewayFetch(seen, { legacy: era === 'legacy' });
    expect(await registrationName(buildApp())).toBe('ai-demo-bff');

    seen.length = 0;
    const call = await firstMcpCall(buildApp(), null);
    expect(call.method).toBe('server/discover');
    expect(call.clientInfo).toEqual({ name: 'PingOne Privilege MCP Client', version: '2.0.0' });
    expect(call.userAgent).toBeUndefined();
  });

  test.each([
    ['chatgpt', 'ChatGPT', 'openai-mcp'],
    ['claude', 'Claude', 'claude-ai'],
    ['gemini', 'Gemini', 'gemini-cli-mcp-client'],
    ['codex', 'Codex', 'codex-mcp-client'],
  ])('%s: DCR name, clientInfo and User-Agent all change together', async (profile, clientName, infoName) => {
    global.fetch = gatewayFetch(seen);
    let app = buildApp();
    await request(app).post('/api/privilege-mcp/client-profile').send({ profile }).expect(200);
    expect(await registrationName(app)).toBe(clientName);

    seen.length = 0;
    const call = await firstMcpCall(buildApp(), profile);
    expect(call.clientInfo.name).toBe(infoName);
    expect(call.userAgent).toMatch(new RegExp(infoName.split('-')[0], 'i'));
  });

  test('legacy handshake: initialize carries the profile clientInfo and User-Agent too', async () => {
    global.fetch = gatewayFetch(seen, { legacy: true });
    await request(buildApp()).get('/api/privilege-mcp/state'); // warm module
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: MCP_URL }).expect(200);
    await request(app).post('/api/privilege-mcp/client-profile').send({ profile: 'chatgpt' }).expect(200);
    await request(app).post('/api/privilege-mcp/tools/list').set('Authorization', 'Bearer seeded-token').send({}).expect(200);
    const init = seen.find((s) => { try { return JSON.parse(s.options.body).method === 'initialize'; } catch { return false; } });
    expect(init).toBeTruthy();
    expect(JSON.parse(init.options.body).params.clientInfo).toEqual({ name: 'openai-mcp', version: '1.0.0' });
    expect(init.options.headers['User-Agent']).toBe('openai-mcp/1.0.0');
  });

  test('an unknown profile is refused with 400 and the session keeps its profile', async () => {
    global.fetch = gatewayFetch(seen);
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/client-profile').send({ profile: 'chatgpt' }).expect(200);
    const bad = await request(app).post('/api/privilege-mcp/client-profile').send({ profile: 'definitely-not-real' }).expect(400);
    expect(bad.body.error).toMatch(/profile must be one of/);
    const state = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(state.body.clientProfile).toBe('chatgpt');
    expect(state.body.clientProfiles).toEqual(expect.arrayContaining(['default', 'chatgpt', 'claude', 'gemini', 'codex']));
  });

  test('prototype keys are not profiles', async () => {
    global.fetch = gatewayFetch(seen);
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/client-profile').send({ profile: '__proto__' }).expect(400);
    await request(app).post('/api/privilege-mcp/client-profile').send({ profile: 'constructor' }).expect(400);
  });

  test('the environment sets the default profile; an unknown env value falls back to default', async () => {
    global.fetch = gatewayFetch(seen);
    process.env[ENV] = 'claude';
    expect(await registrationName(buildApp())).toBe('Claude');

    seen.length = 0;
    process.env[ENV] = 'typo-not-a-profile';
    expect(await registrationName(buildApp())).toBe('ai-demo-bff');
  });

  test('switching profile registers a new client rather than reusing the cached one', async () => {
    global.fetch = gatewayFetch(seen);
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: MCP_URL }).expect(200);
    await request(app).post('/api/privilege-mcp/client-profile').send({ profile: 'chatgpt' }).expect(200);
    await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    await request(app).post('/api/privilege-mcp/client-profile').send({ profile: 'claude' }).expect(200);
    await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    const names = seen.filter((s) => s.target.endsWith('/register')).map((s) => JSON.parse(s.options.body).client_name);
    expect(names).toEqual(['ChatGPT', 'Claude']);
  });
});
