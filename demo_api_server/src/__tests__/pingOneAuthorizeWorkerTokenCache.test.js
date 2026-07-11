/**
 * Worker token cache (P1AZ hardening amendment §E).
 *
 * getWorkerToken() must:
 *  - reuse a still-valid token instead of a client-credentials call per decision,
 *  - single-flight concurrent callers into ONE token request (no stampede),
 *  - invalidate immediately on a credential/environment rotation (keyed cache),
 *  - refetch once the token is within 60s of its own expiry,
 *  - be resettable in tests.
 */
jest.mock('../../services/configStore');

const configStore = require('../../services/configStore');
const svc = require('../../services/pingOneAuthorizeService');

let creds;
let tokenSeq;
let fetchCalls;

function setCreds({ envId = 'env-1', clientId = 'client-A', clientSecret = 'secret-A' } = {}) {
  creds = { pingone_environment_id: envId, pingone_region: 'com',
    authorize_worker_client_id: clientId, authorize_worker_client_secret: clientSecret };
}

beforeEach(() => {
  jest.clearAllMocks();
  setCreds();
  tokenSeq = 0;
  fetchCalls = 0;
  configStore.get = jest.fn(() => null);
  configStore.getEffective = jest.fn((k) => creds[k] ?? null);
  // Default: long-lived tokens (expires_in 3600s) so the cache is reusable.
  global.fetch = jest.fn(async () => {
    fetchCalls += 1;
    tokenSeq += 1;
    return { ok: true, status: 200, json: async () => ({ access_token: `tok-${tokenSeq}`, expires_in: 3600 }) };
  });
  svc._resetAuthorizeRuntimeState();
});

test('reuses a valid cached token instead of minting one per call', async () => {
  const a = await svc.getWorkerToken();
  const b = await svc.getWorkerToken();
  expect(a).toBe('tok-1');
  expect(b).toBe('tok-1');
  expect(fetchCalls).toBe(1);
});

test('single-flights concurrent callers into one token request', async () => {
  const [a, b, c] = await Promise.all([
    svc.getWorkerToken(), svc.getWorkerToken(), svc.getWorkerToken(),
  ]);
  expect(a).toBe('tok-1');
  expect(b).toBe('tok-1');
  expect(c).toBe('tok-1');
  expect(fetchCalls).toBe(1);
});

test('rotating worker credentials invalidates the cache immediately', async () => {
  const first = await svc.getWorkerToken();
  expect(first).toBe('tok-1');
  // Operator rotates the worker app / switches environment.
  setCreds({ clientId: 'client-B', clientSecret: 'secret-B' });
  const second = await svc.getWorkerToken();
  expect(second).toBe('tok-2');
  expect(fetchCalls).toBe(2);
});

test('refetches once the cached token is within 60s of expiry', async () => {
  // expires_in 30s → expiresAt = now + 30s - 60s margin = already expired.
  global.fetch = jest.fn(async () => {
    fetchCalls += 1;
    tokenSeq += 1;
    return { ok: true, status: 200, json: async () => ({ access_token: `tok-${tokenSeq}`, expires_in: 30 }) };
  });
  const a = await svc.getWorkerToken();
  const b = await svc.getWorkerToken();
  expect(a).toBe('tok-1');
  expect(b).toBe('tok-2');
  expect(fetchCalls).toBe(2);
});

test('_invalidateWorkerToken only clears when the failing token matches', async () => {
  const a = await svc.getWorkerToken();
  expect(a).toBe('tok-1');
  svc._invalidateWorkerToken('some-other-token'); // stale/mismatched → no-op
  expect(await svc.getWorkerToken()).toBe('tok-1');
  expect(fetchCalls).toBe(1);
  svc._invalidateWorkerToken('tok-1'); // matches cached → clears
  expect(await svc.getWorkerToken()).toBe('tok-2');
  expect(fetchCalls).toBe(2);
});
