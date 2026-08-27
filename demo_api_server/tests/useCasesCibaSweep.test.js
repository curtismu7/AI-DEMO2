'use strict';

/**
 * UC15 CIBA requests (routes/useCases.js `cibaRequests` Map) are only ever
 * removed on an explicit deny or a poll that happens to land after expiry.
 * An approved-and-never-polled-again or abandoned request has nothing left
 * to delete it, so the Map grows unboundedly over the server's uptime
 * (finding #71). A periodic sweep — mirroring demoTrackService.js's
 * `_sweepStaleBuckets` — is the backstop.
 *
 * Fake timers are installed BEFORE the module is required, so the
 * module-level `setInterval(...).unref()` call is registered against the
 * fake clock and can be advanced deterministically.
 */

jest.useFakeTimers();

// eslint-disable-next-line import/no-dynamic-require
const useCasesRouter = require('../routes/useCases');

describe('cibaRequests sweep (finding #71)', () => {
  afterEach(() => {
    useCasesRouter._cibaRequestsForTest.clear();
  });

  test('an expired, never-polled-again entry is removed once the sweep interval fires', () => {
    const past = Date.now() - 60 * 1000; // already expired
    useCasesRouter._cibaRequestsForTest.set('auth_req_expired_1', {
      userId: 'u1',
      status: 'APPROVED', // approved-and-abandoned also leaks today
      createdAt: new Date().toISOString(),
      expiresAt: past,
      approvedAt: new Date().toISOString(),
    });

    expect(useCasesRouter._cibaRequestsForTest.size).toBe(1);

    // Advance past the hourly sweep interval.
    jest.advanceTimersByTime(60 * 60 * 1000 + 1);

    expect(useCasesRouter._cibaRequestsForTest.has('auth_req_expired_1')).toBe(false);
    expect(useCasesRouter._cibaRequestsForTest.size).toBe(0);
  });

  test('a still-pending, not-yet-expired entry survives the sweep', () => {
    // Expires after the first sweep tick (60min) but the sweep only removes
    // entries whose expiresAt has passed at the time it runs.
    const future = Date.now() + 65 * 60 * 1000;
    useCasesRouter._cibaRequestsForTest.set('auth_req_pending_1', {
      userId: 'u2',
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      expiresAt: future,
      approvedAt: null,
    });

    jest.advanceTimersByTime(60 * 60 * 1000 + 1);

    expect(useCasesRouter._cibaRequestsForTest.has('auth_req_pending_1')).toBe(true);
  });
});
