/**
 * @file pingOneAuthorize.reliability.test.js
 * P1AZ client reliability hardening (spec:
 * docs/superpowers/specs/2026-07-11-p1az-reliability-design.md):
 *  - worker token cache (reuse until expiry; refresh once on 401)
 *  - fetchT single retry on transient failure (network/timeout or 5xx, never 4xx)
 *  - circuit breaker (3 consecutive failures → fail fast 60s; policy_not_found
 *    never trips it; success resets the count)
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
const permitResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({ decision: 'PERMIT' }),
});

const _origFetch = globalThis.fetch;
beforeEach(() => svc._resetAuthorizeRuntimeState());
afterEach(() => {
  globalThis.fetch = _origFetch;
});

const evalOnce = () =>
  svc.evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' })
    .catch((e) => e);

describe('worker token cache', () => {
  it('reuses the token until expiry', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(tokenResponse());
    await svc.getWorkerToken();
    await svc.getWorkerToken();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes and retries once on 401 from a decision call', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'expired' })
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(permitResponse());
    const r = await svc.evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' });
    expect(r.decision).toBe('PERMIT');
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });
});

describe('fetchT retry', () => {
  it('retries once on network error', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(permitResponse());
    const r = await svc.evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' });
    expect(r.decision).toBe('PERMIT');
  });

  it('retries once on 5xx, then succeeds', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' })
      .mockResolvedValueOnce(permitResponse());
    const r = await svc.evaluateTransaction({ decisionEndpointId: 'ep', userId: 'u1', amount: 1, type: 'transfer' });
    expect(r.decision).toBe('PERMIT');
  });

  it('does NOT retry a 404', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: false, status: 404, text: async () => 'nope' });
    const err = await evalOnce();
    expect(err.code).toBe('policy_not_found');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // token + one decision call
  });
});

describe('circuit breaker', () => {
  const fail500 = () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
  };

  it('opens after 3 consecutive failures and fails fast', async () => {
    fail500();
    await evalOnce();
    await evalOnce();
    await evalOnce();
    const fetchCallsBefore = globalThis.fetch.mock.calls.length;
    const err = await evalOnce();
    expect(err.code).toBe('authorize_circuit_open');
    expect(globalThis.fetch.mock.calls.length).toBe(fetchCallsBefore); // no network call
  });

  it('policy_not_found does not trip the breaker', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue({ ok: false, status: 404, text: async () => 'nope' });
    await evalOnce();
    await evalOnce();
    await evalOnce();
    const err = await evalOnce();
    expect(err.code).toBe('policy_not_found'); // still live, not circuit_open
  });

  it('success resets the count', async () => {
    fail500();
    await evalOnce();
    await evalOnce();
    // Token is still cached from the first mock, so these mocks serve decision
    // calls only.
    globalThis.fetch = jest.fn().mockResolvedValue(permitResponse());
    const ok = await evalOnce();
    expect(ok.decision).toBe('PERMIT');
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const err = await evalOnce();
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBeUndefined(); // count restarted — breaker not open yet
  });
});
