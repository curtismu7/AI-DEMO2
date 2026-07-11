/**
 * @file pingOneAuthorize.policyNotFound.test.js
 * Policy-not-found detection in the P1AZ client (spec:
 * docs/superpowers/specs/2026-07-11-p1az-policy-not-found-design.md):
 *  - _normalizeDecision maps ONLY the literal NOT_APPLICABLE effect to
 *    'NOT_APPLICABLE'; every other unknown effect still fails closed to DENY.
 *  - An HTTP 404 from the decision call throws with code='policy_not_found';
 *    other statuses keep the untagged generic error.
 */
process.env.PINGONE_ENVIRONMENT_ID = process.env.PINGONE_ENVIRONMENT_ID || 'env-test';
process.env.PINGONE_WORKER_CLIENT_ID = process.env.PINGONE_WORKER_CLIENT_ID || 'cid';
process.env.PINGONE_WORKER_CLIENT_SECRET = process.env.PINGONE_WORKER_CLIENT_SECRET || 'secret';

const svc = require('../../services/pingOneAuthorizeService');

const tokenResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'tok', expires_in: 3600 }),
});

const _origFetch = globalThis.fetch;
beforeEach(() => {
  if (typeof svc._resetAuthorizeRuntimeState === 'function') svc._resetAuthorizeRuntimeState();
});
afterEach(() => {
  globalThis.fetch = _origFetch;
});

describe('_normalizeDecision NOT_APPLICABLE', () => {
  it('maps literal NOT_APPLICABLE to NOT_APPLICABLE', () => {
    expect(svc._normalizeDecision({ decision: 'NOT_APPLICABLE' })).toBe('NOT_APPLICABLE');
    expect(svc._normalizeDecision({ decision: 'not_applicable' })).toBe('NOT_APPLICABLE');
  });

  it('still collapses other unknown effects to DENY (fail-closed)', () => {
    expect(svc._normalizeDecision({ decision: 'BANANA' })).toBe('DENY');
    expect(svc._normalizeDecision({})).toBe('DENY');
    expect(svc._normalizeDecision({ decision: '' })).toBe('DENY');
  });

  it('PERMIT/DENY unchanged', () => {
    expect(svc._normalizeDecision({ decision: 'PERMIT' })).toBe('PERMIT');
    expect(svc._normalizeDecision({ decision: 'deny' })).toBe('DENY');
  });

  it('obligation fallback unchanged for unknown effects', () => {
    expect(svc._normalizeDecision({ decision: 'weird' }, { hasObligation: true })).toBe('INDETERMINATE');
  });
});

describe('404 tagging', () => {
  it('tags decision-endpoint 404 with code=policy_not_found', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: false, status: 404, text: async () => 'NOT_FOUND' });
    await expect(
      svc.evaluateTransaction({ decisionEndpointId: 'missing-id', userId: 'u1', amount: 1, type: 'transfer' }),
    ).rejects.toMatchObject({ code: 'policy_not_found', status: 404 });
  });

  it('does NOT tag a 500', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const err = await svc
      .evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBeUndefined();
  });
});
