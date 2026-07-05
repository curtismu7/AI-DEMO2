/**
 * C1 regression — fail-closed decision-envelope normalisation.
 *
 * The PingOne Authorize decision endpoint carries the authorization *effect*
 * under `decision` / `result.decision` / `details.decision`, and a
 * transport-level `status: 'SUCCESS'` wrapper. Reading `status` as the decision
 * (the previous `raw.decision || raw.status` fallthrough) turned a live DENY
 * into a silent PERMIT. These tests pin the fail-closed behaviour.
 */
const { _normalizeDecision } = require('../../services/pingOneAuthorizeService');

describe('pingOneAuthorizeService._normalizeDecision (C1 fail-closed)', () => {
  test('clean top-level PERMIT stays PERMIT', () => {
    expect(_normalizeDecision({ decision: 'PERMIT' })).toBe('PERMIT');
    expect(_normalizeDecision({ decision: 'permit' })).toBe('PERMIT');
    expect(_normalizeDecision({ decision: 'ALLOW' })).toBe('PERMIT');
  });

  test('top-level DENY is DENY', () => {
    expect(_normalizeDecision({ decision: 'DENY' })).toBe('DENY');
    expect(_normalizeDecision({ decision: 'denied' })).toBe('DENY');
  });

  test('envelope form (result.decision = DENY) with status SUCCESS is DENY, not permit', () => {
    const raw = { status: 'SUCCESS', result: { decision: 'DENY' }, obligations: [] };
    expect(_normalizeDecision(raw)).toBe('DENY');
  });

  test('details.decision = PERMIT is honoured', () => {
    expect(_normalizeDecision({ status: 'SUCCESS', details: { decision: 'PERMIT' } })).toBe('PERMIT');
  });

  test('unrecognised top-level status (SUCCESS) with no decision and no obligation fails closed to DENY', () => {
    expect(_normalizeDecision({ status: 'SUCCESS' })).toBe('DENY');
  });

  test('malformed / empty body fails closed to DENY', () => {
    expect(_normalizeDecision({})).toBe('DENY');
    expect(_normalizeDecision(null)).toBe('DENY');
    expect(_normalizeDecision({ decision: '' })).toBe('DENY');
  });

  test('unknown decision string WITH an enforceable obligation returns INDETERMINATE (caller acts on obligation)', () => {
    expect(_normalizeDecision({ status: 'SUCCESS' }, { hasObligation: true })).toBe('INDETERMINATE');
  });

  test('unknown decision string WITHOUT obligation fails closed even when hasObligation flag omitted', () => {
    expect(_normalizeDecision({ status: 'INDETERMINATE' })).toBe('DENY');
  });
});
