// demo_api_server/tests/stepVerification.replyAndGrounded.test.js
'use strict';

/**
 * Step verification — agent reply contract (#762):
 * - UC6/7/8: exact match against golden education `reply`
 * - UC1 (delegated-access): grounded reply contains a live account balance
 *
 * Ledger modes: unit-reply / unit-grounded
 */

const {
  loadGoldenByUcId,
  scoreAgentReply,
  bankingAmountGateExpectations,
} = require('../services/stepVerificationExpectations');
const { writeLedgerEntry } = require('../services/stepVerificationLedger');

const GATE_VERTICALS = ['banking', 'healthcare'];

describe('step verification — exact golden reply for amount gates (#762)', () => {
  const bankingGates = bankingAmountGateExpectations();

  test('banking catalog exposes UC6/7/8 for reply scoring', () => {
    expect(bankingGates.map((g) => g.id)).toEqual(expect.arrayContaining(['UC6', 'UC7', 'UC8']));
  });

  test.each(
    GATE_VERTICALS.flatMap((vertical) =>
      ['UC6', 'UC7', 'UC8'].map((id) => [`${vertical}/${id}`, vertical, id]),
    ),
  )('%s: golden reply scores exact PASS', (_label, vertical, id) => {
    const golden = loadGoldenByUcId(vertical, id);
    expect(golden).toBeTruthy();
    expect(golden.reply).toBeTruthy();

    const scored = scoreAgentReply({
      reply: golden.reply,
      style: 'exact',
      expectedReply: golden.reply,
    });
    const status = scored.ok ? 'PASS' : 'FAIL';

    writeLedgerEntry({
      vertical,
      useCaseId: id,
      triggerType: 'chip',
      mode: 'unit-reply',
      status,
      errorClass: scored.ok ? null : (scored.reason || 'wrong_response'),
      primaryTool: vertical === 'healthcare' ? 'pay_bill' : 'create_transfer',
      checkedAt: new Date().toISOString(),
      verifiedBy: 'scoreAgentReply exact vs data/goldens (#762)',
    });

    expect(scored.ok).toBe(true);
  });

  test('exact style fails when reply drifts from golden', () => {
    const golden = loadGoldenByUcId('banking', 'UC6');
    const scored = scoreAgentReply({
      reply: 'Bill Paid',
      style: 'exact',
      expectedReply: golden.reply,
    });
    expect(scored.ok).toBe(false);
    expect(scored.reason).toBe('reply_mismatch');
  });
});

describe('step verification — grounded read reply (#762)', () => {
  test('UC1: reply containing live balance scores grounded PASS', () => {
    const liveAccounts = [
      { id: 'checking', balance: 3144.52 },
      { id: 'savings', balance: 8900.1 },
    ];
    // Agent may format money; scoreAgentReply requires raw balance substring.
    const reply = `Your checking balance is 3144.52 and savings is 8900.1.`;
    const scored = scoreAgentReply({
      reply,
      style: 'grounded',
      liveAccounts,
    });
    const status = scored.ok ? 'PASS' : 'FAIL';

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: 'UC1',
      triggerType: 'chip',
      mode: 'unit-grounded',
      status,
      errorClass: scored.ok ? null : (scored.reason || 'wrong_response'),
      primaryTool: 'get_my_accounts',
      checkedAt: new Date().toISOString(),
      verifiedBy: 'scoreAgentReply grounded vs live account balances (#762)',
    });

    expect(scored.ok).toBe(true);
  });

  test('healthcare UC1-class read: grounded coverage reply', () => {
    const liveAccounts = [{ id: 'plan', balance: 0 }];
    // Healthcare reads are not account balances; still exercise grounded contract
    // with a numeric figure the reply must contain (deductible remaining).
    const reply = 'Your deductible remaining is 0.';
    const scored = scoreAgentReply({ reply, style: 'grounded', liveAccounts });
    const status = scored.ok ? 'PASS' : 'FAIL';

    writeLedgerEntry({
      vertical: 'healthcare',
      useCaseId: 'UC1',
      triggerType: 'chip',
      mode: 'unit-grounded',
      status,
      errorClass: scored.ok ? null : (scored.reason || 'wrong_response'),
      primaryTool: 'view_coverage',
      checkedAt: new Date().toISOString(),
      verifiedBy: 'scoreAgentReply grounded (#762) — healthcare read figure',
    });

    expect(scored.ok).toBe(true);
  });
});
