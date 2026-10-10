/**
 * signInService — the app's one entry point for sign-in: opens the branded
 * pi.flow modal when the BFF reports it drivable, falls back to the redirect
 * login in exactly one place.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { openSignIn, isSignInAvailable, initSignInService, _resetSignInServiceForTests } from '../signInService';
import { PI_FLOW_SIGNIN_EVENT } from '../authUi';

const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const ON = { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', PINGONE_ADMIN_AUTHORIZE_PI_FLOW: 'false', oauth_provider: 'pingone' };

describe('signInService', () => {
  let handled;
  beforeEach(() => {
    handled = null;
    _resetSignInServiceForTests();
    // jsdom has no assignable location; the Raw redirects write window.location.href.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://app.test', pathname: '/dashboard', href: '', assign: vi.fn() },
    });
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, (e) => { handled = e.detail; e.detail.handled = true; });
  });

  test('init fetches config once and caches availability', async () => {
    global.fetch = vi.fn(() => ok({ config: ON }));
    await initSignInService();
    await initSignInService();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(isSignInAvailable()).toEqual({ customer: true, admin: false });
  });

  test('openSignIn dispatches the modal event with role/returnTo/force', async () => {
    global.fetch = vi.fn(() => ok({ config: ON }));
    await initSignInService();
    openSignIn({ returnTo: '/x', force: true });
    expect(handled).toMatchObject({ returnTo: '/x', force: true, role: 'customer' });
  });

  test('admin role requests the admin availability', async () => {
    global.fetch = vi.fn(() => ok({ config: { ...ON, PINGONE_ADMIN_AUTHORIZE_PI_FLOW: 'true' } }));
    await initSignInService();
    openSignIn({ role: 'admin' });
    expect(handled).toMatchObject({ role: 'admin' });
  });

  test('admin without the admin flag falls back to the admin redirect', async () => {
    global.fetch = vi.fn(() => ok({ config: ON }));
    await initSignInService();
    openSignIn({ role: 'admin' });
    expect(handled).toBeNull();
    expect(window.location.href).toContain('/api/auth/oauth/login');
  });

  test('flag off: openSignIn falls back to the redirect (window.location)', async () => {
    global.fetch = vi.fn(() => ok({ config: { PINGONE_USER_AUTHORIZE_PI_FLOW: 'false', oauth_provider: 'pingone' } }));
    await initSignInService();
    openSignIn({});
    expect(window.location.href).toContain('/api/auth/oauth/user/login');
  });
});
