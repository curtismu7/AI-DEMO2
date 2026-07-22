// demo_api_server/tests/stepVerificationExpectations.test.js
'use strict';

const {
  amountFromChipText,
  normalizeParsedIntent,
  expectationFromUseCase,
  bankingAmountGateExpectations,
  bankingWorksChipExpectations,
} = require('../services/stepVerificationExpectations');
const { resolveUseCase } = require('../config/useCases.js');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');

describe('stepVerificationExpectations', () => {
  test('amountFromChipText reads $N', () => {
    expect(amountFromChipText('transfer $300 from checking to savings')).toBe(300);
    expect(amountFromChipText('transfer $2500 from checking to savings')).toBe(2500);
    expect(amountFromChipText('show my balance')).toBeNull();
  });

  test('normalizeParsedIntent expands transfer_600_test to amount 600', () => {
    const n = normalizeParsedIntent({
      kind: 'banking',
      banking: { action: 'transfer_600_test' },
    });
    expect(n.tool).toBe('create_transfer');
    expect(n.amount).toBe(600);
    expect(n.params.fromId).toBe('checking');
  });

  test('UC6/7/8 expectations expose amount + gate from catalog', () => {
    const gates = bankingAmountGateExpectations();
    const byId = Object.fromEntries(gates.map((g) => [g.id, g]));
    expect(byId.UC6).toMatchObject({ amount: 2500, gate: 'DENY', primaryTool: 'create_transfer' });
    expect(byId.UC7).toMatchObject({ amount: 600, gate: 'STEP_UP', primaryTool: 'create_transfer' });
    expect(byId.UC8).toMatchObject({ amount: 300, gate: 'HITL', primaryTool: 'create_transfer' });
  });

  test('works chip matrix is non-empty and every row has primaryTool', () => {
    const rows = bankingWorksChipExpectations();
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      expect(r.primaryTool).toBeTruthy();
      expect(r.expectedOutcome).toBeTruthy();
    }
  });

  test('live parse of UC6/7/8 matches expectation amount after normalize', () => {
    const ctx = resolveVerticalCtx('banking');
    for (const id of ['UC6', 'UC7', 'UC8']) {
      const uc = resolveUseCase(id, 'banking');
      const exp = expectationFromUseCase(uc);
      const parsed = parseHeuristic(exp.chipText, 'banking', ctx, {});
      const n = normalizeParsedIntent(parsed);
      expect(n.tool).toBe('create_transfer');
      expect(n.amount).toBe(exp.amount);
    }
  });
});
