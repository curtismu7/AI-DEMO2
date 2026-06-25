/**
 * UI OAuth Integration Tests
 *
 * Tests the UI OAuth flow without JWT generation, focusing on:
 * - OAuth token management in UI components
 * - API client OAuth token handling
 * - Token refresh and expiration handling
 * - Error handling for insufficient scopes
 *
 * Requirements covered: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3
 */
/* eslint-disable import/first, jest/no-jasmine-globals, jest/no-conditional-expect, no-unused-vars, no-undef -- legacy skipped suite; mock-before-import; Jasmine fail() */

vi.mock('axios', () => {
  const mockClient = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockClient),
      get: jest.fn(),
      post: jest.fn(),
      defaults: { headers: { common: {} } },
    },
  };
});

import axios from 'axios';
import apiClient from '../apiClient';

const mockedAxios = axios;

/** Axios instance from the same mock factory the singleton ApiClient uses */
const mockClientInstance = axios.create.mock.results[0].value;
const responseInterceptorFromMock =
  mockClientInstance.interceptors.response.use.mock.calls[0] &&
  mockClientInstance.interceptors.response.use.mock.calls[0][1];

// Legacy suite: many cases assumed a non-singleton ApiClient and axios 0.x CJS.
// Kept for reference; replace with focused tests in apiClient.session.test.js.
describe.skip('UI OAuth Integration Tests (legacy)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset axios defaults
    delete axios.defaults.headers.common['Authorization'];
    
    // Clear localStorage
    localStorage.clear();
    
    // Clear any existing event listeners
    window.removeEventListener('userLoggedOut', () => {});
  });

  describe('OAuth Token Management (Requirements 5.1, 5.2)', () => {
    it('should obtain OAuth tokens from session instead of localStorage', async () => {
      // Mock successful OAuth session response
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          authenticated: true,
          accessToken: 'oauth-access-token-123',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 3600000,
          user: {
            id: 'user-123',
            username: 'testuser',
            email: 'test@example.com'
          }
        }
      });

      const token = await apiClient.getTokenFromSession();
      
      expect(token).toBe('oauth-access-token-123');
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/auth/oauth/user/status');
      
      // Verify no localStorage access for tokens
      expect(localStorage.getItem).not.toHaveBeenCalledWith('token');
      expect(localStorage.getItem).not.toHaveBeenCalledWith('jwtToken');
    });

    it('should fallback to admin OAuth session if user session fails', async () => {
      // Mock user session failure and admin session success
      mockedAxios.get
        .mockRejectedValueOnce(new Error('User session not found'))
        .mockResolvedValueOnce({
          data: {
            authenticated: true,
            accessToken: 'admin-oauth-token-456',
            tokenType: 'Bearer',
            expiresAt: Date.now() + 3600000,
            user: {
              id: 'admin-123',
              username: 'admin',
              role: 'admin'
            }
          }
        });

      const token = await apiClient.getTokenFromSession();
      
      expect(token).toBe('admin-oauth-token-456');
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/auth/oauth/user/status');
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/auth/oauth/status');
    });

    it('should return null when no OAuth sessions are available', async () => {
      // Mock both sessions failing
      mockedAxios.get
        .mockRejectedValueOnce(new Error('User session not found'))
        .mockRejectedValueOnce(new Error('Admin session not found'));

      const token = await apiClient.getTokenFromSession();
      
      expect(token).toBeNull();
    });

    it('should store OAuth tokens securely without JWT generation', () => {
      // Simulate OAuth callback storing tokens
      const oauthTokens = {
        accessToken: 'oauth-access-token-123',
        refreshToken: 'oauth-refresh-token-456',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer'
      };

      const user = {
        id: 'user-123',
        username: 'testuser',
        email: 'test@example.com'
      };

      // Verify OAuth tokens are stored (this would be in session, not localStorage)
      expect(oauthTokens.accessToken).toBe('oauth-access-token-123');
      expect(oauthTokens.refreshToken).toBe('oauth-refresh-token-456');
      expect(oauthTokens.tokenType).toBe('Bearer');
      
      // Verify JWT tokens are NOT generated
      expect(oauthTokens.jwtToken).toBeUndefined();
      expect(user.jwtToken).toBeUndefined();
    });
  });

  describe('API Client OAuth Integration (Requirements 5.3, 5.4)', () => {
    it('should include OAuth Bearer token in API requests', async () => {
      // Mock token retrieval
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          authenticated: true,
          accessToken: 'oauth-token-123',
          tokenType: 'Bearer'
        }
      });

      // Mock API request
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: { accounts: [] } }),
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() }
        }
      });

      // Create new API client instance to test interceptors
      const testClient = new (require('../apiClient').constructor)();
      
      // Verify that the request interceptor would add the OAuth token
      const mockConfig = { headers: {} };
      const requestInterceptor = testClient.client.interceptors.request.use.mock.calls[0][0];
      
      // Mock getValidToken to return OAuth token
      testClient.getValidToken = jest.fn().mockResolvedValue('oauth-token-123');
      
      const modifiedConfig = await requestInterceptor(mockConfig);
      
      expect(modifiedConfig.headers.Authorization).toBe('Bearer oauth-token-123');
    });

    it('should handle token expiration and refresh automatically', async () => {
      // Mock initial request failure due to expired token
      const expiredTokenError = {
        response: { status: 401 },
        config: { headers: {} }
      };

      // Mock successful token refresh
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          accessToken: 'new-oauth-token-456',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 3600000
        }
      });

      // Mock retry request success
      const mockClient = {
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() }
        }
      };

      mockedAxios.create.mockReturnValue(mockClient);

      const testClient = new (require('../apiClient').constructor)();
      
      // Get the response interceptor
      const responseInterceptor = mockClient.interceptors.response.use.mock.calls[0][1];
      
      // Mock the client method for retry
      testClient.client = jest.fn().mockResolvedValue({ data: { success: true } });
      
      // Test the error handling
      const result = await responseInterceptor(expiredTokenError);
      
      // Verify token refresh was attempted
      expect(mockedAxios.post).toHaveBeenCalledWith('/api/auth/oauth/user/refresh');
    });

    it('should handle insufficient scope errors with detailed information', async () => {
      const scopeError = {
        response: {
          status: 403,
          data: {
            error: 'insufficient_scope',
            error_description: 'Insufficient permissions',
            required_scopes: ['admin:read'],
            provided_scopes: ['read']
          }
        }
      };

      const mockClient = {
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() }
        }
      };

      mockedAxios.create.mockReturnValue(mockClient);

      const testClient = new (require('../apiClient').constructor)();
      
      // Get the response interceptor
      const responseInterceptor = mockClient.interceptors.response.use.mock.calls[0][1];
      
      try {
        await responseInterceptor(scopeError);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toBe('Insufficient permissions for this operation');
        expect(error.requiredScopes).toEqual(['admin:read']);
        expect(error.providedScopes).toEqual(['read']);
      }
    });
  });

  describe('Token Refresh Handling (Requirement 5.5)', () => {
    it('should attempt user token refresh first', async () => {
      // Mock successful user token refresh
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          accessToken: 'new-user-token-123',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 3600000
        }
      });

      const newToken = await apiClient.refreshToken();
      
      expect(newToken).toBe('new-user-token-123');
      expect(mockedAxios.post).toHaveBeenCalledWith('/api/auth/oauth/user/refresh');
    });

    it('should fallback to admin token refresh if user refresh fails', async () => {
      // Mock user refresh failure and admin refresh success
      mockedAxios.post
        .mockRejectedValueOnce({ response: { status: 404 } })
        .mockResolvedValueOnce({
          data: {
            accessToken: 'new-admin-token-456',
            tokenType: 'Bearer',
            expiresAt: Date.now() + 3600000
          }
        });

      const newToken = await apiClient.refreshToken();
      
      expect(newToken).toBe('new-admin-token-456');
      expect(mockedAxios.post).toHaveBeenCalledWith('/api/auth/oauth/user/refresh');
      expect(mockedAxios.post).toHaveBeenCalledWith('/api/auth/oauth/refresh');
    });

    it('should handle refresh not implemented gracefully', async () => {
      // Mock refresh not implemented (501)
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 501, data: { error: 'not_implemented' } }
      });

      try {
        await apiClient.refreshToken();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).toBe(501);
      }
    });

    it('should handle no refresh token available', async () => {
      // Mock no refresh token (401)
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 401, data: { error: 'no_refresh_token' } }
      });

      try {
        await apiClient.refreshToken();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).toBe(401);
      }
    });
  });

  describe('Authentication Failure Handling (Requirements 6.1, 6.2, 6.3)', () => {
    it('should handle authentication failure by redirecting to login', () => {
      // Mock window location
      delete window.location;
      window.location = { href: '' };

      // Mock localStorage
      const setItemSpy = jest.spyOn(localStorage, 'setItem');
      
      // Mock event dispatch
      const dispatchEventSpy = jest.spyOn(window, 'dispatchEvent');

      apiClient.handleAuthFailure();

      expect(setItemSpy).toHaveBeenCalledWith('userLoggedOut', 'true');
      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'userLoggedOut'
        })
      );

      // Verify redirect happens after timeout
      setTimeout(() => {
        expect(window.location.href).toBe('/');
      }, 150);
    });

    it('should clear cached tokens on authentication failure', () => {
      apiClient.handleAuthFailure();

      expect(axios.defaults.headers.common['Authorization']).toBeUndefined();
    });

    it('should dispatch logout event for other components', () => {
      const dispatchEventSpy = jest.spyOn(window, 'dispatchEvent');

      apiClient.handleAuthFailure();

      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'userLoggedOut'
        })
      );
    });
  });

  describe('OAuth Token Validation', () => {
    it('should not attempt to decode OAuth tokens like JWTs', () => {
      const oauthToken = 'oauth-access-token-not-jwt-format';
      
      const isExpired = apiClient.isTokenExpired(oauthToken);
      
      // Should return false since OAuth tokens can't be decoded client-side
      expect(isExpired).toBe(false);
    });

    it('should rely on server for OAuth token validation', async () => {
      // Mock server response for token validation
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          authenticated: true,
          accessToken: 'valid-oauth-token',
          expiresAt: Date.now() + 3600000
        }
      });

      const token = await apiClient.getValidToken();
      
      expect(token).toBe('valid-oauth-token');
      // Verify we're asking the server about token status, not decoding locally
      expect(mockedAxios.get).toHaveBeenCalledWith('/api/auth/oauth/user/status');
    });
  });

  describe('Error Response Handling', () => {
    it('should provide detailed error information for scope issues', async () => {
      const scopeError = {
        response: {
          status: 403,
          data: {
            error: 'insufficient_scope',
            error_description: 'Access denied. At least one of the following scopes is required: admin:read',
            required_scopes: ['admin:read'],
            provided_scopes: ['read'],
            missing_scopes: ['admin:read'],
            hint: 'Contact your administrator to request additional permissions'
          }
        }
      };

      const mockClient = {
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() }
        }
      };

      mockedAxios.create.mockReturnValue(mockClient);

      const testClient = new (require('../apiClient').constructor)();
      
      // Get the response interceptor
      const responseInterceptor = mockClient.interceptors.response.use.mock.calls[0][1];
      
      try {
        await responseInterceptor(scopeError);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toBe('Insufficient permissions for this operation');
        expect(error.response.data.error).toBe('insufficient_scope');
        expect(error.requiredScopes).toEqual(['admin:read']);
        expect(error.providedScopes).toEqual(['read']);
      }
    });

    it('should handle malformed token errors', async () => {
      const malformedTokenError = {
        response: {
          status: 401,
          data: {
            error: 'malformed_token',
            error_description: 'The access token is malformed',
            timestamp: new Date().toISOString(),
            path: '/api/accounts',
            method: 'GET'
          }
        }
      };

      const mockClient = {
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() }
        }
      };

      mockedAxios.create.mockReturnValue(mockClient);

      const testClient = new (require('../apiClient').constructor)();
      
      // Get the response interceptor
      const responseInterceptor = mockClient.interceptors.response.use.mock.calls[0][1];
      
      try {
        await responseInterceptor(malformedTokenError);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).toBe(401);
        expect(error.response.data.error).toBe('malformed_token');
      }
    });

    it('should handle expired token errors', async () => {
      const expiredTokenError = {
        response: {
          status: 401,
          data: {
            error: 'expired_token',
            error_description: 'The access token has expired',
            timestamp: new Date().toISOString()
          }
        },
        config: { headers: {} }
      };

      // Mock successful token refresh
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          accessToken: 'new-token-123',
          tokenType: 'Bearer'
        }
      });

      const mockClient = {
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() }
        }
      };

      mockedAxios.create.mockReturnValue(mockClient);

      const testClient = new (require('../apiClient').constructor)();
      testClient.client = jest.fn().mockResolvedValue({ data: { success: true } });
      
      // Get the response interceptor
      const responseInterceptor = mockClient.interceptors.response.use.mock.calls[0][1];
      
      const result = await responseInterceptor(expiredTokenError);
      
      // Should attempt token refresh
      expect(mockedAxios.post).toHaveBeenCalledWith('/api/auth/oauth/user/refresh');
    });
  });

  describe('Integration with UI Components', () => {
    it('should work with React components that use OAuth tokens', async () => {
      // Mock successful OAuth session
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          authenticated: true,
          accessToken: 'oauth-token-123',
          user: {
            id: 'user-123',
            username: 'testuser'
          }
        }
      });

      // Mock API call with OAuth token
      const mockApiResponse = { data: { accounts: [{ id: '1', balance: 1000 }] } };
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockApiResponse),
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() }
        }
      });

      // Simulate component making API call
      const response = await apiClient.get('/api/accounts/my');
      
      expect(response.data.accounts).toHaveLength(1);
      expect(response.data.accounts[0].balance).toBe(1000);
    });

    it('should handle component logout when OAuth fails', () => {
      let logoutEventFired = false;
      
      // Listen for logout event
      window.addEventListener('userLoggedOut', () => {
        logoutEventFired = true;
      });

      apiClient.handleAuthFailure();

      expect(logoutEventFired).toBe(true);
      expect(localStorage.getItem('userLoggedOut')).toBe('true');
    });
  });
});

/**
 * Current Backend-for-Frontend (BFF) behavior — not part of the legacy skipped suite above.
 */
describe('apiClient Backend-for-Frontend (BFF) OAuth (current)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete axios.defaults.headers.common['Authorization'];
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('getValidToken returns null without calling oauth status endpoints', async () => {
    const token = await apiClient.getValidToken();
    expect(token).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('401 + refresh failure does not call handleAuthFailure', async () => {
    expect(responseInterceptorFromMock).toEqual(expect.any(Function));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handleSpy = jest.spyOn(apiClient, 'handleAuthFailure').mockImplementation(() => {});
    jest.spyOn(apiClient, 'refreshToken').mockRejectedValue({ response: { status: 501 } });

    const originalErr = {
      response: { status: 401, data: { error: 'expired_token' } },
      config: { headers: {} },
    };

    await expect(responseInterceptorFromMock(originalErr)).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(handleSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});