// demo_api_server/tests/stepVerification.authzOrdering.test.js
'use strict';

/**
 * Step verification — authorization precedence ordering (PR-796 / e90262f9 fix).
 *
 * PR-804 silently reverted three invariants enforced by PR-796:
 *
 *   1. Simulated path: DENY must fire before step-up (UC6 — hard deny must not
 *      surface as a step-up modal).
 *
 *   2. _applyTransactionPolicy step-up must clear hitlRequired so a gate
 *      hitlRequired=true does not bleed into the UC7 step-up response (UC7 bleed).
 *
 *   3. Transaction-policy consentRequired/hitlRequired must promote a bare-PERMIT
 *      gate to hitlRequired so UC8 ($300 consent) shows the consent modal, not
 *      an immediate execution (UC8 promotion).
 *
 * Ledger: data/step-verification/banking/<UC>.chip.unit-authz-ordering-*.json
 */

jest.mock('../services/configStore', () => ({
  get: jest.fn(),
  getEffective: jest.fn(() => null),
}));

jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn(),
  evaluateMcpToolDelegation: jest.fn(),
  isMcpDelegationDecisionReady: jest.fn(() => false),
}));

jest.mock('../services/simulatedAuthorizeService', () => ({
  resolveAuthorizeMode: jest.fn(() => ({
    mode: 'simulated', useSimulated: true, failoverMode: 'deny',
  })),
  isSimulatedModeEnabled: jest.fn(() => true),
  evaluateMcpFirstTool: jest.fn(),
}));

jest.mock('../services/hitlServiceClient', () => ({
  checkHitlApproval: jest.fn(async () => ({ approved: false })),
}));

const configStore = require('../services/configStore');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const simulatedAuthorizeService = require('../services/simulatedAuthorizeService');
const { evaluateMcpFirstToolGate, _applyTransactionPolicy } = require('../services/mcpToolAuthorizationService');
const { writeLedgerEntry } = require('../services/stepVerificationLedger');

/** Build a minimal signed-looking JWT payload (gate does not verify signatures). */
function jwtWithPayload(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.SIG`;
}

// ---------------------------------------------------------------------------
// Case 1: Simulated path — DENY beats step-up (UC6 ordering regression)
// ---------------------------------------------------------------------------

describe('authz ordering — simulated DENY beats step-up (UC6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.get.mockImplementation((k) =>
      k === 'ff_authorize_mcp_first_tool' ? 'true' : null,
    );
    simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
    simulatedAuthorizeService.resolveAuthorizeMode.mockReturnValue({
      mode: 'simulated', useSimulated: true, failoverMode: 'deny',
    });
  });

  it('returns 403 mcp_authorization_denied when simulated returns DENY+stepUpRequired', async () => {
    // UC6: PingOne Authorize hard-denies the transaction. The simulated engine
    // mirrors this by returning decision=DENY. Prior to the fix, the simulated
    // path checked stepUpRequired BEFORE decision===DENY, so a DENY with
    // stepUpRequired=true incorrectly surfaced as a 428 step-up modal.
    simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
      decision: 'DENY',
      stepUpRequired: true, // gate may set both; DENY must still win
      hitlRequired: false,
      path: 'simulated',
      decisionId: 'sim-uc6-deny',
      raw: { decision: 'DENY', reason: 'amount_over_limit' },
    });

    const r = await evaluateMcpFirstToolGate({
      req: { session: { user: { role: 'user' } } },
      tool: 'create_transfer',
      toolParams: { amount: 2500 },
      agentToken: jwtWithPayload({ sub: 'u-uc6', aud: 'mcp' }),
      userSub: 'u-uc6',
    });

    const status = r.block?.status === 403 && r.block?.body?.error === 'mcp_authorization_denied'
      ? 'PASS' : 'FAIL';

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: 'UC6',
      triggerType: 'chip',
      mode: 'unit-simulated-deny-precedence',
      status,
      errorClass: status === 'FAIL' ? 'wrong_gate' : null,
      primaryTool: 'create_transfer',
      checkedAt: new Date().toISOString(),
      verifiedBy: 'simulated-path DENY-before-stepUp ordering fix (e90262f9)',
    });

    expect(r.block.status).toBe(403);
    expect(r.block.body.error).toBe('mcp_authorization_denied');
  });

  it('returns 428 mcp_step_up_required when simulated returns INDETERMINATE+stepUpRequired', async () => {
    // Confirm the step-up path still works when there is no DENY — this is the
    // normal UC7 shape.
    simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
      decision: 'INDETERMINATE',
      stepUpRequired: true,
      hitlRequired: false,
      path: 'simulated',
      decisionId: 'sim-uc7-stepup',
      raw: {},
    });

    const r = await evaluateMcpFirstToolGate({
      req: { session: { user: { role: 'user' } } },
      tool: 'create_transfer',
      toolParams: { amount: 600 },
      agentToken: jwtWithPayload({ sub: 'u-uc7', aud: 'mcp' }),
      userSub: 'u-uc7',
    });

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: 'UC7',
      triggerType: 'chip',
      mode: 'unit-simulated-deny-precedence',
      status: r.block?.body?.error === 'mcp_step_up_required' ? 'PASS' : 'FAIL',
      errorClass: r.block?.body?.error === 'mcp_step_up_required' ? null : 'wrong_gate',
      primaryTool: 'create_transfer',
      checkedAt: new Date().toISOString(),
      verifiedBy: 'simulated-path step-up (non-DENY) still fires (e90262f9)',
    });

    expect(r.block.status).toBe(428);
    expect(r.block.body.error).toBe('mcp_step_up_required');
  });
});

// ---------------------------------------------------------------------------
// Cases 2 & 3: _applyTransactionPolicy invariants (unit — no full gate needed)
// ---------------------------------------------------------------------------

describe('authz ordering — _applyTransactionPolicy invariants (UC7 bleed / UC8 promotion)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('step-up clears gate hitlRequired (UC7 bleed fix)', async () => {
    // Gate returns PERMIT + hitlRequired=true (normal live-P1AZ MCP shape for
    // write tools). Transaction policy says STEP_UP. Without the fix PR-804
    // removed, spreading ...r would carry hitlRequired=true into the step-up
    // result, making the UI show both step-up and HITL modals.
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({
      decision: 'PERMIT',
      stepUpRequired: true,
      hitlRequired: false,
      decisionId: 'txn-uc7',
    });

    const gate = { decision: 'PERMIT', hitlRequired: true, stepUpRequired: false, decisionId: 'gate-1' };
    const out = await _applyTransactionPolicy(gate, {
      amount: 600,
      transactionType: 'transfer',
      userId: 'u-uc7',
      acr: 'Password',
    });

    const status = out.stepUpRequired === true && out.hitlRequired === false ? 'PASS' : 'FAIL';

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: 'UC7',
      triggerType: 'chip',
      mode: 'unit-gate-stepup-clears-hitl',
      status,
      errorClass: status === 'FAIL' ? 'wrong_gate' : null,
      primaryTool: 'create_transfer',
      checkedAt: new Date().toISOString(),
      verifiedBy: '_applyTransactionPolicy step-up sets hitlRequired:false (e90262f9)',
    });

    expect(out.stepUpRequired).toBe(true);
    expect(out.hitlRequired).toBe(false);
  });

  it('Transaction consentRequired promotes bare-PERMIT gate to hitlRequired (UC8 promotion fix)', async () => {
    // Gate PERMITs (normal live-P1AZ shape — no hitl). Transaction policy returns
    // consentRequired=true for the $300 consent band. Without the HITL-promotion
    // block restored by the fix, this became a bare PERMIT and UC8 executed without
    // showing the consent modal.
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({
      decision: 'PERMIT',
      consentRequired: true,
      stepUpRequired: false,
      decisionId: 'txn-uc8',
    });

    const gate = { decision: 'PERMIT', hitlRequired: false, stepUpRequired: false, decisionId: 'gate-1' };
    const out = await _applyTransactionPolicy(gate, {
      amount: 300,
      transactionType: 'transfer',
      userId: 'u-uc8',
      acr: 'Password',
    });

    const status = out.hitlRequired === true && out.transactionPolicyHitl === true ? 'PASS' : 'FAIL';

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: 'UC8',
      triggerType: 'chip',
      mode: 'unit-transaction-hitl-promote',
      status,
      errorClass: status === 'FAIL' ? 'wrong_gate' : null,
      primaryTool: 'create_transfer',
      checkedAt: new Date().toISOString(),
      verifiedBy: '_applyTransactionPolicy Transaction-HITL promotion (e90262f9)',
    });

    expect(out.hitlRequired).toBe(true);
    expect(out.transactionPolicyHitl).toBe(true);
  });

  it('Transaction hitlRequired (not consentRequired) also promotes bare-PERMIT gate (UC8 variant)', async () => {
    // Same as above but live P1AZ may return hitlRequired directly.
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({
      decision: 'PERMIT',
      hitlRequired: true,
      consentRequired: false,
      stepUpRequired: false,
      decisionId: 'txn-uc8b',
    });

    const gate = { decision: 'PERMIT', hitlRequired: false, stepUpRequired: false, decisionId: 'gate-1' };
    const out = await _applyTransactionPolicy(gate, {
      amount: 300,
      transactionType: 'transfer',
      userId: 'u-uc8b',
      acr: 'Password',
    });

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: 'UC8',
      triggerType: 'chip',
      mode: 'unit-transaction-hitl-promote-direct',
      status: out.hitlRequired === true ? 'PASS' : 'FAIL',
      errorClass: out.hitlRequired === true ? null : 'wrong_gate',
      primaryTool: 'create_transfer',
      checkedAt: new Date().toISOString(),
      verifiedBy: '_applyTransactionPolicy Transaction hitlRequired direct promotion (e90262f9)',
    });

    expect(out.hitlRequired).toBe(true);
    expect(out.transactionPolicyHitl).toBe(true);
  });
});
