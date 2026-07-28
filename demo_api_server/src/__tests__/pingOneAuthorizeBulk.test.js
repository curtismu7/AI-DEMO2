/**
 * Bulk decision requests (POST .../decisionEndpoints/{id} with the bulk
 * Content-Type — see pingOneAuthorizeService.js "Bulk decision requests").
 *
 * Covers the properties the plan calls out as load-bearing:
 *   - the bulk media type is sent, and ONLY for the bulk path (single stays
 *     application/json — regression guard on the existing gate)
 *   - the 20-item PingOne limit is rejected client-side, before any fetch
 *   - a short responses[] array fails closed (DENY) on the unmatched index,
 *     never dropped/shifted
 *   - per-item obligation classification is independent per item (one item's
 *     step-up statement doesn't leak onto a sibling item)
 *   - evaluateDecisionEndpointBulk chunks >20 items and preserves a single
 *     global index across chunks
 */
jest.mock('../../services/configStore');

const configStore = require('../../services/configStore');
const svc = require('../../services/pingOneAuthorizeService');

beforeEach(() => {
  jest.clearAllMocks();
  const creds = {
    pingone_environment_id: 'env-1', pingone_region: 'com',
    authorize_worker_client_id: 'client-A', authorize_worker_client_secret: 'secret-A',
  };
  configStore.get = jest.fn(() => null);
  configStore.getEffective = jest.fn((k) => creds[k] ?? null);
  svc._resetAuthorizeRuntimeState();
});

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const err = (status) => ({ ok: false, status, json: async () => ({}), text: async () => `e${status}` });

function tokenThenDecision(decisionBody) {
  return jest.fn(async (url) => {
    if (String(url).endsWith('/as/token')) {
      return ok({ access_token: 'tok-1', expires_in: 3600 });
    }
    return decisionBody;
  });
}

describe('_postBulkDecisionEndpoint', () => {
  test('sends the PingOne bulk Content-Type, not application/json', async () => {
    global.fetch = tokenThenDecision(ok({
      correlationId: 'corr-1',
      summary: { requested: 1, errors: 0, successful: 1 },
      responses: [{ id: 'd1', decision: 'PERMIT' }],
    }));

    await svc._postBulkDecisionEndpoint('ep-1', { decisionRequests: [{ Amount: 100 }] });

    const decisionCall = global.fetch.mock.calls.find(([u]) => !String(u).endsWith('/as/token'));
    expect(decisionCall[1].headers['Content-Type']).toBe(
      'application/vnd.pingidentity.decisionengine.authorize.bulk+json',
    );
  });

  test('a single-request call still sends application/json (regression guard)', async () => {
    global.fetch = tokenThenDecision(ok({ decision: 'PERMIT' }));

    await svc.evaluateDecisionEndpoint('ep-1', { Amount: 100 });

    const decisionCall = global.fetch.mock.calls.find(([u]) => !String(u).endsWith('/as/token'));
    expect(decisionCall[1].headers['Content-Type']).toBe('application/json');
  });

  test('rejects more than 20 decisionRequests before issuing any fetch', async () => {
    global.fetch = jest.fn();
    const decisionRequests = Array.from({ length: 21 }, (_, i) => ({ Amount: i }));

    await expect(
      svc._postBulkDecisionEndpoint('ep-1', { decisionRequests }),
    ).rejects.toThrow(/bulk limit/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a shorter responses[] fails the unmatched index closed to DENY, not dropped', async () => {
    global.fetch = tokenThenDecision(ok({
      correlationId: 'corr-2',
      summary: { requested: 3, errors: 1, successful: 2 },
      responses: [
        { id: 'd1', decision: 'PERMIT' },
        { id: 'd2', decision: 'PERMIT' },
        // index 2 missing — PingOne reported an error for it.
      ],
    }));

    const result = await svc._postBulkDecisionEndpoint('ep-1', {
      decisionRequests: [{ Amount: 1 }, { Amount: 2 }, { Amount: 3 }],
    });

    expect(result.results).toHaveLength(3);
    expect(result.results[0].decision).toBe('PERMIT');
    expect(result.results[1].decision).toBe('PERMIT');
    expect(result.results[2].decision).toBe('DENY');
    expect(result.results[2].reason).toBe('bulk_response_length_mismatch');
  });

  test('an obligation on one item does not leak onto a sibling item', async () => {
    global.fetch = tokenThenDecision(ok({
      correlationId: 'corr-3',
      summary: { requested: 2, errors: 0, successful: 2 },
      responses: [
        { id: 'd1', decision: 'PERMIT', statements: [{ code: 'step-up-required' }] },
        { id: 'd2', decision: 'PERMIT', statements: [] },
      ],
    }));

    const result = await svc._postBulkDecisionEndpoint('ep-1', {
      decisionRequests: [{ Amount: 5000 }, { Amount: 10 }],
    });

    // An explicit PERMIT effect stays PERMIT — the obligation rides alongside
    // as stepUpRequired, same contract as the single-decision path. INDETERMINATE
    // is reserved for an obligation with no positive PERMIT/DENY effect at all.
    expect(result.results[0].stepUpRequired).toBe(true);
    expect(result.results[0].decision).toBe('PERMIT');
    expect(result.results[1].stepUpRequired).toBe(false);
    expect(result.results[1].decision).toBe('PERMIT');
  });

  test('a DENY effect on one item does not deny its siblings', async () => {
    global.fetch = tokenThenDecision(ok({
      correlationId: 'corr-4',
      summary: { requested: 2, errors: 0, successful: 2 },
      responses: [
        { id: 'd1', decision: 'DENY' },
        { id: 'd2', decision: 'PERMIT' },
      ],
    }));

    const result = await svc._postBulkDecisionEndpoint('ep-1', {
      decisionRequests: [{ Amount: 999999 }, { Amount: 10 }],
    });

    expect(result.results[0].decision).toBe('DENY');
    expect(result.results[1].decision).toBe('PERMIT');
  });

  test('a non-2xx bulk response throws (fail closed on transport error)', async () => {
    global.fetch = tokenThenDecision(err(500));

    await expect(
      svc._postBulkDecisionEndpoint('ep-1', { decisionRequests: [{ Amount: 1 }] }),
    ).rejects.toThrow();
  });
});

describe('evaluateDecisionEndpointBulk chunking', () => {
  test('splits 25 items into two PingOne calls and preserves a single global index', async () => {
    let call = 0;
    global.fetch = jest.fn(async (url, opts) => {
      if (String(url).endsWith('/as/token')) return ok({ access_token: 'tok-1', expires_in: 3600 });
      call += 1;
      const body = JSON.parse(opts.body);
      const n = body.decisionRequests.length;
      return ok({
        correlationId: `corr-chunk-${call}`,
        summary: { requested: n, errors: 0, successful: n },
        responses: body.decisionRequests.map((_r, i) => ({ id: `d-${call}-${i}`, decision: 'PERMIT' })),
      });
    });

    const decisionRequests = Array.from({ length: 25 }, (_, i) => ({ Amount: i }));
    const result = await svc.evaluateDecisionEndpointBulk('ep-1', decisionRequests);

    const decisionCalls = global.fetch.mock.calls.filter(([u]) => !String(u).endsWith('/as/token'));
    expect(decisionCalls).toHaveLength(2);
    expect(decisionCalls[0][1].headers['Content-Type']).toBe(
      'application/vnd.pingidentity.decisionengine.authorize.bulk+json',
    );
    expect(JSON.parse(decisionCalls[0][1].body).decisionRequests).toHaveLength(20);
    expect(JSON.parse(decisionCalls[1][1].body).decisionRequests).toHaveLength(5);

    expect(result.results).toHaveLength(25);
    expect(result.results.map((r) => r.index)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(result.correlationIds).toEqual(['corr-chunk-1', 'corr-chunk-2']);
    expect(result.summary).toEqual({ requested: 25, errors: 0, successful: 25 });
  });
});
