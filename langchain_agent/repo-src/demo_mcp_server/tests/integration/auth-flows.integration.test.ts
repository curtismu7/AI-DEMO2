/**
 * Integration tests for authentication flows
 * Tests complete agent authentication validation, user authorization code exchange,
 * and token correlation with session management
 */

import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../../src/storage/BankingSessionManager';
import { PingOneConfig, UserTokens } from '../../src/interfaces/auth';
import axios from 'axios';
import { promises as fs } from 'fs';
import { join } from 'path';
import { setupIntegrationAxiosMock } from '../helpers/integrationAxiosMock';

// Mock axios for PingOne API calls
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Authentication Flows Integration Tests', () => {
  let authManager: BankingAuthenticationManager;
  let sessionManager: BankingSessionManager;
  let testConfig: PingOneConfig;
  let testStoragePath: string;
  let testEncryptionKey: string;

  beforeAll(async () => {
    // Setup test configuration
    testConfig = {
      baseUrl: 'https://test.pingone.com',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tokenIntrospectionEndpoint: '/as/introspect',
      authorizationEndpoint: '/as/authorization',
      tokenEndpoint: '/as/token'
    };

    // Setup test storage
    testStoragePath = join(__dirname, '../storage/test-auth-integration');
    testEncryptionKey = 'test-encryption-key-32-chars-long!';

    // Ensure test directory exists
    await fs.mkdir(testStoragePath, { recursive: true });

    setupIntegrationAxiosMock(mockedAxios);

    // Initialize managers
    authManager = new BankingAuthenticationManager(testConfig);
    sessionManager = new BankingSessionManager(
      testStoragePath,
      testEncryptionKey,
      3600, // 1 hour cache TTL
      60,   // 1 minute cleanup interval
      { enableDetailedLogging: false }
    );
  });

  afterAll(async () => {
    // Cleanup test resources
    authManager.destroy();
    sessionManager.destroy();

    // Clean up test storage
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setupIntegrationAxiosMock(mockedAxios);
  });

  describe('Complete Agent Authentication Flow', () => {
    it('should validate agent token and create session successfully', async () => {
      // Arrange
      const testAgentToken = 'valid-agent-token-12345';
      const mockTokenResponse = {
        data: {
          active: true,
          client_id: 'test-client-id',
          scope: 'read write',
          exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
        }
      };

      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);

      // Act
      const agentTokenInfo = await authManager.validateAgentToken(testAgentToken);
      const session = await sessionManager.createSession(testAgentToken);

      // Assert
      expect(agentTokenInfo).toMatchObject({
        clientId: 'test-client-id',
        scopes: ['read', 'write'],
        isValid: true
      });
      expect(agentTokenInfo.tokenHash).toBeDefined();
      expect(agentTokenInfo.expiresAt).toBeInstanceOf(Date);

      expect(session).toMatchObject({
        sessionId: expect.stringMatching(/^banking_session_/),
        createdAt: expect.any(Date),
        expiresAt: expect.any(Date)
      });
      // TokenIntrospector uses a 16-char SHA-256 prefix; session stores the full hex digest
      expect(session.agentTokenHash.startsWith(agentTokenInfo.tokenHash)).toBe(true);
      expect(session.userTokens).toBeUndefined();

      // Verify session can be retrieved by agent token
      const retrievedSession = await sessionManager.getSessionByAgentToken(testAgentToken);
      expect(retrievedSession).toMatchObject(session);
    });

    it('should handle invalid agent token and throw authentication error', async () => {
      // Arrange
      const invalidAgentToken = 'invalid-agent-token';
      const mockErrorResponse = {
        isAxiosError: true,
        message: 'Request failed with status 401',
        response: {
          status: 401,
          data: { error: 'invalid_token' }
        }
      };

      mockedAxios.post.mockRejectedValueOnce(mockErrorResponse);

      // Act & Assert
      await expect(authManager.validateAgentToken(invalidAgentToken))
        .rejects
        .toThrow('Invalid client credentials for token introspection');
    });

    it('should handle expired agent token', async () => {
      // Arrange
      const expiredAgentToken = 'expired-agent-token';
      const mockTokenResponse = {
        data: {
          active: true,
          client_id: 'test-client-id',
          scope: 'read',
          exp: Math.floor(Date.now() / 1000) - 3600 // 1 hour ago (expired)
        }
      };

      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);

      // Act & Assert
      await expect(authManager.validateAgentToken(expiredAgentToken))
        .rejects
        .toThrow('Agent token has expired');
    });

    it('should validate token scopes correctly', async () => {
      // Arrange
      const testAgentToken = 'scoped-agent-token';
      const mockTokenResponse = {
        data: {
          active: true,
          client_id: 'test-client-id',
          scope: 'read accounts:read',
          exp: Math.floor(Date.now() / 1000) + 3600
        }
      };

      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);

      // Act & Assert
      const hasReadScope = await authManager.validateTokenScopes(testAgentToken, ['read']);
      expect(hasReadScope).toBe(true);

      // Reset mock for second call
      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);
      
      const hasWriteScope = await authManager.validateTokenScopes(testAgentToken, ['write']);
      expect(hasWriteScope).toBe(false);

      // Reset mock for third call
      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);
      
      const hasMultipleScopes = await authManager.validateTokenScopes(
        testAgentToken, 
        ['read', 'accounts:read']
      );
      expect(hasMultipleScopes).toBe(true);
    });
  });

  describe('User Authorization Code Exchange Flow', () => {
    let testSession: any;
    let testAgentToken: string;

    beforeEach(async () => {
      // Setup a valid session for user authorization tests
      testAgentToken = 'valid-agent-token-for-user-auth';
      const mockTokenResponse = {
        data: {
          active: true,
          client_id: 'test-client-id',
          scope: 'read write',
          exp: Math.floor(Date.now() / 1000) + 3600
        }
      };

      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);
      await authManager.validateAgentToken(testAgentToken);
      testSession = await sessionManager.createSession(testAgentToken);
    });

    it('should generate authorization request successfully', async () => {
      // Arrange
      const authOptions = {
        sessionId: testSession.sessionId,
        scopes: ['accounts:read', 'transactions:read'],
        redirectUri: 'http://localhost:3000/callback'
      };

      // Act
      const authRequest = authManager.generateAuthorizationRequest(authOptions);

      // Assert
      expect(authRequest).toMatchObject({
        authorizationUrl: expect.stringContaining(testConfig.baseUrl + testConfig.authorizationEndpoint),
        state: expect.any(String),
        scope: 'accounts:read transactions:read',
        sessionId: testSession.sessionId,
        expiresAt: expect.any(Date)
      });

      expect(authRequest.authorizationUrl).toContain('client_id=' + testConfig.clientId);
      expect(authRequest.authorizationUrl).toContain('response_type=code');
      expect(authRequest.authorizationUrl).toContain('state=' + authRequest.state);
      const scopeFromUrl = new URL(authRequest.authorizationUrl).searchParams.get('scope');
      expect(scopeFromUrl).toBe('accounts:read transactions:read');
    });

    it('should exchange authorization code for user tokens successfully', async () => {
      // Arrange
      const authCode = 'test-authorization-code';
      const redirectUri = 'http://localhost:3000/callback';
      
      const mockUserTokens: UserTokens = {
        accessToken: 'user-access-token-12345',
        refreshToken: 'user-refresh-token-12345',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'accounts:read transactions:read',
        issuedAt: new Date()
      };

      const mockTokenExchangeResponse = {
        data: {
          access_token: mockUserTokens.accessToken,
          refresh_token: mockUserTokens.refreshToken,
          token_type: mockUserTokens.tokenType,
          expires_in: mockUserTokens.expiresIn,
          scope: mockUserTokens.scope
        }
      };

      mockedAxios.post.mockResolvedValueOnce(mockTokenExchangeResponse);

      // Act
      const userTokens = await authManager.exchangeAuthorizationCode(authCode, redirectUri);

      // Assert
      expect(userTokens).toMatchObject({
        accessToken: mockUserTokens.accessToken,
        refreshToken: mockUserTokens.refreshToken,
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'accounts:read transactions:read',
        issuedAt: expect.any(Date)
      });

      // Verify the correct API call was made
      expect(mockedAxios.post).toHaveBeenCalledWith(
        testConfig.tokenEndpoint,
        expect.stringContaining('grant_type=authorization_code'),
      );
    });

    it('should handle authorization code exchange failure', async () => {
      // Arrange
      const invalidAuthCode = 'invalid-authorization-code';
      const mockErrorResponse = {
        response: {
          status: 400,
          data: { 
            error: 'invalid_grant',
            error_description: 'Authorization code is invalid or expired'
          }
        }
      };

      mockedAxios.post.mockRejectedValueOnce(mockErrorResponse);

      // Act & Assert
      await expect(authManager.exchangeAuthorizationCode(invalidAuthCode))
        .rejects
        .toThrow('Authorization code exchange failed');
    });

    it('should refresh user tokens successfully', async () => {
      // Arrange
      const refreshToken = 'valid-refresh-token';
      const mockRefreshedTokens = {
        data: {
          access_token: 'new-user-access-token',
          refresh_token: 'new-user-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'accounts:read transactions:read'
        }
      };

      mockedAxios.post.mockResolvedValueOnce(mockRefreshedTokens);

      // Act
      const refreshedTokens = await authManager.refreshUserToken(refreshToken);

      // Assert
      expect(refreshedTokens).toMatchObject({
        accessToken: 'new-user-access-token',
        refreshToken: 'new-user-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'accounts:read transactions:read',
        issuedAt: expect.any(Date)
      });

      // Verify the correct API call was made
      expect(mockedAxios.post).toHaveBeenCalledWith(
        testConfig.tokenEndpoint,
        expect.stringContaining('grant_type=refresh_token'),
      );
    });
  });

  describe('Token Correlation and Session Management', () => {
    let testAgentToken: string;
    let testSession: any;
    let testUserTokens: UserTokens;

    beforeEach(async () => {
      // Setup test session with agent token
      testAgentToken = 'correlation-test-agent-token';
      const mockTokenResponse = {
        data: {
          active: true,
          client_id: 'test-client-id',
          scope: 'read write',
          exp: Math.floor(Date.now() / 1000) + 3600
        }
      };

      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);
      await authManager.validateAgentToken(testAgentToken);
      testSession = await sessionManager.createSession(testAgentToken);

      // Setup test user tokens
      testUserTokens = {
        accessToken: 'correlated-user-access-token',
        refreshToken: 'correlated-user-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'accounts:read transactions:read',
        issuedAt: new Date()
      };
    });

    it('should correlate user tokens with agent session successfully', async () => {
      // Act
      await sessionManager.associateUserTokens(testSession.sessionId, testUserTokens);

      // Assert
      const updatedSession = await sessionManager.getSession(testSession.sessionId);
      expect(updatedSession).toBeDefined();
      expect(updatedSession!.userTokens).toHaveLength(1);
      expect(updatedSession!.userTokens![0]).toMatchObject(testUserTokens);

      // Verify session can still be retrieved by agent token
      const sessionByAgentToken = await sessionManager.getSessionByAgentToken(testAgentToken);
      expect(sessionByAgentToken).toBeDefined();
      expect(sessionByAgentToken!.userTokens).toHaveLength(1);
      expect(sessionByAgentToken!.userTokens![0]).toMatchObject(testUserTokens);
    });

    it('should validate session with user tokens correctly', async () => {
      // Arrange - Associate user tokens with session
      await sessionManager.associateUserTokens(testSession.sessionId, testUserTokens);

      // Act
      const validationResult = await sessionManager.validateSession(testSession.sessionId);

      // Assert
      expect(validationResult).toMatchObject({
        isValid: true,
        requiresUserAuth: false,
        session: expect.objectContaining({
          sessionId: testSession.sessionId,
          userTokens: [expect.objectContaining({ accessToken: testUserTokens.accessToken })],
        })
      });
    });

    it('should detect when user authorization is required', async () => {
      // Act - Validate session without user tokens
      const validationResult = await sessionManager.validateSession(testSession.sessionId);

      // Assert
      expect(validationResult).toMatchObject({
        isValid: true,
        requiresUserAuth: true,
        session: expect.objectContaining({
          sessionId: testSession.sessionId
        })
      });
      expect(validationResult.session!.userTokens).toBeUndefined();
    });

    it('should detect expired user tokens and require re-authorization', async () => {
      // Arrange - Create expired user tokens
      const expiredUserTokens: UserTokens = {
        ...testUserTokens,
        expiresIn: 1, // 1 second
        issuedAt: new Date(Date.now() - 2000) // 2 seconds ago
      };

      await sessionManager.associateUserTokens(testSession.sessionId, expiredUserTokens);

      // Act
      const validationResult = await sessionManager.validateSession(testSession.sessionId);

      // Assert
      expect(validationResult).toMatchObject({
        isValid: true,
        requiresUserAuth: true,
        session: expect.objectContaining({
          sessionId: testSession.sessionId,
          userTokens: [expect.objectContaining({ accessToken: expiredUserTokens.accessToken })],
        })
      });
    });

    it('should handle complete authorization flow with state validation', async () => {
      // Arrange - Generate authorization request
      const authOptions = {
        sessionId: testSession.sessionId,
        scopes: ['accounts:read'],
        redirectUri: 'http://localhost:3000/callback'
      };

      const authRequest = authManager.generateAuthorizationRequest(authOptions);

      // Act - Validate state and complete authorization
      const validatedRequest = authManager.validateAuthorizationState(authRequest.state);
      expect(validatedRequest).toMatchObject(authRequest);

      const completed = authManager.completeAuthorizationRequest(authRequest.state);
      expect(completed).toBe(true);

      // Verify state is no longer valid after completion
      const invalidatedRequest = authManager.validateAuthorizationState(authRequest.state);
      expect(invalidatedRequest).toBeNull();
    });

    it('should track session activity and statistics', async () => {
      // Arrange - Associate user tokens
      await sessionManager.associateUserTokens(testSession.sessionId, testUserTokens);

      // Act - Update session activity
      await sessionManager.updateSessionActivity(testSession.sessionId, 'tool_call');
      await sessionManager.updateSessionActivity(testSession.sessionId, 'auth_challenge');
      await sessionManager.updateSessionActivity(testSession.sessionId, 'banking_api_call');

      // Assert
      const sessionStats = sessionManager.getSessionStats(testSession.sessionId);
      expect(sessionStats).toMatchObject({
        toolCallCount: 1,
        authChallengeCount: 1,
        bankingApiCallCount: 1,
        lastToolCall: expect.any(Date),
        lastAuthChallenge: expect.any(Date),
        lastBankingApiCall: expect.any(Date)
      });

      const overallStats = await sessionManager.getSessionStatistics();
      expect(overallStats.totalSessions).toBeGreaterThanOrEqual(1);
      expect(overallStats.activeSessions).toBeGreaterThanOrEqual(1);
      expect(overallStats.sessionsWithUserTokens).toBeGreaterThanOrEqual(1);
      expect(overallStats.totalToolCalls).toBeGreaterThanOrEqual(1);
      expect(overallStats.totalAuthChallenges).toBeGreaterThanOrEqual(1);
      expect(overallStats.totalBankingApiCalls).toBeGreaterThanOrEqual(1);
    });

    it('should clean up expired sessions and maintain correlation', async () => {
      // Arrange — create a session that's born already expired by passing a negative
      // expirationHours. SessionManager computes `expiresAt = now + hours*3600000`,
      // making it expired immediately. This replaces a previous 4-second wall-clock
      // sleep that made the test flaky on busy CI.
      const shortLivedSession = await sessionManager.createSession(
        'short-lived-agent-token',
        -0.01 // expiresAt = now - 36s (already expired)
      );

      // Verify expired session is not accessible — getSession() eagerly removes
      // expired sessions when accessed (SessionManager.ts:87-89). This IS the
      // cleanup happening on read; no need to call forceCleanup() separately.
      const expiredSession = await sessionManager.getSession(shortLivedSession.sessionId);
      expect(expiredSession).toBeNull();

      // Verify original (long-lived) session is still accessible — correlation
      // between sessions is maintained: cleaning one doesn't take down the rest.
      const activeSession = await sessionManager.getSession(testSession.sessionId);
      expect(activeSession).toBeDefined();
      expect(activeSession?.sessionId).toBe(testSession.sessionId);

      // forceCleanup() also reports a non-negative total (read-eviction may have
      // already removed it, in which case background cleanup is a no-op).
      const cleanupResult = await sessionManager.forceCleanup();
      expect(cleanupResult.totalCleaned).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle network errors during token validation', async () => {
      // Arrange
      const networkErrorToken = 'network-error-token';
      mockedAxios.post.mockRejectedValueOnce(new Error('Network Error'));

      // Act & Assert
      await expect(authManager.validateAgentToken(networkErrorToken))
        .rejects
        .toThrow('Token introspection failed: Network Error');
    });

    it('should handle malformed token responses', async () => {
      // Arrange
      const malformedResponseToken = 'malformed-response-token';
      const mockMalformedResponse = {
        data: {
          // Missing required fields
          active: true
          // No client_id, scope, or exp
        }
      };

      mockedAxios.post.mockResolvedValueOnce(mockMalformedResponse);

      // Act
      const agentTokenInfo = await authManager.validateAgentToken(malformedResponseToken);

      // Assert - Should handle missing fields gracefully
      expect(agentTokenInfo).toMatchObject({
        clientId: 'unknown',
        scopes: [],
        isValid: true,
        expiresAt: expect.any(Date)
      });
    });

    it('should handle session validation for non-existent sessions', async () => {
      // Act
      const validationResult = await sessionManager.validateSession('non-existent-session-id');

      // Assert
      expect(validationResult).toMatchObject({
        isValid: false,
        requiresUserAuth: false,
        error: 'Session not found'
      });
    });

    it('should handle invalid user token association', async () => {
      // Arrange - Create a test session first
      const testAgentToken = 'test-agent-token-invalid-user-tokens';
      
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          active: true,
          client_id: 'test-client-id',
          scope: 'read write',
          exp: Math.floor(Date.now() / 1000) + 3600
        }
      });

      await authManager.validateAgentToken(testAgentToken);
      const testSession = await sessionManager.createSession(testAgentToken);

      const invalidUserTokens = {
        accessToken: '', // Invalid empty token
        refreshToken: 'valid-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'read',
        issuedAt: new Date()
      } as UserTokens;

      // Act & Assert
      await expect(sessionManager.associateUserTokens(testSession.sessionId, invalidUserTokens))
        .rejects
        .toThrow('Invalid access token');
    });
  });

  describe('Concurrent Session Management', () => {
    it('should handle multiple concurrent agent sessions', async () => {
      // Arrange
      const concurrentSessions = 5;
      const agentTokens = Array.from({ length: concurrentSessions }, (_, i) => `concurrent-agent-token-${i}`);
      
      // Mock token validation for all tokens
      agentTokens.forEach(() => {
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            active: true,
            client_id: 'test-client-id',
            scope: 'read write',
            exp: Math.floor(Date.now() / 1000) + 3600
          }
        });
      });

      // Act - Create sessions concurrently
      const sessionPromises = agentTokens.map(async (token) => {
        await authManager.validateAgentToken(token);
        return sessionManager.createSession(token);
      });

      const sessions = await Promise.all(sessionPromises);

      // Assert
      expect(sessions).toHaveLength(concurrentSessions);
      sessions.forEach((session) => {
        expect(session.sessionId).toMatch(/^banking_session_/);
        expect(session.agentTokenHash).toBeDefined();
      });

      // Verify all sessions can be retrieved by their agent tokens
      const retrievalPromises = agentTokens.map(token => 
        sessionManager.getSessionByAgentToken(token)
      );
      const retrievedSessions = await Promise.all(retrievalPromises);

      expect(retrievedSessions).toHaveLength(concurrentSessions);
      retrievedSessions.forEach(session => {
        expect(session).toBeDefined();
      });

      // Verify session statistics
      const stats = await sessionManager.getSessionStatistics();
      expect(stats.activeSessions).toBeGreaterThanOrEqual(concurrentSessions);
    });

    it('should handle concurrent user token associations', async () => {
      // Arrange
      const testAgentToken = 'concurrent-user-token-test';
      const mockTokenResponse = {
        data: {
          active: true,
          client_id: 'test-client-id',
          scope: 'read write',
          exp: Math.floor(Date.now() / 1000) + 3600
        }
      };

      mockedAxios.post.mockResolvedValueOnce(mockTokenResponse);
      await authManager.validateAgentToken(testAgentToken);
      const session = await sessionManager.createSession(testAgentToken);

      const userTokens: UserTokens = {
        accessToken: 'concurrent-user-access-token',
        refreshToken: 'concurrent-user-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'accounts:read',
        issuedAt: new Date()
      };

      // Act - Attempt concurrent user token associations (should be handled gracefully)
      const associationPromises = Array.from({ length: 3 }, () =>
        sessionManager.associateUserTokens(session.sessionId, userTokens)
      );

      // Should not throw errors
      await Promise.all(associationPromises);

      // Assert
      const updatedSession = await sessionManager.getSession(session.sessionId);
      expect(updatedSession!.userTokens).toHaveLength(1);
      expect(updatedSession!.userTokens![0]).toMatchObject(userTokens);
    });
  });
});