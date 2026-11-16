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

  it('never asks PingFederate for the openid scope (refused for this client; selects another token manager)', async () => {
    await request(app).post('/api/pf-token-demo/run');
    const scopes = global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/as/token.oauth2')).map(([, o]) => new URLSearchParams(String(o.body)).get('scope'));
    expect(scopes).toHaveLength(5); // three tiers + two Cedar cases
    scopes.forEach((scope) => expect(scope.split(' ')).not.toContain('openid'));
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
    expect(scopes).toEqual(expect.arrayContaining(['opensearch:admin whoami:read', 'opensearch:read', 'whoami:read']));
    const audiences = global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/as/token.oauth2')).map(([, o]) => new URLSearchParams(String(o.body)).get('audience'));
    expect(new Set(audiences)).toEqual(new Set(['https://gw.example/pftoken/mcp']));
    expect(res.body.tiers).toEqual([
      expect.objectContaining({ key: 'full', scope: 'opensearch:admin whoami:read', verdict: 'allowed', tools: ['ListIndexTool', 'SearchIndexTool'] }),
      expect.objectContaining({ key: 'read', scope: 'opensearch:read', verdict: 'allowed', tools: ['ListIndexTool'] }),
      expect.objectContaining({ key: 'none', scope: 'whoami:read', status: 403, verdict: 'refused-by-policy' }),
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
      expect.objectContaining({ key: 'without', scope: 'opensearch:admin', status: 400, verdict: 'blocked-by-cedar', message: expect.stringContaining('needs the opensearch:search scope') }),
      expect.objectContaining({ key: 'with', scope: 'opensearch:admin opensearch:search', status: 200, verdict: 'allowed', message: 'search ran (935 documents matched)' }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE_ROW');
  });

  describe('actSub: the act.sub Cedar gate, one token, two tools', () => {
    const DENY = { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'action denied by policy: ListIndexTool requires act.sub to be some-other-agent' } };
    const ok = (text = 'ran') => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } });
    const sse = (rpc) => `event: message\ndata: ${JSON.stringify(rpc)}\n`;
    // answers maps a tool name to { status, rpc, as } where as is 'json' or 'sse' (default sse)
    const mockDoor = (answers) => {
      global.fetch.mockImplementation(async (url, opts) => {
        if (String(url).endsWith('/as/token.oauth2')) return reply(200, { access_token: JWT });
        const body = JSON.parse(String(opts.body));
        if (body.method === 'tools/call' && answers[body.params.name]) {
          const a = answers[body.params.name];
          if (a.text !== undefined) return reply(a.status, a.text, false);
          return a.as === 'json' ? reply(a.status, a.rpc) : reply(a.status, sse(a.rpc), false);
        }
        if (String(url).endsWith('/pftoken-rs/mcp')) return reply(200, WHOAMI_SSE, false);
        if (opts.headers.authorization === `Bearer ${JWT}`) return reply(200, TOOLS_SSE, false);
        return reply(401, 'Unauthorized ', false);
      });
    };
    const run = async () => (await request(app).post('/api/pf-token-demo/run')).body;

    it('is enforcing only when CountTool is allowed and ListIndexTool is blocked by Cedar (SSE and JSON shapes)', async () => {
      mockDoor({ CountTool: { status: 200, rpc: ok('count: 12') }, ListIndexTool: { status: 400, rpc: DENY, as: 'json' } });
      const { actSub } = await run();
      expect(actSub.enforcing).toBe(true);
      expect(actSub.tools).toEqual([
        { tool: 'CountTool', status: 200, verdict: 'allowed', message: '' },
        { tool: 'ListIndexTool', status: 400, verdict: 'blocked-by-cedar', message: 'action denied by policy: ListIndexTool requires act.sub to be some-other-agent' },
      ]);
      expect(actSub.claim).toEqual({ act: { sub: 'pf-route-c-test' }, actKind: 'object', sub: 'pf-route-c-test' });
    });

    it('calls the door with the same arguments the lab probe uses, and the one token of the main answer', async () => {
      mockDoor({ CountTool: { status: 200, rpc: ok() }, ListIndexTool: { status: 200, rpc: ok() } });
      await run();
      const calls = global.fetch.mock.calls.filter(([u, o]) => !String(u).endsWith('/as/token.oauth2') && JSON.parse(String(o.body)).method === 'tools/call' && String(o.headers.authorization) === `Bearer ${JWT}`);
      const byName = Object.fromEntries(calls.map(([, o]) => { const b = JSON.parse(String(o.body)); return [b.params.name, b.params.arguments]; }));
      expect(byName.CountTool).toEqual({ index: 'gateway-events' });
      expect(byName.ListIndexTool).toEqual({});
      const mints = global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/as/token.oauth2'));
      expect(mints).toHaveLength(5); // still three tiers + two Cedar cases: the act.sub case mints nothing of its own
    });

    it.each([
      ['both allowed (no act.sub policy enforcing)', { CountTool: { status: 200, rpc: ok() }, ListIndexTool: { status: 200, rpc: ok() } }, ['allowed', 'allowed']],
      ['both blocked', { CountTool: { status: 400, rpc: DENY }, ListIndexTool: { status: 400, rpc: DENY } }, ['blocked-by-cedar', 'blocked-by-cedar']],
      ['reversed', { CountTool: { status: 400, rpc: DENY }, ListIndexTool: { status: 200, rpc: ok() } }, ['blocked-by-cedar', 'allowed']],
      ['token rejected on both', { CountTool: { status: 401, text: 'Unauthorized ' }, ListIndexTool: { status: 401, text: 'Unauthorized ' } }, ['token-rejected', 'token-rejected']],
      ['an error on the blocked tool', { CountTool: { status: 200, rpc: ok() }, ListIndexTool: { status: 500, text: 'Internal Server Error' } }, ['allowed', 'error']],
      ['a JSON-RPC error that is not a policy denial', { CountTool: { status: 200, rpc: ok() }, ListIndexTool: { status: 200, rpc: { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'index not found' } } } }, ['allowed', 'error']],
    ])('is not enforcing for %s', async (_name, answers, verdicts) => {
      mockDoor(answers);
      const { actSub } = await run();
      expect(actSub.tools.map((t) => t.verdict)).toEqual(verdicts);
      expect(actSub.enforcing).toBe(false);
    });

    it('maps a 401 to token-rejected and a thrown fetch to error without failing the run', async () => {
      global.fetch.mockImplementation(async (url, opts) => {
        if (String(url).endsWith('/as/token.oauth2')) return reply(200, { access_token: JWT });
        const body = JSON.parse(String(opts.body));
        if (body.method === 'tools/call' && body.params.name === 'CountTool') return reply(401, 'Unauthorized ', false);
        if (body.method === 'tools/call' && body.params.name === 'ListIndexTool') throw new Error('socket hang up');
        return reply(200, String(url).endsWith('/pftoken-rs/mcp') ? WHOAMI_SSE : TOOLS_SSE, false);
      });
      const res = await request(app).post('/api/pf-token-demo/run');
      expect(res.status).toBe(200);
      expect(res.body.actSub.tools).toEqual([
        expect.objectContaining({ tool: 'CountTool', status: 401, verdict: 'token-rejected' }),
        expect.objectContaining({ tool: 'ListIndexTool', status: 0, verdict: 'error', message: 'socket hang up' }),
      ]);
      expect(res.body.actSub.enforcing).toBe(false);
      expect(res.body.pfToken.verdict).toBe('allowed'); // the other scenarios are untouched
    });

    it('reports act as text or absent as such, with no sub to show', async () => {
      const mintWith = (claims) => `${b64u({ alg: 'RS256' })}.${b64u(claims)}.sig`;
      for (const [claims, expected] of [
        [{ ...CLAIMS, act: '{}' }, { act: '{}', actKind: 'text', sub: null }],
        [{ ...CLAIMS, act: undefined }, { act: null, actKind: 'absent', sub: null }],
      ]) {
        const jwt = mintWith(claims);
        global.fetch.mockImplementation(async (url, opts) => {
          if (String(url).endsWith('/as/token.oauth2')) return reply(200, { access_token: jwt });
          return reply(200, sse(ok()), false);
        });
        const res = await request(app).post('/api/pf-token-demo/run');
        expect(res.body.actSub.claim).toEqual(expected);
      }
    });

    it('never returns the token, the secret or a token-looking string, even if the door echoes one', async () => {
      mockDoor({
        CountTool: { status: 200, rpc: ok(`SECRET_ROW ${JWT}`) },
        ListIndexTool: { status: 400, rpc: { jsonrpc: '2.0', id: 1, error: { code: -32600, message: `action denied by policy: bearer ${JWT} refused ${'x'.repeat(500)}` } } },
      });
      const res = await request(app).post('/api/pf-token-demo/run');
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(JWT);
      expect(text).not.toContain('.sig');
      expect(text).not.toContain('test-secret');
      expect(text).not.toContain('SECRET_ROW'); // tool output is never returned
      const blocked = res.body.actSub.tools[1];
      expect(blocked.verdict).toBe('blocked-by-cedar');
      expect(blocked.message.length).toBeLessThanOrEqual(200);
    });

    it('leaves the mint failure path alone: no actSub when PingFederate did not issue a token', async () => {
      global.fetch.mockImplementation(async () => reply(401, { error: 'invalid_client', error_description: 'Invalid client' }));
      const res = await request(app).post('/api/pf-token-demo/run');
      expect(res.body.actSub).toBeUndefined();
    });
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
