/**
 * The fetch resolve handler unconditionally overwrote cache[cacheKey] with
 * no check that the entry it was writing to was still the one this fetch
 * was launched for. Two overlapping requests for the same URL that resolve
 * out of order let an older, slower response clobber a newer, already-
 * cached fresher response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCachedStatus, clearStatusCache } from '../cachedStatusService';

function jsonResponse(data) {
  return { ok: true, headers: { get: () => 'application/json' }, json: async () => data };
}

describe('cachedStatusService overlapping-request race', () => {
  beforeEach(() => {
    clearStatusCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete global.fetch;
  });

  it("does not let an older, slower request clobber a newer cached response", async () => {
    let resolveSlow;
    const slowPromise = new Promise((resolve) => { resolveSlow = resolve; });
    global.fetch = vi.fn()
      .mockImplementationOnce(() => slowPromise) // call A: slow, resolves last
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ v: 'fresh-from-B' })));

    // Call A starts; its cache entry's 10s TTL is anchored to "now".
    const aPromise = getCachedStatus('/api/x');

    // TTL elapses with A still pending.
    await vi.advanceTimersByTimeAsync(10001);

    // Call B sees the expired entry, fires a fresh request, and resolves
    // quickly -- caching fresher data.
    const bPromise = getCachedStatus('/api/x');
    await bPromise;

    // A's slow response finally arrives.
    resolveSlow(jsonResponse({ v: 'stale-from-A' }));
    await aPromise;

    // A third call within B's TTL must serve B's cached data, not A's stale
    // overwrite, and must not re-fetch.
    const third = await getCachedStatus('/api/x');
    expect(third).toEqual({ v: 'fresh-from-B' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('cachedStatusService request timeout', () => {
  beforeEach(() => {
    clearStatusCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete global.fetch;
  });

  it('rejects instead of hanging forever when the network never responds', async () => {
    // Never resolves — simulates a stalled BFF/session-check under load, the
    // exact condition that left the "Loading customer dashboard…" spinner
    // stuck: this is the one status call in the app not routed through
    // apiClient's 10s axios timeout.
    global.fetch = vi.fn(() => new Promise(() => {}));

    const pending = getCachedStatus('/api/auth/oauth/user/status');
    const assertion = expect(pending).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(12001);
    await assertion;
  });
});
