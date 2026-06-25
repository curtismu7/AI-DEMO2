/**
 * @file mcpDelegationParity.test.js
 *
 * Live PingAuthorize MCP-delegation path: exercises the REAL
 * pingOneAuthorizeService.evaluateMcpToolDelegation with global.fetch mocked
 * (worker-token call, then decision-endpoint call), so the actual parameter
 * block and _classifyRawObligations() run end-to-end — not stubbed.
 *
 * Focus: the HITL receipt (hitlApproved) parameter is forwarded to the decision
 * endpoint only when true (conditional-spread, parity with the simulated
 * engine). The Trust Framework policy is what flips INDETERMINATE→PERMIT on it;
 * the CODE under test only forwards the flag.
 *
 * Note: this path uses DecisionContext='McpFirstTool' and carries no
 * Amount/TransactionType (unlike the simulated engine's McpToolCall shape).
 */

// configStore mock — supply worker creds + an MCP decision endpoint so
// evaluateMcpToolDelegation proceeds to the fetch calls.
jest.mock('../../services/configStore', () => ({
  get: jest.fn((key) => {
    const vals = {
      pingone_environment_id: 'env-123',
      pingone_region: 'com',
      authorize_worker_client_id: 'worker-id',
      authorize_worker_client_secret: 'worker-secret',
      authorize_mcp_decision_endpoint_id: 'mcp-ep-1',
    };
    return vals[key] || null;
  }),
  getEffective: jest.fn(() => null),
  isReadOnly: jest.fn(() => true),
}));

const svc = require('../../services/pingOneAuthorizeService');

let fetchSpy;

/**
 * Mock the two sequential fetches evaluateMcpToolDelegation triggers:
 *   call[0] → worker token (client_credentials)
 *   call[1] → decision endpoint POST
 */
function mockWorkerThenDecision(decisionBody) {
  fetchSpy = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'worker-token-abc' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => decisionBody,
    });
}

afterEach(() => {
  if (fetchSpy) fetchSpy.mockRestore();
  jest.clearAllMocks();
});

describe('evaluateMcpToolDelegation — decision parameters', () => {
  test('sends the McpFirstTool parameter block', async () => {
    mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
    await svc.evaluateMcpToolDelegation({
      userId: 'u1',
      toolName: 'create_transfer',
      tokenAudience: 'mcp.aud',
      mcpResourceUri: 'mcp.aud',
    });
    // Pin the call count: the real fn does exactly worker-token + decision POST.
    // If a future code path adds a third fetch, this fails clearly instead of
    // throwing "cannot read 'ok' of undefined" on an unmocked call.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
    expect(body.DecisionContext).toBe('McpFirstTool');
    expect(body.UserId).toBe('u1');
    expect(body.ToolName).toBe('create_transfer');
    expect(body.TokenAudience).toBe('mcp.aud');
    expect(body.McpResourceUri).toBe('mcp.aud');
  });

  // HITL receipt parity: the live engine forwards HitlApproved as a decision
  // parameter (only when true, matching the simulated engine's conditional
  // spread). The TF policy flips INDETERMINATE→PERMIT on it; the code only
  // forwards the flag, so we assert the wire body, not the decision.
  describe('HITL receipt (hitlApproved)', () => {
    test('forwards HitlApproved=true in decision params when set', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1',
        toolName: 'create_transfer',
        tokenAudience: 'mcp.aud',
        mcpResourceUri: 'mcp.aud',
        hitlApproved: true,
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.HitlApproved).toBe(true);
    });

    test('omits HitlApproved from decision params when not set (default)', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'INDETERMINATE', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1',
        toolName: 'create_transfer',
        tokenAudience: 'mcp.aud',
        mcpResourceUri: 'mcp.aud',
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.HitlApproved).toBeUndefined();
    });

    // NOTE: this asserts pass-through MAPPING, not receipt→permit causation.
    // The live engine only forwards HitlApproved; the TF policy (out of repo)
    // is what flips INDETERMINATE→PERMIT. With the decision endpoint mocked to
    // PERMIT, this would pass with hitlApproved omitted too — it proves the
    // response→flag mapping is correct, NOT that a receipt causes the permit.
    // Receipt-causation is covered locally by the simulated engine's tests.
    test('PERMIT decision response maps to permit flags (pass-through, not causation)', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      const r = await svc.evaluateMcpToolDelegation({
        userId: 'u1',
        toolName: 'create_transfer',
        tokenAudience: 'mcp.aud',
        mcpResourceUri: 'mcp.aud',
        hitlApproved: true,
      });
      expect(r.decision).toBe('PERMIT');
      expect(r.stepUpRequired).toBe(false);
      expect(r.consentRequired).toBe(false);
    });
  });
});
