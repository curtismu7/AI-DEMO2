/**
 * resolveSessionUser()'s race-based 10s timeout guard created a setTimeout
 * but never captured or cleared its id once the Promise.allSettled branch
 * won the race (the normal, non-hung fast path) -- every call left a
 * dangling timer running for up to 10s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCachedJson } from '../cachedStatusService';

vi.mock('../cachedStatusService', () => ({
  getCachedJson: vi.fn().mockResolvedValue({ data: { authenticated: false } }),
}));

import { resolveSessionUser, resolveSessionExpiry } from '../sessionResolver';

describe('resolveSessionUser timer cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getCachedJson.mockReset().mockResolvedValue({ data: { authenticated: false } });
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

  it('returns a confirmed customer while an unrelated status request hangs', async () => {
    const customer = { id: 'customer-1', role: 'customer' };
    getCachedJson.mockImplementation((url) => {
      if (url === '/api/auth/oauth/status') return new Promise(() => {});
      return Promise.resolve({ data: url === '/api/auth/oauth/user/status'
        ? { authenticated: true, user: customer }
        : { authenticated: false } });
    });

    const result = await Promise.race([
      resolveSessionUser(),
      Promise.resolve().then(() => vi.advanceTimersByTimeAsync(10000)).then(() => 'timed out'),
    ]);
    expect(result).toEqual(customer);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns active token expiry while an unrelated OAuth status request hangs', async () => {
    const expiresAt = Date.now() + 60000;
    getCachedJson.mockImplementation((url) => url === '/api/auth/oauth/status'
      ? new Promise(() => {})
      : Promise.resolve({ data: {
        authenticated: true, expiresAt, sessionType: 'user', hasRefreshToken: true,
        oauthProvider: 'pingone',
      } }));

    const result = await Promise.race([
      resolveSessionExpiry(),
      Promise.resolve().then(() => vi.advanceTimersByTimeAsync(10000)).then(() => 'timed out'),
    ]);
    expect(result).toEqual({
      expiresAt, sessionType: 'user', staleSession: false,
      hasRefreshToken: true, oauthProvider: 'pingone',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the stale refresh-token signal after both OAuth probes settle', async () => {
    getCachedJson.mockImplementation(async (url) => ({ data: url === '/api/auth/oauth/user/status'
      ? { authenticated: false, staleSession: true, sessionType: 'user', hasRefreshToken: true }
      : { authenticated: false } }));

    expect(await resolveSessionExpiry()).toEqual({
      expiresAt: null, sessionType: 'user', staleSession: true,
      hasRefreshToken: true, oauthProvider: null,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
