// demo_api_server/tests/stepVerification.amountGateBand.test.js
'use strict';

/**
 * Step verification — localAmountBand (#769) + Transaction 429 fall-through.
 *
 * Live MCP first-tool often PERMITs vertical writes with no amount obligation.
 * _applyTransactionPolicy must still land UC6/7/8 via:
 *   (a) Transaction PERMIT with no HITL/step-up → localAmountBand
 *   (b) Transaction 429/error → catch fall-through → localAmountBand
 *
 * Ledger: data/step-verification/<vertical>/<UC>.chip.unit-gate-band.json
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

const SCENARIOS = [
  {
    mode: 'unit-gate-band',
    label: 'Transaction PERMIT no obligation',
    setup: () => {
      pingOneAuthorizeService.evaluateTransaction.mockResolvedValue({
        decision: 'PERMIT',
        consentRequired: false,
        hitlRequired: false,
        stepUpRequired: false,
      });
    },
  },
  {
    mode: 'unit-gate-fallback',
    label: 'Transaction 429 REQUEST_LIMITED',
    setup: () => {
      pingOneAuthorizeService.evaluateTransaction.mockRejectedValue(
        new Error('PingOne Authorize decision endpoint evaluation failed (429): REQUEST_LIMITED'),
      );
    },
  },
];

describe('step verification — amount gate band (localAmountBand + 429 fall-through)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('covers banking + healthcare UC6/7/8', () => {
    expect(CASES.map((c) => `${c.vertical}:${c.id}`)).toEqual(expect.arrayContaining([
      'banking:UC6', 'banking:UC7', 'banking:UC8',
      'healthcare:UC6', 'healthcare:UC7', 'healthcare:UC8',
    ]));
  });

  for (const scenario of SCENARIOS) {
    describe(scenario.label, () => {
      test.each(CASES.map((c) => [
        `${c.vertical}/${c.id} $${c.amount} → ${c.gate}`,
        c,
      ]))(
        `%s (${scenario.mode})`,
        async (_label, c) => {
          scenario.setup();
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
            mode: scenario.mode,
            status,
            errorClass: status === 'FAIL' ? 'wrong_gate' : null,
            primaryTool: c.primaryTool,
            checkedAt: new Date().toISOString(),
            verifiedBy:
              scenario.mode === 'unit-gate-band'
                ? 'mcpToolAuthorizationService._applyTransactionPolicy localAmountBand (#769)'
                : 'Transaction 429 → catch fall-through → localAmountBand (#769)',
          });

          expect(decision).toBe(c.gate);
          if (scenario.mode === 'unit-gate-band' || scenario.mode === 'unit-gate-fallback') {
            expect(out.localAmountBand || out.transactionPolicyDenied || out.transactionPolicyStepUp || out.transactionPolicyHitl).toBeTruthy();
          }
        },
      );
    });
  }
});
