/**
 * resolveSessionUser()'s race-based 10s timeout guard created a setTimeout
 * but never captured or cleared its id once the Promise.allSettled branch
 * won the race (the normal, non-hung fast path) -- every call left a
 * dangling timer running for up to 10s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../cachedStatusService', () => ({
  getCachedJson: vi.fn().mockResolvedValue({ data: { authenticated: false } }),
}));

import { getCachedJson } from '../cachedStatusService';
import { resolveSessionExpiry, resolveSessionUser } from '../sessionResolver';

describe('resolveSessionUser timer cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears its 10s timeout guard once the fast (non-hung) path resolves', async () => {
    await resolveSessionUser();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the generic authenticated session expiry when OAuth status has no expiry', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    getCachedJson.mockImplementation((url) => {
      if (url === '/api/auth/session') {
        return Promise.resolve({ data: { authenticated: true, authType: 'user', expiresAt } });
      }
      return Promise.resolve({ data: { authenticated: false } });
    });

    await expect(resolveSessionExpiry()).resolves.toEqual({
      expiresAt,
      sessionType: 'user',
      staleSession: false,
    });
  });
});
