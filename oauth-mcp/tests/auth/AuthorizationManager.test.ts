/**
 * Unit tests for AuthorizationManager
 */

import axios from 'axios';
import { AuthorizationManager } from '../../src/auth/AuthorizationManager';
import { PingOneConfig, TokenResponse, UserTokens, AuthenticationError, AuthErrorCodes } from '../../src/interfaces/auth';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AuthorizationManager', () => {
  let authorizationManager: AuthorizationManager;
  let mockConfig: PingOneConfig;
  let mockAxiosInstance: jest.Mocked<any>;

  beforeEach(() => {
    mockConfig = {
      baseUrl: 'https://openam-dna.forgeblocks.com:443',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tokenIntrospectionEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/introspect',
      authorizationEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      tokenEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token'
    };

    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn()
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    authorizationManager = new AuthorizationManager(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('exchangeAuthorizationCode', () => {
    it('should successfully exchange authorization code for tokens', async () => {
      const mockTokenResponse: TokenResponse = {
        access_token: 'access-token-123',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-token-123',
        scope: 'read write'
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenResponse });

      const result = await authorizationManager.exchangeAuthorizationCode('auth-code-123');

      expect(result).toMatchObject({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'read write'
      });
      expect(result.issuedAt).toBeInstanceOf(Date);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token',
        'grant_type=authorization_code&code=auth-code-123&client_id=test-client-id&client_secret=test-client-secret'
      );
    });

    it('should include redirect_uri when provided', async () => {
      const mockTokenResponse: TokenResponse = {
        access_token: 'access-token-123',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-token-123'
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenResponse });

      await authorizationManager.exchangeAuthorizationCode('auth-code-123', 'https://example.com/callback');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token',
        'grant_type=authorization_code&code=auth-code-123&client_id=test-client-id&client_secret=test-client-secret&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback'
      );
    });

    it('should handle token response without refresh token', async () => {
      const mockTokenResponse: TokenResponse = {
        access_token: 'access-token-123',
        token_type: 'Bearer',
        expires_in: 3600
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenResponse });

      const result = await authorizationManager.exchangeAuthorizationCode('auth-code-123');

      expect(result.refreshToken).toBe('');
    });

    it('should throw AuthenticationError for invalid authorization code', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 400,
          data: { error: 'invalid_grant', error_description: 'Authorization code is invalid' }
        }
      });

      await expect(authorizationManager.exchangeAuthorizationCode('invalid-code'))
        .rejects.toThrow(AuthenticationError);
      
      await expect(authorizationManager.exchangeAuthorizationCode('invalid-code'))
        .rejects.toMatchObject({
          code: AuthErrorCodes.INVALID_AUTHORIZATION_CODE,
          message: 'Invalid or expired authorization code'
        });
    });

    it('should throw AuthenticationError for invalid client credentials', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        isAxiosError: true,
        response: { status: 401 }
      });

      await expect(authorizationManager.exchangeAuthorizationCode('auth-code-123'))
        .rejects.toThrow(AuthenticationError);
      
      await expect(authorizationManager.exchangeAuthorizationCode('auth-code-123'))
        .rejects.toMatchObject({
          code: AuthErrorCodes.INVALID_AGENT_TOKEN,
          message: 'Invalid client credentials for token exchange'
        });
    });

    it('should throw generic error for network failures', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(authorizationManager.exchangeAuthorizationCode('auth-code-123'))
        .rejects.toThrow('Authorization code exchange failed: Network error');
    });
  });

  describe('refreshUserToken', () => {
    it('should successfully refresh user token', async () => {
      const mockTokenResponse: TokenResponse = {
        access_token: 'new-access-token-123',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh-token-123',
        scope: 'read write'
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenResponse });

      const result = await authorizationManager.refreshUserToken('old-refresh-token');

      expect(result).toMatchObject({
        accessToken: 'new-access-token-123',
        refreshToken: 'new-refresh-token-123',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'read write'
      });
      expect(result.issuedAt).toBeInstanceOf(Date);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token',
        'grant_type=refresh_token&refresh_token=old-refresh-token&client_id=test-client-id&client_secret=test-client-secret'
      );
    });

    it('should use existing refresh token when new one is not provided', async () => {
      const mockTokenResponse: TokenResponse = {
        access_token: 'new-access-token-123',
        token_type: 'Bearer',
        expires_in: 3600
        // No refresh_token in response
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenResponse });

      const result = await authorizationManager.refreshUserToken('old-refresh-token');

      expect(result.refreshToken).toBe('old-refresh-token');
    });

    it('should throw AuthenticationError for invalid refresh token', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 400,
          data: { error: 'invalid_grant', error_description: 'Refresh token is invalid' }
        }
      });

      await expect(authorizationManager.refreshUserToken('invalid-refresh-token'))
        .rejects.toThrow(AuthenticationError);
      
      await expect(authorizationManager.refreshUserToken('invalid-refresh-token'))
        .rejects.toMatchObject({
          code: AuthErrorCodes.TOKEN_REFRESH_FAILED,
          message: 'Invalid or expired refresh token'
        });
    });

    it('should throw AuthenticationError for invalid client credentials', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        isAxiosError: true,
        response: { status: 401 }
      });

      await expect(authorizationManager.refreshUserToken('refresh-token'))
        .rejects.toThrow(AuthenticationError);
      
      await expect(authorizationManager.refreshUserToken('refresh-token'))
        .rejects.toMatchObject({
          code: AuthErrorCodes.INVALID_AGENT_TOKEN,
          message: 'Invalid client credentials for token refresh'
        });
    });

    it('should throw generic error for network failures', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(authorizationManager.refreshUserToken('refresh-token'))
        .rejects.toThrow('Token refresh failed: Network error');
    });
  });

  describe('validateBankingScopes', () => {
    it('should return true when user tokens have all required scopes', async () => {
      const userTokens: UserTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'read write admin:users',
        issuedAt: new Date()
      };

      const result = authorizationManager.validateBankingScopes(userTokens, ['read', 'write']);

      expect(result).toBe(true);
    });

    it('should return false when user tokens are missing required scopes', async () => {
      const userTokens: UserTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'read',
        issuedAt: new Date()
      };

      const result = authorizationManager.validateBankingScopes(userTokens, ['read', 'write']);

      expect(result).toBe(false);
    });

    it('should return false when user tokens have no scope', async () => {
      const userTokens: UserTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: '',
        issuedAt: new Date()
      };

      const result = authorizationManager.validateBankingScopes(userTokens, ['read']);

      expect(result).toBe(false);
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for valid token', () => {
      const userTokens: UserTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresIn: 3600, // 1 hour
        scope: 'read',
        issuedAt: new Date() // Just issued
      };

      const result = authorizationManager.isTokenExpired(userTokens);

      expect(result).toBe(false);
    });

    it('should return true for expired token', () => {
      const userTokens: UserTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresIn: 3600, // 1 hour
        scope: 'read',
        issuedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) // Issued 2 hours ago
      };

      const result = authorizationManager.isTokenExpired(userTokens);

      expect(result).toBe(true);
    });

    it('should return true for token expiring within 5 minutes', () => {
      const userTokens: UserTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresIn: 300, // 5 minutes
        scope: 'read',
        issuedAt: new Date(Date.now() - 2 * 60 * 1000) // Issued 2 minutes ago (3 minutes left)
      };

      const result = authorizationManager.isTokenExpired(userTokens);

      expect(result).toBe(true);
    });
  });

  describe('getTokenLifetime', () => {
    it('should return remaining lifetime in seconds', () => {
      const userTokens: UserTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresIn: 3600, // 1 hour
        scope: 'read',
        issuedAt: new Date(Date.now() - 10 * 60 * 1000) // Issued 10 minutes ago
      };

      const result = authorizationManager.getTokenLifetime(userTokens);

      expect(result).toBeGreaterThanOrEqual(2990); // Around 50 minutes left (with some tolerance)
      expect(result).toBeLessThanOrEqual(3600); // Less than or equal to 1 hour left
    });

    it('should return 0 for expired token', () => {
      const userTokens: UserTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenType: 'Bearer',
        expiresIn: 3600, // 1 hour
        scope: 'read',
        issuedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) // Issued 2 hours ago
      };

      const result = authorizationManager.getTokenLifetime(userTokens);

      expect(result).toBe(0);
    });
  });
});