/**
 * @file mcpToolAuthorizationService.test.js
 * First MCP tool PingOne Authorize gate (session-scoped).
 */

jest.mock('../../services/configStore');
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
  isMcpDelegationDecisionReady: jest.fn(),
  // Transaction-limit policy, consulted for amount-bearing tool calls.
  // Default PERMIT so existing cases keep the gate's own decision.
  evaluateTransaction: jest.fn(async () => ({ decision: 'PERMIT' })),
}));
jest.mock('../../services/simulatedAuthorizeService', () => ({
  evaluateMcpFirstTool: jest.fn(),
  isSimulatedModeEnabled: jest.fn(),
  resolveAuthorizeMode: jest.fn(),
  getDenyAmountUsd: jest.fn(() => 2000),
  getStepUpAmountUsd: jest.fn(() => 500),
  getConfirmAmountUsd: jest.fn(() => 250),
  buildAuthorizeFallbackSignal: jest.fn((failoverMode, err, path, extra = {}) => ({
    occurred: true, attemptedEngine: 'pingone', failoverMode,
    effectiveAction: failoverMode === 'deny' ? 'denied' : failoverMode === 'permit' ? 'permitted' : 'fell_back_to_simulated',
    error: err && err.message ? err.message : String(err), path, ...extra,
  })),
  buildPolicyNotFoundBody: jest.fn((path) => ({
    error: 'policy_not_found',
    error_description: 'Policy not found, please contact administrator.',
    authorize_engine: 'pingone',
    authorize_path: path,
  })),
}));
jest.mock('../../services/hitlServiceClient', () => ({
  getChallengeStatus: jest.fn(),
  verifyHitlReceipt: jest.fn(),
}));

const configStore = require('../../services/configStore');
const pingOneAuthorizeService = require('../../services/pingOneAuthorizeService');
const simulatedAuthorizeService = require('../../services/simulatedAuthorizeService');
const hitlServiceClient = require('../../services/hitlServiceClient');
const {
  evaluateMcpFirstToolGate,
  getMcpFirstToolGateStatus,
  nestedActIdFromClaim,
} = require('../../services/mcpToolAuthorizationService');

function jwtWithPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `eyJhbGciOiJub25lIn0.${body}.x`;
}

describe('mcpToolAuthorizationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.get.mockImplementation(() => null);
    configStore.getEffective = (k) => configStore.get(k);
    configStore.setRaw = jest.fn().mockResolvedValue(undefined);
    simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
    // PingOne-ONLY default: failover=deny (fail closed when not configured).
    simulatedAuthorizeService.resolveAuthorizeMode.mockReturnValue({
      mode: 'pingone', useSimulated: false, failoverMode: 'deny',
    });
    pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(false);
  });

  describe('nestedActIdFromClaim', () => {
    it('returns nested client_id when act.act is present', () => {
      expect(
        nestedActIdFromClaim({ client_id: 'mcp', act: { client_id: 'agent' } }),
      ).toBe('agent');
    });
    it('returns empty when no nested act', () => {
      expect(nestedActIdFromClaim({ client_id: 'bff' })).toBe('');
    });
  });

  describe('evaluateMcpFirstToolGate', () => {
    // Transaction-limit policy consult. The MCP first-tool gate answers "may this
    // agent call this tool" and never evaluates amount limits — that rule lives on
    // the Transaction decision endpoint, previously reachable only from
    // routes/transactions.js. Without this consult a $2500 agent transfer got
    // PERMIT + HITL and no use case could demo a hard limit DENY.
    describe('transaction-limit policy consult', () => {
      const readyGate = () => {
        configStore.get.mockImplementation((k) =>
          k === 'ff_authorize_mcp_first_tool' ? 'true' : null);
        // The outer beforeEach assigns getEffective as a PLAIN function, so it has
        // no .mockImplementation — reassign rather than configure.
        configStore.getEffective = jest.fn((k) => configStore.get(k));
        pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
        simulatedAuthorizeService.resolveAuthorizeMode.mockReturnValue({
          mode: 'pingone', useSimulated: false, failoverMode: 'deny',
        });
        simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      };
      const call = (params) => evaluateMcpFirstToolGate({
        req: { session: {}, user: { id: 'u1' } },
        tool: 'create_transfer',
        toolParams: params,
        transactionType: 'transfer',
        agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
        userSub: 'u1',
      });

      beforeEach(() => {
        readyGate();
        // Gate itself permits with a HITL obligation — the live shape today.
        pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
          decision: 'PERMIT', hitlRequired: true, decisionId: 'gate-1',
        });
        pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({ decision: 'PERMIT' });
      });

      it('a transaction-policy DENY overrides the gate PERMIT+HITL', async () => {
        pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({
          decision: 'DENY', decisionId: 'limit-1',
          raw: { decision: 'DENY', reason: 'amount over limit', statements: [] },
        });
        // Stale gate body must not leak into authorize_response (UC6 TraceRail).
        pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
          decision: 'PERMIT', hitlRequired: true, decisionId: 'gate-1',
          raw: {
            decision: 'PERMIT',
            statements: [{ code: 'HITL' }, { code: 'mcp-tool-authorized' }],
          },
          _debug: {
            request: { method: 'POST', url: 'https://example/mcp' },
            response: {
              decision: 'PERMIT',
              statements: [{ code: 'HITL' }, { code: 'mcp-tool-authorized' }],
            },
          },
        });
        const r = await call({ amount: 2500 });
        expect(r.block.status).toBe(403);
        expect(r.block.body.error).toBe('mcp_authorization_denied');
        expect(r.block.body.decisionId).toBe('limit-1');
        expect(r.block.body.decisionContext).toBe('Transaction');
        expect(r.block.body.authorize_response).toMatchObject({ decision: 'DENY' });
        expect(r.block.body.authorize_response.statements || []).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'HITL' })]),
        );
      });

      it('a transaction-policy STEP_UP obligation upgrades the gate HITL to step-up', async () => {
        // $600 live: PERMIT + Step-Up MFA Required + HITL. Step-up outranks HITL.
        pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({
          decision: 'PERMIT', stepUpRequired: true, hitlRequired: true, decisionId: 'limit-2',
        });
        const r = await call({ amount: 600 });
        expect(r.block.status).toBe(428);
        expect(r.block.body.error).toBe('mcp_step_up_required');
      });

      it('a transaction-policy PERMIT leaves the HITL gate intact', async () => {
        const r = await call({ amount: 2500 });
        expect(r.block.status).toBe(428);
        expect(r.block.body.error).toBe('mcp_hitl_required');
      });

      it('is not consulted at all when the tool carries no amount', async () => {
        await evaluateMcpFirstToolGate({
          req: { session: {}, user: { id: 'u1' } },
          tool: 'get_my_accounts',
          agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
          userSub: 'u1',
        });
        expect(pingOneAuthorizeService.evaluateTransaction).not.toHaveBeenCalled();
      });

      it('applies local amount DENY when the limit policy errors (UC6)', async () => {
        pingOneAuthorizeService.evaluateTransaction.mockRejectedValue(new Error('p1az down'));
        const r = await call({ amount: 2500 });
        expect(r.block.body.error).toBe('mcp_authorization_denied');
        expect(r.block.body.decisionContext).toBe('Transaction');
        expect(r.block.body.authorize_response).toMatchObject({ decision: 'DENY' });
      });
    });

    it('fails CLOSED (503) when no backend configured + failover=deny (PingOne-only default)', async () => {
      // simulated off + PingOne not ready + failover=deny (beforeEach) → must NOT
      // skip the gate (fail-open); it fails closed so an unconfigured install
      // cannot run ungated.
      const r = await evaluateMcpFirstToolGate({
        req: { session: {} },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
        userSub: 'u1',
      });
      expect(r).toMatchObject({ ran: true, block: { status: 503 } });
      expect(r.block.body.error).toBe('mcp_authorize_unavailable');
    });

    it('skips (ran:false) when not configured + failover=permit (explicit fail-open)', async () => {
      simulatedAuthorizeService.resolveAuthorizeMode.mockReturnValue({
        mode: 'pingone', useSimulated: false, failoverMode: 'permit',
      });
      const r = await evaluateMcpFirstToolGate({
        req: { session: {} },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
        userSub: 'u1',
      });
      expect(r).toMatchObject({ ran: false });
    });

    it('returns ran:false when no agent token', async () => {
      configStore.get.mockImplementation((k) =>
        k === 'ff_authorize_mcp_first_tool' ? 'true' : null,
      );
      const r = await evaluateMcpFirstToolGate({
        req: { session: {} },
        tool: 'get_my_accounts',
        agentToken: null,
        userSub: 'u1',
      });
      expect(r).toMatchObject({ ran: false });
    });

    it('does NOT skip when session previously had mcpFirstToolAuthorizeDone (runs every call)', async () => {
      configStore.get.mockImplementation((k) =>
        k === 'ff_authorize_mcp_first_tool' ? 'true' : null,
      );
      configStore.getEffective = jest.fn(() => null);
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
      simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
        decision: 'PERMIT',
        stepUpRequired: false,
        hitlRequired: false,
        path: 'simulated',
        decisionId: 'sim-1',
        raw: {},
      });
      const r = await evaluateMcpFirstToolGate({
        req: { session: { mcpFirstToolAuthorizeDone: true } },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'u1' }),
        userSub: 'u1',
      });
      // Gate now runs on every call — no longer skipped after first permit
      expect(r).toMatchObject({ ran: true, permit: true });
    });

    // WAS: 'skips for admin role' — asserted { ran: false } for any admin
    // session, i.e. it pinned the F5 fail-open where the admin role bypassed
    // the ENTIRE authorization gate in code. That test encoded the bug: an
    // admin could invoke any MCP tool with no policy evaluation at all.
    // The role is now a PDP input (UserRole), so policy decides.
    // Full coverage lives in authzGateFailOpen.test.js.
    it('does NOT skip for admin role — the gate runs and policy decides', async () => {
      configStore.get.mockImplementation((k) =>
        k === 'ff_authorize_mcp_first_tool' ? 'true' : null,
      );
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
        decision: 'PERMIT', stepUpRequired: false, raw: {}, decisionId: 'd1',
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'admin' } } },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'u1' }),
        userSub: 'u1',
      });

      expect(r).toMatchObject({ ran: true, permit: true });
      expect(
        pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0].userRole,
      ).toBe('admin');
    });

    it('runs simulated path and permits', async () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'ff_authorize_mcp_first_tool') return 'true';
        if (k === 'PINGONE_RESOURCE_MCP_SERVER_URI') return 'https://mcp.example';
        return null;
      });
      configStore.getEffective = jest.fn((k) => {
        if (k === 'mcp_resource_uri') return 'https://mcp.example';
        return configStore.get(k);
      });
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
      simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
        decision: 'PERMIT',
        stepUpRequired: false,
        path: 'simulated',
        decisionId: 'sim-1',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' } } },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({
          sub: 'user-sub',
          aud: 'https://mcp.example',
          act: { client_id: 'bff-client' },
        }),
        userSub: 'user-sub',
        userAcr: 'Single_Factor',
      });

      expect(r.ran).toBe(true);
      expect(r.permit).toBe(true);
      // simParams must carry the SAME role the live PingOne path gets. When it
      // did not, the two engines evaluated different inputs for one call —
      // which is finding F3, the disagreement this workstream exists to close.
      expect(simulatedAuthorizeService.evaluateMcpFirstTool).toHaveBeenCalledWith(
        expect.objectContaining({ userRole: 'user' }),
      );
      expect(simulatedAuthorizeService.evaluateMcpFirstTool).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-sub',
          toolName: 'get_my_accounts',
          actClientId: 'bff-client',
          mcpResourceUri: 'https://mcp.example',
        }),
      );
    });

    it('returns 403 block when simulated denies', async () => {
      configStore.get.mockImplementation((k) =>
        k === 'ff_authorize_mcp_first_tool' ? 'true' : null,
      );
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
      simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
        decision: 'DENY',
        stepUpRequired: false,
        path: 'simulated',
        decisionId: 'sim-d',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' } } },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'u1' }),
        userSub: 'u1',
      });

      expect(r.ran).toBe(true);
      expect(r.block.status).toBe(403);
      expect(r.block.body.error).toBe('mcp_authorization_denied');
    });

    it('returns 428 block when simulated requires HITL', async () => {
      configStore.get.mockImplementation((k) =>
        k === 'ff_authorize_mcp_first_tool' ? 'true' : null,
      );
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
      simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
        decision: 'INDETERMINATE',
        stepUpRequired: false,
        hitlRequired: true,
        path: 'simulated',
        decisionId: 'sim-hitl-1',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' } } },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'u1' }),
        userSub: 'u1',
      });

      expect(r.ran).toBe(true);
      expect(r.block.status).toBe(428);
      expect(r.block.body.error).toBe('mcp_hitl_required');
      expect(r.block.body.authorize_engine).toBe('simulated');
    });

    it('returns 428 step-up before HITL when both are set (simulated)', async () => {
      configStore.get.mockImplementation((k) =>
        k === 'ff_authorize_mcp_first_tool' ? 'true' : null,
      );
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
      simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
        decision: 'INDETERMINATE',
        stepUpRequired: true,
        hitlRequired: true,
        path: 'simulated',
        decisionId: 'sim-both',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' } } },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'u1' }),
        userSub: 'u1',
      });

      // Step-up should take priority over HITL
      expect(r.ran).toBe(true);
      expect(r.block.status).toBe(428);
      expect(r.block.body.error).toBe('mcp_step_up_required');
    });

    // The agent step-up modal only renders its device picker (SMS / email /
    // passkey) when the 428 body carries step_up_method === 'p1mfa'
    // (AIAgent.js checks that exact string). The gate omitted the field
    // entirely, so `normalized.step_up_method` was undefined and every agent
    // step-up silently fell back to the stub OTP-only modal.
    it('includes step_up_method on the step-up block so the UI can pick a device', async () => {
      configStore.get.mockImplementation((k) =>
        k === 'ff_authorize_mcp_first_tool' ? 'true' : null,
      );
      // jest automock leaves getEffective without mock helpers here; install one.
      configStore.getEffective = jest.fn((k) => (k === 'step_up_method' ? 'p1mfa' : null));
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
      simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
        decision: 'INDETERMINATE',
        stepUpRequired: true,
        hitlRequired: false,
        path: 'simulated',
        decisionId: 'sim-stepup',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' } } },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'u1' }),
        userSub: 'u1',
      });

      expect(r.block.body.error).toBe('mcp_step_up_required');
      expect(r.block.body.step_up_method).toBe('p1mfa');
    });

    it('calls PingOne when live and MCP endpoint ready', async () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'ff_authorize_mcp_first_tool') return 'true';
        if (k === 'ff_authorize_fail_open') return 'false';
        if (k === 'authorize_mcp_decision_endpoint_id') return 'mcp-endpoint-uuid';
        if (k === 'PINGONE_RESOURCE_MCP_SERVER_URI') return 'https://mcp';
        return null;
      });
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
        decision: 'PERMIT',
        stepUpRequired: false,
        path: 'decision-endpoint',
        decisionId: 'p1-1',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' } } },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'sub-99', aud: 'https://mcp' }),
        userSub: 'sub-99',
      });

      expect(r.ran).toBe(true);
      expect(r.permit).toBe(true);
      expect(pingOneAuthorizeService.evaluateMcpToolDelegation).toHaveBeenCalled();
    });

    // The LIVE PingOne path is what the real stack runs (P1AZ + PingGateway), so
    // this is the branch that actually decides whether the agent step-up modal
    // can show its device picker. Covered separately from the simulated block —
    // they are distinct response builders and only one was exercised before.
    it('includes step_up_method on the LIVE PingOne step-up block', async () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'ff_authorize_mcp_first_tool') return 'true';
        if (k === 'ff_authorize_fail_open') return 'false';
        if (k === 'authorize_mcp_decision_endpoint_id') return 'mcp-endpoint-uuid';
        if (k === 'PINGONE_RESOURCE_MCP_SERVER_URI') return 'https://mcp';
        return null;
      });
      configStore.getEffective = jest.fn((k) => (k === 'step_up_method' ? 'p1mfa' : null));
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
        decision: 'INDETERMINATE',
        stepUpRequired: true,
        path: 'decision-endpoint',
        decisionId: 'p1-stepup',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' } } },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'sub-99', aud: 'https://mcp' }),
        userSub: 'sub-99',
      });

      expect(r.block.status).toBe(428);
      expect(r.block.body.error).toBe('mcp_step_up_required');
      expect(r.block.body.step_up_method).toBe('p1mfa');
    });

    // UC22's demo slug (req.body.useCaseId) must force step_up_method: 'ciba'
    // even when the global step_up_method config says 'p1mfa' -- this gate is
    // the one the live banking-agent chat path actually calls (mcpToolPipeline.js),
    // so without this override UC22 showed the P1MFA device picker instead of
    // the CIBA out-of-band flow, though transactionAuthorizationService (a
    // different, unrelated gate) already had its own CIBA override.
    it('overrides step_up_method to ciba for the UC22 demo use-case, ignoring the global config', async () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'ff_authorize_mcp_first_tool') return 'true';
        if (k === 'ff_authorize_fail_open') return 'false';
        if (k === 'authorize_mcp_decision_endpoint_id') return 'mcp-endpoint-uuid';
        if (k === 'PINGONE_RESOURCE_MCP_SERVER_URI') return 'https://mcp';
        return null;
      });
      configStore.getEffective = jest.fn((k) => (k === 'step_up_method' ? 'p1mfa' : null));
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
        decision: 'INDETERMINATE',
        stepUpRequired: true,
        path: 'decision-endpoint',
        decisionId: 'p1-ciba-stepup',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' } }, body: { useCaseId: 'ciba-out-of-band-approval' } },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'sub-99', aud: 'https://mcp' }),
        userSub: 'sub-99',
      });

      expect(r.block.status).toBe(428);
      expect(r.block.body.error).toBe('mcp_step_up_required');
      expect(r.block.body.step_up_method).toBe('ciba');
    });

    // CIBA (and the stub OTP flow) only set req.session.stepUpVerified on
    // completion -- unlike a real P1MFA re-auth, they never re-mint the
    // access token's ACR. Without this check, the retried tool call presents
    // the SAME token to PingOne and gets step-up-required again forever
    // (an infinite CIBA-approval loop, caught live: UC22's chat kept
    // re-initiating CIBA every ~11s instead of completing after approval).
    it('PERMITs a retried call when session.stepUpVerified is fresh, even though PingOne still reports stepUpRequired', async () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'ff_authorize_mcp_first_tool') return 'true';
        if (k === 'ff_authorize_fail_open') return 'false';
        if (k === 'authorize_mcp_decision_endpoint_id') return 'mcp-endpoint-uuid';
        if (k === 'PINGONE_RESOURCE_MCP_SERVER_URI') return 'https://mcp';
        return null;
      });
      configStore.getEffective = jest.fn((k) => (k === 'step_up_method' ? 'p1mfa' : null));
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
        decision: 'INDETERMINATE',
        stepUpRequired: true,
        path: 'decision-endpoint',
        decisionId: 'p1-retry',
        raw: {},
      });

      const req = {
        session: { user: { role: 'user' }, stepUpVerified: Date.now() + 60_000 },
        body: { useCaseId: 'ciba-out-of-band-approval' },
      };
      const r = await evaluateMcpFirstToolGate({
        req,
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'sub-99', aud: 'https://mcp' }),
        userSub: 'sub-99',
      });

      expect(r.ran).toBe(true);
      expect(r.permit).toBe(true);
      expect(r.block).toBeUndefined();
      // Single-use: consumed so a later, unrelated call re-evaluates fresh.
      expect(req.session.stepUpVerified).toBe(0);
    });

    it('still demands step-up when session.stepUpVerified is stale/expired', async () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'ff_authorize_mcp_first_tool') return 'true';
        if (k === 'ff_authorize_fail_open') return 'false';
        if (k === 'authorize_mcp_decision_endpoint_id') return 'mcp-endpoint-uuid';
        if (k === 'PINGONE_RESOURCE_MCP_SERVER_URI') return 'https://mcp';
        return null;
      });
      configStore.getEffective = jest.fn((k) => (k === 'step_up_method' ? 'p1mfa' : null));
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
        decision: 'INDETERMINATE',
        stepUpRequired: true,
        path: 'decision-endpoint',
        decisionId: 'p1-stale',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' }, stepUpVerified: Date.now() - 1000 } },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'sub-99', aud: 'https://mcp' }),
        userSub: 'sub-99',
      });

      expect(r.block.status).toBe(428);
      expect(r.block.body.error).toBe('mcp_step_up_required');
    });

    it('returns 428 HITL block when PingOne live requires human approval', async () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'ff_authorize_mcp_first_tool') return 'true';
        if (k === 'ff_authorize_fail_open') return 'false';
        if (k === 'authorize_mcp_decision_endpoint_id') return 'mcp-endpoint-uuid';
        if (k === 'PINGONE_RESOURCE_MCP_SERVER_URI') return 'https://mcp';
        return null;
      });
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
        decision: 'INDETERMINATE',
        stepUpRequired: false,
        hitlRequired: true,
        path: 'decision-endpoint',
        decisionId: 'p1-hitl-1',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' } } },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'sub-99', aud: 'https://mcp' }),
        userSub: 'sub-99',
      });

      expect(r.ran).toBe(true);
      expect(r.block.status).toBe(428);
      expect(r.block.body.error).toBe('mcp_hitl_required');
      expect(r.block.body.authorize_engine).toBe('pingone');
      expect(r.block.body.decisionId).toBe('p1-hitl-1');
    });

    it('blocks with policy_not_found (not a generic deny) when no policy matched', async () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'ff_authorize_mcp_first_tool') return 'true';
        if (k === 'ff_authorize_fail_open') return 'false';
        if (k === 'authorize_mcp_decision_endpoint_id') return 'mcp-endpoint-uuid';
        if (k === 'PINGONE_RESOURCE_MCP_SERVER_URI') return 'https://mcp';
        return null;
      });
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
      // Engine ran, no policy matched: decision stays fail-closed DENY, drift on side channel.
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
        decision: 'DENY',
        policyNotFound: true,
        stepUpRequired: false,
        path: 'decision-endpoint',
        decisionId: 'p1-na-1',
        raw: {},
      });

      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'user' } } },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'sub-99', aud: 'https://mcp' }),
        userSub: 'sub-99',
      });

      expect(r.ran).toBe(true);
      // 503, not 403: policy_not_found means P1AZ evaluated fine but no policy
      // matched — code/policy drift, deliberately distinct from the 403 deny
      // (see 4a1f8a2d8, which ordered policyNotFound=503 before DENY=403).
      expect(r.block.status).toBe(503);
      expect(r.block.body.error).toBe('policy_not_found');
      expect(r.block.body.error_description).toMatch(/contact administrator/i);
      expect(r.block.body.decisionContext).toBe('McpFirstTool');
    });
  });

  describe('write-tool amount extraction (93626945: WRITE_TOOL_TYPE_MAP)', () => {
    beforeEach(() => {
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
      simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
        decision: 'PERMIT', stepUpRequired: false, hitlRequired: false,
        path: 'simulated', decisionId: 'sim-x', raw: {},
      });
    });

    it('passes amount and transactionType=transfer for create_transfer with toolParams', async () => {
      await evaluateMcpFirstToolGate({
        req: { session: {} },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'u1' }),
        userSub: 'u1',
        toolParams: { amount: 600, fromAccountId: 'a1', toAccountId: 'a2' },
      });
      expect(simulatedAuthorizeService.evaluateMcpFirstTool).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 600, transactionType: 'transfer' }),
      );
    });

    it('passes amount and transactionType=deposit for create_deposit', async () => {
      await evaluateMcpFirstToolGate({
        req: { session: {} },
        tool: 'create_deposit',
        agentToken: jwtWithPayload({ sub: 'u1' }),
        userSub: 'u1',
        toolParams: { amount: 200, accountId: 'a1' },
      });
      expect(simulatedAuthorizeService.evaluateMcpFirstTool).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 200, transactionType: 'deposit' }),
      );
    });

    it('passes amount=null and transactionType=null for read-only tools', async () => {
      await evaluateMcpFirstToolGate({
        req: { session: {} },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'u1' }),
        userSub: 'u1',
        toolParams: {},
      });
      expect(simulatedAuthorizeService.evaluateMcpFirstTool).toHaveBeenCalledWith(
        expect.objectContaining({ amount: null, transactionType: null }),
      );
    });

    // #539 call-site regression: /api/mcp/tool uses requireSession (session only,
    // no req.user). policyUserId must still resolve so pay_bill uses amountDue.
    it('pay_bill on session-only req uses bill amountDue, not the fabricated phrase amount', async () => {
      const { verticalManifest } = require('../../services/verticalManifest');
      const USER = 'session-only-paybill-user';
      const store = verticalManifest.plugins.get('healthcare').getDataStore();
      const bill = (store.get(USER).billingHistory || []).find((b) => String(b.id) === '402');
      expect(bill).toBeTruthy();
      expect(bill.amountDue).toBe(25);
      expect(bill.amountDue).not.toBe(402);

      await evaluateMcpFirstToolGate({
        // Mirror POST /api/mcp/tool: requireSession sets nothing on req.user.
        req: {
          session: {
            user: { id: 'local-seq-1', oauthId: USER, role: 'user' },
            active_vertical: 'healthcare',
          },
        },
        tool: 'pay_bill',
        agentToken: jwtWithPayload({ sub: USER }),
        userSub: null,
        toolParams: { recordId: '402', amount: 402 },
      });

      expect(simulatedAuthorizeService.evaluateMcpFirstTool).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 25, transactionType: 'transfer' }),
      );
    });

    it('pay_bill uses userSub when req.user and session ids are absent', async () => {
      const { verticalManifest } = require('../../services/verticalManifest');
      const USER = 'usersub-paybill-user';
      const store = verticalManifest.plugins.get('healthcare').getDataStore();
      const bill = (store.get(USER).billingHistory || []).find((b) => String(b.id) === '402');
      expect(bill.amountDue).toBe(25);

      await evaluateMcpFirstToolGate({
        req: { session: { active_vertical: 'healthcare' } },
        tool: 'pay_bill',
        agentToken: jwtWithPayload({ sub: USER }),
        userSub: USER,
        toolParams: { billId: '402', amount: 402 },
      });

      expect(simulatedAuthorizeService.evaluateMcpFirstTool).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 25, transactionType: 'transfer' }),
      );
    });
  });

  // ── HITL receipt verification (findings #1 + #2): hitlApproved is derived
  // ONLY from a 3009-verified, caller-bound receipt and threaded into the
  // engines. A missing/invalid/forged/unreachable receipt fails closed
  // (hitlApproved=false → engine re-challenges). Never accept a raw client flag.
  describe('evaluateMcpFirstToolGate — HITL receipt verification', () => {
    const SIM = () => simulatedAuthorizeService.evaluateMcpFirstTool;
    const baseReq = {
      req: { session: { user: { role: 'user' } } },
      tool: 'create_transfer',
      agentToken: jwtWithPayload({ sub: 'u1', act: { sub: 'agent-1' }, aud: 'https://mcp' }),
      userSub: 'u1',
    };

    beforeEach(() => {
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
      SIM().mockResolvedValue({
        decision: 'PERMIT', stepUpRequired: false, hitlRequired: false,
        path: 'simulated', decisionId: 's1', raw: {},
      });
    });

    it('does NOT verify a receipt when no challenge id is provided (hitlApproved=false)', async () => {
      await evaluateMcpFirstToolGate({ ...baseReq });
      expect(hitlServiceClient.getChallengeStatus).not.toHaveBeenCalled();
      expect(SIM()).toHaveBeenCalledWith(expect.objectContaining({ hitlApproved: false }));
    });

    it('passes hitlApproved=true when the receipt verifies (approved + caller-bound)', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue({ status: 'approved', userId: 'u1', agentId: 'agent-1', tool: 'create_transfer' });
      hitlServiceClient.verifyHitlReceipt.mockReturnValue({ ok: true });
      await evaluateMcpFirstToolGate({ ...baseReq, hitlChallengeId: 'c1' });
      expect(hitlServiceClient.getChallengeStatus).toHaveBeenCalledWith('c1');
      expect(hitlServiceClient.verifyHitlReceipt).toHaveBeenCalledWith(
        expect.any(Object), 'u1', 'agent-1', 'create_transfer', expect.any(Number), undefined, {});
      expect(SIM()).toHaveBeenCalledWith(expect.objectContaining({ hitlApproved: true }));
    });

    it('fails closed (hitlApproved=false) when verifyHitlReceipt rejects', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue({ status: 'approved', userId: 'attacker' });
      hitlServiceClient.verifyHitlReceipt.mockReturnValue({ ok: false, message: 'different user' });
      await evaluateMcpFirstToolGate({ ...baseReq, hitlChallengeId: 'c1' });
      expect(SIM()).toHaveBeenCalledWith(expect.objectContaining({ hitlApproved: false }));
    });

    it('fails closed (hitlApproved=false) when the HITL service is unreachable', async () => {
      hitlServiceClient.getChallengeStatus.mockRejectedValue(new Error('ECONNREFUSED'));
      await evaluateMcpFirstToolGate({ ...baseReq, hitlChallengeId: 'c1' });
      expect(SIM()).toHaveBeenCalledWith(expect.objectContaining({ hitlApproved: false }));
    });

    it('returns 403 mcp_hitl_receipt_rejected when hitlApproved=true but engine still requires HITL (simulated)', async () => {
      hitlServiceClient.getChallengeStatus.mockResolvedValue({ status: 'approved', userId: 'u1', agentId: 'agent-1', tool: 'create_transfer' });
      hitlServiceClient.verifyHitlReceipt.mockReturnValue({ ok: true });
      SIM().mockResolvedValue({
        decision: 'INDETERMINATE',
        hitlRequired: true,
        stepUpRequired: false,
        path: 'simulated',
        decisionId: 's1',
        raw: {},
      });
      const result = await evaluateMcpFirstToolGate({ ...baseReq, hitlChallengeId: 'c1' });
      expect(result.ran).toBe(true);
      expect(result.block.status).toBe(403);
      expect(result.block.body.error).toBe('mcp_hitl_receipt_rejected');
      expect(result.block.body.error_description).toContain('HITL receipt accepted but authorization engine still requires approval');
    });

    it('returns 403 mcp_hitl_receipt_rejected when hitlApproved=true but engine still requires HITL (PingOne live)', async () => {
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      hitlServiceClient.getChallengeStatus.mockResolvedValue({ status: 'approved', userId: 'u1', agentId: 'agent-1', tool: 'create_transfer' });
      hitlServiceClient.verifyHitlReceipt.mockReturnValue({ ok: true });
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
        decision: 'INDETERMINATE',
        hitlRequired: true,
        stepUpRequired: false,
        path: 'decision-endpoint',
        decisionId: 'p1',
        raw: {},
      });
      const result = await evaluateMcpFirstToolGate({ ...baseReq, hitlChallengeId: 'c1' });
      expect(result.ran).toBe(true);
      expect(result.block.status).toBe(403);
      expect(result.block.body.error).toBe('mcp_hitl_receipt_rejected');
      expect(result.block.body.error_description).toContain('HITL receipt accepted but authorization engine still requires approval');
    });

    it('auto-disables ff_authorize_group_policy and retries when PingOne rejects UserGroups', async () => {
      // This case exercises the live PingOne path — leave simulated mode off.
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      configStore.get.mockImplementation((k) => {
        if (k === 'ff_authorize_mcp_first_tool') return 'true';
        if (k === 'ff_authorize_group_policy') return 'true';
        return null;
      });
      configStore.getEffective = (k) => configStore.get(k);
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
      const userGroupsErr = new Error(
        'PingOne Authorize decision endpoint evaluation failed (400): ' +
        '{ "details": [ { "target": "parameters.UserGroups", "code": "INVALID_VALUE" } ] }',
      );
      pingOneAuthorizeService.evaluateMcpToolDelegation
        .mockRejectedValueOnce(userGroupsErr)
        .mockResolvedValueOnce({
          decision: 'PERMIT',
          stepUpRequired: false,
          hitlRequired: false,
          path: 'decision-endpoint',
          decisionId: 'p-retry',
          raw: {},
        });

      const result = await evaluateMcpFirstToolGate({
        req: { session: { user: { username: 'demoUser' } } },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
        userSub: 'u1',
      });

      expect(configStore.setRaw).toHaveBeenCalledWith({ ff_authorize_group_policy: 'false' });
      expect(pingOneAuthorizeService.evaluateMcpToolDelegation).toHaveBeenCalledTimes(2);
      expect(result.permit).toBe(true);
      expect(result.evaluation.autoDisabledGroupPolicy).toBe(true);
    });
  });

  describe('getMcpFirstToolGateStatus', () => {
    it('reports enabled flag and live readiness', () => {
      configStore.get.mockImplementation((k) => {
        if (k === 'ff_authorize_mcp_first_tool') return 'true';
        if (k === 'authorize_mcp_decision_endpoint_id') return 'ep-1';
        return null;
      });
      simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);

      const s = getMcpFirstToolGateStatus();
      expect(s.mcpFirstToolGateEnabled).toBe(true);
      expect(s.mcpFirstToolWouldRunLive).toBe(true);
      expect(s.mcpFirstToolWouldRunSimulated).toBe(false);
    });
  });
});
