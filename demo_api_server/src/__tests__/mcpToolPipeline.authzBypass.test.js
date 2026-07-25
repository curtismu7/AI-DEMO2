/**
 * @file mcpToolPipeline.authzBypass.test.js
 *
 * Two bypasses of the authorization gate, from
 * docs/authorization-decision-split.md F5:
 *
 *   1. Token-exchange failure fell back to the LOCAL tool handler, skipping the
 *      gateway AND the MCP server — and therefore every authorization check on
 *      the way. Now behind ff_local_fallback_on_exchange_failure (default OFF),
 *      and any such response is marked degraded (contract C2).
 *   2. A gate that did not run (ran:false) was invisible in the response, so a
 *      skip looked exactly like a PERMIT (contract C4).
 */
'use strict';

// NOTE: the pipeline reads the flag through a LAZY require('./configStore'),
// and src/__tests__/setup.js calls jest.resetModules() after every test — so a
// jest.mock/spy on configStore is a different module instance than the one the
// pipeline resolves at call time. Drive the real configStore through its env
// alias instead (FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE), which is stable across
// module resets.
const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

const FLAG_ENV = 'FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE';

function makeDeps(over = {}) {
  return {
    resolveMcpAccessTokenWithEvents: jest.fn(async () => ({ token: 't', tokenEvents: [], userSub: 'u1' })),
    evaluateMcpFirstToolGate: jest.fn(async () => ({ ran: true, permit: true, evaluation: { decision: 'PERMIT' } })),
    getSessionAccessToken: jest.fn(() => 'sess-tok'),
    introspectToken: jest.fn(async () => ({ active: true, sub: 'u1' })),
    callToolLocal: jest.fn(async () => ({ content: [{ text: 'local-ok' }] })),
    mcpCallTool: jest.fn(async () => ({ content: [{ text: 'remote-ok' }] })),
    callToolViaGateway: jest.fn(async () => ({ result: { content: [] }, gwAuditTrail: null })),
    http2Bridge: { createHttp2Session: jest.fn(() => ({})), forwardToolCall: jest.fn(async () => ({ content: [] })) },
    buildTokenEvent: jest.fn((id, label, status) => ({ id, label, status })),
    mcpNoBearerResponse: jest.fn(() => ({ status: 401, body: { error: 'no_bearer' } })),
    pingoneAdapter: { callTool: jest.fn(), getWorkerTokenDecoded: jest.fn() },
    recordMcpToolCall: jest.fn(),
    createPendingDecision: jest.fn(() => ({ taskId: 't' })),
    createHitlChallenge: jest.fn(async () => ({ challengeId: 't', expiresAt: 'x' })),
    decodeAgentId: jest.fn(() => 'agent-1'),
    appEventLog: jest.fn(),
    publishMcpResultToSse: jest.fn(),
    publishTokenEventsToSse: jest.fn(),
    emit: jest.fn(),
    config: {
      introspectionConfigured: false, useGateway: false, gatewayHttpUrl: '',
      mcpUrl: 'ws://localhost:8080', mcpServerUrlEnv: undefined, useHttp2: false,
      pingoneAdminEnabled: false, pingoneAdminTools: new Set(),
    },
    ...over,
  };
}

function makeCtx(over = {}) {
  return {
    tool: 'get_my_accounts',
    params: {},
    flowTraceId: '',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1' },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

/** Exchange failure of the shape that previously triggered the local fallback. */
function exchangeScopeError() {
  return Object.assign(new Error('At least one scope must be granted'), { httpStatus: 400 });
}

let savedFlag;
beforeEach(() => {
  jest.clearAllMocks();
  savedFlag = process.env[FLAG_ENV];
  delete process.env[FLAG_ENV]; // exercise the shipped default
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG_ENV];
  else process.env[FLAG_ENV] = savedFlag;
});

describe('exchange-failure local fallback (F5)', () => {
  it('is OFF by default — the ungated local handler is never reached', async () => {
    const deps = makeDeps({
      resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw exchangeScopeError(); }),
    });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));

    expect(deps.callToolLocal).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('error');
    expect(outcome.httpStatus).toBe(400);
    expect(outcome.body.error).toBe('token_exchange_failed');
  });

  it('when explicitly enabled, runs the local handler and marks the result degraded (C2)', async () => {
    process.env[FLAG_ENV] = 'true';
    const deps = makeDeps({
      resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw exchangeScopeError(); }),
      callToolLocal: jest.fn(async () => ({ content: [{ text: 'local' }] })),
    });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));

    expect(deps.callToolLocal).toHaveBeenCalled();
    expect(outcome.kind).toBe('result');
    expect(outcome.body._localFallback).toBe(true);
    expect(outcome.body._exchangeFailed).toBe(true);
    // C2: a response produced without the gateway/MCP-server authorization path
    // must say so.
    expect(outcome.body._degraded).toBe(true);
    expect(outcome.body.policy_source).toBe('local-fallback');
  });

  it('no-bearer-token path returns the re-auth block, not an ungated local read', async () => {
    // The no-bearer branch used to serve the tool through the local handler when a
    // session user was present, bypassing the Authorize gate (Proof of Enforcement
    // rendered "Incomplete"). It now surfaces mcpNoBearerResponse so the SPA
    // re-authenticates and the retry runs the real exchange → gateway → Authorize
    // path. Independent of the F5 exchange-failure flag (a different branch).
    const deps = makeDeps({
      resolveMcpAccessTokenWithEvents: jest.fn(async () => ({ token: null, tokenEvents: [], userSub: null })),
    });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({ kind: 'block', httpStatus: 401, body: { error: 'no_bearer' } });
    expect(deps.callToolLocal).not.toHaveBeenCalled();
  });
});

describe('a skipped gate is visible in the response (C4)', () => {
  it('surfaces skipReason on the tool response when the gate did not run', async () => {
    const deps = makeDeps({
      evaluateMcpFirstToolGate: jest.fn(async () => ({
        ran: false, skipReason: 'pingone_error_failover_permit',
      })),
    });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));

    expect(outcome.kind).toBe('result');
    expect(outcome.body.mcpAuthorizeEvaluation).toMatchObject({
      ran: false,
      skipped: true,
      skipReason: 'pingone_error_failover_permit',
      decisionContext: 'McpFirstTool',
    });
    // Must NOT look like a decision was made.
    expect(outcome.body.mcpAuthorizeEvaluation.decision).toBeUndefined();
  });

  it('logs the skip reason at warn level', async () => {
    const deps = makeDeps({
      evaluateMcpFirstToolGate: jest.fn(async () => ({
        ran: false, skipReason: 'authorize_not_configured_failover_permit',
      })),
    });
    await runMcpToolPipeline(makeCtx({ deps }));

    expect(deps.appEventLog).toHaveBeenCalledWith(
      'authorize', 'warn',
      expect.stringContaining('authorize_not_configured_failover_permit'),
      expect.anything(),
    );
  });

  it('a real PERMIT still reports the decision, not a skip', async () => {
    const deps = makeDeps();
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.body.mcpAuthorizeEvaluation).toMatchObject({ decision: 'PERMIT' });
    expect(outcome.body.mcpAuthorizeEvaluation.skipped).toBeUndefined();
  });

  // The A2A specialist path (bffMcpToolExecutor sets ctx.skipBffAuthorize) was
  // the last C4 gap: it emitted an SSE phase and fell through WITHOUT setting
  // mcpAuthorizeEvaluationThisRequest, so the response body was identical to a
  // run where the gate PERMITted. The other two skips already set it.
  it('the A2A supplied-token skip is visible in the response, not just on SSE', async () => {
    const deps = makeDeps();
    const outcome = await runMcpToolPipeline(makeCtx({ deps, skipBffAuthorize: true }));

    expect(deps.evaluateMcpFirstToolGate).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('result');
    expect(outcome.body.mcpAuthorizeEvaluation).toMatchObject({
      ran: false,
      skipped: true,
      skipReason: 'a2a_supplied_token',
      decisionContext: 'McpFirstTool',
    });
    // Must NOT look like a decision was made.
    expect(outcome.body.mcpAuthorizeEvaluation.decision).toBeUndefined();
  });

  it('the A2A skip is distinguishable from a real PERMIT on the same tool', async () => {
    const permitted = await runMcpToolPipeline(makeCtx({ deps: makeDeps() }));
    const skipped = await runMcpToolPipeline(makeCtx({ deps: makeDeps(), skipBffAuthorize: true }));

    expect(permitted.body.mcpAuthorizeEvaluation).not.toEqual(
      skipped.body.mcpAuthorizeEvaluation,
    );
  });
});
