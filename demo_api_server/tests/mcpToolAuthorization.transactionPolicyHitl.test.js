/**
 * UC8/UC7 amount bands on the MCP path: Transaction-policy HITL/consent must
 * promote onto the gate, and a local amount-band fallback must fire when the
 * Transaction consult PERMITs without an obligation (live vertical writes).
 */
jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn(),
  evaluateMcpToolDelegation: jest.fn(),
}));

const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const {
  _applyTransactionPolicy,
} = require('../services/mcpToolAuthorizationService');

describe('_applyTransactionPolicy — HITL/step-up for MCP write tools', () => {
  const base = { decision: 'PERMIT', hitlRequired: false, stepUpRequired: false };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('promotes Transaction consentRequired to hitlRequired (UC8)', async () => {
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValueOnce({
      decision: 'PERMIT',
      consentRequired: true,
      decisionId: 'tx-consent-1',
      raw: { enforced: 'HITL_CONSENT' },
    });
    const out = await _applyTransactionPolicy(base, {
      amount: 300,
      transactionType: 'transfer',
      userId: 'user-1',
      acr: 'Password',
      useCaseId: 'hitl-consent',
    });
    expect(out.hitlRequired).toBe(true);
    expect(out.transactionPolicyHitl).toBe(true);
    expect(out.stepUpRequired).toBeFalsy();
  });

  test('promotes Transaction hitlRequired the same way', async () => {
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValueOnce({
      decision: 'PERMIT',
      hitlRequired: true,
      decisionId: 'tx-hitl-1',
      raw: {},
    });
    const out = await _applyTransactionPolicy(base, {
      amount: 300,
      transactionType: 'transfer',
      userId: 'user-1',
      acr: 'Password',
    });
    expect(out.hitlRequired).toBe(true);
    expect(out.transactionPolicyHitl).toBe(true);
  });

  test('local amount-band fallback: $300 → HITL when Transaction attaches nothing', async () => {
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValueOnce({
      decision: 'PERMIT',
      consentRequired: false,
      hitlRequired: false,
      stepUpRequired: false,
    });
    const out = await _applyTransactionPolicy(base, {
      amount: 300,
      transactionType: 'transfer',
      userId: 'user-1',
      acr: 'Password',
      useCaseId: 'hitl-consent',
    });
    expect(out.hitlRequired).toBe(true);
    expect(out.transactionPolicyFallback).toBe(true);
  });

  test('local amount-band fallback: $600 → STEP_UP', async () => {
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValueOnce({
      decision: 'PERMIT',
      consentRequired: false,
      hitlRequired: false,
      stepUpRequired: false,
    });
    const out = await _applyTransactionPolicy(base, {
      amount: 600,
      transactionType: 'transfer',
      userId: 'user-1',
      acr: 'Password',
    });
    expect(out.stepUpRequired).toBe(true);
    expect(out.transactionPolicyFallback).toBe(true);
  });

  test('step-up outranks consent from Transaction', async () => {
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValueOnce({
      decision: 'PERMIT',
      stepUpRequired: true,
      consentRequired: true,
    });
    const out = await _applyTransactionPolicy(base, {
      amount: 600,
      transactionType: 'transfer',
      userId: 'user-1',
      acr: 'Password',
    });
    expect(out.stepUpRequired).toBe(true);
    expect(out.hitlRequired).toBeFalsy();
  });

  test('never clears an existing gate hitlRequired', async () => {
    // Transaction IS consulted even when the gate already has hitlRequired (see
    // mcpToolAuthorizationService._applyTransactionPolicy — deliberately changed
    // so a gate PERMIT+HITL can still be upgraded to DENY/step-up, UC6). $50 is
    // below every local band, so it PERMITs without upgrading; the invariant
    // under test is that the gate's HITL obligation survives untouched.
    const out = await _applyTransactionPolicy(
      { ...base, hitlRequired: true },
      { amount: 50, transactionType: 'transfer', userId: 'user-1', acr: 'Password' },
    );
    expect(out.hitlRequired).toBe(true);
  });
});
