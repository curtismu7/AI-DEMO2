/**
 * Audit logging system for banking operations
 * Maintains detailed audit trails with user context preservation
 */

import { Logger } from './Logger.js';

export interface AuditEvent {
  eventId: string;
  timestamp: string;
  eventType: 'banking_operation' | 'authentication' | 'authorization' | 'session_management' | 'token_chain';
  operation: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  resourceId?: string;
  resourceType?: 'account' | 'transaction' | 'session' | 'token';
  outcome: 'success' | 'failure' | 'partial';
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  duration?: number;
  errorCode?: string;
  errorMessage?: string;
  /** OAuth scopes on the token used for this operation. */
  scope?: string[];
  /** Token type that authorized this operation. 'exchanged' for RFC 8693 derived tokens. */
  tokenType?: 'agent' | 'user' | 'exchanged';
  /** Sanitized summary of tool input params (no raw secrets). */
  requestSummary?: string;
  /** Outcome summary (not raw response data). */
  responseSummary?: string;
}

export interface BankingOperationAudit {
  operation: 'get_accounts' | 'get_balance' | 'get_transactions' | 'create_deposit' | 'create_withdrawal' | 'create_transfer';
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  amount?: number;
  transactionId?: string;
  balanceBefore?: number;
  balanceAfter?: number;
}

export interface AuthenticationAudit {
  operation: 'agent_token_validation' | 'user_authorization' | 'token_refresh' | 'token_revocation' | 'token_exchange';
  tokenType?: 'agent' | 'user' | 'refresh' | 'exchanged';
  scopes?: string[];
  grantType?: string;
  clientId?: string;
}

export interface SessionAudit {
  operation: 'session_create' | 'session_update' | 'session_expire' | 'session_cleanup';
  sessionDuration?: number;
  tokensAssociated?: boolean;
  cleanupReason?: string;
}

export interface UserTokenInfo {
  sub: string;              // User subject (PingOne user ID)
  scope: string[];          // Scopes on incoming token
  aud?: string | string[];  // Audience
  issuedAt: string;         // ISO timestamp
  expiresAt?: string;       // ISO timestamp or "never" if persistent
  tokenId?: string;         // jti claim (for token tracking)
}

export interface ExchangedTokenInfo {
  sub: string;              // Agent/MCP server subject (for delegation tracking)
  act?: {                   // RFC 8693 actor claim (multi-hop delegation)
    iss: string;
    sub: string;
  };
  aud?: string | string[];
  scope: string[];
  issuedAt: string;
  expiresAt?: string;
  tokenId?: string;
}

export interface TokenChainExecutionResult {
  success: boolean;
  errorCode?: string;
  duration: number;         // ms
  toolResultSummary?: string;  // e.g. "3 accounts returned", "transfer completed", etc.
  toolResultJson?: Record<string, any>;  // Full MCP tool response JSON
  toolRequestJson?: Record<string, any>;  // Tool request arguments (the params the tool was called with)
}

/**
 * Audit logger for comprehensive banking operation tracking
 */
export class AuditLogger {
  private logger: Logger;
  private static instance: AuditLogger;
  private static eventStore: AuditEvent[] = []; // In-memory audit event storage (max 1000 events)
  private static readonly MAX_EVENTS = 1000;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  private sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    const SENSITIVE = /password|secret|token|key|credential|authorization/i;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      result[k] = SENSITIVE.test(k) ? '[REDACTED]' : v;
    }
    return result;
  }

  /**
   * Store audit event in memory (replaces Redis)
   */
  private static addEventToStore(event: AuditEvent): void {
    AuditLogger.eventStore.push(event);
    // Keep only last MAX_EVENTS to prevent unbounded memory growth
    if (AuditLogger.eventStore.length > AuditLogger.MAX_EVENTS) {
      AuditLogger.eventStore.shift();
    }
  }

  private async writeToRedis(event: AuditEvent): Promise<void> {
    // Store in memory instead of Redis (Redis/Upstash removed)
    AuditLogger.addEventToStore(event);
  }

  static getInstance(logger?: Logger): AuditLogger {
    if (!AuditLogger.instance) {
      if (!logger) {
        throw new Error('Logger instance required for first initialization');
      }
      AuditLogger.instance = new AuditLogger(logger);
    }
    return AuditLogger.instance;
  }

  static clearEvents(): void {
    AuditLogger.eventStore.length = 0;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create base audit event
   */
  private createBaseAuditEvent(
    eventType: AuditEvent['eventType'],
    operation: string,
    outcome: AuditEvent['outcome'],
    context: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      resourceId?: string;
      resourceType?: AuditEvent['resourceType'];
      ipAddress?: string;
      userAgent?: string;
      duration?: number;
      errorCode?: string;
      errorMessage?: string;
    }
  ): Omit<AuditEvent, 'details'> {
    return {
      eventId: this.generateEventId(),
      timestamp: new Date().toISOString(),
      eventType,
      operation,
      outcome,
      ...context
    };
  }

  /**
   * Log banking operation audit event
   */
  async logBankingOperation(
    operation: BankingOperationAudit['operation'],
    outcome: AuditEvent['outcome'],
    context: {
      userId: string;
      agentId?: string;
      sessionId: string;
      ipAddress?: string;
      userAgent?: string;
      duration?: number;
      errorCode?: string;
      errorMessage?: string;
    },
    operationDetails: Partial<BankingOperationAudit>
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'banking_operation',
      operation,
      outcome,
      {
        ...context,
        resourceType: operationDetails.accountId ? 'account' : 'transaction',
        resourceId: operationDetails.accountId || operationDetails.transactionId
      }
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      details: {
        operation,
        ...operationDetails,
        // Ensure sensitive data is not logged
        amount: operationDetails.amount ? `$${operationDetails.amount.toFixed(2)}` : undefined
      }
    };

    await this.logger.info('Banking operation audit', {
      auditEvent,
      operation: 'audit_banking'
    });
    await this.writeToRedis(auditEvent);
  }

  /**
   * Log authentication audit event
   */
  async logAuthentication(
    operation: AuthenticationAudit['operation'],
    outcome: AuditEvent['outcome'],
    context: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      ipAddress?: string;
      userAgent?: string;
      duration?: number;
      errorCode?: string;
      errorMessage?: string;
    },
    authDetails: Partial<AuthenticationAudit>
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'authentication',
      operation,
      outcome,
      {
        ...context,
        resourceType: 'token'
      }
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      details: {
        operation,
        ...authDetails
      }
    };

    await this.logger.info('Authentication audit', {
      auditEvent,
      operation: 'audit_authentication'
    });
    await this.writeToRedis(auditEvent);
  }

  /**
   * Log authorization audit event
   */
  async logAuthorization(
    operation: string,
    outcome: AuditEvent['outcome'],
    context: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      ipAddress?: string;
      userAgent?: string;
      duration?: number;
      errorCode?: string;
      errorMessage?: string;
    },
    authzDetails: {
      requiredScopes?: string[];
      grantedScopes?: string[];
      resourceRequested?: string;
      decision?: 'allow' | 'deny';
      reason?: string;
    }
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'authorization',
      operation,
      outcome,
      context
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      details: {
        operation,
        ...authzDetails
      }
    };

    await this.logger.info('Authorization audit', {
      auditEvent,
      operation: 'audit_authorization'
    });
    await this.writeToRedis(auditEvent);
  }

  /**
   * Log session management audit event
   */
  async logSessionManagement(
    operation: SessionAudit['operation'],
    outcome: AuditEvent['outcome'],
    context: {
      userId?: string;
      agentId?: string;
      sessionId: string;
      ipAddress?: string;
      userAgent?: string;
      duration?: number;
      errorCode?: string;
      errorMessage?: string;
    },
    sessionDetails: Partial<SessionAudit>
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'session_management',
      operation,
      outcome,
      {
        ...context,
        resourceType: 'session',
        resourceId: context.sessionId
      }
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      details: {
        operation,
        ...sessionDetails
      }
    };

    await this.logger.info('Session management audit', {
      auditEvent,
      operation: 'audit_session'
    });
    await this.writeToRedis(auditEvent);
  }

  /**
   * Log a token chain audit event for an MCP tool call
   * Captures complete token lineage and execution outcome per call
   * Per D-03, D-04: Full lifecycle logging with lineage tracking
   */
  async logTokenChain(
    toolName: string,
    chainIndex: number,  // ordinal in session: 1st call, 2nd call, 3rd call...
    userTokenInfo: UserTokenInfo,
    exchangedTokenInfo: ExchangedTokenInfo | null,  // null if not exchanged
    context: {
      sessionId: string;
      userId?: string;
      ipAddress?: string;
      userAgent?: string;
    },
    toolExecutionStatus: 'started' | 'completed' | 'failed',
    executionResult: TokenChainExecutionResult
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'token_chain',       // event type
      `tool_call_${toolName}`,
      executionResult.success ? 'success' : 'failure',
      {
        sessionId: context.sessionId,
        userId: context.userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        resourceId: toolName,
        resourceType: 'transaction',  // tool calls are like transactions
        errorCode: executionResult.errorCode,
        duration: executionResult.duration
      }
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      tokenType: exchangedTokenInfo ? 'exchanged' : 'user',
      scope: userTokenInfo.scope,  // Track scopes on this audit event
      details: {
        toolName,
        chainIndex,           // Track call order in session
        userToken: {
          sub: userTokenInfo.sub,
          scope: userTokenInfo.scope,
          issuedAt: userTokenInfo.issuedAt,
          exp: userTokenInfo.expiresAt,
          jti: userTokenInfo.tokenId
        },
        exchangedToken: exchangedTokenInfo ? {
          sub: exchangedTokenInfo.sub,
          act: exchangedTokenInfo.act,  // RFC 8693 delegation chain
          aud: exchangedTokenInfo.aud,
          scope: exchangedTokenInfo.scope,
          issuedAt: exchangedTokenInfo.issuedAt,
          exp: exchangedTokenInfo.expiresAt,
          jti: exchangedTokenInfo.tokenId
        } : null,
        toolExecutionStatus,
        request: executionResult.toolRequestJson ?? null,
        result: {
          success: executionResult.success,
          errorCode: executionResult.errorCode,
          duration: executionResult.duration,
          summary: executionResult.toolResultSummary,
          resultJson: executionResult.toolResultJson
        }
      }
    };

    await this.logger.info('Token chain audit', {
      auditEvent,
      operation: 'audit_token_chain'
    });
    await this.writeToRedis(auditEvent);
  }

  /**
   * Log security incident
   */
  async logSecurityIncident(
    incident: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    context: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      ipAddress?: string;
      userAgent?: string;
      resourceId?: string;
      resourceType?: AuditEvent['resourceType'];
    },
    incidentDetails: Record<string, any>
  ): Promise<void> {
    const baseEvent = this.createBaseAuditEvent(
      'authentication', // Security incidents are often auth-related
      `security_incident_${incident}`,
      'failure',
      context
    );

    const auditEvent: AuditEvent = {
      ...baseEvent,
      details: {
        incident,
        severity,
        ...incidentDetails
      }
    };

    await this.logger.warn('Security incident', {
      auditEvent,
      operation: 'audit_security',
      severity
    });
    await this.writeToRedis(auditEvent);
  }

  /**
   * Query audit logs (simplified interface for monitoring)
   */
  async queryAuditLogs(filters: {
    eventType?: AuditEvent['eventType'];
    operation?: string;
    userId?: string;
    agentId?: string;
    sessionId?: string;
    outcome?: AuditEvent['outcome'];
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<AuditEvent[]> {
    // Query from in-memory event store
    let results = AuditLogger.eventStore.filter(event => {
      // Apply all filters
      if (filters.eventType && event.eventType !== filters.eventType) return false;
      if (filters.operation && event.operation !== filters.operation) return false;
      if (filters.userId && event.userId !== filters.userId) return false;
      if (filters.agentId && event.agentId !== filters.agentId) return false;
      if (filters.sessionId && event.sessionId !== filters.sessionId) return false;
      if (filters.outcome && event.outcome !== filters.outcome) return false;
      if (filters.startTime && new Date(event.timestamp) < filters.startTime) return false;
      if (filters.endTime && new Date(event.timestamp) > filters.endTime) return false;
      return true;
    });

    // Apply limit
    if (filters.limit && filters.limit > 0) {
      results = results.slice(-filters.limit); // Return most recent N
    }

    return results;
  }

  /**
   * Generate audit summary report
   */
  async generateAuditSummary(
    startTime: Date,
    endTime: Date,
    filters?: {
      userId?: string;
      agentId?: string;
      eventType?: AuditEvent['eventType'];
    }
  ): Promise<{
    totalEvents: number;
    successfulOperations: number;
    failedOperations: number;
    eventsByType: Record<string, number>;
    topUsers: Array<{ userId: string; eventCount: number }>;
    topOperations: Array<{ operation: string; eventCount: number }>;
  }> {
    await this.logger.info('Generating audit summary', { startTime: startTime.toISOString(), endTime: endTime.toISOString(), filters, operation: 'audit_summary' });

    const events = await this.queryAuditLogs({ startTime, endTime, ...filters, limit: 500 });

    const eventsByType: Record<string, number> = {};
    const userCounts: Record<string, number> = {};
    const opCounts: Record<string, number> = {};
    let successCount = 0;
    let failureCount = 0;

    for (const ev of events) {
      eventsByType[ev.eventType] = (eventsByType[ev.eventType] ?? 0) + 1;
      if (ev.userId) userCounts[ev.userId] = (userCounts[ev.userId] ?? 0) + 1;
      opCounts[ev.operation] = (opCounts[ev.operation] ?? 0) + 1;
      if (ev.outcome === 'success') successCount++;
      else if (ev.outcome === 'failure') failureCount++;
    }

    const topUsers = Object.entries(userCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([userId, eventCount]) => ({ userId, eventCount }));

    const topOperations = Object.entries(opCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([operation, eventCount]) => ({ operation, eventCount }));

    return {
      totalEvents: events.length,
      successfulOperations: successCount,
      failedOperations: failureCount,
      eventsByType,
      topUsers,
      topOperations,
    };
  }
}