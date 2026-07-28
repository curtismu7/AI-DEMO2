/**
 * @file mcpToolAuthorization.hitlAmountBind.test.js
 *
 * Canary: CIBA HITL credit on the MCP first-tool gate must be amount-bound for
 * write tools. Omitting amount from isFresh() + recording a receipt keyed by
 * the REQUEST amount let a $50 CIBA approval mint a $5000 bearer receipt —
 * /api/transactions then consumed it and the larger transfer went through.
 */

jest.mock('../../services/configStore');
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
  isMcpDelegationDecisionReady: jest.fn(),
  evaluateTransaction: jest.fn(async () => ({ decision: 'PERMIT' })),
}));
jest.mock('../../services/simulatedAuthorizeService', () => ({
  evaluateMcpFirstTool: jest.fn(),
  isSimulatedModeEnabled: jest.fn(),
  resolveAuthorizeMode: jest.fn(),
  getDenyAmountUsd: jest.fn(() => 2000),
  getStepUpAmountUsd: jest.fn(() => 500),
  getConfirmAmountUsd: jest.fn(() => 250),
  buildAuthorizeFallbackSignal: jest.fn(),
  buildPolicyNotFoundBody: jest.fn(),
}));
jest.mock('../../services/hitlServiceClient', () => ({
  getChallengeStatus: jest.fn(),
  verifyHitlReceipt: jest.fn(),
}));

const configStore = require('../../services/configStore');
const pingOneAuthorizeService = require('../../services/pingOneAuthorizeService');
const simulatedAuthorizeService = require('../../services/simulatedAuthorizeService');
const cibaTransactionReceipt = require('../../services/cibaTransactionReceipt');
const { evaluateMcpFirstToolGate } = require('../../services/mcpToolAuthorizationService');

function jwtWithPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `eyJhbGciOiJub25lIn0.${body}.x`;
}

const future = () => Date.now() + 60_000;

describe('MCP HITL credit amount-binding (write tools)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.get.mockImplementation((k) =>
      (k === 'ff_authorize_mcp_first_tool' ? 'true' : null));
    configStore.getEffective = jest.fn((k) => configStore.get(k));
    configStore.setRaw = jest.fn().mockResolvedValue(undefined);
    simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
    simulatedAuthorizeService.resolveAuthorizeMode.mockReturnValue({
      mode: 'pingone', useSimulated: false, failoverMode: 'deny',
    });
    pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
    pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
      decision: 'PERMIT', hitlRequired: true, decisionId: 'gate-hitl',
    });
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({ decision: 'PERMIT' });
    // Drain any leftover receipts from a prior case.
    cibaTransactionReceipt.consume('u1', 'create_transfer', 50);
    cibaTransactionReceipt.consume('u1', 'create_transfer', 300);
    cibaTransactionReceipt.consume('u1', 'create_transfer', 5000);
  });

  /**
   * Call the gate as a create_transfer with a live CIBA credit for $50.
   * @param {number} requestAmount
   */
  function callWithCredit(requestAmount) {
    return evaluateMcpFirstToolGate({
      req: {
        session: {
          hitlVerified: future(),
          hitlApprovedAmount: 50,
          user: { id: 'u1' },
        },
        user: { id: 'u1' },
      },
      tool: 'create_transfer',
      toolParams: { amount: requestAmount, fromAccountId: 'a1', toAccountId: 'a2' },
      agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
      userSub: 'u1',
    });
  }

  it('does NOT discharge HITL or mint a bearer receipt when request amount exceeds approved', async () => {
    // $300 is above the $50 CIBA credit and still in the mid-value HITL band
    // (confirm=$250 … step-up=$500) — not the hard DENY band (>= $2000), so the
    // gate reaches the HITL check rather than short-circuiting on amount DENY.
    const r = await callWithCredit(300);
    expect(r.ran).toBe(true);
    expect(r.block?.status).toBe(428);
    expect(r.block?.body?.error).toBe('mcp_hitl_required');
    // No receipt for the inflated amount — bearer /api/transactions must not
    // be able to consume one and complete the larger write.
    expect(cibaTransactionReceipt.consume('u1', 'create_transfer', 300)).toBe(false);
  });

  it('discharges HITL and mints a receipt when request amount is within the approved credit', async () => {
    const r = await callWithCredit(50);
    expect(r.ran).toBe(true);
    expect(r.block).toBeUndefined();
    expect(r.permit).toBe(true);
    expect(cibaTransactionReceipt.consume('u1', 'create_transfer', 50)).toBe(true);
  });
});
