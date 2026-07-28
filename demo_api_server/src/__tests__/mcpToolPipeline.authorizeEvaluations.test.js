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

  test('permit path: singular mcpAuthorizeEvaluation does NOT contain gateEvaluation/secondaryEvaluation keys', async () => {
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
    // Verify singular field exists but does not contain the dual-decision keys
    expect(outcome.body.mcpAuthorizeEvaluation).toBeDefined();
    expect(outcome.body.mcpAuthorizeEvaluation).not.toHaveProperty('gateEvaluation');
    expect(outcome.body.mcpAuthorizeEvaluation).not.toHaveProperty('secondaryEvaluation');
    // Verify it still has the core fields
    expect(outcome.body.mcpAuthorizeEvaluation.decision).toBe('PERMIT');
    expect(outcome.body.mcpAuthorizeEvaluation.decisionId).toBe('limit-2');
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

  test('block path: local-amount-fallback secondary decision is NOT labeled engine "pingone"', async () => {
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
            secondaryEvaluation: { source: 'transaction-policy-fallback', decision: 'DENY', decisionId: null, raw: { engine: 'local-amount-fallback', reason: '$2500 exceeds deny limit $2000' } },
          },
        },
      }),
    });
    const outcome = await runMcpToolPipeline({
      tool: 'create_transfer', params: { amount: 2500 }, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.body.mcpAuthorizeEvaluations[0].engine).toBe('pingone'); // gate card is always a real live decision
    expect(outcome.body.mcpAuthorizeEvaluations[1].engine).not.toBe('pingone'); // secondary card was a LOCAL fallback, not PingOne
    expect(outcome.body.mcpAuthorizeEvaluations[1].engine).toBe('local-amount-fallback');
  });

  test('permit path: local-amount-fallback secondary decision is NOT labeled engine "pingone"', async () => {
    const deps = baseDeps({
      evaluateMcpFirstToolGate: async () => ({
        ran: true,
        permit: true,
        evaluation: {
          decision: 'PERMIT', decisionId: 'limit-2', decisionContext: 'McpFirstTool',
          gateEvaluation: { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null },
          secondaryEvaluation: { source: 'transaction-policy-fallback', decision: 'STEP_UP', decisionId: null, raw: { engine: 'local-amount-fallback', reason: '$600 at/above step-up limit $500' } },
        },
      }),
    });
    const outcome = await runMcpToolPipeline({
      tool: 'create_transfer', params: { amount: 600 }, flowTraceId: null, startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.body.mcpAuthorizeEvaluations[1].engine).not.toBe('pingone');
    expect(outcome.body.mcpAuthorizeEvaluations[1].engine).toBe('local-amount-fallback');
  });
});

describe('runMcpToolPipeline — publishMcpResultToSse carries the authorize evaluation', () => {
  test('normal remote success: publishMcpResultToSse receives both fields on a dual decision', async () => {
    const publishMcpResultToSse = jest.fn();
    const deps = baseDeps({
      publishMcpResultToSse,
      evaluateMcpFirstToolGate: async () => ({
        ran: true,
        permit: true,
        evaluation: {
          decision: 'PERMIT', decisionId: 'limit-2', decisionContext: 'McpFirstTool',
          gateEvaluation: { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null },
          secondaryEvaluation: { source: 'transaction-policy', decision: 'STEP_UP', decisionId: 'limit-2', raw: null },
        },
      }),
      mcpCallTool: async () => ({ content: [{ text: 'ok' }] }),
    });
    await runMcpToolPipeline({
      tool: 'create_transfer', params: { amount: 600 }, flowTraceId: 'ft-1', startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(publishMcpResultToSse).toHaveBeenCalled();
    const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-1');
    // Singular retains the top-level (merged) decisionId — same "unchanged"
    // contract as the pre-existing block/permit-path tests above (gateEvaluation/
    // secondaryEvaluation keys are stripped, everything else passes through).
    expect(call[1].mcpAuthorizeEvaluation).toMatchObject({ decision: 'PERMIT', decisionId: 'limit-2' });
    expect(call[1].mcpAuthorizeEvaluations).toEqual([
      { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null, engine: 'pingone', decisionContext: 'McpFirstTool' },
      { source: 'transaction-policy', decision: 'STEP_UP', decisionId: 'limit-2', raw: null, engine: 'pingone', decisionContext: 'TransactionAmount' },
    ]);
  });

  test('normal remote success: single decision (no secondary) → mcpAuthorizeEvaluations omitted', async () => {
    const publishMcpResultToSse = jest.fn();
    const deps = baseDeps({
      publishMcpResultToSse,
      evaluateMcpFirstToolGate: async () => ({
        ran: true, permit: true,
        evaluation: { decision: 'PERMIT', decisionId: 'd1', decisionContext: 'McpFirstTool' },
      }),
      mcpCallTool: async () => ({ content: [{ text: 'ok' }] }),
    });
    await runMcpToolPipeline({
      tool: 'get_my_accounts', params: {}, flowTraceId: 'ft-2', startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-2');
    expect(call[1].mcpAuthorizeEvaluation).toMatchObject({ decision: 'PERMIT', decisionId: 'd1' });
    // Call-site options always carry the key (set to null when there's no
    // plural) rather than omitting it — mcpSsePublisher.js spreads it into the
    // outgoing SSE payload only when truthy, so null is equivalent to absent.
    expect(call[1].mcpAuthorizeEvaluations).toBeNull();
  });

  test('exchange-failure local fallback (pre-gate branch): publishMcpResultToSse gets NEITHER field', async () => {
    const publishMcpResultToSse = jest.fn();
    process.env.FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE = 'true';
    try {
      const deps = baseDeps({
        publishMcpResultToSse,
        resolveMcpAccessTokenWithEvents: async () => {
          const err = new Error('exchange failed');
          err.httpStatus = 400;
          err.code = 'token_exchange_failed';
          err.tokenEvents = [];
          throw err;
        },
        callToolLocal: async () => ({ result: 'local-ok' }),
      });
      await runMcpToolPipeline({
        tool: 'get_my_accounts', params: {}, flowTraceId: 'ft-3', startTime: Date.now(),
        req: { session: { user: { id: '1', oauthId: 'u1' } } }, deps,
      });
      const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-3');
      expect(call).toBeDefined();
      expect(call[1]).not.toHaveProperty('mcpAuthorizeEvaluation');
      expect(call[1]).not.toHaveProperty('mcpAuthorizeEvaluations');
    } finally {
      delete process.env.FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE;
    }
  });

  test('auth-challenge → local fallback: publishMcpResultToSse receives the authorize evaluation', async () => {
    const publishMcpResultToSse = jest.fn();
    const deps = baseDeps({
      publishMcpResultToSse,
      evaluateMcpFirstToolGate: async () => ({
        ran: true,
        permit: true,
        evaluation: {
          decision: 'PERMIT', decisionId: 'limit-3', decisionContext: 'McpFirstTool',
          gateEvaluation: { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null },
          secondaryEvaluation: { source: 'transaction-policy', decision: 'PERMIT', decisionId: 'limit-3', raw: null },
        },
      }),
      mcpCallTool: async () => ({ content: [{ text: 'need auth' }], _meta: { authChallenge: { type: 'redirect', url: 'https://idp/authorize' } } }),
      callToolLocal: async () => ({ result: 'local-ok' }),
    });
    await runMcpToolPipeline({
      tool: 'get_my_accounts', params: {}, flowTraceId: 'ft-4', startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    const calls = publishMcpResultToSse.mock.calls.filter((c) => c[0] === 'ft-4');
    // Two publishes fire on this path: the unconditional "normal remote success"
    // one, then the auth-challenge → local-fallback one this test targets — index
    // into the SECOND call specifically so a still-broken fallback site can't
    // hide behind the first (already-covered) call carrying the right data.
    expect(calls.length).toBe(2);
    const fallbackCall = calls[1];
    expect(fallbackCall[1].mcpAuthorizeEvaluation).toMatchObject({ decision: 'PERMIT', decisionId: 'limit-3' });
    expect(fallbackCall[1].mcpAuthorizeEvaluations).toEqual([
      { decision: 'PERMIT', decisionId: 'gate-1', raw: null, request: null, response: null, engine: 'pingone', decisionContext: 'McpFirstTool' },
      { source: 'transaction-policy', decision: 'PERMIT', decisionId: 'limit-3', raw: null, engine: 'pingone', decisionContext: 'TransactionAmount' },
    ]);
  });

  test('gateway HITL-required 428: publishMcpResultToSse receives the authorize evaluation', async () => {
    const publishMcpResultToSse = jest.fn();
    const deps = baseDeps({
      publishMcpResultToSse,
      evaluateMcpFirstToolGate: async () => ({
        ran: true, permit: true,
        evaluation: { decision: 'PERMIT', decisionId: 'd5', decisionContext: 'McpFirstTool' },
      }),
      mcpCallTool: async () => { throw Object.assign(new Error('policy'), { code: 'gateway_policy_denied', gatewayErrorCode: 'hitl_required' }); },
    });
    const outcome = await runMcpToolPipeline({
      tool: 'create_transfer', params: { amount: 100 }, flowTraceId: 'ft-5', startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome).toMatchObject({ kind: 'block', httpStatus: 428 });
    const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-5');
    expect(call).toBeDefined();
    expect(call[1].mcpAuthorizeEvaluation).toMatchObject({ decision: 'PERMIT', decisionId: 'd5' });
    expect(call[1].mcpAuthorizeEvaluations).toBeNull();
  });

  test('gateway generic deny 403: publishMcpResultToSse receives the authorize evaluation', async () => {
    const publishMcpResultToSse = jest.fn();
    const deps = baseDeps({
      publishMcpResultToSse,
      evaluateMcpFirstToolGate: async () => ({
        ran: true, permit: true,
        evaluation: { decision: 'PERMIT', decisionId: 'd6', decisionContext: 'McpFirstTool' },
      }),
      mcpCallTool: async () => { throw Object.assign(new Error('audience mismatch'), { code: 'gateway_policy_denied', gatewayErrorCode: 'aud_invalid' }); },
    });
    const outcome = await runMcpToolPipeline({
      tool: 'get_my_accounts', params: {}, flowTraceId: 'ft-6', startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome).toMatchObject({ kind: 'block', httpStatus: 403 });
    const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-6');
    expect(call).toBeDefined();
    expect(call[1].mcpAuthorizeEvaluation).toMatchObject({ decision: 'PERMIT', decisionId: 'd6' });
    expect(call[1].mcpAuthorizeEvaluations).toBeNull();
  });

  test('remote-unreachable → local fallback: publishMcpResultToSse receives the authorize evaluation', async () => {
    const publishMcpResultToSse = jest.fn();
    const deps = baseDeps({
      publishMcpResultToSse,
      evaluateMcpFirstToolGate: async () => ({
        ran: true, permit: true,
        evaluation: { decision: 'PERMIT', decisionId: 'd7', decisionContext: 'McpFirstTool' },
      }),
      mcpCallTool: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); },
      callToolLocal: async () => ({ result: 'local-ok' }),
    });
    const outcome = await runMcpToolPipeline({
      tool: 'get_my_accounts', params: {}, flowTraceId: 'ft-7', startTime: Date.now(),
      req: { session: { user: { id: '1', oauthId: 'u1' } } }, deps,
    });
    expect(outcome.kind).toBe('result');
    expect(outcome.body._localFallback).toBe(true);
    const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-7');
    expect(call).toBeDefined();
    expect(call[1].mcpAuthorizeEvaluation).toMatchObject({ decision: 'PERMIT', decisionId: 'd7' });
    expect(call[1].mcpAuthorizeEvaluations).toBeNull();
  });

  test('gate block (dual-decision DENY) NOW publishes to SSE — Fix 2: previously ZERO cards on this path', async () => {
    const publishMcpResultToSse = jest.fn();
    const deps = baseDeps({
      publishMcpResultToSse,
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
      tool: 'create_transfer', params: { amount: 2500 }, flowTraceId: 'ft-8', startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
    });
    expect(outcome.kind).toBe('block');
    expect(publishMcpResultToSse).toHaveBeenCalled();
    const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-8');
    expect(call).toBeDefined();
    expect(call[1].denied).toBe(true);
    expect(call[1].mcpAuthorizeEvaluation).toMatchObject({ decision: 'DENY', decisionId: 'limit-1' });
    expect(call[1].mcpAuthorizeEvaluations).toEqual([
      { decision: 'PERMIT', decisionId: 'gate-1', raw: { decision: 'PERMIT' }, request: null, response: { decision: 'PERMIT' }, engine: 'pingone', decisionContext: 'McpFirstTool' },
      { source: 'transaction-policy', decision: 'DENY', decisionId: 'limit-1', raw: { decision: 'DENY', reason: 'over limit' }, engine: 'pingone', decisionContext: 'TransactionAmount' },
    ]);
  });

  test('a2a-supplied-token skip shape — Fix 1: publishMcpResultToSse gets NEITHER field, never a false PERMIT', async () => {
    const publishMcpResultToSse = jest.fn();
    const deps = baseDeps({
      publishMcpResultToSse,
      mcpCallTool: async () => ({ content: [{ text: 'ok' }] }),
    });
    await runMcpToolPipeline({
      tool: 'create_transfer', params: { amount: 100 }, flowTraceId: 'ft-9', startTime: Date.now(),
      req: { session: { user: { id: 'u1' } } }, deps,
      skipBffAuthorize: true,
    });
    const call = publishMcpResultToSse.mock.calls.find((c) => c[0] === 'ft-9');
    expect(call).toBeDefined();
    // The skip shape ({ran:false, skipped:true, skipReason:'a2a_supplied_token'})
    // has no .decision — splitAuthorizeEvaluationForSse must null both fields out
    // rather than let it read as a real PERMIT on the Token Chain.
    expect(call[1].mcpAuthorizeEvaluation).toBeNull();
    expect(call[1].mcpAuthorizeEvaluations).toBeNull();
  });
});
