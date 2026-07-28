'use strict';

const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

function baseDeps(overrides = {}) {
  return {
    resolveMcpAccessTokenWithEvents: async () => ({ token: 'tok', tokenEvents: [] }),
    evaluateMcpFirstToolGate: async () => ({ ran: true, permit: true, evaluation: { decisionId: 'd1', decisionContext: 'McpFirstTool' } }),
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

describe('runMcpToolPipeline — mcpAuthorizeEvaluations (dynamic Token Chain authorize cards)', () => {
  test('block path: gate + secondary decisions become an ordered mcpAuthorizeEvaluations array', async () => {
    const deps = baseDeps({
      evaluateMcpFirstToolGate: async () => ({
        ran: true,
        block: {
          status: 403,
          body: {
            error: 'mcp_authorization_denied',
            decisionId: 'limit-1',
            decisionContext: 'McpFirstTool',
            gateEvaluation: { decision: 'PERMIT', decisionId: 'gate-1', raw: { decision: 'PERMIT' }, request: null, response: { decision: 'PERMIT' } },
            secondaryEvaluation: { source: 'transaction-policy', decision: 'DENY', decisionId: 'limit-1', raw: { decision: 'DENY', reason: 'over limit' } },
          },
        },
      }),
    });
    const outcome = await runMcpToolPipeline({
      tool: 'create_transfer', params: { amount: 2500 }, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.kind).toBe('block');
    expect(outcome.body.mcpAuthorizeEvaluation.decisionId).toBe('limit-1'); // singular unchanged
    expect(outcome.body.mcpAuthorizeEvaluations).toEqual([
      { decision: 'PERMIT', decisionId: 'gate-1', raw: { decision: 'PERMIT' }, request: null, response: { decision: 'PERMIT' }, engine: 'pingone', decisionContext: 'McpFirstTool' },
      { source: 'transaction-policy', decision: 'DENY', decisionId: 'limit-1', raw: { decision: 'DENY', reason: 'over limit' }, engine: 'pingone', decisionContext: 'TransactionAmount' },
    ]);
  });

  test('block path: single decision (no secondary) never gets mcpAuthorizeEvaluations', async () => {
    const deps = baseDeps({
      evaluateMcpFirstToolGate: async () => ({
        ran: true,
        block: { status: 403, body: { error: 'mcp_authorization_denied', decisionId: 'd1', decisionContext: 'McpFirstTool' } },
      }),
    });
    const outcome = await runMcpToolPipeline({
      tool: 'get_my_accounts', params: {}, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.body.mcpAuthorizeEvaluations).toBeUndefined();
  });

  test('permit path: gate + secondary decisions become an ordered mcpAuthorizeEvaluations array', async () => {
    const deps = baseDeps({
      evaluateMcpFirstToolGate: async () => ({
        ran: true,
        permit: true,
        evaluation: {
          decision: 'PERMIT', decisionId: 'limit-2', decisionContext: 'McpFirstTool',
          gateEvaluation: { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null },
          secondaryEvaluation: { source: 'transaction-policy', decision: 'STEP_UP', decisionId: 'limit-2', raw: null },
        },
      }),
    });
    const outcome = await runMcpToolPipeline({
      tool: 'create_transfer', params: { amount: 600 }, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.kind).toBe('result');
    expect(outcome.body.mcpAuthorizeEvaluations).toEqual([
      { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null, engine: 'pingone', decisionContext: 'McpFirstTool' },
      { source: 'transaction-policy', decision: 'STEP_UP', decisionId: 'limit-2', raw: null, engine: 'pingone', decisionContext: 'TransactionAmount' },
    ]);
  });

  test('permit path: no secondary decision → no mcpAuthorizeEvaluations', async () => {
    const deps = baseDeps();
    const outcome = await runMcpToolPipeline({
      tool: 'get_balance', params: {}, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.body.mcpAuthorizeEvaluation).toBeDefined();
    expect(outcome.body.mcpAuthorizeEvaluations).toBeUndefined();
  });
});
