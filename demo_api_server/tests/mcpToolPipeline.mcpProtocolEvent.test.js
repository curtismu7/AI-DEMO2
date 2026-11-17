'use strict';
/**
 * The trace shows which MCP version the gateway hop spoke. The gateway client
 * returns `mcpProtocol` ({ version, stateless, reason }) and the pipeline turns it
 * into an `mcp-protocol` token event, which the UI renders on the gateway step.
 * No event when the client reports nothing (older clients, mocked gateways).
 *
 * makeDeps()/makeCtx() follow mcpToolPipeline.gatewayDenyEvidence.test.js's DI pattern.
 */
const { runMcpToolPipeline } = require('../services/mcpToolPipeline');

// agentConsent consults configStore.getOAuthProvider (run-identity); the real
// configStore in a bare jest env throws 'Unsupported OAuth provider' and its
// error would REPLACE the gateway error the spec under test throws. Mock it
// to a stable no-op identity (getEffective returns null for every flag).
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => null),
  getOAuthProvider: jest.fn(() => 'pingone'),
}));
jest.mock('../services/agentConsent', () => ({
  consentSub: jest.fn(() => ''),
  agentClientId: jest.fn(() => ''),
  legacyMayAct: jest.fn(() => false),
  hasGrant: jest.fn(() => false),
}));

function makeDeps(over = {}) {
  return {
    resolveMcpAccessTokenWithEvents: jest.fn(async () => ({
      token: 't',
      tokenEvents: [{ id: 'user-token', status: 'active' }],
      userSub: 'u1',
    })),
    evaluateMcpFirstToolGate: jest.fn(async () => ({ ran: true, permit: true, evaluation: { decision: 'PERMIT' } })),
    getSessionAccessToken: jest.fn(() => 'sess-tok'),
    introspectToken: jest.fn(async () => ({ active: true, sub: 'u1', scope: 'read', exp: 9999999999 })),
    callToolLocal: jest.fn(async () => ({ content: [{ text: 'local-ok' }] })),
    mcpCallTool: jest.fn(async () => ({ content: [{ text: 'remote-ok' }] })),
    callToolViaGateway: jest.fn(async () => ({ result: { content: [] }, gwAuditTrail: {} })),
    http2Bridge: { createHttp2Session: jest.fn(() => ({})), forwardToolCall: jest.fn(async () => ({ content: [] })) },
    buildTokenEvent: jest.fn((id, label, status, _t, detail, extra) => ({ id, label, status, detail, extra })),
    mcpNoBearerResponse: jest.fn(() => ({ status: 401, body: { error: 'no_bearer' } })),
    pingoneAdapter: {
      callTool: jest.fn(async () => ({ content: [{ text: 'p1-ok' }] })),
      getWorkerTokenDecoded: jest.fn(async () => ({ claims: { client_id: 'w1' } })),
    },
    recordMcpToolCall: jest.fn(),
    createPendingDecision: jest.fn(() => ({ taskId: 't' })),
    createHitlChallenge: jest.fn(async () => ({ challengeId: 't', expiresAt: '2026-01-01T00:00:00Z' })),
    decodeAgentId: jest.fn(() => 'agent-1'),
    appEventLog: jest.fn(),
    publishMcpResultToSse: jest.fn(),
    publishTokenEventsToSse: jest.fn(),
    emit: jest.fn(),
    config: {
      introspectionConfigured: false,
      useGateway: true,
      gatewayHttpUrl: 'https://gw.local',
      mcpUrl: 'ws://localhost:8080',
      mcpServerUrlEnv: undefined,
      useHttp2: false,
      pingoneAdminEnabled: false,
      pingoneAdminTools: new Set(['listApplications']),
    },
    ...over,
  };
}

function makeCtx(over = {}) {
  return {
    tool: 'pay_fee',
    params: { amount: 2500 },
    flowTraceId: 'ft-1',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1', body: { vertical: 'government', useCaseId: 'authz-denied' } },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

const gw = (mcpProtocol) => makeDeps({
  callToolViaGateway: jest.fn(async () => ({ result: { content: [] }, gwAuditTrail: null, mcpProtocol })),
});

describe('runMcpToolPipeline — MCP protocol version on the gateway hop', () => {
  test('a stateless call is traced as 2026-07-28 with no initialize', async () => {
    const out = await runMcpToolPipeline(makeCtx({ deps: gw({ version: '2026-07-28', stateless: true, reason: 'stateless' }) }));
    const ev = out.tokenEvents.find((e) => e && e.id === 'mcp-protocol');
    expect(ev).toBeDefined();
    expect(ev.label).toBe('MCP protocol — 2026-07-28 (stateless)');
    expect(ev.extra).toEqual({ protocolVersion: '2026-07-28', stateless: true, reason: 'stateless' });
    expect(ev.detail).toMatch(/no initialize handshake/);
  });

  test.each([
    ['pinggateway', '2025-06-18', /PingGateway/],
    ['flag-off', '2025-11-25', /flag is off/],
    ['gateway-rejected-recently', '2025-11-25', /rejected a stateless request recently/],
    ['resent-rejected', '2025-11-25', /resent/],
    ['resent-input-required', '2025-11-25', /confirmation/],
  ])('%s is traced as %s with its reason', async (reason, version, text) => {
    const out = await runMcpToolPipeline(makeCtx({ deps: gw({ version, stateless: false, reason }) }));
    const ev = out.tokenEvents.find((e) => e && e.id === 'mcp-protocol');
    expect(ev.label).toBe(`MCP protocol — ${version}`);
    expect(ev.extra.stateless).toBe(false);
    expect(ev.detail).toMatch(text);
  });

  test('it is published to the live trace with the other gateway events', async () => {
    const deps = gw({ version: '2026-07-28', stateless: true, reason: 'stateless' });
    await runMcpToolPipeline(makeCtx({ deps }));
    const published = deps.publishTokenEventsToSse.mock.calls.flatMap((c) => c[1]);
    expect(published.some((e) => e && e.id === 'mcp-protocol')).toBe(true);
  });

  test('no event when the client reports no protocol', async () => {
    const out = await runMcpToolPipeline(makeCtx({ deps: gw(undefined) }));
    expect(out.tokenEvents.some((e) => e && e.id === 'mcp-protocol')).toBe(false);
  });
});

describe('runMcpToolPipeline — MCP protocol version on the error path', () => {
  // A denied/errored gateway call throws; mcpGatewayClient attaches the hop's
  // mcpProtocol to every throw (err.mcpProtocol) so the trace's gateway step
  // still shows the version. No duplicate when the success event already ran.
  test('a denied call still traces the protocol from err.mcpProtocol', async () => {
    const err = Object.assign(new Error('Gateway policy denied the tool call'), {
      code: 'gateway_policy_denied',
      httpStatus: 403,
      mcpProtocol: { version: '2026-07-28', stateless: true, reason: 'stateless' },
    });
    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => { throw err; }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));
    const ev = out.tokenEvents.find((e) => e && e.id === 'mcp-protocol');
    expect(ev).toBeDefined();
    expect(ev.label).toBe('MCP protocol — 2026-07-28 (stateless)');
    expect(ev.detail).toMatch(/before this error/);
    expect(out.kind).toBe('block');
  });

  test('a non-connection gateway error traces the protocol from the thrown error', async () => {
    // gateway_upstream_error without "timed out"/ECONNREFUSED falls into the
    // generic mcp_error branch — its body carries tokenEvents (no top-level
    // tokenEvents on this return), and the mcp-protocol event must be in it.
    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => {
        throw Object.assign(new Error('Gateway upstream error (HTTP 502)'), {
          code: 'gateway_upstream_error',
          httpStatus: 502,
          mcpProtocol: { version: '2025-11-25', stateless: false, reason: 'flag-off' },
        });
      }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));
    expect(out.kind).toBe('error');
    const ev = ((out.body || {}).tokenEvents || out.tokenEvents || []).find((e) => e && e.id === 'mcp-protocol');
    expect(ev).toBeDefined();
    expect(ev.label).toBe('MCP protocol — 2025-11-25');
  });

  test('a gateway unreachable transport failure traces the protocol too', async () => {
    // ECONNREFUSED satisfies isConnErr → GATEWAY_UNREACHABLE branch (no local
    // fallback: ff flag off) — the catch block's event must survive into the
    // returned tokenEvents.
    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3005'), {
          code: 'GATEWAY_UNREACHABLE',
          httpStatus: 503,
          mcpProtocol: { version: '2026-07-28', stateless: true, reason: 'stateless' },
        });
      }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));
    const ev = (out.tokenEvents ?? []).find((e) => e && e.id === 'mcp-protocol');
    expect(ev).toBeDefined();
    expect(ev.label).toBe('MCP protocol — 2026-07-28 (stateless)');
  });

  test('no duplicate event when the success-path event already ran', async () => {
    // Deny-after-success path: callToolViaGateway returned (success path pushed
    // the event), a later stage threw carrying err.mcpProtocol.
    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => ({ result: { content: [] }, gwAuditTrail: { authorize: { decision: 'PERMIT' } }, mcpProtocol: { version: '2026-07-28', stateless: true, reason: 'stateless' } })),
      publishMcpResultToSse: jest.fn(() => { throw new Error('sse blew up'); }),
    });
    await runMcpToolPipeline(makeCtx({ deps }));
    const events = deps.buildTokenEvent.mock.calls.filter((c) => c[0] === 'mcp-protocol');
    expect(events).toHaveLength(1);
  });

  test('no event when the error carries no protocol (older callers)', async () => {
    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => { throw Object.assign(new Error('boom'), { code: 'gateway_policy_denied' }); }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));
    expect(out.tokenEvents.some((e) => e && e.id === 'mcp-protocol')).toBe(false);
  });
});
