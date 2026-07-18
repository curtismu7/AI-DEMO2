'use strict';
/**
 * Task 6 (docs/superpowers/sdd — token-chain dynamic steps plan): the four
 * gateway-reported audit-trail events (gw-mtls/gw-introspection/gw-authorize/
 * gw-mcp-audit) previously only ever appeared in the final HTTP response.
 * This covers that they are also pushed live via publishTokenEventsToSse the
 * moment callToolViaGateway returns — as their own push, not folded into the
 * stage-1 publish and not re-sending the stage-1 events.
 *
 * makeDeps()/makeCtx() adapted from mcpToolPipeline.confusedDeputy.test.js's
 * DI-factory pattern (this test file's own convention — no jest.mock()).
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
    callToolViaGateway: jest.fn(async () => ({
      result: { content: [] },
      gwAuditTrail: {
        introspection: { active: true, sub: 'u1' },
        authorize: { decision: 'PERMIT' },
      },
    })),
    http2Bridge: { createHttp2Session: jest.fn(() => ({})), forwardToolCall: jest.fn(async () => ({ content: [] })) },
    buildTokenEvent: jest.fn((id, label, status) => ({ id, label, status })),
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
    tool: 'get_account_balance',
    params: {},
    flowTraceId: 'ft-1',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1', body: {} },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

describe('runMcpToolPipeline — gw-* events pushed live', () => {
  test('publishTokenEventsToSse is called a second time with only the gw-* events, right after the gateway call returns', async () => {
    const published = [];
    const deps = makeDeps();
    // Snapshot a copy of `events` at call time: publishTokenEventsToSse is
    // sometimes called with a live reference to the pipeline's running
    // `tokenEvents` array (e.g. the stage-1 call at line 153), which is
    // mutated further by later pushes in the same array — capturing the
    // reference itself would make this recorded call reflect later state.
    deps.publishTokenEventsToSse = jest.fn((flowTraceId, events) => published.push({ flowTraceId, events: [...events] }));

    await runMcpToolPipeline(makeCtx({ deps }));

    // First push: the stage-1 exchange events. Second push: the gw-* events,
    // published as soon as the gateway call returns — not folded into a
    // single end-of-call publish.
    expect(published.length).toBeGreaterThanOrEqual(2);
    const gwPush = published.find((p) => p.events.some((e) => e.id === 'gw-authorize'));
    expect(gwPush).toBeDefined();
    expect(gwPush.events.some((e) => e.id === 'gw-introspection')).toBe(true);
    // The gw-* push must NOT re-send the stage-1 user-token event.
    expect(gwPush.events.some((e) => e.id === 'user-token')).toBe(false);
  });
});
