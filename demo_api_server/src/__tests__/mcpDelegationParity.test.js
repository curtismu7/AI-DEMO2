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
//
// _getCredentials() reads exclusively via configStore.getEffective() (not
// .get()) so the env-var alias map is traversed — see
// services/pingOneAuthorizeService.js commit da9128062 ("harden: MCP Gateway
// probe, P1AZ endpoint check, always-on scope validator"). Mock both so the
// service resolves credentials the same way it does at runtime.
const configStoreMockVals = {
  pingone_environment_id: 'env-123',
  pingone_region: 'com',
  authorize_worker_client_id: 'worker-id',
  authorize_worker_client_secret: 'worker-secret',
  authorize_mcp_decision_endpoint_id: 'mcp-ep-1',
};
jest.mock('../../services/configStore', () => ({
  get: jest.fn((key) => configStoreMockVals[key] || null),
  getEffective: jest.fn((key) => configStoreMockVals[key] || null),
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

beforeEach(() => {
  // The worker token is cached across evaluate calls; reset so every test's
  // "call[0] token, call[1] decision" mock queue lines up.
  if (typeof svc._resetAuthorizeRuntimeState === 'function') svc._resetAuthorizeRuntimeState();
});

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

    // Live PingOne policy uses BFF-pre-resolved scalars (InRequiredGroup, UserTier),
    // not a UserGroups array — forwarding the array causes INVALID_VALUE (400).
    test('forwards group-policy scalars but not UserGroups array', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1',
        toolName: 'get_my_accounts',
        tokenAudience: 'mcp.aud',
        mcpResourceUri: 'mcp.aud',
        requiredGroup: 'Banking_Privileged',
        userGroups: ['Standard', 'Banking_Privileged'],
        userTier: 'Standard',
        inRequiredGroup: true,
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.RequiredGroup).toBe('Banking_Privileged');
      expect(body.UserTier).toBe('Standard');
      expect(body.InRequiredGroup).toBe(true);
      expect(body.UserGroups).toBeUndefined();
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

  // ── F3 / contract C1 — canonical decision parameter set ───────────────────
  // The BFF McpFirstTool gate and the gateway McpToolCall gate must send the
  // SAME keys, or they can legitimately disagree on the same call. These pin
  // the keys the BFF was missing (planning/authz-fix-contract.md §C1).
  describe('C1 canonical parameter set', () => {
    // ActChainDepth was NEVER sent, so the cloud rule
    // "Deny — Invalid A2A Generalist" (ActChainDepth > 1 AND NestedActClientId
    // != <allowed>) could not fire from the BFF: the TF attribute defaults to 0.
    test('sends ActChainDepth=0 when no actor is present', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'get_my_accounts',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.ActChainDepth).toBe(0);
    });

    test('sends ActChainDepth=1 for a single actor', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'get_my_accounts',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
        actClientId: 'agent-1',
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.ActChainDepth).toBe(1);
    });

    // The reachability case: depth 2 is what makes the A2A generalist rule fire.
    test('sends ActChainDepth=2 for a nested (A2A) actor chain', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'get_my_accounts',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
        actClientId: 'specialist-1', nestedActClientId: 'generalist-1',
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.ActChainDepth).toBe(2);
      expect(body.NestedActClientId).toBe('generalist-1');
    });

    // F11 — the ONLY place banking scopes can be enforced on the default path.
    test('forwards TokenScopes so policy can enforce least privilege', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'create_transfer',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
        tokenScopes: 'gateway:mcp:invoke banking:transfers:write',
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.TokenScopes).toBe('gateway:mcp:invoke banking:transfers:write');
    });

    // C1 rule 3: a caller that cannot supply a value OMITS the key rather than
    // sending a falsy placeholder ("unknown" != "verified absent").
    test('omits TokenScopes and the temporal claims when unknown', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'get_my_accounts',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.TokenScopes).toBeUndefined();
      expect(body.TokenExp).toBeUndefined();
      expect(body.TokenIat).toBeUndefined();
      expect(body.TokenNbf).toBeUndefined();
      expect(body.TokenIss).toBeUndefined();
      expect(body.MayActSub).toBeUndefined();
    });

    test('forwards the remaining C1 token facts and request keys', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'create_transfer',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
        tokenExp: 1900000000, tokenIat: 1800000000, tokenNbf: 1800000000,
        tokenIss: 'https://auth.pingone.com/env-123/as',
        mayActSub: 'agent-1', clientId: 'u1',
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      // TokenAudActual mirrors TokenAudience (C1: retained for mock back-compat).
      expect(body.TokenAudActual).toBe('mcp.aud');
      expect(body.TokenExp).toBe(1900000000);
      expect(body.TokenIat).toBe(1800000000);
      expect(body.TokenNbf).toBe(1800000000);
      expect(body.TokenIss).toBe('https://auth.pingone.com/env-123/as');
      expect(body.MayActSub).toBe('agent-1');
      expect(body.ClientId).toBe('u1');
      expect(body.McpMethod).toBe('tools/call');
    });

    // F5 — admin is no longer a code-level skip; it is a policy INPUT.
    test('forwards UserRole so policy can decide on admin, not code', async () => {
      mockWorkerThenDecision({ id: 'd1', decision: 'PERMIT', obligations: [] });
      await svc.evaluateMcpToolDelegation({
        userId: 'u1', toolName: 'get_my_accounts',
        tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
        userRole: 'admin',
      });
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body).parameters;
      expect(body.UserRole).toBe('admin');
    });
  });

  // ── F8 — silent contract drift on statement codes ─────────────────────────
  // The unknown-type warning deliberately excluded `statements`, so a RENAMED
  // statement code degraded to "no gate" with nothing in the logs. Statements
  // are now checked against the known-code set; only genuinely unknown codes
  // warn, so the benign PERMIT/DENY effects stay quiet.
  describe('unrecognised statement codes warn (F8)', () => {
    let warnSpy;
    beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { warnSpy.mockRestore(); });

    const evaluate = () => svc.evaluateMcpToolDelegation({
      userId: 'u1', toolName: 'create_transfer',
      tokenAudience: 'mcp.aud', mcpResourceUri: 'mcp.aud',
    });

    test('warns when a statement code is not a known gate or known effect', async () => {
      mockWorkerThenDecision({
        id: 'd1', decision: 'PERMIT',
        statements: [{ code: 'mcp-tier-amount-exceeded-v2' }],
      });
      await evaluate();
      const warned = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(warned).toMatch(/mcp-tier-amount-exceeded-v2/);
    });

    test('stays quiet for benign PERMIT statements', async () => {
      mockWorkerThenDecision({
        id: 'd1', decision: 'PERMIT',
        statements: [{ code: 'mcp-tool-authorized' }, { code: 'transaction-approved' }],
      });
      await evaluate();
      const warned = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(warned).not.toMatch(/Unrecognised/i);
    });

    test('stays quiet for known DENY statements (decision carries the enforcement)', async () => {
      mockWorkerThenDecision({
        id: 'd1', decision: 'DENY',
        statements: [{ code: 'mcp-tier-amount-exceeded' }],
      });
      await evaluate();
      const warned = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(warned).not.toMatch(/Unrecognised/i);
    });

    test('stays quiet for a recognised gate statement', async () => {
      mockWorkerThenDecision({
        id: 'd1', decision: 'INDETERMINATE',
        statements: [{ code: 'step-up-required' }],
      });
      const r = await evaluate();
      expect(r.stepUpRequired).toBe(true);
      const warned = warnSpy.mock.calls.flat().map(String).join(' ');
      expect(warned).not.toMatch(/Unrecognised/i);
    });
  });
});
