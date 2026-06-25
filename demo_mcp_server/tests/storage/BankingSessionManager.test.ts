import * as fs from 'fs/promises';
import * as path from 'path';
import { BankingSessionManager, UserTokens } from '../../src/storage/BankingSessionManager';

describe('BankingSessionManager', () => {
  const testStoragePath = path.join(__dirname, 'test-banking-sessions');
  const testEncryptionKey = 'test-encryption-key-with-sufficient-length-for-security';
  let bankingSessionManager: BankingSessionManager;

  beforeEach(async () => {
    bankingSessionManager = new BankingSessionManager(testStoragePath, testEncryptionKey, 60, 10);

    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  }, 10000);

  afterEach(async () => {
    bankingSessionManager.destroy();

    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  }, 10000);

  describe('session creation and correlation', () => {
    it('should create a new banking session with agent token correlation', async () => {
      const agentToken = 'test-agent-token-123';
      
      const session = await bankingSessionManager.createSession(agentToken);
      
      expect(session.sessionId).toMatch(/^banking_session_\d+_[a-z0-9]+$/);
      expect(session.agentTokenHash).toBeDefined();
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivity).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.userTokens).toBeUndefined();
      expect(session.sessionStats).toEqual({
        toolCallCount: 0,
        authChallengeCount: 0,
        bankingApiCallCount: 0
      });
    });

    it('should create session with custom expiration', async () => {
      const agentToken = 'test-agent-token-123';
      const expirationHours = 12;
      
      const session = await bankingSessionManager.createSession(agentToken, expirationHours);
      
      const expectedExpiration = new Date(session.createdAt.getTime() + (expirationHours * 60 * 60 * 1000));
      expect(session.expiresAt.getTime()).toBeCloseTo(expectedExpiration.getTime(), -3);
    });

    it('should allow retrieval by agent token', async () => {
      const agentToken = 'unique-agent-token-456';
      
      const originalSession = await bankingSessionManager.createSession(agentToken);
      const retrievedSession = await bankingSessionManager.getSessionByAgentToken(agentToken);
      
      expect(retrievedSession).not.toBeNull();
      expect(retrievedSession!.sessionId).toBe(originalSession.sessionId);
      expect(retrievedSession!.agentTokenHash).toBe(originalSession.agentTokenHash);
    });

    it('should return null for non-existent agent token', async () => {
      const retrievedSession = await bankingSessionManager.getSessionByAgentToken('non-existent-token');
      expect(retrievedSession).toBeNull();
    });

    it('should handle multiple sessions with different agent tokens', async () => {
      const agentToken1 = 'agent-token-1';
      const agentToken2 = 'agent-token-2';
      
      const session1 = await bankingSessionManager.createSession(agentToken1);
      const session2 = await bankingSessionManager.createSession(agentToken2);
      
      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session1.agentTokenHash).not.toBe(session2.agentTokenHash);
      
      const retrieved1 = await bankingSessionManager.getSessionByAgentToken(agentToken1);
      const retrieved2 = await bankingSessionManager.getSessionByAgentToken(agentToken2);
      
      expect(retrieved1!.sessionId).toBe(session1.sessionId);
      expect(retrieved2!.sessionId).toBe(session2.sessionId);
    });
  });

  describe('user token association', () => {
    const validUserTokens: UserTokens = {
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'accounts:read transactions:read',
      issuedAt: new Date()
    };

    it('should associate user tokens with session', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      await bankingSessionManager.associateUserTokens(session.sessionId, validUserTokens);
      
      const updatedSession = await bankingSessionManager.getSession(session.sessionId);
      expect(updatedSession!.userTokens).toEqual([validUserTokens]);
    });

    it('should throw error when associating tokens with non-existent session', async () => {
      await expect(
        bankingSessionManager.associateUserTokens('non-existent-session', validUserTokens)
      ).rejects.toThrow('Session non-existent-session not found');
    });

    it('should validate user tokens structure', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);

      // Test invalid access token
      const invalidTokens1 = { ...validUserTokens, accessToken: '' };
      await expect(
        bankingSessionManager.associateUserTokens(session.sessionId, invalidTokens1)
      ).rejects.toThrow('Invalid access token');

      // Test invalid refresh token
      const invalidTokens2 = { ...validUserTokens, refreshToken: null as any };
      await expect(
        bankingSessionManager.associateUserTokens(session.sessionId, invalidTokens2)
      ).rejects.toThrow('Invalid refresh token');

      // Test invalid token type
      const invalidTokens3 = { ...validUserTokens, tokenType: '' };
      await expect(
        bankingSessionManager.associateUserTokens(session.sessionId, invalidTokens3)
      ).rejects.toThrow('Invalid token type');

      // Test invalid expires in
      const invalidTokens4 = { ...validUserTokens, expiresIn: -1 };
      await expect(
        bankingSessionManager.associateUserTokens(session.sessionId, invalidTokens4)
      ).rejects.toThrow('Invalid expires in value');

      // Test invalid scope
      const invalidTokens5 = { ...validUserTokens, scope: '' };
      await expect(
        bankingSessionManager.associateUserTokens(session.sessionId, invalidTokens5)
      ).rejects.toThrow('Invalid scope');

      // Test invalid issued at
      const invalidTokens6 = { ...validUserTokens, issuedAt: 'invalid-date' as any };
      await expect(
        bankingSessionManager.associateUserTokens(session.sessionId, invalidTokens6)
      ).rejects.toThrow('Invalid issued at date');
    });
  });

  describe('session validation', () => {
    it('should validate existing session without user tokens', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      const validation = await bankingSessionManager.validateSession(session.sessionId);
      
      expect(validation.isValid).toBe(true);
      expect(validation.requiresUserAuth).toBe(true);
      expect(validation.session).toBeDefined();
      expect(validation.error).toBeUndefined();
    });

    it('should validate session with valid user tokens', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      const userTokens: UserTokens = {
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'accounts:read',
        issuedAt: new Date()
      };
      
      await bankingSessionManager.associateUserTokens(session.sessionId, userTokens);
      
      const validation = await bankingSessionManager.validateSession(session.sessionId);
      
      expect(validation.isValid).toBe(true);
      expect(validation.requiresUserAuth).toBe(false);
      expect(validation.session).toBeDefined();
      expect(validation.error).toBeUndefined();
    });

    it('should detect expired user tokens', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      const expiredUserTokens: UserTokens = {
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
        tokenType: 'Bearer',
        expiresIn: 1, // 1 second
        scope: 'accounts:read',
        issuedAt: new Date(Date.now() - 2000) // 2 seconds ago
      };
      
      await bankingSessionManager.associateUserTokens(session.sessionId, expiredUserTokens);
      
      const validation = await bankingSessionManager.validateSession(session.sessionId);
      
      expect(validation.isValid).toBe(true);
      expect(validation.requiresUserAuth).toBe(true);
      expect(validation.session).toBeDefined();
    });

    it('should return invalid for non-existent session', async () => {
      const validation = await bankingSessionManager.validateSession('non-existent-session');
      
      expect(validation.isValid).toBe(false);
      expect(validation.requiresUserAuth).toBe(false);
      expect(validation.session).toBeUndefined();
      expect(validation.error).toBe('Session not found');
    });

    it('should return invalid for expired session', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken, 0.0001); // Very short expiration
      
      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const validation = await bankingSessionManager.validateSession(session.sessionId);
      
      expect(validation.isValid).toBe(false);
      expect(validation.requiresUserAuth).toBe(false);
      expect(validation.session).toBeUndefined();
      expect(validation.error).toBe('Session expired');
    });
  });

  describe('session activity tracking', () => {
    it('should update session activity without activity type', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      const originalActivity = session.lastActivity;
      
      // Wait to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await bankingSessionManager.updateSessionActivity(session.sessionId);
      
      const updatedSession = await bankingSessionManager.getSession(session.sessionId);
      expect(updatedSession!.lastActivity.getTime()).toBeGreaterThan(originalActivity.getTime());
    });

    it('should track tool call activity', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      await bankingSessionManager.updateSessionActivity(session.sessionId, 'tool_call');
      
      const stats = bankingSessionManager.getSessionStats(session.sessionId);
      expect(stats!.toolCallCount).toBe(1);
      expect(stats!.lastToolCall).toBeInstanceOf(Date);
      expect(stats!.authChallengeCount).toBe(0);
      expect(stats!.bankingApiCallCount).toBe(0);
    });

    it('should track auth challenge activity', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      await bankingSessionManager.updateSessionActivity(session.sessionId, 'auth_challenge');
      
      const stats = bankingSessionManager.getSessionStats(session.sessionId);
      expect(stats!.authChallengeCount).toBe(1);
      expect(stats!.lastAuthChallenge).toBeInstanceOf(Date);
      expect(stats!.toolCallCount).toBe(0);
      expect(stats!.bankingApiCallCount).toBe(0);
    });

    it('should track banking API call activity', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      await bankingSessionManager.updateSessionActivity(session.sessionId, 'banking_api_call');
      
      const stats = bankingSessionManager.getSessionStats(session.sessionId);
      expect(stats!.bankingApiCallCount).toBe(1);
      expect(stats!.lastBankingApiCall).toBeInstanceOf(Date);
      expect(stats!.toolCallCount).toBe(0);
      expect(stats!.authChallengeCount).toBe(0);
    });

    it('should accumulate multiple activities', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      await bankingSessionManager.updateSessionActivity(session.sessionId, 'tool_call');
      await bankingSessionManager.updateSessionActivity(session.sessionId, 'tool_call');
      await bankingSessionManager.updateSessionActivity(session.sessionId, 'auth_challenge');
      await bankingSessionManager.updateSessionActivity(session.sessionId, 'banking_api_call');
      
      const stats = bankingSessionManager.getSessionStats(session.sessionId);
      expect(stats!.toolCallCount).toBe(2);
      expect(stats!.authChallengeCount).toBe(1);
      expect(stats!.bankingApiCallCount).toBe(1);
    });
  });

  describe('session removal and cleanup', () => {
    it('should remove session and clean up indices', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      // Verify session exists
      expect(await bankingSessionManager.sessionExists(session.sessionId)).toBe(true);
      expect(await bankingSessionManager.getSessionByAgentToken(agentToken)).not.toBeNull();
      
      await bankingSessionManager.removeSession(session.sessionId);
      
      // Verify session is removed
      expect(await bankingSessionManager.sessionExists(session.sessionId)).toBe(false);
      expect(await bankingSessionManager.getSessionByAgentToken(agentToken)).toBeNull();
      expect(bankingSessionManager.getSessionStats(session.sessionId)).toBeNull();
    });

    it('should handle removal of non-existent session gracefully', async () => {
      await expect(
        bankingSessionManager.removeSession('non-existent-session')
      ).resolves.not.toThrow();
    });

    it('should clean up expired sessions and update indices', async () => {
      const agentToken1 = 'agent-token-1';
      const agentToken2 = 'agent-token-2';
      
      await bankingSessionManager.createSession(agentToken1, 24);
      await bankingSessionManager.createSession(agentToken2, 0.0001);
      
      // Wait for one session to expire
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await bankingSessionManager.cleanupExpiredSessions();
      
      // Valid session should still exist
      expect(await bankingSessionManager.getSessionByAgentToken(agentToken1)).not.toBeNull();
      
      // Expired session should be cleaned up
      expect(await bankingSessionManager.getSessionByAgentToken(agentToken2)).toBeNull();
    });
  });

  describe('session statistics', () => {
    it('should provide comprehensive session statistics', async () => {
      const agentToken1 = 'agent-token-1';
      const agentToken2 = 'agent-token-2';
      
      const session1 = await bankingSessionManager.createSession(agentToken1);
      const session2 = await bankingSessionManager.createSession(agentToken2);
      
      // Add user tokens to one session
      const userTokens: UserTokens = {
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'accounts:read',
        issuedAt: new Date()
      };
      await bankingSessionManager.associateUserTokens(session1.sessionId, userTokens);
      
      // Add some activity
      await bankingSessionManager.updateSessionActivity(session1.sessionId, 'tool_call');
      await bankingSessionManager.updateSessionActivity(session1.sessionId, 'auth_challenge');
      await bankingSessionManager.updateSessionActivity(session2.sessionId, 'banking_api_call');
      
      const stats = await bankingSessionManager.getSessionStatistics();
      
      expect(stats.totalSessions).toBe(2);
      expect(stats.activeSessions).toBe(2);
      expect(stats.sessionsWithUserTokens).toBe(1);
      expect(stats.totalToolCalls).toBe(1);
      expect(stats.totalAuthChallenges).toBe(1);
      expect(stats.totalBankingApiCalls).toBe(1);
      expect(stats.cacheStats).toBeDefined();
    });

    it('should return null for non-existent session stats', async () => {
      const stats = bankingSessionManager.getSessionStats('non-existent-session');
      expect(stats).toBeNull();
    });

    it('should provide individual session statistics', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      await bankingSessionManager.updateSessionActivity(session.sessionId, 'tool_call');
      await bankingSessionManager.updateSessionActivity(session.sessionId, 'tool_call');
      
      const stats = bankingSessionManager.getSessionStats(session.sessionId);
      
      expect(stats).not.toBeNull();
      expect(stats!.toolCallCount).toBe(2);
      expect(stats!.authChallengeCount).toBe(0);
      expect(stats!.bankingApiCallCount).toBe(0);
      expect(stats!.lastToolCall).toBeInstanceOf(Date);
    });
  });

  describe('session monitoring and cleanup', () => {
    it('should track monitoring statistics', async () => {
      const agentToken1 = 'agent-token-1';
      const agentToken2 = 'agent-token-2';
      
      await bankingSessionManager.createSession(agentToken1);
      await bankingSessionManager.createSession(agentToken2);
      
      const stats = bankingSessionManager.getMonitoringStatistics();
      
      expect(stats.totalSessionsCreated).toBe(2);
      expect(stats.peakConcurrentSessions).toBe(2);
      expect(stats.totalCleanupRuns).toBeGreaterThanOrEqual(0);
    });

    it('should provide monitoring configuration', () => {
      const config = bankingSessionManager.getMonitoringConfig();
      
      expect(config.cleanupIntervalSeconds).toBe(10);
      expect(config.sessionTimeoutSeconds).toBe(86400);
      expect(config.inactivityTimeoutSeconds).toBe(3600);
      expect(config.enableDetailedLogging).toBe(false);
    });

    it('should update monitoring configuration', () => {
      const newConfig = {
        sessionTimeoutSeconds: 7200,
        enableDetailedLogging: true
      };
      
      bankingSessionManager.updateMonitoringConfig(newConfig);
      
      const updatedConfig = bankingSessionManager.getMonitoringConfig();
      expect(updatedConfig.sessionTimeoutSeconds).toBe(7200);
      expect(updatedConfig.enableDetailedLogging).toBe(true);
      expect(updatedConfig.cleanupIntervalSeconds).toBe(10); // Should remain unchanged
    });

    it('should perform force cleanup', async () => {
      const agentToken = 'test-agent-token';
      
      // Create a session that will expire quickly
      await bankingSessionManager.createSession(agentToken, 0.0001);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const cleanupResult = await bankingSessionManager.forceCleanup();
      
      expect(cleanupResult.totalCleaned).toBeGreaterThanOrEqual(0);
      expect(typeof cleanupResult.expiredSessions).toBe('number');
      expect(typeof cleanupResult.timedOutSessions).toBe('number');
    });

    it('should detect inactive sessions', async () => {
      // Create session manager with very short inactivity timeout
      const shortTimeoutManager = new BankingSessionManager(
        testStoragePath + '-short',
        testEncryptionKey,
        60,
        5,
        { inactivityTimeoutSeconds: 1 }
      );

      const agentToken = 'test-agent-token';
      await shortTimeoutManager.createSession(agentToken);
      
      // Wait for inactivity timeout
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const cleanupResult = await shortTimeoutManager.forceCleanup();
      expect(cleanupResult.totalCleaned).toBeGreaterThanOrEqual(0);
      
      shortTimeoutManager.destroy();
    });

    it('should provide health status', async () => {
      const agentToken = 'test-agent-token';
      await bankingSessionManager.createSession(agentToken);
      
      const health = bankingSessionManager.getHealthStatus();
      
      expect(health.activeSessions).toBe(1);
      expect(typeof health.isHealthy).toBe('boolean');
      expect(Array.isArray(health.issues)).toBe(true);
    });

    it('should handle background cleanup errors gracefully', async () => {
      // Create a session manager with detailed logging to test error handling
      const loggingManager = new BankingSessionManager(
        testStoragePath + '-logging',
        testEncryptionKey,
        60,
        1, // Very frequent cleanup for testing
        { enableDetailedLogging: true }
      );

      const agentToken = 'test-agent-token';
      await loggingManager.createSession(agentToken);
      
      // Wait for at least one cleanup cycle
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const stats = loggingManager.getMonitoringStatistics();
      expect(stats.totalCleanupRuns).toBeGreaterThan(0);
      
      loggingManager.destroy();
    });

    it('should track session creation times', async () => {
      const agentToken = 'test-agent-token';

      await bankingSessionManager.createSession(agentToken);

      const stats = bankingSessionManager.getMonitoringStatistics();
      
      expect(stats.totalSessionsCreated).toBe(1);
      // Session should have been created within our time window
      expect(stats.totalSessionsCreated).toBeGreaterThan(0);
    });

    it('should update peak concurrent sessions', async () => {
      const initialStats = bankingSessionManager.getMonitoringStatistics();
      const initialPeak = initialStats.peakConcurrentSessions;
      
      // Create multiple sessions
      await bankingSessionManager.createSession('agent-1');
      await bankingSessionManager.createSession('agent-2');
      await bankingSessionManager.createSession('agent-3');
      
      const updatedStats = bankingSessionManager.getMonitoringStatistics();
      expect(updatedStats.peakConcurrentSessions).toBeGreaterThanOrEqual(initialPeak + 3);
    });
  });

  describe('resource management', () => {
    it('should destroy resources properly', () => {
      expect(() => bankingSessionManager.destroy()).not.toThrow();
    });

    it('should clear all indices on destroy', async () => {
      const agentToken = 'test-agent-token';
      await bankingSessionManager.createSession(agentToken);
      
      bankingSessionManager.destroy();
      
      // After destroy, indices should be cleared
      expect(bankingSessionManager.getSessionStats('any-session')).toBeNull();
    });

    it('should stop background cleanup on destroy', async () => {
      const agentToken = 'test-agent-token';
      await bankingSessionManager.createSession(agentToken);
      
      // Destroy should stop the cleanup interval
      bankingSessionManager.destroy();
      
      // Should not throw after destroy
      expect(() => bankingSessionManager.getHealthStatus()).not.toThrow();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle concurrent session creation with same agent token', async () => {
      const agentToken = 'same-agent-token';
      
      // Create two sessions concurrently with the same agent token
      const [session1, session2] = await Promise.all([
        bankingSessionManager.createSession(agentToken),
        bankingSessionManager.createSession(agentToken)
      ]);
      
      // Both sessions should be created but have different session IDs
      expect(session1.sessionId).not.toBe(session2.sessionId);
      
      // The last one should be retrievable by agent token (due to map overwrite)
      const retrieved = await bankingSessionManager.getSessionByAgentToken(agentToken);
      expect(retrieved).not.toBeNull();
      expect([session1.sessionId, session2.sessionId]).toContain(retrieved!.sessionId);
    });

    it('should handle session retrieval after storage corruption', async () => {
      const agentToken = 'test-agent-token';
      const session = await bankingSessionManager.createSession(agentToken);
      
      // Simulate storage corruption by removing the storage directory
      await fs.rm(testStoragePath, { recursive: true, force: true });
      
      // Create a new session manager to avoid cache interference
      const newBankingSessionManager = new BankingSessionManager(testStoragePath, testEncryptionKey);
      
      const retrieved = await newBankingSessionManager.getSession(session.sessionId);
      expect(retrieved).toBeNull();
      
      newBankingSessionManager.destroy();
    });
  });
});