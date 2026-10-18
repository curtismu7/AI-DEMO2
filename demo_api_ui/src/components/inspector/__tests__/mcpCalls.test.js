import { describe, it, expect } from 'vitest';
import { mcpCallFromStore, apiCallFromTracker } from '../mcpCalls';
import { ok, err, idle } from '../inspectorCalls';

const USER = { id: 'user-token', label: 'User token', status: 'active', claims: { sub: 'u1', scope: 'accounts:read read sensitive:read', aud: 'bff' } };
const EXCH = { id: 'exchanged-token', label: 'Exchanged token', status: 'exchanged', rfc: 'RFC 8693', claims: { sub: 'u1', scope: 'accounts:read read', aud: ['https://api.example/mcp'] } };
const frames = {
  initializeRequest: { jsonrpc: '2.0', id: 1, method: 'initialize' },
  initializeResponse: { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'bank-mcp' }, protocolVersion: '2025-06-18' } },
  request: { jsonrpc: '2.0', id: 2, method: 'tools/call' },
  response: { jsonrpc: '2.0', id: 2, result: { content: [] } },
  notifications: [],
};
const base = { id: 7, tool: 'get_my_accounts', status: 200, duration: 42, result: { a: 1 }, errorMsg: null, timestamp: '2026-10-17T00:00:00Z' };

describe('mcpCallFromStore', () => {
  it('inspector success', () => {
    const c = mcpCallFromStore({
      ...base,
      detail: { src: 'you', params: { x: 1 }, frames, tokenEvents: [USER, EXCH], response: { inspector: { tokenExchangeApplied: true, requiredScopesHint: ['accounts:read'] } } },
    });
    expect(c.src).toBe('you');
    expect(c.request.label).toBe('JSON-RPC request');
    expect(c.status).toEqual({ tone: 'ok', label: '200 OK' });
    expect(c.hops.map((h) => h.dir)).toEqual(['Browser → BFF', 'BFF → PingOne', 'BFF → MCP server', 'BFF → MCP server']);
    expect(c.hops[1].request).toEqual({ grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', audience: ['https://api.example/mcp'], scope: 'accounts:read read' });
    expect(c.hops[1].ms).toBeNull();
    const scope = c.steps.find((s) => s.title === "Compared the tool's required scopes with the token");
    expect(scope.status).toEqual(ok('has them'));
    expect(c.steps.at(-1).title).toBe('Ran the tool');
    expect(c.input).toEqual({ tool: 'get_my_accounts', params: { x: 1 } });
    expect(c.chips).toContainEqual(idle('Token exchange applied'));
  });

  it('agent entry without detail', () => {
    const c = mcpCallFromStore(base);
    expect(c.src).toBe('agent');
    expect(c.request.label).toBe('Tool arguments');
    expect(c.hops).toHaveLength(1);
    expect(c.hops[0].dir).toBe('AI agent → BFF');
    expect(c.hops[0].call).toBe('POST /api/mcp/tool');
    expect(c.tokens).toEqual([]);
    expect(c.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('403 insufficient scope', () => {
    const c = mcpCallFromStore({
      ...base, status: 403, result: null, errorMsg: 'insufficient_scope',
      detail: { src: 'you', tokenEvents: [USER, EXCH], response: { inspector: { requiredScopesHint: ['read', 'sensitive:read'] } } },
    });
    expect(c.status).toEqual(err('403'));
    expect(c.banner.text).toContain('insufficient_scope');
    expect(c.steps.find((s) => s.status.label === 'missing sensitive:read').status).toEqual(err('missing sensitive:read'));
  });

  it('local fallback', () => {
    const c = mcpCallFromStore({ ...base, detail: { src: 'you', response: { _localFallback: true } } });
    expect(c.chips).toContainEqual(idle('Local handler, no MCP server'));
  });
});

describe('apiCallFromTracker', () => {
  const call = { id: 'a1', timestamp: '2026-10-17T10:00:00Z', method: 'GET', url: '/api/accounts', request: { body: null }, response: { status: 200, body: { ok: true } }, duration: 12 };
  it('maps a tracked call', () => {
    const c = apiCallFromTracker(call);
    expect(c.title).toBe('GET /api/accounts');
    expect(c.status).toEqual({ tone: 'ok', label: '200' });
    expect(c.ms).toBe(12);
    expect(c.response.body).toEqual({ ok: true });
    expect(c.hops).toHaveLength(1);
    expect(c.hops[0].dir).toBe('Browser → BFF');
    expect(c.steps).toHaveLength(1);
    expect(c.tokens).toEqual([]);
  });
  it('flags 500 as err', () => {
    expect(apiCallFromTracker({ ...call, response: { status: 500, body: null } }).status.tone).toBe('err');
  });
});

describe('mcpCallFromStore: refusals inside HTTP 200', () => {
  const run = (response) => mcpCallFromStore({ ...base, detail: { src: 'you', params: {}, response } });
  it.each([
    ['gateway showcase DENY', { denied: true, status: 403, error: 'Denied by policy' }, '403', 'Denied by policy'],
    ['PingOne error true', { error: true, message: 'PingOne said no' }, 'Error', 'PingOne said no'],
    ['rsFilter 401', { status: 401, message: 'bad token' }, '401', 'bad token'],
  ])('%s renders as an error with a banner and failing last step', (_n, response, label, text) => {
    const c = run(response);
    expect(c.status).toEqual(err(label));
    expect(c.banner).toMatchObject({ tone: 'err', text });
    expect(c.steps.at(-1).status.tone).toBe('err');
    expect(c.steps.at(-1).text).toBe(text);
  });
  it('a plain 200 stays ok', () => {
    expect(run({ result: { a: 1 }, status: 200 }).status.tone).toBe('ok');
  });
});
