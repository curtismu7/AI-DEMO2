/**
 * Unit tests for Logger utility
 */

import { Logger, LogLevel, createDefaultLoggerConfig, type LoggerConfig } from '../../src/utils/Logger';

describe('Logger', () => {
  let logger: Logger;
  let mockConfig: LoggerConfig;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockConfig = {
      level: LogLevel.DEBUG,
      enableConsole: true,
      enableFile: false,
      auditLogPath: './logs/audit.log',
      securityLogPath: './logs/security.log',
      applicationLogPath: './logs/application.log'
    };
    
    logger = new Logger(mockConfig);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    // Reset singleton instance for clean tests
    (Logger as any).instance = undefined;
  });

  describe('Singleton Pattern', () => {
    it('should create singleton instance', () => {
      const instance1 = Logger.getInstance(mockConfig);
      const instance2 = Logger.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should throw error if no config provided for first initialization', () => {
      expect(() => Logger.getInstance()).toThrow('Logger configuration required for first initialization');
    });
  });

  describe('Sensitive Data Filtering', () => {
    it('should filter bearer tokens from strings', async () => {
      await logger.info('Authorization: Bearer abc123token456');
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.message).toBe('Authorization: [REDACTED]');
    });

    it('should filter access tokens from objects', async () => {
      const context = {
        access_token: 'secret_token_123',
        user_id: 'user123',
        refresh_token: 'refresh_secret_456'
      };
      
      await logger.info('User authenticated', context);
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.context.access_token).toBe('[REDACTED]');
      expect(logEntry.context.refresh_token).toBe('[REDACTED]');
      expect(logEntry.context.user_id).toBe('user123');
    });

    it('should filter sensitive keys regardless of case', async () => {
      const context = {
        PASSWORD: 'secret123',
        Secret: 'mysecret',
        API_KEY: 'key123',
        normal_field: 'normal_value'
      };
      
      await logger.info('Test message', context);
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.context.PASSWORD).toBe('[REDACTED]');
      expect(logEntry.context.Secret).toBe('[REDACTED]');
      expect(logEntry.context.API_KEY).toBe('[REDACTED]');
      expect(logEntry.context.normal_field).toBe('normal_value');
    });

    it('should filter nested sensitive data', async () => {
      const context = {
        user: {
          id: 'user123',
          credentials: {
            password: 'secret123',
            token: 'token456'
          }
        },
        config: {
          database_password: 'dbsecret'
        }
      };
      
      await logger.info('Nested data test', context);
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.context.user.id).toBe('user123');
      expect(logEntry.context.user.credentials.password).toBe('[REDACTED]');
      expect(logEntry.context.user.credentials.token).toBe('[REDACTED]');
      expect(logEntry.context.config.database_password).toBe('[REDACTED]');
    });

    it('should filter sensitive data from arrays', async () => {
      const context = {
        tokens: ['token1', 'token2'],
        users: [
          { id: 'user1', password: 'secret1' },
          { id: 'user2', password: 'secret2' }
        ]
      };
      
      await logger.info('Array data test', context);
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.context.users[0].id).toBe('user1');
      expect(logEntry.context.users[0].password).toBe('[REDACTED]');
      expect(logEntry.context.users[1].id).toBe('user2');
      expect(logEntry.context.users[1].password).toBe('[REDACTED]');
    });
  });

  describe('Log Levels', () => {
    it('should respect log level configuration', async () => {
      const warnLogger = new Logger({ ...mockConfig, level: LogLevel.WARN });
      
      await warnLogger.debug('Debug message');
      await warnLogger.info('Info message');
      await warnLogger.warn('Warn message');
      await warnLogger.error('Error message');
      
      expect(consoleSpy).toHaveBeenCalledTimes(2); // Only warn and error
    });

    it('should always log error messages', async () => {
      const errorLogger = new Logger({ ...mockConfig, level: LogLevel.ERROR });
      
      await errorLogger.debug('Debug message');
      await errorLogger.info('Info message');
      await errorLogger.warn('Warn message');
      await errorLogger.error('Error message');
      
      expect(consoleSpy).toHaveBeenCalledTimes(1); // Only error
    });
  });

  describe('Structured Logging', () => {
    it('should create properly structured log entries', async () => {
      const context = {
        userId: 'user123',
        sessionId: 'session456',
        agentId: 'agent789',
        operation: 'banking_operation'
      };
      
      await logger.info('Test message', context);
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry).toHaveProperty('timestamp');
      expect(logEntry).toHaveProperty('level', 'INFO');
      expect(logEntry).toHaveProperty('message', 'Test message');
      expect(logEntry).toHaveProperty('userId', 'user123');
      expect(logEntry).toHaveProperty('sessionId', 'session456');
      expect(logEntry).toHaveProperty('agentId', 'agent789');
      expect(logEntry).toHaveProperty('operation', 'banking_operation');
      expect(logEntry.context).toEqual(context);
    });

    it('should include error information when provided', async () => {
      const infoLogger = new Logger({ ...mockConfig, level: LogLevel.INFO });
      const error = new Error('Test error');
      error.name = 'TestError';
      (error as any).code = 'TEST_CODE';
      
      await infoLogger.error('Error occurred', { userId: 'user123' }, error);
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.error).toMatchObject({
        name: 'TestError',
        message: 'Test error',
        code: 'TEST_CODE'
      });
      // Stack trace should not be included in INFO level
      expect(logEntry.error.stack).toBeUndefined();
    });

    it('should include stack trace in debug mode', async () => {
      const debugLogger = new Logger({ ...mockConfig, level: LogLevel.DEBUG });
      const error = new Error('Test error');
      
      await debugLogger.error('Error with stack', {}, error);
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.error).toHaveProperty('stack');
      expect(typeof logEntry.error.stack).toBe('string');
    });
  });

  describe('Specialized Logging Methods', () => {
    it('should log authentication events', async () => {
      await logger.logAuthenticationEvent('agent_auth', {
        agentId: 'agent123',
        sessionId: 'session456',
        success: true,
        ipAddress: '192.168.1.1'
      });
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.message).toBe('Authentication event: agent_auth');
      expect(logEntry.operation).toBe('authentication');
      expect(logEntry.context.eventType).toBe('agent_auth');
      expect(logEntry.context.success).toBe(true);
    });

    it('should log banking operations', async () => {
      await logger.logBankingOperation('get_accounts', {
        userId: 'user123',
        sessionId: 'session456',
        agentId: 'agent789',
        success: true,
        duration: 150
      });
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.message).toBe('Banking operation: get_accounts');
      expect(logEntry.operation).toBe('banking');
      expect(logEntry.userId).toBe('user123');
      expect(logEntry.context.duration).toBe(150);
    });

    it('should log security events', async () => {
      await logger.logSecurityEvent('unauthorized_access', {
        agentId: 'agent123',
        ipAddress: '192.168.1.1',
        details: 'Invalid token provided',
        severity: 'high'
      });
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.message).toBe('Security event: unauthorized_access');
      expect(logEntry.operation).toBe('security');
      expect(logEntry.context.eventType).toBe('unauthorized_access');
      expect(logEntry.context.severity).toBe('high');
    });
  });

  describe('Configuration', () => {
    it('should create default configuration', () => {
      const defaultConfig = createDefaultLoggerConfig();
      
      expect(defaultConfig).toEqual({
        level: LogLevel.INFO,
        enableConsole: true,
        enableFile: true,
        auditLogPath: './logs/audit.log',
        securityLogPath: './logs/security.log',
        applicationLogPath: './logs/application.log',
        maxFileSize: 10 * 1024 * 1024,
        maxFiles: 5
      });
    });

    it('should disable console logging when configured', async () => {
      const noConsoleLogger = new Logger({ ...mockConfig, enableConsole: false });
      
      await noConsoleLogger.info('Test message');
      
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined values', async () => {
      const context = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        zeroNumber: 0
      };
      
      await logger.info('Edge case test', context);
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.context.nullValue).toBeNull();
      expect(logEntry.context.undefinedValue).toBeUndefined();
      expect(logEntry.context.emptyString).toBe('');
      expect(logEntry.context.zeroNumber).toBe(0);
    });

    it('should handle circular references gracefully', async () => {
      const circular: any = { name: 'test' };
      circular.self = circular;
      
      // This should not throw an error
      await logger.info('Circular reference test', { circular });
      
      const logCall = consoleSpy.mock.calls[0][0];
      const logEntry = JSON.parse(logCall);
      
      expect(logEntry.context.circular.name).toBe('test');
      expect(logEntry.context.circular.self).toBe('[Circular Reference]');
    });

    it('should handle very large objects', async () => {
      const largeObject = {
        data: new Array(1000).fill(0).map((_, i) => ({ id: i, value: `value_${i}` }))
      };
      
      await expect(logger.info('Large object test', largeObject)).resolves.not.toThrow();
    });
  });
});