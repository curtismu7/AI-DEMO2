import { describe, it, expect } from 'vitest';
import {
  ok, warn, err, idle, SRC_LABEL, diffClaims, tokenStatusChip, tokensFromEvents,
  stepsFromTokenEvents, isProblem, diffPaths, diagramConfigFromCall,
} from '../inspectorCalls';

const USER = { id: 'user-token', label: 'User access token', status: 'active', alg: 'RS256', rfc: 'RFC 9068',
  claims: { sub: 'u1', aud: ['ai-demo-bff'], scope: 'openid accounts:read read' }, hiddenClaims: ['email'],
  explanation: 'Your sign-in token. It never leaves the BFF.', jwtFullDecode: { header: { alg: 'RS256' } } };
const EXCH = { id: 'exchanged-token', label: 'MCP access token (delegated) → MCP server', status: 'exchanged', alg: 'RS256',
  rfc: 'RFC 8693 · RFC 8707', claims: { sub: 'u1', aud: ['https://api.example/mcp'], scope: 'accounts:read read', act: { sub: 'ai-agent' } },
  hiddenClaims: [], explanation: 'PingOne issued the MCP access token.' };
const DPOP = { id: 'dpop-binding', label: 'DPoP — Sender-constrained token (cnf.jkt)', status: 'active', claims: null, explanation: 'Bound to the key.' };

describe('chips', () => {
  it('build chips', () => {
    expect(ok('a')).toEqual({ tone: 'ok', label: 'a' });
    expect(warn('a').tone).toBe('warn');
    expect(err('a').tone).toBe('err');
    expect(idle('a').tone).toBe('idle');
    expect(SRC_LABEL.agent).toBe('AI agent');
  });
});

describe('diffClaims', () => {
  it('classifies changes', () => {
    expect(diffClaims(USER.claims, EXCH.claims)).toEqual({ aud: 'changed', scope: 'narrowed', act: 'added' });
  });
  it('ignores array order', () => {
    expect(diffClaims({ aud: ['a', 'b'] }, { aud: ['b', 'a'] })).toEqual({});
  });
  it('widened scope is changed', () => {
    expect(diffClaims({ scope: 'read' }, { scope: 'read write' })).toEqual({ scope: 'changed' });
  });
  it('removed key', () => {
    expect(diffClaims({ x: 1 }, {})).toEqual({ x: 'removed' });
  });
});

describe('tokenStatusChip', () => {
  it('maps statuses', () => {
    expect(tokenStatusChip('active')).toEqual({ tone: 'ok', label: 'Valid' });
    expect(tokenStatusChip('exchanged')).toEqual({ tone: 'ok', label: 'Exchanged' });
    expect(tokenStatusChip('warning')).toEqual({ tone: 'warn', label: 'Warning' });
    expect(tokenStatusChip('failed')).toEqual({ tone: 'err', label: 'Failed' });
    expect(tokenStatusChip('skipped')).toEqual({ tone: 'idle', label: 'skipped' });
  });
});

describe('tokensFromEvents', () => {
  it('keeps claim-bearing events and diffs the exchange', () => {
    const t = tokensFromEvents([DPOP, USER, EXCH]);
    expect(t).toHaveLength(2);
    expect(t[0].role).toBe('Your sign-in token. It never leaves the BFF.');
    expect(t[0].rfc).toBe('RFC 9068');
    expect(t[0].hidden).toEqual(['email']);
    expect(t[0].header).toEqual({ alg: 'RS256' });
    expect(t[0].diff).toBeUndefined();
    expect(t[1].diff).toEqual({ aud: 'changed', scope: 'narrowed', act: 'added' });
  });
  it('handles undefined', () => {
    expect(tokensFromEvents(undefined)).toEqual([]);
  });
});

describe('stepsFromTokenEvents', () => {
  it('maps every event in order', () => {
    const s = stepsFromTokenEvents([DPOP, USER, EXCH]);
    expect(s).toHaveLength(3);
    expect(s[0]).toMatchObject({ title: DPOP.label, status: { tone: 'ok', label: 'Valid' }, text: 'Bound to the key.' });
    expect(s[2].tag).toBe('RFC 8693 · RFC 8707');
  });
});

describe('isProblem', () => {
  it('flags warn/err', () => {
    expect(isProblem({ status: { tone: 'warn' } })).toBe(true);
    expect(isProblem({ status: { tone: 'err' } })).toBe(true);
    expect(isProblem({ status: { tone: 'ok' } })).toBe(false);
  });
});

describe('diffPaths', () => {
  it('lists differing leaf paths as JSON strings', () => {
    expect(diffPaths({ a: { b: 1, c: 2 } }, { a: { b: 1, c: 3 }, d: true })).toEqual([
      { path: 'a.c', a: '2', b: '3' },
      { path: 'd', a: undefined, b: 'true' },
    ]);
  });
  it('parses JSON held in strings first', () => {
    expect(diffPaths({ body: '{"x":1}' }, { body: '{"x":2}' })).toEqual([{ path: 'body.x', a: '1', b: '2' }]);
  });
});

describe('diagramConfigFromCall', () => {
  const hop = (dir, call, tone) => ({ dir, call, what: 'w ' + call, status: { tone, label: tone }, ms: 1, request: {}, response: {} });
  const call = { hops: [hop('Browser → BFF', 'c1', 'ok'), hop('BFF → PingOne', 'c2', 'ok'), hop('BFF → MCP server', '<call>', 'err')] };
  it('lays out nodes, edges and steps', () => {
    const c = diagramConfigFromCall(call, { BFF: ['sub line'] });
    expect(c.NODES.map((n) => n.id)).toEqual(['Browser', 'BFF', 'PingOne', 'MCP server']);
    expect(c.NODES.map((n) => n.group)).toEqual(['client', 'bff', 'pingone', 'mcp']);
    expect(c.NODES.map((n) => n.x)).toEqual([0, 300, 600, 600]);
    expect(c.EDGES[2]).toEqual(['BFF', 'MCP server', '3. <call>', { color: 'var(--th-status-error)' }]);
    expect(c.STEPS).toHaveLength(3);
    expect(c.STEPS[1].edges).toEqual([1]);
    expect(c.NODES[1].sub).toEqual(['sub line']);
    expect(c.GROUPS.client.label).toBe('Caller');
  });
  it('dashes idle hops', () => {
    const c = diagramConfigFromCall({ hops: [hop('A → B', 'x', 'idle')] });
    expect(c.EDGES[0][3]).toEqual({ dashed: true });
  });
});
