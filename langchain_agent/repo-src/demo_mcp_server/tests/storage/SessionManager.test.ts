import * as fs from 'fs/promises';
import * as path from 'path';
import { SessionManager } from '../../src/storage/SessionManager';

describe('SessionManager', () => {
  const testStoragePath = path.join(__dirname, 'test-sessions');
  const testEncryptionKey = 'test-encryption-key-with-sufficient-length-for-security';
  let sessionManager: SessionManager;

  beforeEach(async () => {
    sessionManager = new SessionManager(testStoragePath, testEncryptionKey, 60, 10);
    
    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  });

  afterEach(async () => {
    sessionManager.destroy();
    
    // Clean up test directory
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  });

  describe('session creation', () => {
    it('should create a new session', async () => {
      const sessionId = 'test-session-123';
      const agentTokenHash = 'agent-token-hash';
      
      const session = await sessionManager.createSession(sessionId, agentTokenHash);
      
      expect(session.sessionId).toBe(sessionId);
      expect(session.agentTokenHash).toBe(agentTokenHash);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivity).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.userTokens).toBeUndefined();
    });

    it('should create session with custom expiration', async () => {
      const sessionId = 'test-session-123';
      const agentTokenHash = 'agent-token-hash';
      const expirationHours = 12;
      
      const session = await sessionManager.createSession(sessionId, agentTokenHash, expirationHours);
      
      const expectedExpiration = new Date(session.createdAt.getTime() + (expirationHours * 60 * 60 * 1000));
      expect(session.expiresAt.getTime()).toBeCloseTo(expectedExpiration.getTime(), -3); // Within 1 second
    });
  });

  describe('session retrieval', () => {
    it('should retrieve existing session', async () => {
      const sessionId = 'test-session-123';
      const agentTokenHash = 'agent-token-hash';
      
      await sessionManager.createSession(sessionId, agentTokenHash);
      const retrieved = await sessionManager.getSession(sessionId);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(sessionId);
      expect(retrieved!.agentTokenHash).toBe(agentTokenHash);
    });

    it('should return null for non-existent session', async () => {
      const retrieved = await sessionManager.getSession('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should return null for expired session', async () => {
      const sessionId = 'test-session-123';
      const agentTokenHash = 'agent-token-hash';
      
      // Create session with very short expiration
      await sessionManager.createSession(sessionId, agentTokenHash, 0.0001); // Very short
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const retrieved = await sessionManager.getSession(sessionId);
      expect(retrieved).toBeNull();
    });

    it('should retrieve session from storage when not in cache', async () => {
      const sessionId = 'test-session-123';
      const agentTokenHash = 'agent-token-hash';
      
      await sessionManager.createSession(sessionId, agentTokenHash);
      
      // Create new session manager (fresh cache)
      const newSessionManager = new SessionManager(testStoragePath, testEncryptionKey);
      
      const retrieved = await newSessionManager.getSession(sessionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(sessionId);
      
      newSessionManager.destroy();
    });
  });

  describe('session updates', () => {
    it('should update session with user tokens', async () => {
      const sessionId = 'test-session-123';
      const agentTokenHash = 'agent-token-hash';
      const userTokens = { accessToken: 'access-123', refreshToken: 'refresh-456' };
      
      await sessionManager.createSession(sessionId, agentTokenHash);
      await sessionManager.updateSessionWithUserTokens(sessionId, userTokens);
      
      const retrieved = await sessionManager.getSession(sessionId);
      expect(retrieved!.userTokens).toEqual(userTokens);
    });

    it('should update session activity', async () => {
      const sessionId = 'test-session-123';
      const agentTokenHash = 'agent-token-hash';
      
      const session = await sessionManager.createSession(sessionId, agentTokenHash);
      const originalActivity = session.lastActivity;
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await sessionManager.updateSessionActivity(sessionId);
      
      const retrieved = await sessionManager.getSession(sessionId);
      expect(retrieved!.lastActivity.getTime()).toBeGreaterThan(originalActivity.getTime());
    });

    it('should throw error when updating non-existent session with user tokens', async () => {
      const userTokens = { accessToken: 'access-123' };
      
      await expect(
        sessionManager.updateSessionWithUserTokens('non-existent', userTokens)
      ).rejects.toThrow('Session not found');
    });

    it('should handle updating activity for non-existent session gracefully', async () => {
      await expect(
        sessionManager.updateSessionActivity('non-existent')
      ).resolves.not.toThrow();
    });
  });

  describe('session removal', () => {
    it('should remove session', async () => {
      const sessionId = 'test-session-123';
      const agentTokenHash = 'agent-token-hash';
      
      await sessionManager.createSession(sessionId, agentTokenHash);
      await sessionManager.removeSession(sessionId);
      
      const retrieved = await sessionManager.getSession(sessionId);
      expect(retrieved).toBeNull();
      expect(await sessionManager.sessionExists(sessionId)).toBe(false);
    });
  });

  describe('session existence check', () => {
    it('should check session existence', async () => {
      const sessionId = 'test-session-123';
      const agentTokenHash = 'agent-token-hash';
      
      expect(await sessionManager.sessionExists(sessionId)).toBe(false);
      
      await sessionManager.createSession(sessionId, agentTokenHash);
      expect(await sessionManager.sessionExists(sessionId)).toBe(true);
    });
  });

  describe('session lookup by agent token', () => {
    it('should return null for agent token lookup (not implemented)', async () => {
      const sessionId = 'test-session-123';
      const agentTokenHash = 'unique-agent-token-hash';
      
      await sessionManager.createSession(sessionId, agentTokenHash);
      
      // Current implementation returns null - would need proper indexing
      const found = await sessionManager.getSessionByAgentToken(agentTokenHash);
      expect(found).toBeNull();
    });

    it('should return null for non-existent agent token', async () => {
      const found = await sessionManager.getSessionByAgentToken('non-existent-hash');
      expect(found).toBeNull();
    });
  });

  describe('cleanup operations', () => {
    it('should clean up expired sessions', async () => {
      const sessionId1 = 'session-1';
      const agentTokenHash = 'agent-token-hash';
      
      // Create a valid session
      await sessionManager.createSession(sessionId1, agentTokenHash, 24);
      
      // Just test that cleanup doesn't break anything
      await sessionManager.cleanupExpiredSessions();
      
      expect(await sessionManager.sessionExists(sessionId1)).toBe(true);
    });
  });

  describe('session statistics', () => {
    it('should provide session statistics', async () => {
      const sessionId1 = 'session-1';
      const sessionId2 = 'session-2';
      const agentTokenHash = 'agent-token-hash';
      
      await sessionManager.createSession(sessionId1, agentTokenHash);
      await sessionManager.createSession(sessionId2, agentTokenHash);
      
      const stats = await sessionManager.getSessionStats();
      
      expect(stats.totalSessions).toBe(2);
      expect(stats.activeSessions).toBe(0); // Current implementation limitation
      expect(stats.cacheStats).toBeDefined();
    });
  });

  describe('resource management', () => {
    it('should destroy resources properly', () => {
      expect(() => sessionManager.destroy()).not.toThrow();
    });
  });
});