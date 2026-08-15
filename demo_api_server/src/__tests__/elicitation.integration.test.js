'use strict';

/**
 * Cross-module integration: the REAL mcpGatewayClient.callToolViaGateway
 * feeding the REAL runMcpToolPipeline, with only axios mocked at the network
 * boundary — no field-name assumptions between the two modules. This is
 * exactly the seam that hid the mcpToolPipeline.js gap (a hand-rolled
 * `jest.fn()` throw in the unit tests could not have caught a field-name
 * mismatch between what mcpGatewayClient actually throws and what
 * mcpToolPipeline actually reads).
 */

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');
const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

function makeDeps(over = {}) {
  return {
    resolveMcpAccessTokenWithEvents: jest.fn(async () => ({ token: 't', tokenEvents: [], userSub: 'u1' })),
    evaluateMcpFirstToolGate: jest.fn(async () => ({ ran: true, permit: true, evaluation: { decision: 'PERMIT' } })),
    getSessionAccessToken: jest.fn(() => 'sess-tok'),
    introspectToken: jest.fn(async () => ({ active: true, sub: 'u1', scope: 'read', exp: 9999999999 })),
    callToolLocal: jest.fn(async () => ({ content: [{ text: 'local-ok' }] })),
    mcpCallTool: jest.fn(async () => ({ content: [{ text: 'remote-ok' }] })),
    // The REAL function under test — only axios (its own network boundary) is mocked.
    callToolViaGateway,
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
      gatewayHttpUrl: 'https://api.ping.demo:3005',
      mcpUrl: 'ws://localhost:8080',
      mcpServerUrlEnv: undefined,
      useHttp2: false,
      pingoneAdminEnabled: false,
      pingoneAdminTools: new Set(),
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

test('gateway 428 elicitation_required (real mcpGatewayClient + real mcpToolPipeline) blocks with the exact routes/agentTool.js-consumable shape', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 428,
    headers: {},
    data: {
      error: 'elicitation_required',
      message: 'Confirm create_withdrawal?',
      elicitation_id: 'elic-1',
      prompt: 'Confirm create_withdrawal?',
      tool_name: 'create_withdrawal',
      expires_in: 120,
    },
  });

  const outcome = await runMcpToolPipeline(makeCtx());

  expect(outcome.kind).toBe('block');
  expect(outcome.httpStatus).toBe(428);
  expect(outcome.body).toMatchObject({
    error: 'elicitation_required',
    elicitationId: 'elic-1',
    prompt: 'Confirm create_withdrawal?',
    tool: 'create_withdrawal',
  });

  // routes/agentTool.js's isElicitation branch — same JSON.stringify({error, ...body})
  // wrapping bffMcpToolExecutor.js applies to any 'block' outcome.
  const parsed = JSON.parse(JSON.stringify({ error: outcome.body.error, ...outcome.body }));
  expect(parsed.error).toBe('elicitation_required');
  expect(parsed.elicitationId).toBe('elic-1');
  expect(parsed.prompt).toBe('Confirm create_withdrawal?');
});
