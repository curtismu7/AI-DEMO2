/**
 * MCP 2026-07-28 stateless request helpers (pure functions, no server).
 */

import {
  validateModernMeta,
  checkModernHeaders,
  requestedLogLevel,
  decorateModernSend,
  CACHE_HINTS,
} from '../src/modernRequest';

const V = 'io.modelcontextprotocol/protocolVersion';
const CAPS = 'io.modelcontextprotocol/clientCapabilities';
const LOG = 'io.modelcontextprotocol/logLevel';
const goodMeta = { [V]: '2026-07-28', [CAPS]: {} };

describe('validateModernMeta', () => {
  it('accepts the required keys (clientInfo is optional)', () => {
    expect(validateModernMeta({ _meta: goodMeta })).toBeNull();
  });
  it('rejects a missing _meta, version, or clientCapabilities with -32602', () => {
    expect(validateModernMeta({})?.code).toBe(-32602);
    expect(validateModernMeta({ _meta: { [CAPS]: {} } })?.code).toBe(-32602);
    expect(validateModernMeta({ _meta: { [V]: '2026-07-28' } })?.code).toBe(-32602);
    expect(validateModernMeta({ _meta: { [V]: '2026-07-28', [CAPS]: [] } })?.code).toBe(-32602);
    expect(validateModernMeta({ _meta: { [V]: '2026-07-28', [CAPS]: null } })?.code).toBe(-32602);
  });
  it('rejects an invalid logLevel but accepts a valid one', () => {
    expect(validateModernMeta({ _meta: { ...goodMeta, [LOG]: 'loud' } })?.code).toBe(-32602);
    expect(validateModernMeta({ _meta: { ...goodMeta, [LOG]: 'warning' } })).toBeNull();
  });
});

describe('requestedLogLevel', () => {
  it('returns the level only when valid', () => {
    expect(requestedLogLevel({ _meta: { [LOG]: 'info' } })).toBe('info');
    expect(requestedLogLevel({ _meta: { [LOG]: 'nope' } })).toBeUndefined();
    expect(requestedLogLevel({})).toBeUndefined();
  });
});

describe('checkModernHeaders', () => {
  const list = { method: 'tools/list', params: { _meta: goodMeta } };
  const call = { method: 'tools/call', params: { name: 'get_x', _meta: goodMeta } };

  it('passes when Mcp-Method (and Mcp-Name for tools/call) mirror the body', () => {
    expect(checkModernHeaders({ 'mcp-method': 'tools/list' }, list)).toBeNull();
    expect(checkModernHeaders({ 'mcp-method': 'tools/call', 'mcp-name': 'get_x' }, call)).toBeNull();
  });
  it('fails on a missing or mismatched Mcp-Method', () => {
    expect(checkModernHeaders({}, list)).toMatch(/Missing required header: Mcp-Method/);
    expect(checkModernHeaders({ 'mcp-method': 'tools/call' }, list)).toMatch(/Header mismatch: Mcp-Method/);
  });
  it('fails on a missing or mismatched Mcp-Name for tools/call only', () => {
    expect(checkModernHeaders({ 'mcp-method': 'tools/call' }, call)).toMatch(/Missing required header: Mcp-Name/);
    expect(checkModernHeaders({ 'mcp-method': 'tools/call', 'mcp-name': 'other' }, call)).toMatch(/Header mismatch: Mcp-Name/);
    expect(checkModernHeaders({ 'mcp-method': 'tools/list' }, list)).toBeNull();
  });
  it('requires MCP-Protocol-Version, when sent, to equal the _meta version', () => {
    expect(checkModernHeaders({ 'mcp-method': 'tools/list', 'mcp-protocol-version': '2026-07-28' }, list)).toBeNull();
    expect(checkModernHeaders({ 'mcp-method': 'tools/list', 'mcp-protocol-version': '2025-11-25' }, list))
      .toMatch(/MCP-Protocol-Version/);
  });
});

describe('decorateModernSend', () => {
  const info = { name: 'svc', version: '1' };
  const run = (method: string, payload: unknown) => {
    const out: string[] = [];
    decorateModernSend(method, info, (s) => out.push(s))(JSON.stringify(payload));
    return JSON.parse(out[0]);
  };

  it('adds resultType, serverInfo and cache hints to a cacheable result', () => {
    const r = run('tools/list', { jsonrpc: '2.0', id: 1, result: { tools: [] } });
    expect(r.result).toMatchObject({
      resultType: 'complete',
      tools: [],
      ...CACHE_HINTS['tools/list'],
      _meta: { 'io.modelcontextprotocol/serverInfo': info },
    });
  });
  it('adds resultType but no cache hints to a non-cacheable method', () => {
    const r = run('tools/call', { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } });
    expect(r.result.resultType).toBe('complete');
    expect(r.result.ttlMs).toBeUndefined();
    expect(r.result.cacheScope).toBeUndefined();
  });
  it('keeps hints private for token-scoped lists and public for prompts', () => {
    expect(CACHE_HINTS['tools/list'].cacheScope).toBe('private');
    expect(CACHE_HINTS['resources/read'].ttlMs).toBe(0);
    expect(CACHE_HINTS['prompts/list'].cacheScope).toBe('public');
  });
  it('does not touch errors, notifications, or unparsable frames', () => {
    const err = { jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'x' } };
    expect(run('tools/list', err)).toEqual(err);
    const note = { jsonrpc: '2.0', method: 'notifications/message', params: {} };
    expect(run('tools/list', note)).toEqual(note);
    const out: string[] = [];
    decorateModernSend('tools/list', info, (s) => out.push(s))('not json');
    expect(out).toEqual(['not json']);
  });
  it('preserves an existing _meta and a result that already set ttlMs', () => {
    const r = run('tools/list', { jsonrpc: '2.0', id: 1, result: { tools: [], ttlMs: 5, cacheScope: 'public', _meta: { a: 1 } } });
    expect(r.result.ttlMs).toBe(5);
    expect(r.result.cacheScope).toBe('public');
    expect(r.result._meta).toMatchObject({ a: 1, 'io.modelcontextprotocol/serverInfo': info });
  });
});
