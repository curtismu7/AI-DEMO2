/**
 * Scoped retry + 401-refresh (P1AZ hardening amendment §C).
 *
 * fetchRetryable retries ONCE on a transient failure (network/timeout or 5xx)
 * and NEVER on a 4xx. _postDecisionWithAuth additionally refreshes the worker
 * token once on a 401 (the cached token may have been rotated at P1AZ).
 */
jest.mock('../../services/configStore');

const configStore = require('../../services/configStore');
const svc = require('../../services/pingOneAuthorizeService');

const DECISION_URL = 'https://api/decision';

beforeEach(() => {
  jest.clearAllMocks();
  const creds = { pingone_environment_id: 'env-1', pingone_region: 'com',
    authorize_worker_client_id: 'client-A', authorize_worker_client_secret: 'secret-A' };
  configStore.get = jest.fn(() => null);
  configStore.getEffective = jest.fn((k) => creds[k] ?? null);
  svc._resetAuthorizeRuntimeState();
});

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const err = (status) => ({ ok: false, status, json: async () => ({}), text: async () => `e${status}` });

describe('fetchRetryable', () => {
  test('retries once on a network error, then succeeds', async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(ok({ n: 1 }));
    const res = await svc._fetchRetryable(DECISION_URL, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('retries once on a 5xx, returning the retry result', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(err(503))
      .mockResolvedValueOnce(ok());
    const res = await svc._fetchRetryable(DECISION_URL, {});
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does NOT retry a 4xx', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(err(404));
    const res = await svc._fetchRetryable(DECISION_URL, {});
    expect(res.status).toBe(404);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('_postDecisionWithAuth 401-refresh', () => {
  function routedFetch({ decisionStatuses }) {
    let tokenSeq = 0;
    let decisionIdx = 0;
    return jest.fn(async (url) => {
      if (String(url).endsWith('/as/token')) {
        tokenSeq += 1;
        return ok({ access_token: `tok-${tokenSeq}`, expires_in: 3600 });
      }
      const status = decisionStatuses[decisionIdx++] ?? 200;
      return status === 200 ? ok({ decision: 'PERMIT' }) : err(status);
    });
  }

  test('a 401 clears the cached token and retries the decision with a fresh one', async () => {
    global.fetch = routedFetch({ decisionStatuses: [401, 200] });
    const res = await svc._postDecisionWithAuth(DECISION_URL, '{}');
    expect(res.status).toBe(200);
    // token minted twice (initial + after invalidation), decision attempted twice.
    const tokenCalls = global.fetch.mock.calls.filter(([u]) => String(u).endsWith('/as/token')).length;
    const decisionCalls = global.fetch.mock.calls.filter(([u]) => u === DECISION_URL).length;
    expect(tokenCalls).toBe(2);
    expect(decisionCalls).toBe(2);
  });

  test('a persistent 401 is returned after a single refresh (no infinite loop)', async () => {
    global.fetch = routedFetch({ decisionStatuses: [401, 401] });
    const res = await svc._postDecisionWithAuth(DECISION_URL, '{}');
    expect(res.status).toBe(401);
    const decisionCalls = global.fetch.mock.calls.filter(([u]) => u === DECISION_URL).length;
    expect(decisionCalls).toBe(2);
  });
});
