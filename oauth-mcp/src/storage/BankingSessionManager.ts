import { SessionManager, SessionData } from './SessionManager';
import { createHash, randomBytes } from 'crypto';

/**
 * CIBA pending authentication request stored in session
 */
export interface CIBAPendingRequest {
  authReqId: string;
  initiatedAt: number;    // epoch ms
  expiresAt: number;      // epoch ms
  interval: number;       // poll interval in seconds
  userEmail: string;
  requiredScope: string;
}

/**
 * Banking-specific session data structure
 */
export interface BankingSession extends SessionData {
  userTokens?: UserTokens[];
  sessionStats?: SessionStats;
  /** Email address of the authenticated user — injected at connection time for CIBA. */
  userEmail?: string;
  /** Token exchange mode detected at session creation. Informational. */
  tokenMode?: 'rfc_8693' | 'transaction_tokens';
  /** Transaction ID from Transaction Tokens draft (txn_id claim). Undefined in RFC 8693 mode. */
  transactionId?: string;
  /** Transaction scope/intent from Transaction Tokens (txn_scope claim). */
  transactionScope?: string;
}

/**
 * User token information for banking operations
 */
export interface UserTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
  issuedAt: Date;
}

/**
 * Session statistics for monitoring
 */
export interface SessionStats {
  toolCallCount: number;
  lastToolCall?: Date;
  authChallengeCount: number;
  lastAuthChallenge?: Date;
  bankingApiCallCount: number;
  lastBankingApiCall?: Date;
}

/**
 * Session monitoring configuration
 */
export interface SessionMonitoringConfig {
  cleanupIntervalSeconds: number;
  sessionTimeoutSeconds: number;
  inactivityTimeoutSeconds: number;
  enableDetailedLogging: boolean;
}

/**
 * Session monitoring statistics
 */
export interface SessionMonitoringStats {
  totalSessionsCreated: number;
  totalSessionsExpired: number;
  totalSessionsTimedOut: number;
  totalCleanupRuns: number;
  lastCleanupTime?: Date;
  averageSessionDuration: number;
  peakConcurrentSessions: number;
}

/**
 * Banking-specific session manager that extends the base SessionManager
 * with banking-specific functionality for agent token to user token correlation
 */
export class BankingSessionManager {
  private sessionManager: SessionManager;
  private agentTokenIndex: Map<string, string> = new Map(); // agentTokenHash -> sessionId
  private sessionStats: Map<string, SessionStats> = new Map(); // sessionId -> stats
  private monitoringConfig: SessionMonitoringConfig;
  private monitoringStats: SessionMonitoringStats;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private sessionCreationTimes: Map<string, Date> = new Map(); // sessionId -> creation time
  /** In-memory CIBA request store keyed by "sessionId::authReqId" */
  private cibaRequests: Map<string, CIBAPendingRequest> = new Map();
  /** User email per session — set at connection time from the frontend */
  private sessionEmails: Map<string, string> = new Map(); // sessionId -> email

  constructor(
    storagePath: string,
    encryptionKey: string,
    cacheTTLSeconds: number = 3600,
    cleanupIntervalSeconds: number = 300,
    monitoringConfig?: Partial<SessionMonitoringConfig>
  ) {
    this.sessionManager = new SessionManager(
      storagePath,
      encryptionKey,
      cacheTTLSeconds,
      cleanupIntervalSeconds
    );

    this.monitoringConfig = {
      cleanupIntervalSeconds: cleanupIntervalSeconds,
      sessionTimeoutSeconds: 86400, // 24 hours
      inactivityTimeoutSeconds: 3600, // 1 hour
      enableDetailedLogging: false,
      ...monitoringConfig
    };

    this.monitoringStats = {
      totalSessionsCreated: 0,
      totalSessionsExpired: 0,
      totalSessionsTimedOut: 0,
      totalCleanupRuns: 0,
      averageSessionDuration: 0,
      peakConcurrentSessions: 0
    };

    // Start background cleanup task
    this.startBackgroundCleanup();
  }

  /**
   * Create a new banking session with agent token correlation
   */
  async createSession(
    agentToken: string,
    expirationHours: number = 24,
    tokenMode?: 'rfc_8693' | 'transaction_tokens',
    transactionId?: string,
    transactionScope?: string
  ): Promise<BankingSession> {
    const sessionId = this.generateSessionId();
    const agentTokenHash = this.hashAgentToken(agentToken);

    const sessionData = await this.sessionManager.createSession(
      sessionId,
      agentTokenHash,
      expirationHours
    );

    // Create banking session with initial stats and optional transaction context
    const bankingSession: BankingSession = {
      ...sessionData,
      sessionStats: {
        toolCallCount: 0,
        authChallengeCount: 0,
        bankingApiCallCount: 0
      },
      ...(tokenMode && { tokenMode }),
      ...(transactionId && { transactionId }),
      ...(transactionScope && { transactionScope }),
    };

    // Index agent token for quick lookup
    this.agentTokenIndex.set(agentTokenHash, sessionId);
    this.sessionStats.set(sessionId, bankingSession.sessionStats!);
    this.sessionCreationTimes.set(sessionId, new Date());

    // Update monitoring stats
    this.monitoringStats.totalSessionsCreated++;
    const currentSessions = this.agentTokenIndex.size;
    if (currentSessions > this.monitoringStats.peakConcurrentSessions) {
      this.monitoringStats.peakConcurrentSessions = currentSessions;
    }

    if (this.monitoringConfig.enableDetailedLogging) {
      console.log(`[BankingSessionManager] Created session ${sessionId} for agent token hash ${agentTokenHash.substring(0, 8)}... tokenMode=${tokenMode || 'rfc_8693'}` + (transactionId ? ` txn_id=${transactionId}` : ''));
    }

    return bankingSession;
  }

  /**
   * Get banking session by session ID
   */
  async getSession(sessionId: string): Promise<BankingSession | null> {
    const sessionData = await this.sessionManager.getSession(sessionId);
    
    if (!sessionData) {
      return null;
    }

    // Enhance with banking-specific data
    const bankingSession: BankingSession = {
      ...sessionData,
      sessionStats: this.sessionStats.get(sessionId) || {
        toolCallCount: 0,
        authChallengeCount: 0,
        bankingApiCallCount: 0
      }
    };

    return bankingSession;
  }

  /**
   * Get session by agent token
   */
  async getSessionByAgentToken(agentToken: string): Promise<BankingSession | null> {
    const agentTokenHash = this.hashAgentToken(agentToken);
    const sessionId = this.agentTokenIndex.get(agentTokenHash);
    
    if (!sessionId) {
      return null;
    }

    return this.getSession(sessionId);
  }

  /**
   * Associate user tokens with a banking session
   */
  async associateUserTokens(sessionId: string, userTokens: UserTokens): Promise<void> {
    const session = await this.getSession(sessionId);
    
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Validate user tokens
    this.validateUserTokens(userTokens);

    // Get existing tokens array or create new one
    const existingTokens = session.userTokens || [];
    
    // Check if we already have tokens for this scope
    const existingTokenIndex = existingTokens.findIndex(tokens => tokens.scope === userTokens.scope);
    
    if (existingTokenIndex >= 0) {
      // Replace existing tokens for this scope
      existingTokens[existingTokenIndex] = userTokens;
    } else {
      // Add new tokens for this scope
      existingTokens.push(userTokens);
    }

    // Update session with token array
    await this.sessionManager.updateSessionWithUserTokens(sessionId, existingTokens);
  }

  /**
   * Update session activity and statistics
   */
  async updateSessionActivity(sessionId: string, activityType?: 'tool_call' | 'auth_challenge' | 'banking_api_call'): Promise<void> {
    await this.sessionManager.updateSessionActivity(sessionId);

    // Update statistics if activity type is provided
    if (activityType) {
      const stats = this.sessionStats.get(sessionId);
      if (stats) {
        const now = new Date();
        
        switch (activityType) {
          case 'tool_call':
            stats.toolCallCount++;
            stats.lastToolCall = now;
            break;
          case 'auth_challenge':
            stats.authChallengeCount++;
            stats.lastAuthChallenge = now;
            break;
          case 'banking_api_call':
            stats.bankingApiCallCount++;
            stats.lastBankingApiCall = now;
            break;
        }
        
        this.sessionStats.set(sessionId, stats);
      }
    }
  }

  /**
   * Validate session and check if user authorization is required
   */
  async validateSession(sessionId: string): Promise<{
    isValid: boolean;
    requiresUserAuth: boolean;
    session?: BankingSession;
    error?: string;
  }> {
    // First check if session exists in storage without using getSession
    // to avoid automatic cleanup interfering with our validation logic
    const sessionData = await this.sessionManager['storage'].retrieve(sessionId);
    
    if (!sessionData) {
      return {
        isValid: false,
        requiresUserAuth: false,
        error: 'Session not found'
      };
    }

    // Check if session has expired
    if (new Date() > new Date(sessionData.expiresAt)) {
      await this.removeSession(sessionId);
      return {
        isValid: false,
        requiresUserAuth: false,
        error: 'Session expired'
      };
    }

    // Get the full session data
    const session = await this.getSession(sessionId);
    
    if (!session) {
      return {
        isValid: false,
        requiresUserAuth: false,
        error: 'Session not found'
      };
    }

    // Check if user tokens are present and valid
    const requiresUserAuth = !session.userTokens || 
                             session.userTokens.length === 0 || 
                             session.userTokens.every(tokens => this.isUserTokenExpired(tokens));

    return {
      isValid: true,
      requiresUserAuth,
      session
    };
  }

  /**
   * Remove a banking session
   */
  async removeSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    
    if (session) {
      // Remove from agent token index
      this.agentTokenIndex.delete(session.agentTokenHash);
      // Remove session stats
      this.sessionStats.delete(sessionId);
      // Clean up sessionEmails and cibaRequests to prevent memory leaks
      this.sessionEmails.delete(sessionId);
      // Remove any CIBA requests associated with this session
      for (const [key, _] of this.cibaRequests.entries()) {
        if (key.startsWith(`${sessionId}::`)) {
          this.cibaRequests.delete(key);
        }
      }
      // Keep creation time for duration calculation
      // this.sessionCreationTimes.delete(sessionId); // Keep for stats calculation

      if (this.monitoringConfig.enableDetailedLogging) {
        console.log(`[BankingSessionManager] Removed session ${sessionId}`);
      }
    }

    await this.sessionManager.removeSession(sessionId);
  }

  /**
   * Check if session exists
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    return this.sessionManager.sessionExists(sessionId);
  }

  /**
   * Clean up expired sessions and update indices
   */
  async cleanupExpiredSessions(): Promise<void> {
    // Get all sessions before cleanup to update indices
    const allKeys = await this.sessionManager['storage'].getAllKeys();
    const expiredSessions: string[] = [];

    for (const sessionId of allKeys) {
      const session = await this.sessionManager.getSession(sessionId);
      if (!session) {
        expiredSessions.push(sessionId);
      }
    }

    // Clean up expired sessions from indices
    for (const sessionId of expiredSessions) {
      const session = await this.sessionManager['storage'].retrieve(sessionId);
      if (session && session.agentTokenHash) {
        this.agentTokenIndex.delete(session.agentTokenHash);
      }
      this.sessionStats.delete(sessionId);
    }

    // Perform base cleanup
    await this.sessionManager.cleanupExpiredSessions();
  }

  /**
   * Get comprehensive session statistics
   */
  async getSessionStatistics(): Promise<{
    totalSessions: number;
    activeSessions: number;
    sessionsWithUserTokens: number;
    totalToolCalls: number;
    totalAuthChallenges: number;
    totalBankingApiCalls: number;
    cacheStats: any;
  }> {
    const baseStats = await this.sessionManager.getSessionStats();
    
    let sessionsWithUserTokens = 0;
    let totalToolCalls = 0;
    let totalAuthChallenges = 0;
    let totalBankingApiCalls = 0;

    // Count sessions with user tokens and aggregate statistics
    for (const [sessionId, stats] of this.sessionStats.entries()) {
      const session = await this.getSession(sessionId);
      if (session && session.userTokens && session.userTokens.length > 0) {
        sessionsWithUserTokens++;
      }
      
      totalToolCalls += stats.toolCallCount;
      totalAuthChallenges += stats.authChallengeCount;
      totalBankingApiCalls += stats.bankingApiCallCount;
    }

    return {
      totalSessions: baseStats.totalSessions,
      activeSessions: this.agentTokenIndex.size,
      sessionsWithUserTokens,
      totalToolCalls,
      totalAuthChallenges,
      totalBankingApiCalls,
      cacheStats: baseStats.cacheStats
    };
  }

  /**
   * Get session statistics for a specific session
   */
  getSessionStats(sessionId: string): SessionStats | null {
    return this.sessionStats.get(sessionId) || null;
  }

  /**
   * Start background cleanup task
   */
  private startBackgroundCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(async () => {
      try {
        await this.performBackgroundCleanup();
      } catch (error) {
        console.error('[BankingSessionManager] Background cleanup failed:', error);
      }
    }, this.monitoringConfig.cleanupIntervalSeconds * 1000);

    if (this.monitoringConfig.enableDetailedLogging) {
      console.log(`[BankingSessionManager] Started background cleanup with interval ${this.monitoringConfig.cleanupIntervalSeconds}s`);
    }
  }

  /**
   * Perform comprehensive background cleanup
   */
  private async performBackgroundCleanup(): Promise<void> {
    const startTime = Date.now();
    let expiredCount = 0;
    let timedOutCount = 0;

    if (this.monitoringConfig.enableDetailedLogging) {
      console.log('[BankingSessionManager] Starting background cleanup...');
    }

    // Get all session IDs to check
    const sessionIds = Array.from(this.agentTokenIndex.values());
    
    for (const sessionId of sessionIds) {
      try {
        const session = await this.getSession(sessionId);
        
        if (!session) {
          // Session was already cleaned up
          continue;
        }

        const now = new Date();
        const isExpired = now > session.expiresAt;
        const isInactive = this.isSessionInactive(session);
        const isTimedOut = this.isSessionTimedOut(session);

        if (isExpired || isInactive || isTimedOut) {
          await this.removeSession(sessionId);
          
          if (isExpired) {
            expiredCount++;
            this.monitoringStats.totalSessionsExpired++;
          } else if (isInactive || isTimedOut) {
            timedOutCount++;
            this.monitoringStats.totalSessionsTimedOut++;
          }

          if (this.monitoringConfig.enableDetailedLogging) {
            const reason = isExpired ? 'expired' : (isInactive ? 'inactive' : 'timed out');
            console.log(`[BankingSessionManager] Cleaned up ${reason} session ${sessionId}`);
          }
        }
      } catch (error) {
        console.error(`[BankingSessionManager] Error cleaning up session ${sessionId}:`, error);
      }
    }

    // Update monitoring stats
    this.monitoringStats.totalCleanupRuns++;
    this.monitoringStats.lastCleanupTime = new Date();
    this.updateAverageSessionDuration();

    // Perform base cleanup
    await this.sessionManager.cleanupExpiredSessions();

    const duration = Date.now() - startTime;
    
    if (this.monitoringConfig.enableDetailedLogging || expiredCount > 0 || timedOutCount > 0) {
      console.log(`[BankingSessionManager] Cleanup completed in ${duration}ms. Expired: ${expiredCount}, Timed out: ${timedOutCount}`);
    }
  }

  /**
   * Check if session is inactive based on last activity
   */
  private isSessionInactive(session: BankingSession): boolean {
    const inactivityThreshold = new Date(Date.now() - (this.monitoringConfig.inactivityTimeoutSeconds * 1000));
    return session.lastActivity < inactivityThreshold;
  }

  /**
   * Check if session has timed out based on total duration
   */
  private isSessionTimedOut(session: BankingSession): boolean {
    const timeoutThreshold = new Date(session.createdAt.getTime() + (this.monitoringConfig.sessionTimeoutSeconds * 1000));
    return new Date() > timeoutThreshold;
  }

  /**
   * Update average session duration statistic
   */
  private updateAverageSessionDuration(): void {
    const completedSessions = this.monitoringStats.totalSessionsExpired + this.monitoringStats.totalSessionsTimedOut;
    
    if (completedSessions === 0) {
      this.monitoringStats.averageSessionDuration = 0;
      return;
    }

    let totalDuration = 0;
    let sessionCount = 0;

    // Calculate average from recently completed sessions
    // This is a simplified calculation - in production, you'd want to track this more precisely
    for (const [sessionId, creationTime] of this.sessionCreationTimes.entries()) {
      if (!this.agentTokenIndex.has(this.hashAgentToken(sessionId))) {
        // Session has been removed
        const duration = Date.now() - creationTime.getTime();
        totalDuration += duration;
        sessionCount++;
      }
    }

    if (sessionCount > 0) {
      this.monitoringStats.averageSessionDuration = Math.round(totalDuration / sessionCount / 1000); // in seconds
    }
  }

  /**
   * Get detailed monitoring statistics
   */
  getMonitoringStatistics(): SessionMonitoringStats {
    return { ...this.monitoringStats };
  }

  /**
   * Get current monitoring configuration
   */
  getMonitoringConfig(): SessionMonitoringConfig {
    return { ...this.monitoringConfig };
  }

  /**
   * Update monitoring configuration
   */
  updateMonitoringConfig(config: Partial<SessionMonitoringConfig>): void {
    const oldInterval = this.monitoringConfig.cleanupIntervalSeconds;
    this.monitoringConfig = { ...this.monitoringConfig, ...config };

    // Restart cleanup if interval changed
    if (config.cleanupIntervalSeconds && config.cleanupIntervalSeconds !== oldInterval) {
      this.startBackgroundCleanup();
    }

    if (this.monitoringConfig.enableDetailedLogging) {
      console.log('[BankingSessionManager] Updated monitoring configuration:', config);
    }
  }

  /**
   * Force immediate cleanup (useful for testing or manual maintenance)
   */
  async forceCleanup(): Promise<{
    expiredSessions: number;
    timedOutSessions: number;
    totalCleaned: number;
  }> {
    const beforeStats = { ...this.monitoringStats };
    await this.performBackgroundCleanup();
    const afterStats = { ...this.monitoringStats };

    return {
      expiredSessions: afterStats.totalSessionsExpired - beforeStats.totalSessionsExpired,
      timedOutSessions: afterStats.totalSessionsTimedOut - beforeStats.totalSessionsTimedOut,
      totalCleaned: (afterStats.totalSessionsExpired + afterStats.totalSessionsTimedOut) - 
                   (beforeStats.totalSessionsExpired + beforeStats.totalSessionsTimedOut)
    };
  }

  /**
   * Get health status of the session manager
   */
  getHealthStatus(): {
    isHealthy: boolean;
    activeSessions: number;
    lastCleanup?: Date;
    issues: string[];
  } {
    const issues: string[] = [];
    const activeSessions = this.agentTokenIndex.size;

    // Check if cleanup is running
    if (!this.monitoringStats.lastCleanupTime) {
      issues.push('No cleanup has been performed yet');
    } else {
      const timeSinceLastCleanup = Date.now() - this.monitoringStats.lastCleanupTime.getTime();
      const expectedInterval = this.monitoringConfig.cleanupIntervalSeconds * 1000 * 2; // Allow 2x interval
      
      if (timeSinceLastCleanup > expectedInterval) {
        issues.push(`Last cleanup was ${Math.round(timeSinceLastCleanup / 1000)}s ago (expected every ${this.monitoringConfig.cleanupIntervalSeconds}s)`);
      }
    }

    // Check for excessive sessions
    if (activeSessions > 1000) {
      issues.push(`High number of active sessions: ${activeSessions}`);
    }

    return {
      isHealthy: issues.length === 0,
      activeSessions,
      lastCleanup: this.monitoringStats.lastCleanupTime,
      issues
    };
  }

  /**
   * Destroy the banking session manager and cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.agentTokenIndex.clear();
    this.sessionStats.clear();
    this.sessionCreationTimes.clear();
    this.sessionManager.destroy();

    if (this.monitoringConfig.enableDetailedLogging) {
      console.log('[BankingSessionManager] Destroyed session manager and cleaned up resources');
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    // Cryptographically random — Math.random() is predictable and these ids are
    // accepted as a credential-ish lookup key (e.g. /auth/status?sessionId=).
    const timestamp = Date.now().toString();
    const random = randomBytes(16).toString('hex');
    return `banking_session_${timestamp}_${random}`;
  }

  /**
   * Hash agent token for secure storage and indexing
   */
  private hashAgentToken(agentToken: string): string {
    return createHash('sha256').update(agentToken).digest('hex');
  }

  /**
   * Validate user tokens structure
   */
  private validateUserTokens(userTokens: UserTokens): void {
    if (!userTokens.accessToken || typeof userTokens.accessToken !== 'string') {
      throw new Error('Invalid access token');
    }
    
    if (!userTokens.refreshToken || typeof userTokens.refreshToken !== 'string') {
      throw new Error('Invalid refresh token');
    }
    
    if (!userTokens.tokenType || typeof userTokens.tokenType !== 'string') {
      throw new Error('Invalid token type');
    }
    
    if (typeof userTokens.expiresIn !== 'number' || userTokens.expiresIn <= 0) {
      throw new Error('Invalid expires in value');
    }
    
    if (!userTokens.scope || typeof userTokens.scope !== 'string') {
      throw new Error('Invalid scope');
    }
    
    if (!(userTokens.issuedAt instanceof Date)) {
      throw new Error('Invalid issued at date');
    }
  }

  /**
   * Check if user token has expired
   */
  private isUserTokenExpired(userTokens: UserTokens): boolean {
    const expirationTime = new Date(userTokens.issuedAt.getTime() + (userTokens.expiresIn * 1000));
    return new Date() >= expirationTime;
  }

  /**
   * Find user tokens that contain the required scopes
   */
  findTokensForScopes(session: BankingSession, requiredScopes: string[]): UserTokens | null {
    if (!session.userTokens || session.userTokens.length === 0) {
      return null;
    }

    // Find tokens that have all required scopes and are not expired
    for (const tokens of session.userTokens) {
      if (this.isUserTokenExpired(tokens)) {
        continue;
      }

      const tokenScopes = tokens.scope.split(' ');
      const hasAllScopes = requiredScopes.every(scope => tokenScopes.includes(scope));
      
      if (hasAllScopes) {
        return tokens;
      }
    }

    return null;
  }

  /**
   * Check if session has valid tokens for the required scopes
   */
  hasValidTokensForScopes(session: BankingSession, requiredScopes: string[]): boolean {
    return this.findTokensForScopes(session, requiredScopes) !== null;
  }

  /**
   * Get all valid (non-expired) scopes from session tokens
   */
  getValidScopes(session: BankingSession): string[] {
    if (!session.userTokens || session.userTokens.length === 0) {
      return [];
    }

    const allScopes = new Set<string>();
    
    for (const tokens of session.userTokens) {
      if (!this.isUserTokenExpired(tokens)) {
        const tokenScopes = tokens.scope.split(' ');
        tokenScopes.forEach(scope => allScopes.add(scope));
      }
    }

    return Array.from(allScopes);
  }

  /**
   * Remove expired tokens from session
   */
  async cleanupExpiredTokens(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    
    if (!session || !session.userTokens || session.userTokens.length === 0) {
      return;
    }

    const validTokens = session.userTokens.filter(tokens => !this.isUserTokenExpired(tokens));
    
    if (validTokens.length !== session.userTokens.length) {
      await this.sessionManager.updateSessionWithUserTokens(sessionId, validTokens);
      
      if (this.monitoringConfig.enableDetailedLogging) {
        console.log(`[BankingSessionManager] Cleaned up ${session.userTokens.length - validTokens.length} expired token sets from session ${sessionId}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CIBA request tracking
  // ---------------------------------------------------------------------------

  /** Store a CIBA pending request in memory keyed by sessionId + authReqId. */
  storeCIBARequest(sessionId: string, request: CIBAPendingRequest): void {
    this.cibaRequests.set(`${sessionId}::${request.authReqId}`, request);
    // Also record the email for this session
    if (request.userEmail) {
      this.sessionEmails.set(sessionId, request.userEmail);
    }
  }

  /** Retrieve a pending CIBA request (null if expired or not found). */
  getCIBARequest(sessionId: string, authReqId: string): CIBAPendingRequest | null {
    const key = `${sessionId}::${authReqId}`;
    const request = this.cibaRequests.get(key);
    if (!request) return null;
    if (Date.now() > request.expiresAt) {
      this.cibaRequests.delete(key);
      return null;
    }
    return request;
  }

  /** Remove a completed or cancelled CIBA request. */
  deleteCIBARequest(sessionId: string, authReqId: string): void {
    this.cibaRequests.delete(`${sessionId}::${authReqId}`);
  }

  // ---------------------------------------------------------------------------
  // User email per session
  // ---------------------------------------------------------------------------

  /** Record the authenticated user's email for a session (injected at connection time). */
  setSessionEmail(sessionId: string, email: string): void {
    this.sessionEmails.set(sessionId, email);
  }

  /** Retrieve the email associated with a session, or undefined. */
  getSessionEmail(sessionId: string): string | undefined {
    return this.sessionEmails.get(sessionId);
  }
}