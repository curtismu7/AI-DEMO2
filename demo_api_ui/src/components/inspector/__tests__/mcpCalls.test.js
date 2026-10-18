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
  it('maps one hop and one step', () => {
    const c = apiCallFromTracker({ id: 3, method: 'GET', url: '/api/accounts', status: 200, duration: 9, responseBody: { a: 1 }, timestamp: '2026-10-17T00:00:00Z' });
    expect(c.title).toBe('GET /api/accounts');
    expect(c.hops).toHaveLength(1);
    expect(c.steps).toHaveLength(1);
  });
});
