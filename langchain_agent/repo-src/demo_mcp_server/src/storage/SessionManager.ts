import { IEncryptedTokenStorage, ITokenCache } from './interfaces';
import { EncryptedTokenStorage } from './EncryptedTokenStorage';
import { TokenCache } from './TokenCache';

/**
 * Session data structure
 */
export interface SessionData {
  sessionId: string;
  agentTokenHash: string;
  userTokens?: any;
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
}

/**
 * Session management with encrypted storage and caching
 */
export class SessionManager {
  private storage: IEncryptedTokenStorage;
  private cache: ITokenCache;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    storagePath: string,
    encryptionKey: string,
    cacheTTLSeconds: number = 3600,
    cleanupIntervalSeconds: number = 300
  ) {
    this.storage = new EncryptedTokenStorage(storagePath, encryptionKey);
    this.cache = new TokenCache(cacheTTLSeconds, cleanupIntervalSeconds);

    // Start cleanup interval for expired sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, cleanupIntervalSeconds * 1000);
  }

  /**
   * Create a new session
   */
  async createSession(sessionId: string, agentTokenHash: string, expirationHours: number = 24): Promise<SessionData> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (expirationHours * 60 * 60 * 1000));

    const sessionData: SessionData = {
      sessionId,
      agentTokenHash,
      createdAt: now,
      lastActivity: now,
      expiresAt
    };

    // Store in persistent storage
    await this.storage.store(sessionId, sessionData);
    
    // Cache for quick access
    this.cache.set(sessionId, sessionData, expirationHours * 3600);

    return sessionData;
  }

  /**
   * Get session data
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    // Try cache first
    let sessionData = this.cache.get(sessionId);
    
    if (!sessionData) {
      // Fallback to storage
      sessionData = await this.storage.retrieve(sessionId);
      
      if (sessionData) {
        // Update cache
        const ttlSeconds = Math.max(0, Math.floor((new Date(sessionData.expiresAt).getTime() - Date.now()) / 1000));
        this.cache.set(sessionId, sessionData, ttlSeconds);
      }
    }

    if (!sessionData) {
      return null;
    }

    // Check if session has expired
    if (new Date() > new Date(sessionData.expiresAt)) {
      await this.removeSession(sessionId);
      return null;
    }

    return sessionData;
  }

  /**
   * Update session with user tokens
   */
  async updateSessionWithUserTokens(sessionId: string, userTokens: any): Promise<void> {
    const sessionData = await this.getSession(sessionId);
    
    if (!sessionData) {
      throw new Error('Session not found');
    }

    sessionData.userTokens = userTokens;
    sessionData.lastActivity = new Date();

    // Update both storage and cache
    await this.storage.store(sessionId, sessionData);
    
    const ttlSeconds = Math.max(0, Math.floor((new Date(sessionData.expiresAt).getTime() - Date.now()) / 1000));
    this.cache.set(sessionId, sessionData, ttlSeconds);
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(sessionId: string): Promise<void> {
    const sessionData = await this.getSession(sessionId);
    
    if (!sessionData) {
      return;
    }

    sessionData.lastActivity = new Date();

    // Update both storage and cache
    await this.storage.store(sessionId, sessionData);
    
    const ttlSeconds = Math.max(0, Math.floor((new Date(sessionData.expiresAt).getTime() - Date.now()) / 1000));
    this.cache.set(sessionId, sessionData, ttlSeconds);
  }

  /**
   * Remove a session
   */
  async removeSession(sessionId: string): Promise<void> {
    await this.storage.remove(sessionId);
    this.cache.delete(sessionId);
  }

  /**
   * Check if session exists
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    if (this.cache.has(sessionId)) {
      return true;
    }
    
    return await this.storage.exists(sessionId);
  }

  /**
   * Get session by agent token hash
   */
  async getSessionByAgentToken(_agentTokenHash: string): Promise<SessionData | null> {
    // This is a simplified implementation for testing
    // In production, this would need proper indexing
    
    // For now, we'll maintain a simple in-memory mapping
    // This is not ideal but works for the current implementation
    
    // Since we can't efficiently scan all sessions with the current storage design,
    // we'll return null for now. This method would need a proper index in production.
    return null;
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      // Clean up storage
      await this.storage.cleanup();
      
      // Clean up cache
      this.cache.cleanup();
    } catch (error) {
      console.error('Failed to cleanup expired sessions:', error);
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    cacheStats: any;
  }> {
    // For now, return basic stats since we can't efficiently scan all sessions
    // with the current storage design
    const allKeys = await this.storage.getAllKeys();
    
    return {
      totalSessions: allKeys.length,
      activeSessions: 0, // Would need proper implementation with indexing
      cacheStats: this.cache.getStats()
    };
  }

  /**
   * Destroy the session manager and cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.cache && typeof (this.cache as any).destroy === 'function') {
      (this.cache as any).destroy();
    }
  }
}