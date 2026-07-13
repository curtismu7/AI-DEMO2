'use strict';

const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

// Build the minimal ctx.deps double this pipeline needs to reach the PERMIT
// branch quickly. Mirror whatever fixture the existing mcpToolPipeline test
// (if any) already uses for a PERMIT path — check for one before writing this
// from scratch, since runMcpToolPipeline has many required deps.
function permitDeps(overrides = {}) {
  return {
    resolveMcpAccessTokenWithEvents: async () => ({ token: 'tok', tokenEvents: [] }),
    evaluateMcpFirstToolGate: async () => ({ ran: true, permit: true, evaluation: { decisionId: 'd1', decisionContext: {} } }),
    introspectToken: async () => ({ active: true }),
    getSessionAccessToken: () => 'tok',
    callToolLocal: async () => ({ result: 'ok' }),
    mcpCallTool: async () => ({ result: 'ok' }),
    callToolViaGateway: async () => ({ result: 'ok' }),
    http2Bridge: null,
    pingoneAdapter: null,
    buildTokenEvent: () => ({}),
    mcpNoBearerResponse: () => null,
    createPendingDecision: () => null,
    createHitlChallenge: async () => null,
    decodeAgentId: () => undefined,
    recordMcpToolCall: () => {},
    recordComplianceAudit: () => {},
    publishMcpResultToSse: () => {},
    publishTokenEventsToSse: () => {},
    appEventLog: jest.fn(),
    emit: () => {},
    config: { introspectionConfigured: false, useGateway: false, gatewayHttpUrl: null, mcpUrl: 'http://x', useHttp2: false, pingoneAdminEnabled: false, pingoneAdminTools: () => false },
    ...overrides,
  };
}

describe('runMcpToolPipeline tags useCaseId onto the authorize evaluation and activity logs', () => {
  test('permit path stamps mcpAuthorizeEvaluation.useCaseId', async () => {
    const deps = permitDeps();
    const outcome = await runMcpToolPipeline({
      tool: 'get_balance', params: {}, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps, useCaseId: 'delegated-access-with-proof',
    });
    expect(outcome.body.mcpAuthorizeEvaluation.useCaseId).toBe('delegated-access-with-proof');
  });

  test('the gate-permitted appEventLog call carries useCaseId in metadata', async () => {
    const deps = permitDeps();
    await runMcpToolPipeline({
      tool: 'get_balance', params: {}, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps, useCaseId: 'delegated-access-with-proof',
    });
    const call = deps.appEventLog.mock.calls.find((c) => c[3] && c[3].tag === 'authorize/gate-permitted');
    expect(call[3].metadata.useCaseId).toBe('delegated-access-with-proof');
  });
});
