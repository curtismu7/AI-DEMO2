// banking_api_ui/src/utils/__tests__/authUi.test.js
import {
  errorMessageSuggestsLogin,
  isAuthenticatedAppSurface,
  isAuthRequiredApiError,
  isSessionExpiredApiError,
  normalizeAuthFailure,
  notifySessionExpiredIfNeeded,
  SESSION_EXPIRED_INTERRUPT_MESSAGE,
  SESSION_REAUTH_EVENT,
  USER_SESSION_EXPIRED_MESSAGE,
  navigateToCustomerOAuthLogin,
  navigateToAdminOAuthLogin,
  navigateToCustomerOAuthForceLogin,
  _resetSessionExpiryNotifyForTests,
} from '../authUi';

describe('authUi', () => {
  beforeEach(() => {
    _resetSessionExpiryNotifyForTests();
  });
  describe('errorMessageSuggestsLogin', () => {
    it('returns true for session / login prompts', () => {
      expect(errorMessageSuggestsLogin('Your session has expired. Please log in again.')).toBe(true);
      expect(errorMessageSuggestsLogin('Please log in to access your account')).toBe(true);
      expect(errorMessageSuggestsLogin('Sign in again to continue')).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(errorMessageSuggestsLogin('Failed to load your account information')).toBe(false);
      expect(errorMessageSuggestsLogin('You do not have permission')).toBe(false);
      expect(errorMessageSuggestsLogin(null)).toBe(false);
      expect(errorMessageSuggestsLogin(undefined)).toBe(false);
    });
  });

  describe('isSessionExpiredApiError', () => {
    it('detects jwt expired and requiresLogin responses', () => {
      expect(
        isSessionExpiredApiError({
          error: 'invalid_token',
          error_description: 'PingOne token validation failed: jwt expired',
        }),
      ).toBe(true);
      expect(isSessionExpiredApiError({ requiresLogin: true })).toBe(true);
      expect(isSessionExpiredApiError({ error: 'not_found' })).toBe(false);
    });

    it('does not treat an RFC 9470 step-up 401 body as session expiry', () => {
      expect(
        isSessionExpiredApiError({
          error: 'step_up_required',
          error_description:
            'This transaction requires additional authentication (MFA) as required by the authorization policy.',
        })
      ).toBe(false);
    });
  });

  describe('isAuthRequiredApiError', () => {
    it('matches overnight agent / BFF 401 shapes', () => {
      expect(isAuthRequiredApiError(401, { error: 'Session expired' })).toBe(true);
      expect(
        isAuthRequiredApiError(401, {
          error: 'Unauthorized',
          message: 'Please log in to access the banking agent.',
        }),
      ).toBe(true);
      expect(isAuthRequiredApiError(401, { error: 'login_required' })).toBe(true);
      expect(isAuthRequiredApiError(401, { error: 'authentication_required' })).toBe(true);
      expect(isAuthRequiredApiError(401, { need_auth: true, error: 'token_inactive' })).toBe(true);
      expect(isAuthRequiredApiError(401, { error: 'oauth_session_required' })).toBe(true);
      expect(isAuthRequiredApiError(401, { error: 'session_restore_required' })).toBe(true);
      expect(
        isAuthRequiredApiError(401, {
          error: 'session_expired',
          requiresLogin: true,
        }),
      ).toBe(true);
    });

    it('excludes delegation and step-up 401s', () => {
      expect(
        isAuthRequiredApiError(401, {
          error: 'Unauthorized',
          code: 'DELEGATION_REQUIRED',
        }),
      ).toBe(false);
      expect(
        isAuthRequiredApiError(401, {
          error: 'DELEGATION_REQUIRED',
          message: 'Delegation token required',
        }),
      ).toBe(false);
      expect(
        isAuthRequiredApiError(401, {
          error: 'step_up_required',
          error_description: 'MFA required',
        }),
      ).toBe(false);
      expect(isAuthRequiredApiError(401, { error: 'admin_required' })).toBe(false);
    });

    it('ignores non-401 status', () => {
      expect(isAuthRequiredApiError(403, { error: 'session_expired' })).toBe(false);
      expect(isAuthRequiredApiError(200, { error: 'session_expired' })).toBe(false);
    });
  });

  describe('normalizeAuthFailure', () => {
    it('returns stable session_expired shape', () => {
      const out = normalizeAuthFailure(401, {
        error: 'Session expired',
        message: 'Could not refresh session. Please log in again.',
      });
      expect(out.error).toBe('session_expired');
      expect(out.need_auth).toBe(true);
      expect(out.requiresLogin).toBe(true);
      expect(out._status).toBe(401);
      expect(out.message).toMatch(/log in again/i);
    });

    it('falls back to canonical message', () => {
      const out = normalizeAuthFailure(401, {});
      expect(out.message).toBe(USER_SESSION_EXPIRED_MESSAGE);
    });
  });

  describe('isAuthenticatedAppSurface', () => {
    it('includes dashboard, admin, and agent hosts; excludes public landing', () => {
      expect(isAuthenticatedAppSurface('/dashboard')).toBe(true);
      expect(isAuthenticatedAppSurface('/admin')).toBe(true);
      expect(isAuthenticatedAppSurface('/use-cases/live')).toBe(true);
      expect(isAuthenticatedAppSurface('/agent-lifecycle')).toBe(true);
      expect(isAuthenticatedAppSurface('/')).toBe(false);
      expect(isAuthenticatedAppSurface('/setup/foo')).toBe(false);
      expect(isAuthenticatedAppSurface('/logout')).toBe(false);
    });
  });

  describe('notifySessionExpiredIfNeeded', () => {
    it('dispatches re-auth event on protected routes', () => {
      const handler = jest.fn();
      window.addEventListener(SESSION_REAUTH_EVENT, handler);
      window.history.pushState({}, '', '/dashboard');

      notifySessionExpiredIfNeeded({
        status: 401,
        body: {
          error: 'invalid_token',
          error_description: 'PingOne token validation failed: jwt expired',
        },
      });

      expect(handler).toHaveBeenCalled();
      const detail = handler.mock.calls[0][0].detail;
      expect(detail.invalidateSession).toBe(true);
      expect(detail.message).toMatch(/sign in/i);

      window.removeEventListener(SESSION_REAUTH_EVENT, handler);
    });

    it('keeps raw provider text out of the leading sentence', () => {
      const handler = jest.fn();
      window.addEventListener(SESSION_REAUTH_EVENT, handler);
      window.history.pushState({}, '', '/dashboard');

      notifySessionExpiredIfNeeded({
        status: 401,
        body: {
          error: 'invalid_token',
          error_description: 'PingOne token validation failed: jwt expired',
        },
      });

      const detail = handler.mock.calls[0][0].detail;
      // The sentence the user reads first must be ours, not PingOne's.
      expect(detail.message).toBe(SESSION_EXPIRED_INTERRUPT_MESSAGE);
      expect(detail.message).not.toMatch(/jwt expired/i);
      // ...but the raw text is still carried, for the disclosure.
      expect(detail.detail).toBe('PingOne token validation failed: jwt expired');

      window.removeEventListener(SESSION_REAUTH_EVENT, handler);
    });

    it('dispatches for human Session expired on agent host path', () => {
      const handler = jest.fn();
      window.addEventListener(SESSION_REAUTH_EVENT, handler);
      window.history.pushState({}, '', '/use-cases/live');

      notifySessionExpiredIfNeeded({
        status: 401,
        body: { error: 'Session expired', need_auth: true },
      });

      expect(handler).toHaveBeenCalled();
      window.removeEventListener(SESSION_REAUTH_EVENT, handler);
    });

    it('stays silent until the user has interacted with the page', () => {
      // A page-load fetch or a background poll that 401s must not interrupt a
      // visitor who has not touched anything yet.
      const handler = jest.fn();
      window.addEventListener(SESSION_REAUTH_EVENT, handler);
      window.history.pushState({}, '', '/dashboard');
      Object.defineProperty(navigator, 'userActivation', {
        value: { hasBeenActive: false },
        configurable: true,
      });

      notifySessionExpiredIfNeeded({ status: 401, body: { error: 'session_expired' } });
      expect(handler).not.toHaveBeenCalled();

      Object.defineProperty(navigator, 'userActivation', {
        value: { hasBeenActive: true },
        configurable: true,
      });
      notifySessionExpiredIfNeeded({ status: 401, body: { error: 'session_expired' } });
      expect(handler).toHaveBeenCalled();

      delete navigator.userActivation;
      window.removeEventListener(SESSION_REAUTH_EVENT, handler);
    });

    it('does not dispatch on public landing', () => {
      const handler = jest.fn();
      window.addEventListener(SESSION_REAUTH_EVENT, handler);
      window.history.pushState({}, '', '/');

      notifySessionExpiredIfNeeded({
        status: 401,
        body: {
          error: 'invalid_token',
          error_description: 'jwt expired',
        },
      });

      expect(handler).not.toHaveBeenCalled();
      window.removeEventListener(SESSION_REAUTH_EVENT, handler);
    });
  });

  describe('navigateToOAuthLogin', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      delete window.location;
      window.location = { ...originalLocation, href: '' };
    });

    afterEach(() => {
      window.location = originalLocation;
    });

    it('navigateToCustomerOAuthLogin sets user OAuth URL', () => {
      delete window.location;
      window.location = { href: '', assign: jest.fn(), replace: jest.fn(), reload: jest.fn() };

      navigateToCustomerOAuthLogin();

      expect(window.location.href).toMatch(/\/api\/auth\/oauth\/user\/login$/);
    });

    it('navigateToAdminOAuthLogin sets admin OAuth URL', () => {
      delete window.location;
      window.location = { href: '', assign: jest.fn(), replace: jest.fn(), reload: jest.fn() };

      navigateToAdminOAuthLogin();

      expect(window.location.href).toMatch(/\/api\/auth\/oauth\/login$/);
      expect(window.location.href).not.toMatch(/\/oauth\/user\/login/);
    });

    // Without return_to, signing in from an expired session dropped the user
    // somewhere other than the page they were interrupted on.
    describe('return_to', () => {
      const stubLocation = (pathname) => {
        delete window.location;
        window.location = {
          href: '',
          pathname,
          assign: jest.fn(),
          replace: jest.fn(),
          reload: jest.fn(),
        };
      };

      it('force login keeps force=true and joins return_to with &', () => {
        stubLocation('/agent-gateway-inspector');

        navigateToCustomerOAuthForceLogin();

        expect(window.location.href).toContain('?force=true');
        expect(window.location.href).toContain(
          '&return_to=%2Fagent-gateway-inspector',
        );
        // A second '?' would make the BFF read return_to as part of force's value.
        expect(window.location.href.match(/\?/g)).toHaveLength(1);
      });

      it('force login accepts an explicit returnTo over the current path', () => {
        stubLocation('/somewhere-else');

        navigateToCustomerOAuthForceLogin('/tracing');

        expect(window.location.href).toContain('&return_to=%2Ftracing');
      });

      it('force login sends the landing page to /dashboard, not back to /', () => {
        stubLocation('/');

        navigateToCustomerOAuthForceLogin();

        expect(window.location.href).toContain('&return_to=%2Fdashboard');
      });

      it('admin login joins return_to with ? since it has no other query', () => {
        stubLocation('/agent-gateway-inspector');

        navigateToAdminOAuthLogin();

        expect(window.location.href).toContain('?return_to=%2Fagent-gateway-inspector');
        expect(window.location.href.match(/\?/g)).toHaveLength(1);
      });
    });
  });
});
