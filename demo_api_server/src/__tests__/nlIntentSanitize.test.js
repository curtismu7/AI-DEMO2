'use strict';

const { sanitizeNlResult } = require('../../services/nlIntentSanitize');

describe('nlIntentSanitize', () => {
  it('accepts valid banking action', () => {
    const { result, rejected } = sanitizeNlResult(
      { kind: 'banking', banking: { action: 'accounts' } },
      'show accounts',
    );
    expect(rejected).toBe(false);
    expect(result.banking.action).toBe('accounts');
  });

  it('rewrites plural balance request to accounts when no accountId is provided', () => {
    const { result, rejected } = sanitizeNlResult(
      {
        kind: 'banking',
        banking: { action: 'balance', params: {} },
      },
      'get balances',
    );
    expect(rejected).toBe(true);
    expect(result.banking.action).toBe('accounts');
  });

  it('rejects unknown banking action and falls back to heuristic', () => {
    const { result, rejected } = sanitizeNlResult(
      { kind: 'banking', banking: { action: 'wire_swift' } },
      'show my accounts',
    );
    expect(rejected).toBe(true);
    expect(result.kind).toBe('banking');
    expect(result.banking.action).toBe('accounts');
  });

  it('rejects unknown education panel', () => {
    const { result, rejected } = sanitizeNlResult(
      { kind: 'education', education: { panel: 'fake-panel' } },
      'what is token exchange',
    );
    expect(rejected).toBe(true);
    expect(result.kind).toBe('education');
    expect(result.education.panel).toBe('token-exchange');
  });

  it('accepts CIBA flag without panel', () => {
    const { result, rejected } = sanitizeNlResult(
      { kind: 'education', ciba: true, tab: 'what' },
      'what is ciba',
    );
    expect(rejected).toBe(false);
    expect(result.ciba).toBe(true);
  });

  it('strips LLM-copied placeholder accountId "optional" from balance intent', () => {
    const { result, rejected } = sanitizeNlResult(
      {
        kind: 'banking',
        banking: { action: 'balance', params: { accountId: 'optional' } },
      },
      'Check my account balance',
    );
    expect(rejected).toBe(false);
    expect(result.banking.action).toBe('balance');
    expect(result.banking.params.accountId).toBeUndefined();
    expect(result.banking.params.account_id).toBeUndefined();
  });
});
