'use strict';
/**
 * Regression (finding #36): the _runs/_histories Maps are keyed by
 * req.sessionID and a new bucket is created per distinct session, but
 * nothing ever evicted an old one -- the bucket count grew unbounded for the
 * life of the process. Fixed with a last-accessed timestamp per bucket plus
 * a periodic sweep that drops buckets idle past BUCKET_TTL_MS (24h).
 */
describe('demoTrackService bucket eviction', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('evicts a session bucket that has been idle past the TTL, via its own sweep interval', () => {
    const svc = require('../services/demoTrackService');

    svc.getState('session-a');
    svc.getState('session-b');
    expect(svc._bucketCountForTests()).toBe(2);

    // Idle past the 24h TTL with no further access to either bucket. The
    // module's own setInterval (not a manual sweep call) must fire during this.
    jest.advanceTimersByTime(25 * 60 * 60 * 1000);

    expect(svc._bucketCountForTests()).toBe(0);
  });

  it('does not evict a bucket that was touched again before the TTL elapsed', () => {
    const svc = require('../services/demoTrackService');

    svc.getState('session-a');
    // Touch it again just under the TTL boundary.
    jest.advanceTimersByTime(23 * 60 * 60 * 1000);
    svc.getState('session-a');
    // Now advance past what would have been the ORIGINAL TTL, but not the
    // renewed one.
    jest.advanceTimersByTime(2 * 60 * 60 * 1000);

    expect(svc._bucketCountForTests()).toBe(1);
  });
});
