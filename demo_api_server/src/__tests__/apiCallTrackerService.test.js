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
  trackToken,
  sweepStaleTrackerSessions,
  _resetForTests,
  _setLastActivityForTests,
  _hasTrackedDataForTests,
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

describe('apiCallTrackerService — stale-session sweep (memory-leak regression guard)', () => {
  beforeEach(() => {
    _resetForTests();
  });

  it('deletes a session\'s tracked calls/tokens entirely once its last activity is past the TTL', async () => {
    await trackApiCall({ sessionId: 'stale-sess', method: 'GET', url: '/api/x', responseStatus: 200 });
    trackToken('stale-sess', { token: 'abc.def.ghi', tokenType: 'access' });
    expect(_hasTrackedDataForTests('stale-sess')).toBe(true);

    // Backdate this session's last activity to just past the 24h TTL, without
    // waiting for the real hourly setInterval — sweepStaleTrackerSessions is
    // the exact function that interval calls.
    _setLastActivityForTests('stale-sess', Date.now() - (24 * 60 * 60 * 1000 + 1000));
    sweepStaleTrackerSessions();

    // Before the fix, nothing ever deleted the Map entry for an abandoned
    // session — this assertion is the one that would fail without the sweep.
    expect(_hasTrackedDataForTests('stale-sess')).toBe(false);
    expect(getApiCalls('stale-sess', 10)).toHaveLength(0);
  });

  it('leaves a recently-active session untouched', async () => {
    await trackApiCall({ sessionId: 'fresh-sess', method: 'GET', url: '/api/x', responseStatus: 200 });
    sweepStaleTrackerSessions();

    expect(_hasTrackedDataForTests('fresh-sess')).toBe(true);
    expect(getApiCalls('fresh-sess', 10)).toHaveLength(1);
  });

  it('never sweeps the shared GLOBAL_SESSION_ID buffer', async () => {
    await trackApiCall({ sessionId: GLOBAL_SESSION_ID, method: 'GET', url: '/api/x', responseStatus: 200 });
    // GLOBAL_SESSION_ID is never written to lastActivity, so backdating an
    // unrelated key and sweeping must not touch it.
    _setLastActivityForTests('unrelated', Date.now() - (25 * 60 * 60 * 1000));
    sweepStaleTrackerSessions();

    expect(getApiCalls(GLOBAL_SESSION_ID, 10)).toHaveLength(1);
  });
});
