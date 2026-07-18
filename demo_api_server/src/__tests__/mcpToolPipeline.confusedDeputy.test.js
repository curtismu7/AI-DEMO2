'use strict';
/**
 * Covers the confused-deputy allowedActor field added to the gateway_policy_denied
 * block — see docs/superpowers/plans/2026-07-13-remaining-tried-vs-allowed.md Task 2.
 */
const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

// makeDeps()/makeCtx() copied verbatim from mcpToolPipeline.characterization.test.js's
// DI-factory pattern (this file's own convention — no jest.mock()).
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

// Extended to accept a `req` override whose `body` field flows through to
// req.body?._testActClientId, same as the production code reads it (line 599).
function makeCtx(over = {}) {
  return {
    tool: 'get_my_accounts',
    params: {},
    flowTraceId: '',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1', body: {} },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

describe('gateway_policy_denied — allowedActor field', () => {
  test('includes allowedActor when the request set _testActClientId', async () => {
    const deps = makeDeps();
    deps.mcpCallTool = jest.fn(async () => {
      throw Object.assign(new Error('denied'), {
        code: 'gateway_policy_denied',
        httpStatus: 403,
        gatewayErrorCode: 'mcp-invalid-actor',
      });
    });
    const configStore = require('../../services/configStore');
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) =>
      key === 'pingone_ai_agent_client_id' ? 'real-agent-client-id' : null,
    );
    const outcome = await runMcpToolPipeline(
      makeCtx({ deps, req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1', body: { _testActClientId: 'rogue-agent-9f2a-not-allowlisted' } } }),
    );
    expect(outcome.body.allowedActor).toBe('real-agent-client-id');
    configStore.getEffective.mockRestore();
  });

  test('omits allowedActor on an ordinary (non-confused-deputy) gateway denial', async () => {
    const deps = makeDeps();
    deps.mcpCallTool = jest.fn(async () => {
      throw Object.assign(new Error('denied'), {
        code: 'gateway_policy_denied',
        httpStatus: 403,
        gatewayErrorCode: 'some_other_reason',
      });
    });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.body.allowedActor).toBeUndefined();
  });
});
