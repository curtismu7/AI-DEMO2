// banking_api_ui/src/utils/__tests__/authUi.test.js
import {
  errorMessageSuggestsLogin,
  isAuthenticatedAppSurface,
  isSessionExpiredApiError,
  notifySessionExpiredIfNeeded,
  SESSION_REAUTH_EVENT,
  navigateToCustomerOAuthLogin,
  navigateToAdminOAuthLogin,
} from '../authUi';

describe('authUi', () => {
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
  });

  describe('isAuthenticatedAppSurface', () => {
    it('includes dashboard and admin but not public landing', () => {
      expect(isAuthenticatedAppSurface('/dashboard')).toBe(true);
      expect(isAuthenticatedAppSurface('/admin')).toBe(true);
      expect(isAuthenticatedAppSurface('/')).toBe(false);
      expect(isAuthenticatedAppSurface('/setup/foo')).toBe(false);
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
  });
});
