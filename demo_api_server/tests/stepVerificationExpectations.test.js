// demo_api_server/tests/stepVerificationExpectations.test.js
'use strict';

const {
  amountFromChipText,
  normalizeParsedIntent,
  expectationFromUseCase,
  bankingAmountGateExpectations,
  bankingWorksChipExpectations,
  scoreTokenChainDetail,
  loadGoldenByUcId,
  scoreAgentReply,
  TOKEN_SUMMARY_IDS_1EX,
  TOKEN_SUMMARY_IDS_2EX,
  detectTokenSummaryMode,
  scoreTokenSummaryCoverage,
  scoreBankingVerticalPrereq,
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

  test('scoreTokenChainDetail requires events with teaching detail', () => {
    expect(scoreTokenChainDetail(null).ok).toBe(false);
    expect(scoreTokenChainDetail([{ id: 'user-token' }]).ok).toBe(false);
    expect(scoreTokenChainDetail([
      { id: 'user-token', claims: { sub: 'u1' } },
      { id: 'exchange-failed', status: 'failed', explanation: 'invalid_scope', pingoneError: 'invalid_scope' },
    ], { requireFailureEvent: true }).ok).toBe(true);
    expect(scoreTokenChainDetail([
      { id: 'user-token', claims: { sub: 'u1' } },
    ], { requireFailureEvent: true }).reason).toBe('missing_failure_event');
  });

  test('loadGoldenByUcId returns gate education replies for UC6/7/8', () => {
    expect(loadGoldenByUcId('banking', 'UC8')?.reply).toMatch(/human approval/i);
    // Accept either wording. The previous golden was captured in SIMULATED
    // education mode ("Simulated authorization policy requires step-up ...
    // (education mode)"); a real PingOne Authorize run says "requires additional
    // authentication before MCP tools can run". The real one is the better
    // golden, so the assertion tracks the GATE, not one path's phrasing.
    expect(loadGoldenByUcId('banking', 'UC7')?.reply).toMatch(/step-up|additional authentication/i);
    expect(loadGoldenByUcId('banking', 'UC6')?.reply).toMatch(/denied/i);
  });

  test('scoreAgentReply exact matches golden gate text; grounded needs live balances', () => {
    const hitl = loadGoldenByUcId('banking', 'UC8');
    expect(scoreAgentReply({
      reply: hitl.reply,
      style: 'exact',
      expectedReply: hitl.reply,
    }).ok).toBe(true);
    expect(scoreAgentReply({
      reply: 'wrong education copy',
      style: 'exact',
      expectedReply: hitl.reply,
    }).reason).toBe('reply_mismatch');

    expect(scoreAgentReply({
      reply: 'Your balances:\nCHECKING — $3144.52 USD',
      style: 'grounded',
      liveAccounts: [{ balance: 3144.52 }],
    }).ok).toBe(true);
    expect(scoreAgentReply({
      reply: 'Your balances look fine',
      style: 'grounded',
      liveAccounts: [{ balance: 3144.52 }],
    }).reason).toBe('reply_ungrounded');
  });
});

describe('scoreTokenSummaryCoverage', () => {
  test('2-exchange run requires the full Token Summary set', () => {
    const events = TOKEN_SUMMARY_IDS_2EX.map((id) => ({
      id,
      claims: { sub: id },
      explanation: 'ok',
    }));
    const scored = scoreTokenSummaryCoverage(events);
    expect(scored.ok).toBe(true);
    expect(scored.mode).toBe('2ex');
    expect(scored.present).toEqual(TOKEN_SUMMARY_IDS_2EX);
    expect(scored.missing).toEqual([]);
  });

  test('1-exchange run accepts exchanged-token-fallback as delegated slot', () => {
    const events = [
      { id: 'user-token', claims: { sub: 'u1' } },
      { id: 'agent-actor-token', claims: { sub: 'agent' } },
      { id: 'exchanged-token-fallback', claims: { sub: 'u1', act: { sub: 'agent' } } },
    ];
    expect(detectTokenSummaryMode(events)).toBe('1ex');
    expect(scoreTokenSummaryCoverage(events).ok).toBe(true);
  });
});

describe('scoreBankingVerticalPrereq', () => {
  test('healthcare leftovers fail as missing_prereq (not wrong_gate)', () => {
    const scored = scoreBankingVerticalPrereq(
      [{ accountType: 'Primary Care' }, { accountType: 'HSA' }],
      'healthcare',
    );
    expect(scored.ok).toBe(false);
    expect(scored.reason).toBe('missing_prereq');
    expect(scored.prereqErrors.some((e) => /active_vertical=healthcare/.test(e))).toBe(true);
    expect(scored.prereqErrors.some((e) => /missing checking/.test(e))).toBe(true);
  });

  test('passes for banking checking+savings', () => {
    const scored = scoreBankingVerticalPrereq(
      [{ accountType: 'checking' }, { accountType: 'savings' }],
      'banking',
    );
    expect(scored.ok).toBe(true);
    expect(scored.prereqErrors).toEqual([]);
  });
});

