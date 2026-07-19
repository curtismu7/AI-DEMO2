'use strict';

/**
 * Regression: MCP tool request params must be forwarded in the SSE payload.
 *
 * Suite A-D: pipeline unit tests — assert the mock dep receives requestJson.
 * Suite E:   publishMcpResultToSse unit test — asserts the SSE hub receives
 *            requestJson in the emitted payload (tests the server.js mapping
 *            that the pipeline tests can't see through the mock boundary).
 *
 * Four pipeline code paths covered:
 *   (A) Happy path — remote MCP call succeeds (mcpCallTool)
 *   (B) Exchange-failed local fallback — token exchange fails, local handler runs
 *   (C) Remote-unreachable fallback — mcpCallTool throws, local handler runs
 *   (D) Auth-challenge fallback — MCP server returns _meta.authChallenge,
 *       pipeline falls back to local handler
 *
 * Additional invariants locked in:
 *   - requestJson is the pre-HITL-strip snapshot (full original args)
 *   - empty params {} is forwarded, not nulled
 */

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  LOG_CATEGORIES: { MCP_TOOL_PIPELINE: 'mcp' },
}));

const { runMcpToolPipeline } = require('../services/mcpToolPipeline');

// ─── Minimal deps factory ────────────────────────────────────────────────────

function makeDeps(overrides = {}) {
  return {
    emit: jest.fn(),
    appEventLog: jest.fn(),
    publishTokenEventsToSse: jest.fn(),
    publishMcpResultToSse: jest.fn(),
    recordMcpToolCall: jest.fn(),
    buildTokenEvent: jest.fn(() => ({})),
    mcpNoBearerResponse: jest.fn(() => ({ status: 401, body: {} })),
    getSessionAccessToken: jest.fn(() => null),
    resolveMcpAccessTokenWithEvents: jest.fn(async () => ({
      token: 'mcp-token-abc',
      userSub: 'user-sub-123',
      tokenEvents: [],
      tratContextHeader: null,
    })),
    evaluateMcpFirstToolGate: jest.fn(async () => ({ ran: true, permit: true })),
    introspectToken: jest.fn(),
    callToolLocal: jest.fn(async () => ({ success: true, data: [] })),
    callToolViaGateway: jest.fn(),
    mcpCallTool: jest.fn(async () => ({
      content: [{ type: 'text', text: '{"orders":[]}' }],
      isError: false,
    })),
    decodeAgentId: jest.fn(() => undefined),
    createHitlChallenge: jest.fn(),
    http2Bridge: { createHttp2Session: jest.fn(), forwardToolCall: jest.fn() },
    pingoneAdapter: { callTool: jest.fn() },
    config: {
      pingoneAdminEnabled: false,
      pingoneAdminTools: new Set(),
      gatewayHttpUrl: null,
      useGateway: false,
      mcpUrl: 'ws://localhost:8080',
      mcpServerUrlEnv: null,
      useHttp2: false,
      introspectionConfigured: false,
    },
    ...overrides,
  };
}

function makeReq(sessionUser = {}) {
  return {
    session: { user: { id: 'user-sub-123', oauthId: 'user-sub-123', role: 'user', ...sessionUser } },
    correlationId: 'corr-test',
    intentToken: null,
  };
}

// ─── Suite A-D: pipeline → mock dep ─────────────────────────────────────────

describe('mcpToolPipeline SSE request payload — regression', () => {
  beforeEach(() => jest.clearAllMocks());

  // requestJson is the full JSON-RPC envelope snapshot (mcpToolPipeline.js builds
  // { jsonrpc, id, method:'tools/call', params:{ name, arguments } } as the wire request).
  const wireReq = (name, args) => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });

  // ── (A) Happy path ──────────────────────────────────────────────────────────

  test('(A) happy path: publishMcpResultToSse receives requestJson for remote MCP call', async () => {
    const deps = makeDeps();
    const params = { limit: 10, status: 'active' };

    await runMcpToolPipeline({
      tool: 'list_orders',
      params,
      flowTraceId: 'trace-a',
      startTime: Date.now(),
      req: makeReq(),
      deps,
    });

    expect(deps.publishMcpResultToSse).toHaveBeenCalledTimes(1);
    const [, payload] = deps.publishMcpResultToSse.mock.calls[0];
    expect(payload.tool).toBe('list_orders');
    expect(payload.requestJson).toEqual(wireReq('list_orders', params));
  });

  test('(A) empty params {} is forwarded, not nulled', async () => {
    const deps = makeDeps();

    await runMcpToolPipeline({
      tool: 'list_orders',
      params: {},
      flowTraceId: 'trace-a2',
      startTime: Date.now(),
      req: makeReq(),
      deps,
    });

    expect(deps.publishMcpResultToSse).toHaveBeenCalledTimes(1);
    const [, payload] = deps.publishMcpResultToSse.mock.calls[0];
    expect(payload.requestJson).toEqual(wireReq('list_orders', {}));
  });

  test('(A) HITL _hitl_challenge_id is stripped from params but requestJson preserves the full original call', async () => {
    const deps = makeDeps();
    const params = { amount: 500, _hitl_challenge_id: 'ch-xyz' };

    await runMcpToolPipeline({
      tool: 'create_transfer',
      params,
      flowTraceId: 'trace-a3',
      startTime: Date.now(),
      req: makeReq(),
      deps,
    });

    expect(deps.publishMcpResultToSse).toHaveBeenCalledTimes(1);
    const [, payload] = deps.publishMcpResultToSse.mock.calls[0];
    // requestJson is the pre-strip snapshot — includes _hitl_challenge_id
    expect(payload.requestJson).toEqual(wireReq('create_transfer', { amount: 500, _hitl_challenge_id: 'ch-xyz' }));
    // recordMcpToolCall also receives the pre-strip snapshot
    expect(deps.recordMcpToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ requestJson: wireReq('create_transfer', { amount: 500, _hitl_challenge_id: 'ch-xyz' }) })
    );
  });

  // ── (B) Exchange-failed local fallback ──────────────────────────────────────

  test('(B) exchange-failed fallback: publishMcpResultToSse receives requestJson', async () => {
    // The exchange-failure local fallback bypasses the gateway, the MCP server
    // and every authorization check, so it is now opt-in via
    // ff_local_fallback_on_exchange_failure (default OFF) — see
    // docs/authorization-decision-split.md F5. This case characterizes the SSE
    // payload OF that path, so it enables the flag. Driven through the env alias
    // because the pipeline lazily requires configStore and setup.js resets the
    // module registry between tests.
    process.env.FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE = 'true';
    const exchangeErr = Object.assign(new Error('token_exchange_failed'), {
      code: 'token_exchange_failed',
      httpStatus: 400,
      tokenEvents: [],
    });
    const deps = makeDeps({
      resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw exchangeErr; }),
      callToolLocal: jest.fn(async () => ({ success: true, data: [] })),
    });
    const params = { accountId: 'acc-99' };

    await runMcpToolPipeline({
      tool: 'get_balance',
      params,
      flowTraceId: 'trace-b',
      startTime: Date.now(),
      req: makeReq(),
      deps,
    });

    expect(deps.publishMcpResultToSse).toHaveBeenCalledTimes(1);
    const [, payload] = deps.publishMcpResultToSse.mock.calls[0];
    expect(payload.tool).toBe('get_balance');
    expect(payload.requestJson).toEqual(wireReq('get_balance', params));
    delete process.env.FF_LOCAL_FALLBACK_ON_EXCHANGE_FAILURE;
  });

  // ── (C) Remote-unreachable fallback ─────────────────────────────────────────

  test('(C) remote-unreachable fallback: publishMcpResultToSse receives requestJson', async () => {
    const networkErr = new Error('connect ECONNREFUSED');
    const deps = makeDeps({
      mcpCallTool: jest.fn(async () => { throw networkErr; }),
      callToolLocal: jest.fn(async () => ({ success: true, data: [] })),
    });
    const params = { fromAccount: 'a1', toAccount: 'a2', amount: 50 };

    await runMcpToolPipeline({
      tool: 'create_transfer',
      params,
      flowTraceId: 'trace-c',
      startTime: Date.now(),
      req: makeReq(),
      deps,
    });

    expect(deps.publishMcpResultToSse).toHaveBeenCalledTimes(1);
    const [, payload] = deps.publishMcpResultToSse.mock.calls[0];
    expect(payload.tool).toBe('create_transfer');
    expect(payload.requestJson).toEqual(wireReq('create_transfer', params));
  });

  // ── (D) Auth-challenge fallback ─────────────────────────────────────────────

  test('(D) auth-challenge fallback: publishMcpResultToSse receives requestJson when MCP server returns _meta.authChallenge', async () => {
    const deps = makeDeps({
      mcpCallTool: jest.fn(async () => ({
        content: [],
        isError: false,
        _meta: { authChallenge: { redirect: 'https://auth.example.com/login' } },
      })),
      callToolLocal: jest.fn(async () => ({ success: true, data: [{ id: 1 }] })),
    });
    const params = { orderId: 'ord-42' };

    await runMcpToolPipeline({
      tool: 'get_order',
      params,
      flowTraceId: 'trace-d',
      startTime: Date.now(),
      req: makeReq({ id: 'user-sub-123', oauthId: 'user-sub-123' }),
      deps,
    });

    expect(deps.callToolLocal).toHaveBeenCalledTimes(1);
    // Two publishes: one for the auth-challenge remote result, one for the local fallback result
    expect(deps.publishMcpResultToSse).toHaveBeenCalledTimes(2);
    for (const [, payload] of deps.publishMcpResultToSse.mock.calls) {
      expect(payload.tool).toBe('get_order');
      expect(payload.requestJson).toEqual(wireReq('get_order', params));
    }
  });
});

// ─── Suite E: publishMcpResultToSse SSE wire test ───────────────────────────
// Tests the real implementation against a mocked SSE hub — verifies that
// requestJson actually appears in the event emitted on the wire, which the
// pipeline tests above cannot see through the mock boundary.

jest.mock('../services/mcpFlowSseHub', () => ({ publish: jest.fn() }));
jest.mock('../utils/correlationContext', () => ({ getCorrelationId: () => null }));

const mcpFlowSseHub = require('../services/mcpFlowSseHub');
const { publishMcpResultToSse } = require('../services/mcpSsePublisher');

describe('publishMcpResultToSse SSE wire payload — regression', () => {
  beforeEach(() => jest.clearAllMocks());

  test('emitted SSE payload contains requestJson matching the passed value', () => {
    const requestJson = { accountId: 'acc-7', limit: 5 };

    publishMcpResultToSse('trace-e', {
      tool: 'get_transactions',
      result: { content: [{ type: 'text', text: '[]' }], isError: false },
      durationMs: 42,
      isDelegated: true,
      requestJson,
    });

    expect(mcpFlowSseHub.publish).toHaveBeenCalledTimes(1);
    const [traceId, payload] = mcpFlowSseHub.publish.mock.calls[0];
    expect(traceId).toBe('trace-e');
    expect(payload.type).toBe('mcp-result');
    expect(payload.toolName).toBe('get_transactions');
    expect(payload.requestJson).toEqual(requestJson);
    expect(payload.isDelegated).toBe(true);
  });

  test('emitted SSE payload has requestJson: null when requestJson is not provided', () => {
    publishMcpResultToSse('trace-e2', {
      tool: 'list_orders',
      result: { content: [], isError: false },
      durationMs: 10,
      isDelegated: false,
    });

    const [, payload] = mcpFlowSseHub.publish.mock.calls[0];
    expect(payload.requestJson).toBeNull();
  });

  test('no-op when flowTraceId is falsy', () => {
    publishMcpResultToSse(null, { tool: 'list_orders', result: {}, durationMs: 0, isDelegated: false, requestJson: {} });
    expect(mcpFlowSseHub.publish).not.toHaveBeenCalled();
  });
});
