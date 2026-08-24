/**
 * finding #57: getWorkerToken()'s single-flight guard reused an in-flight
 * token request regardless of which credentials the caller resolved to.
 * A credential rotation mid-flight could hand a caller a token minted with
 * the OLD (stale) credentials. Proves a caller whose credKey differs from
 * the in-flight request's credKey gets its OWN token request, not the
 * stale in-flight one.
 */
'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(),
}));

const configStore = require('../services/configStore');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');

function mockCreds(clientId) {
  configStore.getEffective.mockImplementation((key) => {
    const values = {
      pingone_environment_id: 'env-1',
      pingone_region: 'com',
      authorize_worker_client_id: clientId,
      authorize_worker_client_secret: `secret-for-${clientId}`,
    };
    return values[key] || null;
  });
}

describe('pingOneAuthorizeService — getWorkerToken credential-rotation race', () => {
  let deferredResolve;
  let fetchCalls;

  beforeEach(() => {
    jest.clearAllMocks();
    pingOneAuthorizeService._resetAuthorizeRuntimeState();

    fetchCalls = [];
    let resolvers = [];
    deferredResolve = (index, accessToken) => resolvers[index]();

    global.fetch = jest.fn((url, opts) => {
      const callIndex = fetchCalls.length;
      fetchCalls.push({ url, authHeader: opts.headers.Authorization });
      return new Promise((resolve) => {
        resolvers[callIndex] = () =>
          resolve({
            ok: true,
            json: async () => ({ access_token: `token-${callIndex}`, expires_in: 3600 }),
          });
      });
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('a caller with rotated credentials does not receive a token minted for the old credentials', async () => {
    mockCreds('client-old');
    const firstCall = pingOneAuthorizeService.getWorkerToken();

    // Let the first request actually start (fetch called) before rotating creds.
    await new Promise((r) => setImmediate(r));
    expect(fetchCalls).toHaveLength(1);

    // Simulate an admin rotating worker credentials while the first request is in flight.
    mockCreds('client-new');
    const secondCall = pingOneAuthorizeService.getWorkerToken();

    await new Promise((r) => setImmediate(r));

    // The second caller must have triggered its OWN request, not reused the first's.
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].authHeader).not.toBe(fetchCalls[0].authHeader);

    deferredResolve(0);
    deferredResolve(1);

    const [firstToken, secondToken] = await Promise.all([firstCall, secondCall]);
    expect(firstToken).toBe('token-0');
    expect(secondToken).toBe('token-1');
  });
});
