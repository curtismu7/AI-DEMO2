/**
 * Unit tests for AuditLogger utility
 */

import { AuditLogger } from '../../src/utils/AuditLogger';
import { Logger } from '../../src/utils/Logger';

// Helper function to safely get audit event from mock call
const getAuditEvent = (mockCall: any[]) => {
  return mockCall[1]?.auditEvent;
};

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;
  let mockLogger: jest.Mocked<Logger>;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      logAuthenticationEvent: jest.fn(),
      logBankingOperation: jest.fn(),
      logSecurityEvent: jest.fn()
    } as any;

    auditLogger = new AuditLogger(mockLogger);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    // Reset singleton instance for clean tests
    (AuditLogger as any).instance = undefined;
  });

  describe('Singleton Pattern', () => {
    it('should create singleton instance', () => {
      const instance1 = AuditLogger.getInstance(mockLogger);
      const instance2 = AuditLogger.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should throw error if no logger provided for first initialization', () => {
      expect(() => AuditLogger.getInstance()).toThrow('Logger instance required for first initialization');
    });
  });

  describe('Banking Operation Auditing', () => {
    it('should log successful account retrieval', async () => {
      await auditLogger.logBankingOperation(
        'get_accounts',
        'success',
        {
          userId: 'user123',
          sessionId: 'session456',
          agentId: 'agent789',
          duration: 150
        },
        {}
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Banking operation audit',
        expect.objectContaining({
          auditEvent: expect.objectContaining({
            eventType: 'banking_operation',
            operation: 'get_accounts',
            outcome: 'success',
            userId: 'user123',
            sessionId: 'session456',
            agentId: 'agent789',
            duration: 150,
            details: expect.objectContaining({
              operation: 'get_accounts'
            })
          }),
          operation: 'audit_banking'
        })
      );
    });

    it('should log account balance check with account ID', async () => {
      await auditLogger.logBankingOperation(
        'get_balance',
        'success',
        {
          userId: 'user123',
          sessionId: 'session456',
          duration: 100
        },
        {
          accountId: 'acc123',
          balanceBefore: 1000.50
        }
      );

      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.resourceType).toBe('account');
      expect(auditEvent?.resourceId).toBe('acc123');
      expect(auditEvent?.details.accountId).toBe('acc123');
      expect(auditEvent?.details.balanceBefore).toBe(1000.50);
    });

    it('should log transaction creation with amount formatting', async () => {
      await auditLogger.logBankingOperation(
        'create_transfer',
        'success',
        {
          userId: 'user123',
          sessionId: 'session456',
          duration: 200
        },
        {
          fromAccountId: 'acc123',
          toAccountId: 'acc456',
          amount: 250.75,
          transactionId: 'txn789'
        }
      );

      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.resourceType).toBe('transaction');
      expect(auditEvent?.resourceId).toBe('txn789');
      expect(auditEvent?.details.amount).toBe('$250.75');
      expect(auditEvent?.details.fromAccountId).toBe('acc123');
      expect(auditEvent?.details.toAccountId).toBe('acc456');
    });

    it('should log failed banking operations with error details', async () => {
      await auditLogger.logBankingOperation(
        'create_withdrawal',
        'failure',
        {
          userId: 'user123',
          sessionId: 'session456',
          errorCode: 'INSUFFICIENT_FUNDS',
          errorMessage: 'Account balance too low'
        },
        {
          fromAccountId: 'acc123',
          amount: 1000.00
        }
      );

      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.outcome).toBe('failure');
      expect(auditEvent?.errorCode).toBe('INSUFFICIENT_FUNDS');
      expect(auditEvent?.errorMessage).toBe('Account balance too low');
      expect(auditEvent?.details.amount).toBe('$1000.00');
    });
  });

  describe('Authentication Auditing', () => {
    it('should log agent token validation', async () => {
      await auditLogger.logAuthentication(
        'agent_token_validation',
        'success',
        {
          agentId: 'agent123',
          sessionId: 'session456',
          ipAddress: '192.168.1.1',
          duration: 50
        },
        {
          tokenType: 'agent',
          scopes: ['read', 'write'],
          clientId: 'client123'
        }
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Authentication audit',
        expect.objectContaining({
          auditEvent: expect.objectContaining({
            eventType: 'authentication',
            operation: 'agent_token_validation',
            outcome: 'success',
            agentId: 'agent123',
            resourceType: 'token',
            details: expect.objectContaining({
              tokenType: 'agent',
              scopes: ['read', 'write'],
              clientId: 'client123'
            })
          })
        })
      );
    });

    it('should log user authorization with grant type', async () => {
      await auditLogger.logAuthentication(
        'user_authorization',
        'success',
        {
          userId: 'user123',
          agentId: 'agent456',
          sessionId: 'session789',
          duration: 300
        },
        {
          tokenType: 'user',
          grantType: 'authorization_code',
          scopes: ['accounts:read', 'transactions:read']
        }
      );

      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.details.grantType).toBe('authorization_code');
      expect(auditEvent?.details.scopes).toEqual(['accounts:read', 'transactions:read']);
    });

    it('should log failed authentication attempts', async () => {
      await auditLogger.logAuthentication(
        'agent_token_validation',
        'failure',
        {
          agentId: 'agent123',
          ipAddress: '192.168.1.1',
          errorCode: 'INVALID_TOKEN',
          errorMessage: 'Token has expired'
        },
        {
          tokenType: 'agent'
        }
      );

      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.outcome).toBe('failure');
      expect(auditEvent?.errorCode).toBe('INVALID_TOKEN');
      expect(auditEvent?.errorMessage).toBe('Token has expired');
    });
  });

  describe('Authorization Auditing', () => {
    it('should log successful authorization decisions', async () => {
      await auditLogger.logAuthorization(
        'scope_validation',
        'success',
        {
          userId: 'user123',
          agentId: 'agent456',
          sessionId: 'session789'
        },
        {
          requiredScopes: ['accounts:read'],
          grantedScopes: ['accounts:read', 'transactions:read'],
          resourceRequested: 'accounts',
          decision: 'allow',
          reason: 'User has sufficient permissions'
        }
      );

      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.eventType).toBe('authorization');
      expect(auditEvent?.details.decision).toBe('allow');
      expect(auditEvent?.details.requiredScopes).toEqual(['accounts:read']);
      expect(auditEvent?.details.grantedScopes).toEqual(['accounts:read', 'transactions:read']);
    });

    it('should log authorization denials', async () => {
      await auditLogger.logAuthorization(
        'scope_validation',
        'failure',
        {
          userId: 'user123',
          agentId: 'agent456',
          sessionId: 'session789'
        },
        {
          requiredScopes: ['transactions:write'],
          grantedScopes: ['accounts:read'],
          resourceRequested: 'transactions',
          decision: 'deny',
          reason: 'Insufficient permissions for write operations'
        }
      );

      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.outcome).toBe('failure');
      expect(auditEvent?.details.decision).toBe('deny');
      expect(auditEvent?.details.reason).toBe('Insufficient permissions for write operations');
    });
  });

  describe('Session Management Auditing', () => {
    it('should log session creation', async () => {
      await auditLogger.logSessionManagement(
        'session_create',
        'success',
        {
          agentId: 'agent123',
          sessionId: 'session456',
          ipAddress: '192.168.1.1'
        },
        {
          tokensAssociated: false
        }
      );

      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.eventType).toBe('session_management');
      expect(auditEvent?.operation).toBe('session_create');
      expect(auditEvent?.resourceType).toBe('session');
      expect(auditEvent?.resourceId).toBe('session456');
      expect(auditEvent?.details.tokensAssociated).toBe(false);
    });

    it('should log session cleanup with reason', async () => {
      await auditLogger.logSessionManagement(
        'session_cleanup',
        'success',
        {
          sessionId: 'session456',
          duration: 3600
        },
        {
          sessionDuration: 3600,
          cleanupReason: 'expired'
        }
      );

      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.details.cleanupReason).toBe('expired');
      expect(auditEvent?.details.sessionDuration).toBe(3600);
    });
  });

  describe('Security Incident Auditing', () => {
    it('should log security incidents with severity', async () => {
      await auditLogger.logSecurityIncident(
        'token_theft_attempt',
        'high',
        {
          agentId: 'agent123',
          ipAddress: '192.168.1.100',
          resourceId: 'token456',
          resourceType: 'token'
        },
        {
          attemptCount: 5,
          timeWindow: '5 minutes',
          detectionMethod: 'rate_limiting'
        }
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Security incident',
        expect.objectContaining({
          auditEvent: expect.objectContaining({
            operation: 'security_incident_token_theft_attempt',
            outcome: 'failure',
            details: expect.objectContaining({
              incident: 'token_theft_attempt',
              severity: 'high',
              attemptCount: 5,
              detectionMethod: 'rate_limiting'
            })
          }),
          operation: 'audit_security',
          severity: 'high'
        })
      );
    });

    it('should log critical security incidents', async () => {
      await auditLogger.logSecurityIncident(
        'unauthorized_access',
        'critical',
        {
          userId: 'user123',
          agentId: 'agent456',
          ipAddress: '10.0.0.1'
        },
        {
          accessAttempt: 'admin_endpoint',
          bypassMethod: 'token_manipulation'
        }
      );

      const call = mockLogger.warn.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.details.severity).toBe('critical');
      expect(auditEvent?.details.incident).toBe('unauthorized_access');
    });
  });

  describe('Event ID Generation', () => {
    it('should generate unique event IDs', async () => {
      await auditLogger.logBankingOperation('get_accounts', 'success', {
        userId: 'user123',
        sessionId: 'session456'
      }, {});

      await auditLogger.logBankingOperation('get_balance', 'success', {
        userId: 'user123',
        sessionId: 'session456'
      }, {});

      const call1 = mockLogger.info.mock.calls[0];
      const call2 = mockLogger.info.mock.calls[1];
      
      const eventId1 = getAuditEvent(call1)?.eventId;
      const eventId2 = getAuditEvent(call2)?.eventId;

      expect(eventId1).not.toBe(eventId2);
      expect(eventId1).toMatch(/^audit_\d+_[a-z0-9]+$/);
      expect(eventId2).toMatch(/^audit_\d+_[a-z0-9]+$/);
    });
  });

  describe('Query and Reporting', () => {
    it('should handle audit log queries', async () => {
      const filters = {
        eventType: 'banking_operation' as const,
        userId: 'user123',
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-01-31'),
        limit: 100
      };

      const result = await auditLogger.queryAuditLogs(filters);

      // Empty event store with filters applied → empty array.
      // queryAuditLogs is a pure filter on in-memory event store; no log call.
      expect(result).toEqual([]);
    });

    it('should generate audit summaries', async () => {
      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-01-31');
      const filters = { userId: 'user123' };

      const summary = await auditLogger.generateAuditSummary(startTime, endTime, filters);

      expect(summary).toEqual({
        totalEvents: 0,
        successfulOperations: 0,
        failedOperations: 0,
        eventsByType: {},
        topUsers: [],
        topOperations: []
      });

      // Source emits 'Generating audit summary' (not 'Audit summary generation requested').
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Generating audit summary',
        expect.objectContaining({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          filters,
          operation: 'audit_summary'
        })
      );
    });
  });

  describe('Timestamp and Formatting', () => {
    it('should include ISO timestamps in audit events', async () => {
      const beforeTime = new Date().toISOString();
      
      await auditLogger.logBankingOperation('get_accounts', 'success', {
        userId: 'user123',
        sessionId: 'session456'
      }, {});

      const afterTime = new Date().toISOString();
      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(auditEvent?.timestamp && auditEvent.timestamp >= beforeTime).toBe(true);
      expect(auditEvent?.timestamp && auditEvent.timestamp <= afterTime).toBe(true);
    });

    it('should preserve context fields in audit events', async () => {
      await auditLogger.logBankingOperation('create_transfer', 'success', {
        userId: 'user123',
        sessionId: 'session456',
        agentId: 'agent789',
        ipAddress: '192.168.1.1',
        userAgent: 'BankingMCP/1.0',
        duration: 250
      }, {
        fromAccountId: 'acc123',
        toAccountId: 'acc456',
        amount: 100.00
      });

      const call = mockLogger.info.mock.calls[0];
      const auditEvent = getAuditEvent(call);

      expect(auditEvent?.userId).toBe('user123');
      expect(auditEvent?.sessionId).toBe('session456');
      expect(auditEvent?.agentId).toBe('agent789');
      expect(auditEvent?.ipAddress).toBe('192.168.1.1');
      expect(auditEvent?.userAgent).toBe('BankingMCP/1.0');
      expect(auditEvent?.duration).toBe(250);
    });
  });
});