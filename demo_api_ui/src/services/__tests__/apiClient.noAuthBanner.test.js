/**
 * `_noAuthBanner` — opt a background call out of the global re-auth banner.
 *
 * Regression: running a public demo step as a guest armed its feature flags
 * first. That PATCH is admin-gated, so it 401'd, and the interceptor raised
 * "For a more personalized experience, please sign in." on top of a demo step
 * that had already answered correctly.
 *
 * The SoT now skips arming for a public use case, which removes the known
 * offender. This flag is the backstop for every other admin-gated call a guest
 * can reach, so the positive control below matters as much as the opt-out: a
 * real session loss must still raise the banner.
 */
/* eslint-disable import/first -- vi.mock must run before axios import */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => {
  const mockClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: {
      create: vi.fn(() => mockClient),
      get: mockClient.get,
      post: mockClient.post,
      defaults: { headers: { common: {} } },
    },
  };
});

import axios from 'axios';
import '../apiClient';
import { SESSION_REAUTH_EVENT, _resetSessionExpiryNotifyForTests } from '../../utils/authUi';

const mockClient = axios.create.mock.results[0].value;
// Response interceptors in registration order: 0 = spinner, 1 = traffic capture
// + auth handling (the one that raises the banner), 2 = error normalization.
const responseErrorInterceptor = mockClient.interceptors.response.use.mock.calls[1][1];

/** Collect re-auth banner events raised while running `fn`. */
async function bannerEventsDuring(fn) {
  const seen = [];
  const listener = (e) => seen.push(e.detail);
  window.addEventListener(SESSION_REAUTH_EVENT, listener);
  try {
    await fn();
  } finally {
    window.removeEventListener(SESSION_REAUTH_EVENT, listener);
  }
  return seen;
}

describe('apiClient _noAuthBanner', () => {
  beforeEach(() => {
    // The banner is suppressed on '/' and other public surfaces, so assert from
    // an app surface where it would otherwise fire.
    window.history.pushState({}, '', '/dashboard');
    _resetSessionExpiryNotifyForTests();
  });

  it('raises the re-auth banner for a normal 401', async () => {
    const events = await bannerEventsDuring(async () => {
      await expect(
        responseErrorInterceptor({
          response: { status: 401, data: { error: 'session_expired' } },
          config: { url: '/api/accounts/my', headers: {} },
        }),
      ).rejects.toBeTruthy();
    });

    expect(events).toHaveLength(1);
  });

  it('stays silent for a 401 on a call marked _noAuthBanner', async () => {
    const events = await bannerEventsDuring(async () => {
      await expect(
        responseErrorInterceptor({
          response: { status: 401, data: { error: 'session_expired' } },
          config: { url: '/api/admin/feature-flags', headers: {}, _noAuthBanner: true },
        }),
      ).rejects.toBeTruthy();
    });

    expect(events).toEqual([]);
  });
});
