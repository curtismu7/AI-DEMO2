'use strict';
/**
 * /api/pf-token-demo: mints a PingFederate token and sends it to the Privilege pftoken door.
 * The raw token must never reach the browser; its claims (all of them) do. fetch is stubbed.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => (req.headers['x-test-signed-out'] ? res.status(401).json({ error: 'auth' }) : next()),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => '') }));

const router = require('../../routes/pfTokenPrivilegeDemo');

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const CLAIMS = { iss: 'https://pf.example', sub: 'pf-route-c-test', aud: 'https://gw.example/pftoken/mcp', client_id: 'pf-route-c-test', act: { sub: 'pf-route-c-test' }, scope: 'openid', jti: 'secret-ish' };
const JWT = `${b64u({ alg: 'RS256' })}.${b64u(CLAIMS)}.sig`;
const RECEIVED = { verifiedBy: 'mcp-resource-server', issuer: 'https://pf.example', subject: 'pf-route-c-test', actor: { sub: 'pf-route-c-test' }, audience: 'https://gw.example/pftoken/mcp' };
const WHOAMI_SSE = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(RECEIVED) }] } })}\n`;
const TOOLS_SSE = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'ListIndexTool' }, { name: 'SearchIndexTool' }] } })}\n`;

const app = express();
app.use(express.json());
app.use('/api/pf-token-demo', router);

const reply = (status, body, isJson = typeof body !== 'string') => ({
  status,
  json: async () => (isJson ? body : JSON.parse(body)),
  text: async () => (isJson ? JSON.stringify(body) : body),
});

beforeEach(() => {
  process.env.PF_TOKEN_DEMO_CLIENT_SECRET = 'test-secret';
  process.env.PF_TOKEN_DEMO_DOOR_URL = 'https://gw.example/pftoken/mcp';
  process.env.PF_TOKEN_DEMO_WHOAMI_URL = 'https://gw.example/pftoken-rs/mcp';
  global.fetch = jest.fn(async (url, opts) => {
    if (String(url).endsWith('/as/token.oauth2')) return reply(200, { access_token: JWT });
    if (opts.headers.authorization === `Bearer ${JWT}` && String(url).endsWith('/pftoken-rs/mcp')) return reply(200, WHOAMI_SSE, false);
    if (opts.headers.authorization === `Bearer ${JWT}`) return reply(200, TOOLS_SSE, false);
    return reply(401, 'Unauthorized ', false);
  });
});
afterEach(() => { delete process.env.PF_TOKEN_DEMO_CLIENT_SECRET; delete process.env.PF_TOKEN_DEMO_DOOR_URL; delete process.env.PF_TOKEN_DEMO_WHOAMI_URL; });

describe('GET /state', () => {
  it('reports configured without ever exposing the secret', async () => {
    const res = await request(app).get('/api/pf-token-demo/state');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, clientId: 'pf-route-c-test', doorUrl: 'https://gw.example/pftoken/mcp' });
    expect(JSON.stringify(res.body)).not.toContain('test-secret');
  });

  it('reports not configured when no secret is set', async () => {
    delete process.env.PF_TOKEN_DEMO_CLIENT_SECRET;
    const res = await request(app).get('/api/pf-token-demo/state');
    expect(res.body.configured).toBe(false);
  });
});

describe('POST /run', () => {
  it('returns every claim, the tools and the control, and never the raw token', async () => {
    const res = await request(app).post('/api/pf-token-demo/run');
    expect(res.status).toBe(200);
    expect(res.body.mint.claims).toMatchObject({ sub: 'pf-route-c-test', act: { sub: 'pf-route-c-test' } });
    expect(res.body.mint.claims).toEqual(CLAIMS);
    expect(res.body.pfToken).toMatchObject({ status: 200, verdict: 'allowed', tools: ['ListIndexTool', 'SearchIndexTool'] });
    expect(res.body.garbage).toMatchObject({ status: 401, verdict: 'token-rejected' });
    expect(res.body.backend).toMatchObject({ status: 200, verdict: 'allowed', received: RECEIVED });
    expect(res.body.tiers.map((t) => t.key)).toEqual(['full', 'read', 'none']);
    expect(res.body.tiers[0]).toMatchObject({ verdict: 'allowed', tools: ['ListIndexTool', 'SearchIndexTool'] });
    expect(JSON.stringify(res.body)).not.toContain(JWT);
    expect(JSON.stringify(res.body)).not.toContain('test-secret');
  });

  it('labels a 403 as refused by policy (token accepted, no grant)', async () => {
    global.fetch.mockImplementation(async (url) => (String(url).endsWith('/as/token.oauth2') ? reply(200, { access_token: JWT }) : reply(403, 'Forbidden ', false)));
    const res = await request(app).post('/api/pf-token-demo/run');
    expect(res.body.pfToken).toMatchObject({ status: 403, verdict: 'refused-by-policy' });
    expect(res.body.backend).toMatchObject({ status: 403, verdict: 'refused-by-policy', received: null });
  });

  it('mints one token per scope tier for the same client and reports each tier\'s answer', async () => {
    global.fetch.mockImplementation(async (url, opts) => {
      if (String(url).endsWith('/as/token.oauth2')) {
        const scope = new URLSearchParams(String(opts.body)).get('scope');
        return reply(200, { access_token: `${b64u({ alg: 'RS256' })}.${b64u({ ...CLAIMS, scope })}.sig` });
      }
      const scope = JSON.parse(Buffer.from(String(opts.headers.authorization).split('.')[1] || '', 'base64url').toString() || '{}').scope || '';
      if (String(url).endsWith('/pftoken-rs/mcp')) return reply(200, WHOAMI_SSE, false);
      if (scope.includes('opensearch:admin')) return reply(200, TOOLS_SSE, false);
      if (scope.includes('opensearch:read')) return reply(200, `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'ListIndexTool' }] } })}\n`, false);
      return reply(403, 'Forbidden ', false);
    });
    const res = await request(app).post('/api/pf-token-demo/run');
    const scopes = global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/as/token.oauth2')).map(([, o]) => new URLSearchParams(String(o.body)).get('scope'));
    expect(scopes).toEqual(expect.arrayContaining(['openid opensearch:admin whoami:read', 'openid opensearch:read', 'openid whoami:read']));
    const audiences = global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/as/token.oauth2')).map(([, o]) => new URLSearchParams(String(o.body)).get('audience'));
    expect(new Set(audiences)).toEqual(new Set(['https://gw.example/pftoken/mcp']));
    expect(res.body.tiers).toEqual([
      expect.objectContaining({ key: 'full', scope: 'openid opensearch:admin whoami:read', verdict: 'allowed', tools: ['ListIndexTool', 'SearchIndexTool'] }),
      expect.objectContaining({ key: 'read', scope: 'openid opensearch:read', verdict: 'allowed', tools: ['ListIndexTool'] }),
      expect.objectContaining({ key: 'none', scope: 'openid whoami:read', status: 403, verdict: 'refused-by-policy' }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('.sig');
  });

  it('reports Cedar blocking SearchIndexTool without opensearch:search and allowing it with, never the results', async () => {
    global.fetch.mockImplementation(async (url, opts) => {
      if (String(url).endsWith('/as/token.oauth2')) {
        const scope = new URLSearchParams(String(opts.body)).get('scope');
        return reply(200, { access_token: `${b64u({ alg: 'RS256' })}.${b64u({ ...CLAIMS, scope })}.sig` });
      }
      const body = JSON.parse(String(opts.body));
      if (body.method !== 'tools/call' || body.params.name !== 'SearchIndexTool') return reply(200, TOOLS_SSE, false);
      const scope = JSON.parse(Buffer.from(String(opts.headers.authorization).split('.')[1], 'base64url').toString()).scope;
      if (!scope.includes('opensearch:search')) {
        return reply(400, { jsonrpc: '2.0', error: { code: -32600, message: "action denied by policy: SearchIndexTool needs the opensearch:search scope in the agent's token" } });
      }
      return reply(200, `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Search results: {"hits":{"total":{"value":935},"hits":[{"PRIVATE_ROW":1}]}}' }] } })}\n`, false);
    });
    const res = await request(app).post('/api/pf-token-demo/run');
    expect(res.body.cedar).toEqual([
      expect.objectContaining({ key: 'without', scope: 'openid opensearch:admin', status: 400, verdict: 'blocked-by-cedar', message: expect.stringContaining('needs the opensearch:search scope') }),
      expect.objectContaining({ key: 'with', scope: 'openid opensearch:admin opensearch:search', status: 200, verdict: 'allowed', message: 'search ran (935 documents matched)' }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE_ROW');
  });

  it('sends whoami to the pftoken-rs door with the same PingFederate token', async () => {
    await request(app).post('/api/pf-token-demo/run');
    const call = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/pftoken-rs/mcp'));
    expect(call[1].headers.authorization).toBe(`Bearer ${JWT}`);
    expect(JSON.parse(call[1].body)).toMatchObject({ method: 'tools/call', params: { name: 'whoami' } });
  });

  it('reports a failed mint without calling the door', async () => {
    global.fetch.mockImplementation(async () => reply(401, { error: 'invalid_client', error_description: 'Invalid client' }));
    const res = await request(app).post('/api/pf-token-demo/run');
    expect(res.body.mint).toEqual({ status: 401, error: 'Invalid client' });
    expect(res.body.pfToken).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('answers 503 not_configured when no secret is set', async () => {
    delete process.env.PF_TOKEN_DEMO_CLIENT_SECRET;
    const res = await request(app).post('/api/pf-token-demo/run');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('not_configured');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('needs a signed-in session', async () => {
    const res = await request(app).post('/api/pf-token-demo/run').set('x-test-signed-out', '1');
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
