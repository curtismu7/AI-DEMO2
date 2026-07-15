/**
 * apiCallTrackerService.test.js
 * Dual-write to shared global buffer for API Explorer.
 */

jest.mock('../../services/pingoneTestSseHub', () => ({
  publishApiCall: jest.fn(),
}));

const {
  GLOBAL_SESSION_ID,
  trackApiCall,
  getApiCalls,
  getApiCallStats,
  clearApiCalls,
  _resetForTests,
} = require('../../services/apiCallTrackerService');

describe('apiCallTrackerService global buffer', () => {
  beforeEach(() => {
    _resetForTests();
  });

  it('dual-writes each call into the session bucket and the global buffer', async () => {
    await trackApiCall({
      sessionId: 'sess-a',
      method: 'GET',
      url: '/api/accounts',
      responseStatus: 200,
      duration: 12,
    });

    const sessionCalls = getApiCalls('sess-a', 10);
    const globalCalls = getApiCalls(GLOBAL_SESSION_ID, 10);

    expect(sessionCalls).toHaveLength(1);
    expect(globalCalls).toHaveLength(1);
    expect(globalCalls[0].id).toBe(sessionCalls[0].id);
    expect(globalCalls[0].durationMs).toBe(12);
  });

  it('surfaces agent-style (ephemeral session) calls via the global buffer', async () => {
    await trackApiCall({
      sessionId: 'ephemeral-1',
      method: 'POST',
      url: '/api/transactions',
      responseStatus: 201,
    });
    await trackApiCall({
      sessionId: 'ephemeral-2',
      method: 'GET',
      url: '/api/accounts/my',
      responseStatus: 401,
    });

    expect(getApiCalls('ephemeral-1', 10)).toHaveLength(1);
    expect(getApiCalls(GLOBAL_SESSION_ID, 10)).toHaveLength(2);
    expect(getApiCallStats(GLOBAL_SESSION_ID)).toMatchObject({
      total: 2,
      success: 1,
      errors: 1,
      successful: 1,
      failed: 1,
    });
  });

  it('does not double-push when already writing to the global bucket', async () => {
    await trackApiCall({
      sessionId: GLOBAL_SESSION_ID,
      method: 'GET',
      url: '/api/healthz',
      responseStatus: 200,
    });

    expect(getApiCalls(GLOBAL_SESSION_ID, 10)).toHaveLength(1);
  });

  it('clearApiCalls on global only clears the global bucket', async () => {
    await trackApiCall({
      sessionId: 'keep-me',
      method: 'GET',
      url: '/api/x',
      responseStatus: 200,
    });
    clearApiCalls(GLOBAL_SESSION_ID);

    expect(getApiCalls(GLOBAL_SESSION_ID, 10)).toHaveLength(0);
    expect(getApiCalls('keep-me', 10)).toHaveLength(1);
  });
});
