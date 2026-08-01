/**
 * Authorization Challenge Handler Tests
 */

import { AuthorizationChallengeHandler } from '../../src/tools/AuthorizationChallengeHandler';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../../src/storage/BankingSessionManager';
import { Session, UserTokens, AuthorizationRequest, AuthenticationError, AuthErrorCodes } from '../../src/interfaces/auth';

// Mock dependencies
jest.mock('../../src/auth/BankingAuthenticationManager');
jest.mock('../../src/storage/BankingSessionManager');

describe('AuthorizationChallengeHandler', () => {
  let handler: AuthorizationChallengeHandler;
  let mockAuthManager: jest.Mocked<BankingAuthenticationManager>;
  let mockSessionManager: jest.Mocked<BankingSessionManager>;
  let mockSession: Session;

  beforeEach(() => {
    mockAuthManager = new BankingAuthenticationManager({} as any) as jest.Mocked<BankingAuthenticationManager>;
    mockSessionManager = new BankingSessionManager('test', 'test-key') as jest.Mocked<BankingSessionManager>;
    handler = new AuthorizationChallengeHandler(mockAuthManager, mockSessionManager);

    // Create mock session with valid user tokens
    const mockUserTokens: UserTokens = {
      accessToken: 'valid_access_token',
      refreshToken: 'valid_refresh_token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'accounts:read transactions:read transactions:write',
      issuedAt: new Date()
    };

    mockSession = {
      sessionId: 'session_123',
      agentTokenHash: 'agent_hash',
      userTokens: mockUserTokens,
      createdAt: new Date(),
      lastActivity: new Date(),
      expiresAt: new Date(Date.now() + 3600000)
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('detectAuthorizationChallenge', () => {
    it('should require challenge when no user tokens', async () => {
      const sessionWithoutTokens = { ...mockSession, userTokens: undefined };
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize?state=abc123',
        state: 'abc123',
        scope: 'accounts:read',
        sessionId: 'session_123',
        expiresAt: new Date(Date.now() + 600000)
      };

      mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

      const result = await handler.detectAuthorizationChallenge(
        sessionWithoutTokens,
        ['accounts:read']
      );

      expect(result.challengeNeeded).toBe(true);
      expect(result.challenge).toBeDefined();
      expect(result.challenge?.authorizationUrl).toBe(mockAuthRequest.authorizationUrl);
      expect(result.challenge?.state).toBe(mockAuthRequest.state);
      expect(result.challenge?.type).toBe('oauth_authorization_required');
    });

    it('should refresh expired tokens successfully', async () => {
      const expiredTokens: UserTokens = {
        ...(mockSession.userTokens as UserTokens),
        issuedAt: new Date(Date.now() - 7200000) // 2 hours ago
      };
      const sessionWithExpiredTokens = { ...mockSession, userTokens: expiredTokens };

      const refreshedTokens: UserTokens = {
        ...expiredTokens,
        accessToken: 'new_access_token',
        issuedAt: new Date()
      };

      mockAuthManager.isTokenExpired.mockReturnValue(true);
      mockAuthManager.refreshUserToken.mockResolvedValue(refreshedTokens);
      mockAuthManager.validateBankingScopes.mockReturnValue(true);
      mockSessionManager.associateUserTokens.mockResolvedValue();

      const result = await handler.detectAuthorizationChallenge(
        sessionWithExpiredTokens,
        ['accounts:read']
      );

      expect(result.challengeNeeded).toBe(false);
      expect(mockAuthManager.refreshUserToken).toHaveBeenCalledWith('valid_refresh_token');
      expect(mockSessionManager.associateUserTokens).toHaveBeenCalledWith('session_123', refreshedTokens);
    });

    it('should require challenge when token refresh fails', async () => {
      const expiredTokens: UserTokens = {
        ...(mockSession.userTokens as UserTokens),
        issuedAt: new Date(Date.now() - 7200000) // 2 hours ago
      };
      const sessionWithExpiredTokens = { ...mockSession, userTokens: expiredTokens };

      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize?state=def456',
        state: 'def456',
        scope: 'accounts:read',
        sessionId: 'session_123',
        expiresAt: new Date(Date.now() + 600000)
      };

      mockAuthManager.isTokenExpired.mockReturnValue(true);
      mockAuthManager.refreshUserToken.mockRejectedValue(new Error('Refresh failed'));
      mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

      const result = await handler.detectAuthorizationChallenge(
        sessionWithExpiredTokens,
        ['accounts:read']
      );

      expect(result.challengeNeeded).toBe(true);
      expect(result.challenge).toBeDefined();
      expect(result.challenge?.authorizationUrl).toBe(mockAuthRequest.authorizationUrl);
    });

    it('should require challenge when insufficient scopes', async () => {
      const limitedScopeTokens: UserTokens = {
        ...(mockSession.userTokens as UserTokens),
        scope: 'transactions:read' // Missing accounts:read
      };
      const sessionWithLimitedScopes = { ...mockSession, userTokens: limitedScopeTokens };

      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize?state=ghi789',
        state: 'ghi789',
        scope: 'accounts:read',
        sessionId: 'session_123',
        expiresAt: new Date(Date.now() + 600000)
      };

      mockAuthManager.isTokenExpired.mockReturnValue(false);
      mockAuthManager.validateBankingScopes.mockReturnValue(false);
      mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

      const result = await handler.detectAuthorizationChallenge(
        sessionWithLimitedScopes,
        ['accounts:read']
      );

      expect(result.challengeNeeded).toBe(true);
      expect(result.challenge).toBeDefined();
    });

    it('should not require challenge when tokens are valid and have sufficient scopes', async () => {
      mockAuthManager.isTokenExpired.mockReturnValue(false);
      mockAuthManager.validateBankingScopes.mockReturnValue(true);

      const result = await handler.detectAuthorizationChallenge(
        mockSession,
        ['accounts:read']
      );

      expect(result.challengeNeeded).toBe(false);
      expect(result.challenge).toBeUndefined();
    });
  });

  describe('generateAuthorizationChallenge', () => {
    it('should generate proper authorization challenge', async () => {
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize?state=xyz123',
        state: 'xyz123',
        scope: 'accounts:read transactions:write',
        sessionId: 'session_123',
        expiresAt: new Date(Date.now() + 600000)
      };

      mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

      const challenge = await handler.generateAuthorizationChallenge(
        'session_123',
        ['accounts:read', 'transactions:write']
      );

      expect(challenge.type).toBe('oauth_authorization_required');
      expect(challenge.authorizationUrl).toBe(mockAuthRequest.authorizationUrl);
      expect(challenge.state).toBe(mockAuthRequest.state);
      expect(challenge.scope).toBe(mockAuthRequest.scope);
      expect(challenge.sessionId).toBe(mockAuthRequest.sessionId);
      expect(challenge.instructions).toContain('To complete this banking operation');
      expect(challenge.instructions).toContain('View your bank accounts and balances');
      expect(challenge.instructions).toContain('Create deposits, withdrawals, and transfers');
    });
  });

  describe('handleAuthorizationCode', () => {
    it('should successfully exchange authorization code for tokens', async () => {
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize',
        state: 'valid_state',
        scope: 'accounts:read',
        sessionId: 'session_123',
        expiresAt: new Date(Date.now() + 600000)
      };

      const mockUserTokens: UserTokens = {
        accessToken: 'new_access_token',
        refreshToken: 'new_refresh_token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'accounts:read',
        issuedAt: new Date()
      };

      mockAuthManager.validateAuthorizationState.mockReturnValue(mockAuthRequest);
      mockAuthManager.exchangeAuthorizationCode.mockResolvedValue(mockUserTokens);
      mockAuthManager.validateBankingScopes.mockReturnValue(true);
      mockSessionManager.associateUserTokens.mockResolvedValue();
      mockAuthManager.completeAuthorizationRequest.mockReturnValue(true);

      const result = await handler.handleAuthorizationCode({
        sessionId: 'session_123',
        authorizationCode: 'auth_code_123',
        state: 'valid_state'
      });

      expect(result.success).toBe(true);
      expect(result.userTokens).toEqual(mockUserTokens);
      expect(mockAuthManager.exchangeAuthorizationCode).toHaveBeenCalledWith('auth_code_123');
      expect(mockSessionManager.associateUserTokens).toHaveBeenCalledWith('session_123', mockUserTokens);
      expect(mockAuthManager.completeAuthorizationRequest).toHaveBeenCalledWith('valid_state');
    });

    it('should reject invalid authorization state', async () => {
      mockAuthManager.validateAuthorizationState.mockReturnValue(null);

      const result = await handler.handleAuthorizationCode({
        sessionId: 'session_123',
        authorizationCode: 'auth_code_123',
        state: 'invalid_state'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid or expired authorization state');
      expect(result.errorCode).toBe('INVALID_STATE');
    });

    it('should reject session mismatch', async () => {
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize',
        state: 'valid_state',
        scope: 'accounts:read',
        sessionId: 'different_session',
        expiresAt: new Date(Date.now() + 600000)
      };

      mockAuthManager.validateAuthorizationState.mockReturnValue(mockAuthRequest);

      const result = await handler.handleAuthorizationCode({
        sessionId: 'session_123',
        authorizationCode: 'auth_code_123',
        state: 'valid_state'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session mismatch in authorization request');
      expect(result.errorCode).toBe('SESSION_MISMATCH');
    });

    it('should reject tokens with insufficient scopes', async () => {
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize',
        state: 'valid_state',
        scope: 'accounts:read transactions:write',
        sessionId: 'session_123',
        expiresAt: new Date(Date.now() + 600000)
      };

      const mockUserTokens: UserTokens = {
        accessToken: 'new_access_token',
        refreshToken: 'new_refresh_token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'accounts:read', // Missing transactions:write
        issuedAt: new Date()
      };

      mockAuthManager.validateAuthorizationState.mockReturnValue(mockAuthRequest);
      mockAuthManager.exchangeAuthorizationCode.mockResolvedValue(mockUserTokens);
      mockAuthManager.validateBankingScopes.mockReturnValue(false);

      const result = await handler.handleAuthorizationCode({
        sessionId: 'session_123',
        authorizationCode: 'auth_code_123',
        state: 'valid_state'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Obtained tokens do not have required banking scopes');
      expect(result.errorCode).toBe('INSUFFICIENT_SCOPE');
    });

    it('should handle authentication errors', async () => {
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize',
        state: 'valid_state',
        scope: 'accounts:read',
        sessionId: 'session_123',
        expiresAt: new Date(Date.now() + 600000)
      };

      const authError = new AuthenticationError(
        'Invalid authorization code',
        AuthErrorCodes.INVALID_AUTHORIZATION_CODE
      );

      mockAuthManager.validateAuthorizationState.mockReturnValue(mockAuthRequest);
      mockAuthManager.exchangeAuthorizationCode.mockRejectedValue(authError);

      const result = await handler.handleAuthorizationCode({
        sessionId: 'session_123',
        authorizationCode: 'invalid_code',
        state: 'valid_state'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid authorization code');
      // Source coerces error.code to string via String(error.code) — assert string form.
      expect(result.errorCode).toBe(String(AuthErrorCodes.INVALID_AUTHORIZATION_CODE));
    });
  });

  describe('validateAuthorizationResponse', () => {
    it('should validate correct authorization response', () => {
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize',
        state: 'valid_state',
        scope: 'accounts:read',
        sessionId: 'session_123',
        expiresAt: new Date(Date.now() + 600000)
      };

      mockAuthManager.validateAuthorizationState.mockReturnValue(mockAuthRequest);

      const result = handler.validateAuthorizationResponse('valid_state', 'session_123');

      expect(result.valid).toBe(true);
      expect(result.authRequest).toEqual(mockAuthRequest);
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid state', () => {
      mockAuthManager.validateAuthorizationState.mockReturnValue(null);

      const result = handler.validateAuthorizationResponse('invalid_state', 'session_123');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid or expired authorization state');
    });

    it('should reject session mismatch', () => {
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize',
        state: 'valid_state',
        scope: 'accounts:read',
        sessionId: 'different_session',
        expiresAt: new Date(Date.now() + 600000)
      };

      mockAuthManager.validateAuthorizationState.mockReturnValue(mockAuthRequest);

      const result = handler.validateAuthorizationResponse('valid_state', 'session_123');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Session mismatch in authorization response');
    });

    it('should reject expired authorization request', () => {
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize',
        state: 'valid_state',
        scope: 'accounts:read',
        sessionId: 'session_123',
        expiresAt: new Date(Date.now() - 60000) // Expired 1 minute ago
      };

      mockAuthManager.validateAuthorizationState.mockReturnValue(mockAuthRequest);

      const result = handler.validateAuthorizationResponse('valid_state', 'session_123');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Authorization request has expired');
    });
  });

  describe('checkReauthorizationNeeded', () => {
    it('should return true when reauthorization is needed', async () => {
      const sessionWithoutTokens = { ...mockSession, userTokens: undefined };
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://auth.example.com/authorize',
        state: 'abc123',
        scope: 'accounts:read',
        sessionId: 'session_123',
        expiresAt: new Date(Date.now() + 600000)
      };

      mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

      const result = await handler.checkReauthorizationNeeded(
        sessionWithoutTokens,
        ['accounts:read']
      );

      expect(result).toBe(true);
    });

    it('should return false when authorization is not needed', async () => {
      mockAuthManager.isTokenExpired.mockReturnValue(false);
      mockAuthManager.validateBankingScopes.mockReturnValue(true);

      const result = await handler.checkReauthorizationNeeded(
        mockSession,
        ['accounts:read']
      );

      expect(result).toBe(false);
    });
  });

  describe('formatMCPAuthorizationChallenge', () => {
    it('should format challenge for MCP protocol', () => {
      const challenge = {
        type: 'oauth_authorization_required' as const,
        authorizationUrl: 'https://auth.example.com/authorize',
        state: 'abc123',
        scope: 'accounts:read',
        sessionId: 'session_123',
        expiresAt: new Date(),
        instructions: 'Please authorize access to your banking data.'
      };

      const result = handler.formatMCPAuthorizationChallenge(challenge);

      expect(result.type).toBe('text');
      expect(result.text).toBe(challenge.instructions);
      expect(result.authChallenge.authorizationUrl).toBe(challenge.authorizationUrl);
      expect(result.authChallenge.state).toBe(challenge.state);
      expect(result.authChallenge.scope).toBe(challenge.scope);
      expect(result.authChallenge.sessionId).toBe(challenge.sessionId);
    });
  });

  describe('handleAuthorizationError', () => {
    it('should handle AuthenticationError', () => {
      const authError = new AuthenticationError(
        'Token expired',
        AuthErrorCodes.TOKEN_EXPIRED
      );

      const result = handler.handleAuthorizationError(authError);

      expect(result.type).toBe('text');
      expect(result.text).toBe('Authorization Error: Token expired');
      expect(result.error).toBe('Token expired');
      // Source coerces error.code to string via String(error.code) — assert string form.
      expect(result.errorCode).toBe(String(AuthErrorCodes.TOKEN_EXPIRED));
    });

    it('should handle generic Error', () => {
      const genericError = new Error('Network timeout');

      const result = handler.handleAuthorizationError(genericError);

      expect(result.type).toBe('text');
      expect(result.text).toBe('Authorization Error: Network timeout');
      expect(result.error).toBe('Network timeout');
      expect(result.errorCode).toBe('AUTHORIZATION_ERROR');
    });

    it('should handle string error types', () => {
      // Source preserves string errors directly (Authorization Error: <string>).
      // Only truly unknown types (object, number, etc.) fall back to 'Authorization failed'.
      const stringError = 'string error';

      const result = handler.handleAuthorizationError(stringError);

      expect(result.type).toBe('text');
      expect(result.text).toBe('Authorization Error: string error');
      expect(result.error).toBe('string error');
      expect(result.errorCode).toBe('AUTHORIZATION_ERROR');
    });

    it('should handle truly unknown error types (object, number)', () => {
      // Non-Error, non-string, non-AuthenticationError input falls back to default text.
      const unknownError = { not_an_error: true };

      const result = handler.handleAuthorizationError(unknownError);

      expect(result.type).toBe('text');
      expect(result.text).toBe('Authorization Error: Authorization failed');
      expect(result.error).toBe('Authorization failed');
      expect(result.errorCode).toBe('AUTHORIZATION_ERROR');
    });
  });
});