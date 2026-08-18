'use strict';
/**
 * The gateway owns the MCP session on the PingGateway path: olb-token-exchange
 * .groovy sends `initialize`, receives an Mcp-Session-Id, and only then forwards
 * the tool call. The chain drew ONE box for those two round trips and labelled
 * the handshake "not visible from here" — which was true only because nothing
 * published it. #1977 tried to fix this and shipped inert: the header went to
 * demo_mcp_gateway (the Node gateway) while traffic goes to PingGateway.
 *
 * p1az-decision.groovy now folds the handshake into X-Gw-Audit-Trail, and this
 * covers the BFF half — turning that trail entry into the `mcp-initialize` event
 * buildTraceSteps already looks for.
 *
 * makeDeps()/makeCtx() follow mcpToolPipeline.gatewayDenyEvidence.test.js's DI
 * pattern.
 */
const { runMcpToolPipeline } = require('../services/mcpToolPipeline');

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
    tool: 'list_invoices',
    params: {},
    flowTraceId: 'ft-1',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1', body: { vertical: 'sporting-goods' } },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

/** What p1az-decision.groovy attaches once olb-token-exchange has opened the session. */
const HANDSHAKE_TRAIL = {
  introspection: { active: true, sub: 'u1' },
  authorize: { decision: 'PERMIT', backend: 'real' },
  handshake: {
    performed: true,
    method: 'initialize',
    status: 200,
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'PingGateway', version: '2026.3' },
    sessionIdPrefix: 'a1b2c3d4',
    initializedSent: false,
  },
};

const gatewayReturning = (trail) =>
  makeDeps({ callToolViaGateway: jest.fn(async () => ({ result: { content: [] }, gwAuditTrail: trail })) });

describe('runMcpToolPipeline — the gateway\'s MCP handshake reaches the chain', () => {
  test('a published handshake becomes an mcp-initialize event', async () => {
    const out = await runMcpToolPipeline(makeCtx({ deps: gatewayReturning(HANDSHAKE_TRAIL) }));

    const init = out.tokenEvents.find((e) => e && e.id === 'mcp-initialize');
    // jest's expect takes ONE argument — the vitest/playwright message form used
    // elsewhere in this repo throws "Expect takes at most one argument" here.
    // Put the diagnostic in the assertion instead.
    expect(out.tokenEvents.map((e) => e && e.id)).toContain('mcp-initialize');
    expect(init.status).toBe('active');
    // buildTraceSteps reads negotiatedVersion for the hop's "why" line.
    expect(init.extra.negotiatedVersion).toBe('2025-11-25');
    expect(init.extra.sessionIdPrefix).toBe('a1b2c3d4');
  });

  test('notifications/initialized is never invented', async () => {
    const out = await runMcpToolPipeline(makeCtx({ deps: gatewayReturning(HANDSHAKE_TRAIL) }));

    // The gateway does not send it. Emitting one would draw a hop that never
    // ran, which is worse than the gap it papers over — the whole reason the
    // trail carries initializedSent rather than being assumed.
    expect(out.tokenEvents.some((e) => e && e.id === 'mcp-initialized')).toBe(false);
    expect(out.tokenEvents.find((e) => e && e.id === 'mcp-initialize').extra.initializedSent).toBe(false);
  });

  test('a trail without a handshake emits nothing — older gateways stay silent', async () => {
    const out = await runMcpToolPipeline(makeCtx({
      deps: gatewayReturning({ introspection: { active: true }, authorize: { decision: 'PERMIT' } }),
    }));
    expect(out.tokenEvents.some((e) => e && e.id === 'mcp-initialize')).toBe(false);
  });

  test('performed:false emits nothing — the flag is respected, not just presence', async () => {
    const out = await runMcpToolPipeline(makeCtx({
      deps: gatewayReturning({ ...HANDSHAKE_TRAIL, handshake: { performed: false } }),
    }));
    expect(out.tokenEvents.some((e) => e && e.id === 'mcp-initialize')).toBe(false);
  });
});
