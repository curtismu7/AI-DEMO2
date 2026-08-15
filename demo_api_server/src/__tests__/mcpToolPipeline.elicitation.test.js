'use strict';

/**
 * runMcpToolPipeline is the REAL path executeBffTool takes for banking tools
 * at runtime (bffMcpToolExecutor.js calls it directly, not
 * utils/mcpToolRegistry.js's callMcpToolInternal — that module is only
 * reached from a fallback/test context). mcpGatewayClient.js already tags a
 * 428 elicitation_required response with gatewayErrorCode:'elicitation_required'
 * (see mcpGatewayClient.elicitationRequired.test.js), but the pipeline's own
 * catch block here only recognized 'hitl_required' and 'step_up_required' —
 * an elicitation obligation fell through to the generic error path instead
 * of the structured block routes/agentTool.js expects.
 */

const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

function makeDeps(over = {}) {
  return {
    resolveMcpAccessTokenWithEvents: jest.fn(async () => ({ token: 't', tokenEvents: [], userSub: 'u1' })),
    evaluateMcpFirstToolGate: jest.fn(async () => ({ ran: true, permit: true, evaluation: { decision: 'PERMIT' } })),
    getSessionAccessToken: jest.fn(() => 'sess-tok'),
    introspectToken: jest.fn(async () => ({ active: true, sub: 'u1', scope: 'read', exp: 9999999999 })),
    callToolLocal: jest.fn(async () => ({ content: [{ text: 'local-ok' }] })),
    mcpCallTool: jest.fn(async () => ({ content: [{ text: 'remote-ok' }] })),
    callToolViaGateway: jest.fn(async () => ({ result: { content: [{ text: 'gw-ok' }] }, gwAuditTrail: null })),
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
      useGateway: false,
      gatewayHttpUrl: '',
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
    tool: 'create_withdrawal',
    params: { from_account_id: 'a1', amount: 100 },
    flowTraceId: '',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1' },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

describe('runMcpToolPipeline — gateway 428 elicitation_required', () => {
  test('is blocked with a structured body carrying elicitationId/prompt, distinct from HITL', async () => {
    const deps = makeDeps();
    deps.config = { ...deps.config, useGateway: true, gatewayHttpUrl: 'http://gw' };
    deps.callToolViaGateway = jest.fn(async () => {
      throw Object.assign(new Error('Confirm create_withdrawal?'), {
        code: 'mcp_tool_error',
        httpStatus: 428,
        gatewayErrorCode: 'elicitation_required',
        elicitation: true,
        rpcData: {
          elicitationId: 'elic-1',
          prompt: 'Confirm create_withdrawal?',
          toolName: 'create_withdrawal',
          expiresIn: 120,
        },
      });
    });

    const outcome = await runMcpToolPipeline(makeCtx({ deps }));

    expect(outcome.kind).toBe('block');
    expect(outcome.httpStatus).toBe(428);
    expect(outcome.body).toMatchObject({
      error: 'elicitation_required',
      elicitationId: 'elic-1',
      prompt: 'Confirm create_withdrawal?',
      tool: 'create_withdrawal',
    });
    // Not the HITL shape — no challengeId minted for this obligation.
    expect(outcome.body.hitl).toBeUndefined();
    expect(outcome.body.challengeId).toBeUndefined();
  });
});
