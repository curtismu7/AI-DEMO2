// demo_api_server/tests/stepVerification.amountGateBand.test.js
'use strict';

/**
 * Step verification — amount gates UC6/7/8, PDP-sourced only.
 *
 * This suite used to prove the opposite: that `_applyTransactionPolicy` landed
 * UC6/7/8 from a LOCAL amount ladder whenever the Transaction endpoint PERMITted
 * without an obligation or errored (#769). That ladder is gone — PingOne
 * Authorize decides an amount gate or nothing does — so the same three use cases
 * are now verified through the only remaining source of truth:
 *
 *   (a) Transaction attaches the obligation → the overlay carries it (DENY /
 *       STEP_UP / HITL land exactly as before, but because the PDP said so)
 *   (b) Transaction PERMITs bare            → PERMIT, no synthesized gate
 *   (c) Transaction 429/errors              → fail closed, no synthesized gate
 *
 * Ledger: data/step-verification/<vertical>/<UC>.chip.unit-gate-pdp.json
 */

jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn(),
  evaluateMcpToolDelegation: jest.fn(),
}));

const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const { _applyTransactionPolicy } = require('../services/mcpToolAuthorizationService');
const { writeLedgerEntry } = require('../services/stepVerificationLedger');
const { bankingAmountGateExpectations } = require('../services/stepVerificationExpectations');

const PERMIT_GATE = { decision: 'PERMIT', hitlRequired: false, stepUpRequired: false };

/** Map overlay result → step-verification gate label. */
function gateFromOverlay(out) {
  if (out?.decision === 'DENY') return 'DENY';
  if (out?.stepUpRequired) return 'STEP_UP';
  if (out?.hitlRequired) return 'HITL';
  return 'PERMIT';
}

/** The Transaction-endpoint response that produces each expected gate. */
function pdpResponseFor(gate) {
  if (gate === 'DENY') {
    return { decision: 'DENY', decisionId: 'tx-deny', raw: { reason: 'amount over limit' } };
  }
  if (gate === 'STEP_UP') {
    return { decision: 'PERMIT', stepUpRequired: true, decisionId: 'tx-stepup' };
  }
  return { decision: 'PERMIT', consentRequired: true, decisionId: 'tx-consent' };
}

const CASES = [
  ...bankingAmountGateExpectations().map((g) => ({
    id: g.id,
    vertical: 'banking',
    amount: g.amount,
    gate: g.gate,
    primaryTool: 'create_transfer',
  })),
  { id: 'UC6', vertical: 'healthcare', amount: 2500, gate: 'DENY', primaryTool: 'pay_bill' },
  { id: 'UC7', vertical: 'healthcare', amount: 600, gate: 'STEP_UP', primaryTool: 'pay_bill' },
  { id: 'UC8', vertical: 'healthcare', amount: 300, gate: 'HITL', primaryTool: 'pay_bill' },
];

describe('step verification — amount gates come from the Transaction policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('covers banking + healthcare UC6/7/8', () => {
    expect(CASES.map((c) => `${c.vertical}:${c.id}`)).toEqual(expect.arrayContaining([
      'banking:UC6', 'banking:UC7', 'banking:UC8',
      'healthcare:UC6', 'healthcare:UC7', 'healthcare:UC8',
    ]));
  });

  describe('Transaction policy attaches the obligation', () => {
    test.each(CASES.map((c) => [`${c.vertical}/${c.id} $${c.amount} → ${c.gate}`, c]))(
      '%s (unit-gate-pdp)',
      async (_label, c) => {
        pingOneAuthorizeService.evaluateTransaction.mockResolvedValue(pdpResponseFor(c.gate));
        const out = await _applyTransactionPolicy(PERMIT_GATE, {
          amount: c.amount,
          transactionType: 'transfer',
          userId: 'user-1',
          acr: 'Password',
        });
        const decision = gateFromOverlay(out);
        const status = decision === c.gate ? 'PASS' : 'FAIL';

        writeLedgerEntry({
          vertical: c.vertical,
          useCaseId: c.id,
          triggerType: 'chip',
          mode: 'unit-gate-pdp',
          status,
          errorClass: status === 'FAIL' ? 'wrong_gate' : null,
          primaryTool: c.primaryTool,
          checkedAt: new Date().toISOString(),
          verifiedBy:
            'mcpToolAuthorizationService._applyTransactionPolicy — PingOne Authorize Transaction obligation',
        });

        expect(decision).toBe(c.gate);
        // Provenance: the gate must be attributable to the PDP, never synthesized.
        expect(out.secondaryEvaluation.source).toBe('transaction-policy');
        expect(out.secondaryEvaluation.decisionId).toBeTruthy();
      },
    );
  });

  describe('nothing else may create a gate', () => {
    test.each(CASES.map((c) => [`${c.vertical}/${c.id} $${c.amount}`, c]))(
      'bare Transaction PERMIT leaves %s ungated',
      async (_label, c) => {
        pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({
          decision: 'PERMIT',
          consentRequired: false,
          hitlRequired: false,
          stepUpRequired: false,
        });
        const out = await _applyTransactionPolicy(PERMIT_GATE, {
          amount: c.amount,
          transactionType: 'transfer',
          userId: 'user-1',
          acr: 'Password',
        });
        expect(gateFromOverlay(out)).toBe('PERMIT');
      },
    );

    test.each(CASES.map((c) => [`${c.vertical}/${c.id} $${c.amount}`, c]))(
      'a 429 REQUEST_LIMITED fails %s closed instead of banding it locally',
      async (_label, c) => {
        pingOneAuthorizeService.evaluateTransaction.mockRejectedValue(
          new Error('PingOne Authorize decision endpoint evaluation failed (429): REQUEST_LIMITED'),
        );
        const out = await _applyTransactionPolicy(PERMIT_GATE, {
          amount: c.amount,
          transactionType: 'transfer',
          userId: 'user-1',
          acr: 'Password',
        });
        expect(out.transactionPolicyUnavailable).toBe(true);
        expect(out.secondaryEvaluation.decision).toBe('UNAVAILABLE');
      },
    );
  });
});
