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

import { resolveSessionUser } from '../sessionResolver';

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
});
