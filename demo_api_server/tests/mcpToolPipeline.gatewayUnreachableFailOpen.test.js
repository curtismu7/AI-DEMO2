'use strict';
/**
 * #67 — gateway-unreachable must NOT fail open to unauthorized local execution.
 *
 * When the call is gateway-authoritative (useGateway) the BFF skips its own
 * authorize gate because the gateway is the sole PDP. A transport failure
 * reaching the gateway (GATEWAY_UNREACHABLE / GATEWAY_TIMEOUT — whose messages
 * contain ECONNREFUSED / "timed out" and so satisfy the isConnErr heuristic)
 * previously ran the tool via callToolLocal, bypassing the gateway, the MCP
 * server, and PingOne Authorize (group/tier/RAR/scope) — fail-open on the
 * money-movement path. It must now surface the transport error (503/504) and
 * only fall back locally when the SAME opt-in as the exchange-failure fallback
 * (ff_local_fallback_on_exchange_failure) is on, marking the result _degraded.
 *
 * makeDeps()/makeCtx() follow mcpToolPipeline.gatewayDenyEvidence.test.js's DI pattern.
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
    tool: 'transfer_funds',
    params: { amount: 2500 },
    flowTraceId: 'ft-1',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1', body: { vertical: 'sporting-goods', useCaseId: 'transfer' } },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

function gatewayUnreachableError() {
  // Shape produced by mcpGatewayClient._normalizeGatewayNetworkError for ECONNREFUSED.
  return Object.assign(new Error('MCP gateway unreachable (ECONNREFUSED)'), {
    code: 'GATEWAY_UNREACHABLE',
    httpStatus: 503,
  });
}

function gatewayTimeoutError() {
  return Object.assign(new Error('MCP gateway request timed out after 30000ms'), {
    code: 'GATEWAY_TIMEOUT',
    httpStatus: 504,
  });
}

describe('runMcpToolPipeline — #67 gateway-unreachable does not fail open', () => {
  afterEach(() => {
    delete process.env.FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE;
    jest.restoreAllMocks();
  });

  test('gateway UNREACHABLE + fallback flag OFF (default): returns 503, does NOT run callToolLocal', async () => {
    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => { throw gatewayUnreachableError(); }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));

    expect(out.kind).toBe('error');
    expect(out.httpStatus).toBe(503);
    expect(out.body.error).toBe('GATEWAY_UNREACHABLE');
    expect(deps.callToolLocal).not.toHaveBeenCalled();
    expect(out.body._localFallback).toBeUndefined();
  });

  test('gateway TIMEOUT + fallback flag OFF (default): returns 504, does NOT run callToolLocal', async () => {
    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => { throw gatewayTimeoutError(); }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));

    expect(out.kind).toBe('error');
    expect(out.httpStatus).toBe(504);
    expect(out.body.error).toBe('GATEWAY_TIMEOUT');
    expect(deps.callToolLocal).not.toHaveBeenCalled();
  });

  test('gateway UNREACHABLE + opt-in flag ON: runs callToolLocal and marks result _degraded', async () => {
    // Driven through the env alias because the pipeline lazily requires
    // configStore and setup.js resets the module registry between tests
    // (a spy on the singleton does not survive the reset). Mirrors
    // mcpToolPipelineSseRequest.regression.test.js's exchange-failure case.
    process.env.FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE = 'true';

    const deps = makeDeps({
      callToolViaGateway: jest.fn(async () => { throw gatewayUnreachableError(); }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));

    expect(out.kind).toBe('result');
    expect(out.httpStatus).toBe(200);
    expect(deps.callToolLocal).toHaveBeenCalledTimes(1);
    expect(out.body._localFallback).toBe(true);
    expect(out.body._degraded).toBe(true);
    expect(out.body.policy_source).toBe('local-fallback');
  });
});
