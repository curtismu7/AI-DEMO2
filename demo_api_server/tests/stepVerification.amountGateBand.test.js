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

const { AMOUNT_PRIMARY_TOOL_BY_VERTICAL } = require('../config/useCases');

// All verticals that participate in the UC6/7/8 amount-gate demo.
// Each must have the same DENY/STEP_UP/HITL breakpoints as banking.
// Adding a new vertical? Add it here — the test enforces that every
// vertical in AMOUNT_PRIMARY_TOOL_BY_VERTICAL is covered.
const AMOUNT_GATE_VERTICALS = [
  { vertical: 'banking',        primaryTool: 'create_transfer' },
  { vertical: 'healthcare',     primaryTool: 'pay_bill' },
  { vertical: 'retail',         primaryTool: 'checkout' },
  { vertical: 'abercrombie-fitch', primaryTool: 'checkout' },
  { vertical: 'government',     primaryTool: 'pay_fee' },
  { vertical: 'university',     primaryTool: 'pay_tuition_balance' },
  { vertical: 'workforce',      primaryTool: 'submit_expense' },
  { vertical: 'sporting-goods', primaryTool: 'extend_rental' },
  { vertical: 'manufacturing',  primaryTool: 'approve_purchase_order' },
  { vertical: 'investment',     primaryTool: 'large_trade' },
  { vertical: 'airlines',       primaryTool: 'pay_airline_fee' },
];

const CASES = [
  ...bankingAmountGateExpectations().map((g) => ({
    id: g.id,
    vertical: 'banking',
    amount: g.amount,
    gate: g.gate,
    primaryTool: 'create_transfer',
  })),
  // All non-banking verticals: same three breakpoints as banking.
  ...AMOUNT_GATE_VERTICALS
    .filter((v) => v.vertical !== 'banking')
    .flatMap(({ vertical, primaryTool }) => [
      { id: 'UC6', vertical, amount: 2500, gate: 'DENY',    primaryTool },
      { id: 'UC7', vertical, amount: 600,  gate: 'STEP_UP', primaryTool },
      { id: 'UC8', vertical, amount: 300,  gate: 'HITL',    primaryTool },
    ]),
];

describe('step verification — amount gates come from the Transaction policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('AMOUNT_PRIMARY_TOOL_BY_VERTICAL is fully covered — no vertical drifts out of sync', () => {
    // banking uses its own base UC entries (primaryTool: 'create_transfer') and is
    // NOT in AMOUNT_PRIMARY_TOOL_BY_VERTICAL. All other verticals are, and every
    // one must appear in AMOUNT_GATE_VERTICALS above or this test fails.
    const catalogVerticals = Object.keys(AMOUNT_PRIMARY_TOOL_BY_VERTICAL).sort();
    const coveredNonBanking = AMOUNT_GATE_VERTICALS
      .filter((v) => v.vertical !== 'banking')
      .map((v) => v.vertical)
      .sort();
    expect(coveredNonBanking).toEqual(catalogVerticals);
  });

  test('covers all verticals for UC6/7/8', () => {
    const pairs = CASES.map((c) => `${c.vertical}:${c.id}`);
    for (const { vertical } of AMOUNT_GATE_VERTICALS) {
      expect(pairs).toContain(`${vertical}:UC6`);
      expect(pairs).toContain(`${vertical}:UC7`);
      expect(pairs).toContain(`${vertical}:UC8`);
    }
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
