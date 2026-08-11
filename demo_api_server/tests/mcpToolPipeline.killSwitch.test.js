/**
 * The kill-check must run at the ONE point every real tool call passes
 * through — before the branch that decides whether PingOne Authorize runs
 * locally (evaluateMcpFirstToolGate) or the call is gateway-authoritative
 * (skipped entirely). Placing it after that branch, as the prior plan did,
 * meant the check never ran at all under the default (gateway-enabled)
 * deployment.
 */
jest.mock('../services/killSwitchService', () => ({
  isAgentRevoked: jest.fn(),
}));
const killSwitchService = require('../services/killSwitchService');
const { runMcpToolPipeline } = require('../services/mcpToolPipeline');

function buildDeps(overrides = {}) {
  return {
    config: { useGateway: true, introspectionConfigured: false }, // gateway-authoritative — the path the OLD check never covered
    emit: jest.fn(),
    resolveMcpAccessTokenWithEvents: jest.fn().mockResolvedValue({
      token: 'fake.token.value', tokenEvents: [], userSub: 'pingone-user-123', tratContextHeader: null,
    }),
    publishTokenEventsToSse: jest.fn(),
    mcpNoBearerResponse: jest.fn(),
    // Beyond the kill-check itself, runMcpToolPipeline's gateway-authoritative
    // path (useGateway: true) still needs these to reach a return without
    // throwing on an unrelated unmocked dep — mirrors the deps shape used by
    // mcpToolPipeline.gatewayDenyEvidence.test.js's makeDeps().
    getSessionAccessToken: jest.fn(() => 'sess-tok'),
    buildTokenEvent: jest.fn((id, label, status, _t, detail, extra) => ({ id, label, status, detail, extra })),
    appEventLog: jest.fn(),
    callToolViaGateway: jest.fn().mockResolvedValue({ result: { content: [] }, gwAuditTrail: {} }),
    publishMcpResultToSse: jest.fn(),
    recordMcpToolCall: jest.fn(),
    ...overrides,
  };
}

describe('runMcpToolPipeline — kill switch runs before the gateway/local branch', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a killed agent is blocked even when useGateway is true (the path the old check missed)', async () => {
    killSwitchService.isAgentRevoked.mockResolvedValueOnce(true);
    const req = { sessionID: 'sess-1', session: { user: { oauthId: 'pingone-user-123' } } };
    const ctx = { tool: 'reorder', params: {}, req, deps: buildDeps(), startTime: Date.now() };

    const out = await runMcpToolPipeline(ctx);

    expect(out.kind).toBe('block');
    expect(out.httpStatus).toBe(403);
    expect(out.body.error).toBe('agent_killed');
    expect(killSwitchService.isAgentRevoked).toHaveBeenCalledWith('user:pingone-user-123');
  });

  test('a non-killed agent proceeds past the check (gateway path continues)', async () => {
    killSwitchService.isAgentRevoked.mockResolvedValueOnce(false);
    const req = { sessionID: 'sess-1', session: { user: { oauthId: 'pingone-user-123' } } };
    const ctx = { tool: 'reorder', params: {}, req, deps: buildDeps(), startTime: Date.now() };

    const out = await runMcpToolPipeline(ctx);

    expect(out.body?.error).not.toBe('agent_killed');
  });
});
