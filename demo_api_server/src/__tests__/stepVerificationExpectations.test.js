// demo_api_server/src/__tests__/stepVerificationExpectations.test.js
'use strict';

const {
  TOKEN_SUMMARY_IDS_1EX,
  TOKEN_SUMMARY_IDS_2EX,
  detectTokenSummaryMode,
  scoreTokenSummaryCoverage,
  scoreTokenChainDetail,
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
