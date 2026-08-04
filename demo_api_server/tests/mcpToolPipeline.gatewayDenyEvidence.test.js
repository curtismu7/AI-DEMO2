'use strict';
/**
 * Gateway DENY relays must carry the PingOne Authorize decision as evidence.
 * #1313 added gatewayBlockAuthEval + body.mcpAuthorizeEvaluation on the two
 * 428 branches (hitl/step-up); the 403 deny branches never got it, so a real
 * P1AZ DENY rendered as "Authz denied — Incomplete / Run failed before
 * authorize-decision" (live incident 2026-08-04, government pay_fee $2500).
 *
 * makeDeps()/makeCtx() follow mcpToolPipeline.dynamicPush.test.js's DI pattern.
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
    tool: 'pay_fee',
    params: { amount: 2500 },
    flowTraceId: 'ft-1',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1', body: { vertical: 'government', useCaseId: 'authz-denied' } },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

const DENY_TRAIL = {
  introspection: { active: true, sub: 'u1' },
  authorize: {
    decision: 'DENY',
    backend: 'real',
    reason: null,
    parameters: { ToolName: 'pay_fee', Amount: '2500' },
    rawResponse: {
      correlationId: 'corr-deny-1',
      decision: 'DENY',
      statements: [{ name: 'MCP Tool Authorization Denied', code: 'mcp-authorization-denied' }],
    },
  },
  filterChain: [{ filter: 'P1AZDecision', result: 'blocked', decision: 'DENY' }],
  denyingFilter: 'P1AZDecision',
};

describe('runMcpToolPipeline — gateway DENY carries authorize evidence', () => {
  test('thrown gateway_policy_denied: body has mcpAuthorizeEvaluation with DENY + decisionId', async () => {
    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => {
        throw Object.assign(new Error('access_denied'), {
          code: 'gateway_policy_denied',
          gatewayErrorCode: 'access_denied',
          gwAuditTrail: DENY_TRAIL,
        });
      }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));

    expect(out.httpStatus).toBe(403);
    expect(out.body.error).toBe('gateway_policy_denied');
    expect(out.body.mcpAuthorizeEvaluation).toBeDefined();
    expect(out.body.mcpAuthorizeEvaluation.decision).toBe('DENY');
    expect(out.body.mcpAuthorizeEvaluation.decisionId).toBe('corr-deny-1');
    expect(out.tokenEvents.some((e) => e && e.id === 'gw-authorize' && e.status === 'deny')).toBe(true);
  });

  test('non-thrown DENY in gwAuditTrail: 403 body has evaluation and gw-authorize event', async () => {
    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => ({
        result: { message: 'Unauthorized-ish envelope' },
        gwAuditTrail: DENY_TRAIL,
      })),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));

    expect(out.httpStatus).toBe(403);
    expect(out.body.error).toBe('gateway_policy_denied');
    expect(out.body.mcpAuthorizeEvaluation).toBeDefined();
    expect(out.body.mcpAuthorizeEvaluation.decision).toBe('DENY');
    expect(out.body.mcpAuthorizeEvaluation.decisionId).toBe('corr-deny-1');
    expect(out.tokenEvents.some((e) => e && e.id === 'gw-authorize' && e.status === 'deny')).toBe(true);
  });

  test('infra fault (no correlationId + Unauthorized) still maps to gateway_misconfigured, no fake DENY evidence', async () => {
    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => ({
        result: { content: [] },
        gwAuditTrail: {
          authorize: { decision: 'DENY', rawResponse: { message: 'Unauthorized' } },
        },
      })),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));
    expect(out.httpStatus).toBe(503);
    expect(out.body.error).toBe('gateway_misconfigured');
    expect(out.body.mcpAuthorizeEvaluation).toBeUndefined();
  });
});
