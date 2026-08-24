'use strict';
/**
 * INTROSPECTION_NOT_CONFIGURED (no credential for a token's issuer — e.g. the
 * User Login PingOne app going PKCE-only/no-secret on 2026-08-24, see
 * tokenIntrospectionService.selectIntrospectionCredentials) is expected and
 * permanent, not a transient error. It must be logged/emitted as a quiet
 * "skipped" event — same distinction tokenVerificationService.js already
 * makes for this error code — never as the noisy "degraded" error path a
 * real introspection-endpoint failure still gets. Either way the tool call
 * must still proceed (introspection failure never blocks execution).
 *
 * makeDeps()/makeCtx() follow mcpToolPipeline.gatewayUnreachableFailOpen.test.js's DI pattern.
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
    recordMcpToolCall: jest.fn(),
    createPendingDecision: jest.fn(() => ({ taskId: 't' })),
    createHitlChallenge: jest.fn(async () => ({ challengeId: 't', expiresAt: '2026-01-01T00:00:00Z' })),
    decodeAgentId: jest.fn(() => 'agent-1'),
    appEventLog: jest.fn(),
    publishMcpResultToSse: jest.fn(),
    publishTokenEventsToSse: jest.fn(),
    emit: jest.fn(),
    config: {
      introspectionConfigured: true,
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
    tool: 'pay_airline_fee',
    params: { amount: 600 },
    flowTraceId: 'ft-1',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1', body: { vertical: 'airlines', useCaseId: 'UC7' } },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

describe('runMcpToolPipeline — INTROSPECTION_NOT_CONFIGURED is a quiet skip, not a degraded error', () => {
  test('no credential for token issuer: proceeds, emits skipped (not degraded)', async () => {
    const deps = makeDeps({
      introspectToken: jest.fn(async () => {
        throw Object.assign(new Error('Token introspection not configured'), { code: 'INTROSPECTION_NOT_CONFIGURED' });
      }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));

    expect(out.kind).toBe('result');
    expect(deps.emit).toHaveBeenCalledWith({ phase: 'introspection_not_configured' });
    expect(deps.emit).not.toHaveBeenCalledWith({ phase: 'introspection_error_degraded' });
    const skippedEvent = deps.buildTokenEvent.mock.calls.find((c) => c[0] === 'session-token-introspection');
    expect(skippedEvent[2]).toBe('skipped');
  });

  test('a real introspection-endpoint error still degrades loudly (unchanged behavior)', async () => {
    const deps = makeDeps({
      introspectToken: jest.fn(async () => {
        throw new Error('ECONNREFUSED talking to auth.pingone.com');
      }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));

    expect(out.kind).toBe('result');
    expect(deps.emit).toHaveBeenCalledWith({ phase: 'introspection_error_degraded' });
    const degradedEvent = deps.buildTokenEvent.mock.calls.find((c) => c[0] === 'session-token-introspection');
    expect(degradedEvent[2]).toBe('degraded');
  });
});
