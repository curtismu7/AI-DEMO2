/**
 * Policy-not-found detection primitive (P1AZ hardening amendment §A).
 *
 * Drift ("code added a tool/action P1AZ has no policy for") must surface as a
 * SIDE-CHANNEL flag while the normalized `decision` stays fail-closed (DENY).
 * The original design proposed a new normalized value 'NOT_APPLICABLE'; that
 * fails OPEN in every consumer that blocks on `decision === 'DENY'` and treats
 * everything else as permit (sensitiveDataService, checkStepUpRequired). These
 * tests pin the safe shape: decision never leaves PERMIT/DENY/INDETERMINATE,
 * and drift is carried separately.
 */
const {
  _normalizeDecision,
  _isPolicyNotFoundEffect,
  _decisionError,
} = require('../../services/pingOneAuthorizeService');

describe('_normalizeDecision stays fail-closed on NOT_APPLICABLE (amendment §A invariant)', () => {
  test('literal not_applicable normalizes to DENY, never a new value', () => {
    expect(_normalizeDecision({ decision: 'NOT_APPLICABLE' })).toBe('DENY');
    expect(_normalizeDecision({ decision: 'not_applicable' })).toBe('DENY');
    expect(_normalizeDecision({ result: { decision: 'NotApplicable' } })).toBe('DENY');
  });

  test('not_applicable with an obligation still does not become PERMIT', () => {
    // INDETERMINATE is caller-acts-on-obligation, still not a silent permit.
    const out = _normalizeDecision({ decision: 'NOT_APPLICABLE' }, { hasObligation: true });
    expect(['DENY', 'INDETERMINATE']).toContain(out);
    expect(out).not.toBe('PERMIT');
  });
});

describe('_isPolicyNotFoundEffect (drift side-channel detector)', () => {
  test('true only for a literal not_applicable effect (case/format-insensitive)', () => {
    expect(_isPolicyNotFoundEffect({ decision: 'NOT_APPLICABLE' })).toBe(true);
    expect(_isPolicyNotFoundEffect({ decision: 'not_applicable' })).toBe(true);
    expect(_isPolicyNotFoundEffect({ decision: ' Not-Applicable ' })).toBe(true);
    expect(_isPolicyNotFoundEffect({ result: { decision: 'NOTAPPLICABLE' } })).toBe(true);
  });

  test('false for PERMIT / DENY / unknown / empty — no false drift', () => {
    expect(_isPolicyNotFoundEffect({ decision: 'PERMIT' })).toBe(false);
    expect(_isPolicyNotFoundEffect({ decision: 'DENY' })).toBe(false);
    expect(_isPolicyNotFoundEffect({ decision: 'INDETERMINATE' })).toBe(false);
    expect(_isPolicyNotFoundEffect({ status: 'SUCCESS' })).toBe(false);
    expect(_isPolicyNotFoundEffect({})).toBe(false);
    expect(_isPolicyNotFoundEffect(null)).toBe(false);
  });
});

describe('_decisionError (single status->code mapping for both decision paths)', () => {
  test('404 is tagged policy_not_found with status, so drift is distinguishable from an outage', () => {
    const err = _decisionError(404, 'no such endpoint', 'decision endpoint');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('policy_not_found');
    expect(err.status).toBe(404);
    expect(err.message).toMatch(/404/);
  });

  test('non-404 errors carry status but NOT the policy_not_found code (still a plain outage)', () => {
    for (const status of [500, 502, 503, 401, 400]) {
      const err = _decisionError(status, 'boom', 'decision endpoint');
      expect(err.status).toBe(status);
      expect(err.code).toBeUndefined();
    }
  });
});
