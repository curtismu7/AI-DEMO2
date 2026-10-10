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

describe('sign-in guardrail', () => {
  test('no source outside the exceptions redirects to a BFF login endpoint', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(import.meta.dirname, '../../..');
    const exceptions = ['utils/authUi.js', 'utils/signInService.js', 'components/PiFlowSignInModal.jsx', 'hooks/useAuth.js', 'components/LogoutPage.js', 'pages/SdkLoginPage.jsx', 'components/sdk-login/EmbeddedSignInForm.jsx', 'lib/embeddedPiFlow.js', 'pages/PersonalAgentStudioPage.jsx'];
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '__tests__' || e.name === 'node_modules') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|jsx)$/.test(e.name)) {
          // Test files live outside __tests__ too (component twins); they mock
          // redirects and prove nothing about production.
          if (/\.test\.(js|jsx)$/.test(e.name)) continue;
          const rel = path.relative(root, p);
          if (exceptions.some((x) => rel.endsWith(x))) continue;
          const text = fs.readFileSync(p, 'utf8');
          // The literal must BE the BFF route (login/login-trace is not), or
          // start with it as a URL — a `?` or quote follows.
          if (/["'`]\/api\/auth\/oauth(\/user)?\/(login|stepup)(["'`?])|["'`]\/api\/auth\/reauth["'`]/.test(text)) offenders.push(rel);
        }
      }
    };
    walk(path.join(root, 'src'));
    expect(offenders).toEqual([]);
  });
});

// These components' sign-in triggers route through openSignIn like every other
// page (de-bypassed in the Task 9 fix pass the census initially missed).
const EXTRA_DE_BYPASS = [
  'components/AdminRequiredModal.jsx',
  'components/DemoSetupPanel.js',
  'components/OASDemoPage.jsx',
  'components/PingOneTestPage.jsx',
  'components/ProtocolPlayground/ActivityPanel.jsx',
  'pages/EnterpriseMcpDemoPage.jsx',
  'pages/PrivilegeDemoPage.jsx',
];
