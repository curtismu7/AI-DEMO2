/**
 * @file mcpToolPipeline.gatewayDenyOnSuccess.test.js
 *
 * Regression: callToolViaGateway returns { result, gwAuditTrail } normally
 * even when PingGateway's own P1AZ check denies the call (it only throws on
 * connection/HTTP-level failures) — so a DENY never reached the block/error
 * handling that already exists for the thrown-error path, and the pipeline
 * returned httpStatus 200 with the LLM left to narrate a raw error envelope
 * (e.g. {"message":"Unauthorized"}) instead of a clear stop.
 */
'use strict';

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
      useGateway: true,
      gatewayHttpUrl: 'http://gw',
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
    tool: 'list_gear',
    params: {},
    flowTraceId: '',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1' },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

describe('runMcpToolPipeline — gateway DENY on the non-throwing success path', () => {
  test('real PingOne Authorize DENY (has correlationId) → block 403 gateway_policy_denied, not httpStatus 200', async () => {
    const deps = makeDeps();
    deps.callToolViaGateway = jest.fn(async () => ({
      result: { content: [{ text: '{"message":"Unauthorized"}' }], isError: true },
      gwAuditTrail: {
        authorize: {
          decision: 'DENY',
          correlationId: 'abc-123',
          reason: 'Amount exceeds delegated limit',
        },
      },
    }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({
      kind: 'block',
      httpStatus: 403,
      body: { error: 'gateway_policy_denied', tool: 'list_gear', message: 'Amount exceeds delegated limit' },
    });
  });

  test('PingGateway upstream call to PingOne itself unauthorized (no correlationId) → block 503 gateway_misconfigured, not policy-denied', async () => {
    const deps = makeDeps();
    deps.callToolViaGateway = jest.fn(async () => ({
      result: { content: [{ text: '{"message":"Unauthorized"}' }], isError: true },
      gwAuditTrail: {
        authorize: {
          decision: 'DENY',
          reason: null,
          rawResponse: { message: 'Unauthorized' },
        },
      },
    }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({
      kind: 'block',
      httpStatus: 503,
      body: { error: 'gateway_misconfigured', tool: 'list_gear' },
    });
    expect(outcome.body.error).not.toBe('gateway_policy_denied');
  });

  test('gwAuditTrail.authorize.decision PERMIT still returns a normal result (no regression)', async () => {
    const deps = makeDeps();
    deps.callToolViaGateway = jest.fn(async () => ({
      result: { content: [{ text: 'gw-ok' }] },
      gwAuditTrail: { authorize: { decision: 'PERMIT', correlationId: 'abc-123' } },
    }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('result');
    expect(outcome.httpStatus).toBe(200);
  });
});
