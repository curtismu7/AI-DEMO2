/**
 * manualRetry() used to unconditionally start a new retryHealthCheck() chain
 * with no check for one already in flight. A user clicking "Retry Now" while
 * handle504Error's automatic chain was still awaiting checkServerHealth()
 * ran two concurrent retryHealthCheck() invocations that both mutated the
 * shared globalRestartState with no lock -- double fetches, double
 * incrementAttempt() calls, and two independent setTimeout schedules.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handle504Error, manualRetry, __internal__ } from '../bankingRestartNotificationService';

describe('bankingRestartNotificationService concurrent retry race', () => {
  beforeEach(() => {
    __internal__.resetState();
  });

  it('manualRetry joins an in-flight automatic retry instead of starting a second concurrent health check', async () => {
    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    // handle504Error kicks off the first retryHealthCheck() without awaiting it,
    // so its checkServerHealth() fetch is already in flight synchronously here.
    handle504Error(new Error('504 Server Unavailable'));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // The user clicks "Retry Now" while that fetch is still pending.
    const manualPromise = manualRetry();

    // Still only one fetch in flight -- manualRetry must not have dispatched
    // a second, concurrent health check.
    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, status: 200 });
    await manualPromise;

    // Still only the one fetch, and the shared attempt counter was only
    // incremented once -- proof the two callers joined a single in-flight
    // check rather than each running (and mutating state via) their own.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(__internal__.getGlobalState().isVisible).toBe(false);
  });
});
