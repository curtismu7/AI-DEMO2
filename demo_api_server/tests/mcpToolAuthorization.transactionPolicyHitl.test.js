/**
 * UC8/UC7 amount bands on the MCP path: a Transaction-policy HITL/consent
 * obligation must promote onto the gate, and nothing else may. The BFF no longer
 * carries a local amount ladder — PingOne Authorize is the only thing that turns
 * an amount into a gate, and an unreachable Transaction endpoint fails closed
 * rather than substituting hardcoded thresholds.
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

  test('$300 with a bare Transaction PERMIT stays PERMIT — no local ladder', async () => {
    // The BFF used to re-impose $300 HITL / $600 step-up / $2500 DENY in code
    // whenever the PDP attached no obligation, so the demo could not tell a
    // PingOne Authorize decision from a hardcoded one. PingOne Authorize decides
    // or nothing does.
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
    expect(out.hitlRequired).toBeFalsy();
    expect(out.stepUpRequired).toBeFalsy();
    expect(out.decision).toBe('PERMIT');
  });

  test('$600 with a bare Transaction PERMIT stays PERMIT — no local ladder', async () => {
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
    expect(out.stepUpRequired).toBeFalsy();
    expect(out.decision).toBe('PERMIT');
  });

  test('a failed Transaction consult fails closed, it does not fall back to local bands', async () => {
    // Previously a 429 REQUEST_LIMITED here silently handed the decision to the
    // BFF's own amount ladder. With no PDP answer there is no decision to
    // enforce, so the call is blocked and the reason says so.
    pingOneAuthorizeService.evaluateTransaction.mockRejectedValueOnce(
      new Error('REQUEST_LIMITED'),
    );
    const out = await _applyTransactionPolicy(base, {
      amount: 300,
      transactionType: 'transfer',
      userId: 'user-1',
      acr: 'Password',
      useCaseId: 'hitl-consent',
    });
    expect(out.transactionPolicyUnavailable).toBe(true);
    expect(out.hitlRequired).toBeFalsy();
    expect(out.secondaryEvaluation.decision).toBe('UNAVAILABLE');
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

  // ── UC7 / UC8 routing regression guards ──────────────────────────────────────
  // These two tests lock in the boundary that caused a reported regression:
  // a PingOne policy returned stepUpRequired for $300 (HITL band), and the BFF
  // promoted it to mcp_step_up_required, making UC8 show P1MFA instead of the
  // consent modal.

  test('UC8 regression: $300 PingOne stepUpRequired is NOT promoted when amount is below MFA threshold', async () => {
    // PingOne Authorize may return stepUpRequired even for $300 (a policy that
    // didn't distinguish HITL vs step-up bands). Without the threshold guard the
    // BFF promoted this to mcp_step_up_required and UC8 showed P1MFA.
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValueOnce({
      decision: 'PERMIT',
      stepUpRequired: true,
      consentRequired: false,
      hitlRequired: false,
    });
    const out = await _applyTransactionPolicy(base, {
      amount: 300,
      transactionType: 'transfer',
      userId: 'user-1',
      acr: 'Password',
      // No useCaseId — UC8 has no declared stepUpMethod, so forceStepUp = false
    });
    expect(out.stepUpRequired).toBeFalsy();
    expect(out.transactionPolicyStepUp).toBeFalsy();
    expect(out.decision).toBe('PERMIT');
  });

  test('UC7: forceStepUp always fires step-up regardless of PingOne answer or amount', async () => {
    // UC7 declares stepUpMethod: 'p1mfa' in useCases.js. That declaration is
    // amount-independent — forceStepUp must win even when PingOne returns bare PERMIT.
    pingOneAuthorizeService.evaluateTransaction.mockResolvedValueOnce({
      decision: 'PERMIT',
      stepUpRequired: false,
      consentRequired: false,
      hitlRequired: false,
    });
    const out = await _applyTransactionPolicy(base, {
      amount: 600,
      transactionType: 'transfer',
      userId: 'user-1',
      acr: 'Password',
      useCaseId: 'step-up-required', // UC7's useCaseId field
    });
    expect(out.stepUpRequired).toBe(true);
    expect(out.hitlRequired).toBeFalsy();
    expect(out.transactionPolicyStepUp).toBe(true);
  });
});
