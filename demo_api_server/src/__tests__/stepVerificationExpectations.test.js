// demo_api_server/src/__tests__/stepVerificationExpectations.test.js
'use strict';

const {
  TOKEN_SUMMARY_IDS_1EX,
  TOKEN_SUMMARY_IDS_2EX,
  detectTokenSummaryMode,
  scoreTokenSummaryCoverage,
  scoreTokenChainDetail,
  scoreBankingVerticalPrereq,
} = require('../../services/stepVerificationExpectations');

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

  test('2-exchange missing final token fails with missing_summary_tokens', () => {
    const events = TOKEN_SUMMARY_IDS_2EX.slice(0, -1).map((id) => ({
      id,
      claims: { sub: id },
    }));
    const scored = scoreTokenSummaryCoverage(events);
    expect(scored.ok).toBe(false);
    expect(scored.reason).toBe('missing_summary_tokens');
    expect(scored.missing).toEqual(['two-ex-final-token']);
  });

  test('1-exchange run accepts exchanged-token-fallback as delegated slot', () => {
    const events = [
      { id: 'user-token', claims: { sub: 'u1' } },
      { id: 'agent-actor-token', claims: { sub: 'agent' } },
      { id: 'exchanged-token-fallback', claims: { sub: 'u1', act: { sub: 'agent' } } },
    ];
    expect(detectTokenSummaryMode(events)).toBe('1ex');
    const scored = scoreTokenSummaryCoverage(events);
    expect(scored.ok).toBe(true);
    expect(scored.mode).toBe('1ex');
    expect(scored.present).toEqual(TOKEN_SUMMARY_IDS_1EX);
  });

  test('empty events fail', () => {
    expect(scoreTokenSummaryCoverage([]).ok).toBe(false);
    expect(scoreTokenChainDetail([]).ok).toBe(false);
  });
});

describe('scoreBankingVerticalPrereq', () => {
  test('passes for banking checking+savings', () => {
    const scored = scoreBankingVerticalPrereq(
      [{ accountType: 'checking' }, { accountType: 'savings' }],
      'banking',
    );
    expect(scored.ok).toBe(true);
    expect(scored.reason).toBeNull();
    expect(scored.prereqErrors).toEqual([]);
  });

  test('healthcare leftovers fail as missing_prereq (not wrong_gate)', () => {
    const scored = scoreBankingVerticalPrereq(
      [{ accountType: 'Primary Care' }, { accountType: 'HSA' }],
      'healthcare',
    );
    expect(scored.ok).toBe(false);
    expect(scored.reason).toBe('missing_prereq');
    expect(scored.prereqErrors.some((e) => /active_vertical=healthcare/.test(e))).toBe(true);
    expect(scored.prereqErrors.some((e) => /missing checking/.test(e))).toBe(true);
    expect(scored.prereqErrors.some((e) => /healthcare account types/.test(e))).toBe(true);
  });

  test('banking vertical with only healthcare accounts still fails', () => {
    const scored = scoreBankingVerticalPrereq(
      [{ accountType: 'Primary Care' }, { accountType: 'HSA' }],
      'banking',
    );
    expect(scored.ok).toBe(false);
    expect(scored.reason).toBe('missing_prereq');
    expect(scored.activeVertical).toBe('banking');
  });
});
