import {
  gatewayCallFromTest, gatewayCallsFromBurst, gatewayCallFromRecord, dedupeGatewayCalls, logLinesFor,
} from '../gatewayCalls';

const CHAIN = [
  { filter: 'McpValidationFilter', result: 'passed' },
  { filter: 'McpAuditFilter', result: 'passed' },
  { filter: 'McpProtectionFilter', result: 'passed' },
  { filter: 'TokenIntrospection', result: 'passed' },
  { filter: 'P1AZDecision', result: 'forwarded', decision: 'PERMIT' },
];
const INTRO = { active: true, sub: 'user-1', client_id: 'cli-1', scope: 'banking:read', email: 'a@b.test' };
const AUDIT = {
  who: { userSub: 'user-1', agentSub: null, clientId: 'cli-1', actDepth: 0 },
  what: { mcpMethod: 'tools/call', tool: 'get_my_accounts' },
  when: 1760000000000,
  where: { resourceId: '/mcp', vertical: 'banking' },
  how: { decision: 'PERMIT', backend: 'p1az', result: 'forwarded', reason: null },
};
const permitRes = () => ({
  gateway: 'PingOne Agent Gateway', ok: true, durationMs: 120, result: { accounts: [] },
  tokenEvents: [{ id: 'user-token', label: 'User token', status: 'active', claims: { sub: 'user-1' } }],
  gwAuditTrail: {
    introspection: INTRO,
    authorize: { decision: 'PERMIT', backend: 'p1az', url: 'https://az/decisionEndpoints/x', tool: 'get_my_accounts', method: 'tools/call', parameters: { a: 1 }, rawResponse: { decision: 'PERMIT' }, statements: [{ name: 'allow-read' }], resolver: { status: 'resolved', accountId: 'acc-1', attributes: ['riskTier'] } },
    mcpAudit: AUDIT, filterChain: CHAIN, denyingFilter: null,
  },
});
const meta = { tool: 'get_my_accounts', args: {}, gatewayUrl: 'https://gw/mcp', at: 1000 };

describe('gatewayCallFromTest', () => {
  it('maps a PERMIT to 4 hops, filter steps, tokens and 5W1H', () => {
    const c = gatewayCallFromTest(permitRes(), meta);
    expect(c.status.label).toBe('PERMIT');
    expect(c.src).toBe('you');
    expect(c.hops).toHaveLength(4);
    expect(c.hops[3].status.label).toBe('forwarded');
    expect(c.steps).toHaveLength(6);
    expect(c.steps[5].title).toBe('Upstream MCP server');
    const seen = c.tokens.find((t) => t.label === 'Token as the gateway saw it');
    expect(seen.claims).not.toHaveProperty('email');
    expect(seen.hidden).toEqual(['email']);
    expect(c.tokens[0].label).toBe('User token');
    expect(c.audit.Who).toEqual(expect.arrayContaining([['userSub', 'user-1']]));
    expect(c.input).toEqual({ tool: 'get_my_accounts', args: {} });
  });

  it('maps a 429 to two hops, the second not called', () => {
    const c = gatewayCallFromTest({ ok: false, durationMs: 5, httpStatus: 429, rateLimited: true, retryAfterMs: 1000, message: 'slow down' }, meta);
    expect(c.status.label).toBe('429 Rate limited');
    expect(c.hops).toHaveLength(2);
    expect(c.hops[1].status.label).toBe('not called');
    expect(c.hops[1].what).toBe('Rate limit hit before any checks ran');
  });

  it('flags a PERMIT with an approval obligation as PAUSE', () => {
    const res = permitRes();
    res.gwAuditTrail.authorize.statements = [{ code: 'HITL_REQUIRED', name: 'needs-approval' }];
    res.gwAuditTrail.denyingFilter = 'P1AZDecision';
    const c = gatewayCallFromTest(res, meta);
    expect(c.status.label).toBe('PAUSE · approval');
    expect(c.status.tone).toBe('warn');
    expect(c.hops[3].status.label).toBe('not called');
  });
});

describe('gatewayCallFromRecord', () => {
  const rec = {
    ts: '2026-10-17T10:00:00.000Z', tool: 'create_withdrawal', method: 'tools/call', decision: 'DENY', backend: 'p1az',
    sub: 'user-1', clientId: 'cli-1', aud: 'mcp', scope: 'a', iss: 'https://iss', email: 'a@b.test', actor: 'agent-1',
    stoppedAt: 'P1AZDecision', correlationId: 'c1', reason: null, statements: [{ name: 'deny-big' }], url: 'https://az',
    parameters: { x: 1 }, rawResponse: { decision: 'DENY' }, filterChain: null, mcpAudit: null, introspectionActive: true,
  };

  it('maps a DENY record: hop 4 not called, stopped-at chip', () => {
    const c = gatewayCallFromRecord(rec);
    expect(c.status.label).toBe('DENY');
    expect(c.src).toBe('agent');
    expect(c.at).toBe(Date.parse(rec.ts));
    expect(c.hops[0].dir).toBe('AI agent → Gateway');
    expect(c.hops[3].status.label).toBe('not called');
    expect(c.hops[3].what).toBe('Stopped at P1AZDecision');
    expect(c.chips.map((x) => x.label)).toContain('Stopped at: P1AZDecision');
    expect(c.tokens).toHaveLength(1);
    expect(c.tokens[0].claims.act).toEqual({ sub: 'agent-1' });
  });
});

describe('gatewayCallsFromBurst', () => {
  it('returns one call per result', () => {
    const res = { results: [{ index: 0, ok: true, durationMs: 3 }, { index: 1, ok: true, durationMs: 4 }, { index: 2, ok: false, httpStatus: 429, rateLimited: true, durationMs: 2 }] };
    const calls = gatewayCallsFromBurst(res, { tool: 't', args: {}, at: 1000 });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.id)).size).toBe(3);
    expect(calls[2].status.label).toBe('429 Rate limited');
    expect(calls[0].hops).toHaveLength(1);
    expect(calls[0].steps[0].title).toBe('Rate limit');
  });
});

describe('dedupeGatewayCalls', () => {
  const mk = (id, at) => ({ id, at, title: 't', status: { tone: 'ok', label: 'PERMIT' } });
  it('drops a record within 5 s of a matching test call, keeps one at 6 s', () => {
    expect(dedupeGatewayCalls([mk('a', 10000)], [mk('r', 14000)]).map((c) => c.id)).toEqual(['a']);
    expect(dedupeGatewayCalls([mk('a', 10000)], [mk('r', 16000)]).map((c) => c.id)).toEqual(['r', 'a']);
  });
});

describe('logLinesFor', () => {
  it('keeps lines inside the window that mention the tool', () => {
    const call = { title: 'get_my_accounts', at: Date.parse('2026-10-17T10:00:10.000Z'), ms: 500 };
    const lines = [
      '2026-10-17T10:00:11.000Z INFO get_my_accounts permit',
      '2026-10-17T10:00:00.000Z INFO get_my_accounts too early',
      '2026-10-17T10:00:11.000Z INFO other_tool',
    ];
    expect(logLinesFor(call, lines)).toEqual([lines[0]]);
  });
});
