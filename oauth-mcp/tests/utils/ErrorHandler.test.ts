/**
 * Unit tests for ErrorHandler utility
 */

import {
  ErrorHandler,
  BankingMCPError,
  AuthenticationError,
  AuthorizationError,
  BankingAPIError,
  ValidationError,
  NetworkError,
  SecurityError,
  ErrorCategory,
  ErrorSeverity,
  type ErrorContext
} from '../../src/utils/ErrorHandler';
import { Logger } from '../../src/utils/Logger';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;
  let mockLogger: jest.Mocked<Logger>;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      logAuthenticationEvent: jest.fn(),
      logBankingOperation: jest.fn(),
      logSecurityEvent: jest.fn()
    } as any;

    errorHandler = new ErrorHandler(mockLogger);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    // Reset singleton instance for clean tests
    (ErrorHandler as any).instance = undefined;
  });

  describe('Singleton Pattern', () => {
    it('should create singleton instance', () => {
      const instance1 = ErrorHandler.getInstance(mockLogger);
      const instance2 = ErrorHandler.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should throw error if no logger provided for first initialization', () => {
      expect(() => ErrorHandler.getInstance()).toThrow('Logger instance required for first initialization');
    });
  });

  describe('BankingMCPError Base Class', () => {
    it('should create error with all properties', () => {
      const context: ErrorContext = {
        userId: 'user123',
        sessionId: 'session456',
        operation: 'test_operation'
      };

      const error = new BankingMCPError(
        ErrorCategory.AUTHENTICATION,
        ErrorSeverity.HIGH,
        'AUTH_FAILED',
        'Authentication failed',
        'Please check your credentials',
        context,
        false,
        'Re-authenticate'
      );

      expect(error.category).toBe(ErrorCategory.AUTHENTICATION);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.code).toBe('AUTH_FAILED');
      expect(error.message).toBe('Authentication failed');
      expect(error.userMessage).toBe('Please check your credentials');
      expect(error.context).toBe(context);
      expect(error.retryable).toBe(false);
      expect(error.actionRequired).toBe('Re-authenticate');
      expect(error.id).toMatch(/^err_\d+_[a-z0-9]+$/);
    });

    it('should serialize to JSON correctly', () => {
      const error = new BankingMCPError(
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW,
        'INVALID_INPUT',
        'Invalid input provided',
        'Please check your input'
      );

      const json = error.toJSON();

      expect(json.id).toBe(error.id);
      expect(json.category).toBe(ErrorCategory.VALIDATION);
      expect(json.severity).toBe(ErrorSeverity.LOW);
      expect(json.code).toBe('INVALID_INPUT');
      expect(json.message).toBe('Invalid input provided');
      expect(json.userMessage).toBe('Please check your input');
      expect(json.retryable).toBe(false);
      expect(json.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Specific Error Classes', () => {
    it('should create AuthenticationError with correct properties', () => {
      const error = new AuthenticationError(
        'TOKEN_EXPIRED',
        'Token has expired',
        'Your session has expired. Please log in again.',
        { userId: 'user123' },
        'Please re-authenticate'
      );

      expect(error.category).toBe(ErrorCategory.AUTHENTICATION);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.code).toBe('TOKEN_EXPIRED');
      expect(error.retryable).toBe(false);
      expect(error.actionRequired).toBe('Please re-authenticate');
    });

    it('should create AuthorizationError with correct properties', () => {
      const error = new AuthorizationError(
        'INSUFFICIENT_SCOPE',
        'Insufficient permissions',
        'You do not have permission to perform this action.',
        { userId: 'user123' },
        'Contact administrator'
      );

      expect(error.category).toBe(ErrorCategory.AUTHORIZATION);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.retryable).toBe(false);
    });

    it('should create BankingAPIError with correct properties', () => {
      const originalError = new Error('API timeout');
      const error = new BankingAPIError(
        'API_TIMEOUT',
        'Banking API timeout',
        'Banking service is temporarily unavailable.',
        { operation: 'get_accounts' },
        true,
        originalError
      );

      expect(error.category).toBe(ErrorCategory.BANKING_API);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(true);
      expect((error as any).cause).toBe(originalError);
    });

    it('should create ValidationError with correct properties', () => {
      const error = new ValidationError(
        'INVALID_AMOUNT',
        'Amount must be positive',
        'Please enter a valid amount.'
      );

      expect(error.category).toBe(ErrorCategory.VALIDATION);
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.retryable).toBe(false);
    });

    it('should create NetworkError with correct properties', () => {
      const error = new NetworkError(
        'CONNECTION_TIMEOUT',
        'Connection timeout',
        'Network connection failed. Please try again.'
      );

      expect(error.category).toBe(ErrorCategory.NETWORK);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.retryable).toBe(true);
    });

    it('should create SecurityError with correct properties', () => {
      const error = new SecurityError(
        'SUSPICIOUS_ACTIVITY',
        'Suspicious activity detected',
        'Your account has been temporarily locked.',
        { userId: 'user123' },
        ErrorSeverity.CRITICAL
      );

      expect(error.category).toBe(ErrorCategory.SECURITY);
      expect(error.severity).toBe(ErrorSeverity.CRITICAL);
      expect(error.retryable).toBe(false);
    });
  });

  describe('Error Classification', () => {
    it('should classify network errors correctly', async () => {
      const networkError = new Error('Connection timeout occurred');
      const context = { operation: 'api_call' };

      const classified = await errorHandler.handleError(networkError, context);

      expect(classified.category).toBe(ErrorCategory.NETWORK);
      expect(classified.retryable).toBe(true);
      expect(classified.userMessage).toBe('A network error occurred. Please try again.');
    });

    it('should classify authentication errors correctly', async () => {
      const authError = new Error('Unauthorized access - invalid token');
      const context = { userId: 'user123' };

      const classified = await errorHandler.handleError(authError, context);

      expect(classified.category).toBe(ErrorCategory.AUTHENTICATION);
      expect(classified.retryable).toBe(false);
      expect(classified.actionRequired).toBe('Please re-authenticate');
    });

    it('should classify authorization errors correctly', async () => {
      const authzError = new Error('Forbidden - insufficient permissions');
      const context = { userId: 'user123' };

      const classified = await errorHandler.handleError(authzError, context);

      expect(classified.category).toBe(ErrorCategory.AUTHORIZATION);
      expect(classified.actionRequired).toBe('Contact administrator for access');
    });

    it('should classify validation errors correctly', async () => {
      const validationError = new Error('Validation failed - required field missing');
      const context = { operation: 'create_transaction' };

      const classified = await errorHandler.handleError(validationError, context);

      expect(classified.category).toBe(ErrorCategory.VALIDATION);
      expect(classified.severity).toBe(ErrorSeverity.LOW);
      expect(classified.retryable).toBe(false);
    });

    it('should classify banking API errors correctly', async () => {
      const bankingError = new Error('Account not found');
      const context = { operation: 'banking_get_balance' };

      const classified = await errorHandler.handleError(bankingError, context);

      expect(classified.category).toBe(ErrorCategory.BANKING_API);
      expect(classified.retryable).toBe(true);
    });

    it('should classify unknown errors as system errors', async () => {
      const unknownError = new Error('Something went wrong');
      const context = { operation: 'unknown_operation' };

      const classified = await errorHandler.handleError(unknownError, context);

      expect(classified.category).toBe(ErrorCategory.SYSTEM);
      expect(classified.code).toBe('UNKNOWN_ERROR');
      expect(classified.severity).toBe(ErrorSeverity.MEDIUM);
    });
  });

  describe('Error Handling and Logging', () => {
    it('should log critical errors with error level', async () => {
      const criticalError = new SecurityError(
        'SECURITY_BREACH',
        'Security breach detected',
        'System compromised'
      );

      await errorHandler.handleError(criticalError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Critical error: Security breach detected',
        expect.objectContaining({
          errorId: criticalError.id,
          category: ErrorCategory.SECURITY,
          severity: ErrorSeverity.CRITICAL,
          code: 'SECURITY_BREACH'
        }),
        undefined
      );
    });

    it('should log high severity errors with error level', async () => {
      const highError = new AuthenticationError(
        'AUTH_FAILED',
        'Authentication failed',
        'Login failed'
      );

      await errorHandler.handleError(highError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'High severity error: Authentication failed',
        expect.objectContaining({
          severity: ErrorSeverity.HIGH
        }),
        undefined
      );
    });

    it('should log medium severity errors with warn level', async () => {
      const mediumError = new BankingAPIError(
        'API_ERROR',
        'API call failed',
        'Service unavailable'
      );

      await errorHandler.handleError(mediumError);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Medium severity error: API call failed',
        expect.objectContaining({
          severity: ErrorSeverity.MEDIUM
        })
      );
    });

    it('should log low severity errors with info level', async () => {
      const lowError = new ValidationError(
        'INVALID_INPUT',
        'Invalid input',
        'Check your input'
      );

      await errorHandler.handleError(lowError);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Low severity error: Invalid input',
        expect.objectContaining({
          severity: ErrorSeverity.LOW
        })
      );
    });

    it('should handle security incidents', async () => {
      const securityError = new SecurityError(
        'UNAUTHORIZED_ACCESS',
        'Unauthorized access attempt',
        'Access denied'
      );

      await errorHandler.handleError(securityError);

      expect(mockLogger.logSecurityEvent).toHaveBeenCalledWith(
        'suspicious_activity',
        expect.objectContaining({
          details: 'Security error: UNAUTHORIZED_ACCESS - Unauthorized access attempt',
          severity: ErrorSeverity.CRITICAL
        })
      );
    });

    it('should merge context when handling BankingMCPError', async () => {
      const error = new AuthenticationError(
        'TOKEN_EXPIRED',
        'Token expired',
        'Please login again',
        { userId: 'user123' }
      );

      const additionalContext = { sessionId: 'session456', operation: 'get_accounts' };

      const classified = await errorHandler.handleError(error, additionalContext);

      expect(classified.context).toEqual({
        userId: 'user123',
        sessionId: 'session456',
        operation: 'get_accounts'
      });
    });
  });

  describe('Error Response Generation', () => {
    it('should create user-friendly error response', () => {
      const error = new ValidationError(
        'INVALID_AMOUNT',
        'Amount must be positive',
        'Please enter a valid amount greater than zero.',
        { operation: 'create_transaction' }
      );

      const response = errorHandler.createErrorResponse(error.toJSON());

      expect(response).toEqual({
        error: {
          code: 'INVALID_AMOUNT',
          message: 'Please enter a valid amount greater than zero.',
          category: ErrorCategory.VALIDATION,
          retryable: false,
          errorId: error.id
        }
      });
    });

    it('should include action required when present', () => {
      const error = new AuthenticationError(
        'TOKEN_EXPIRED',
        'Token expired',
        'Your session has expired.',
        undefined,
        'Please log in again'
      );

      const response = errorHandler.createErrorResponse(error.toJSON());

      expect(response.error.actionRequired).toBe('Please log in again');
    });
  });

  describe('Retry Logic', () => {
    it('should identify retryable errors correctly', () => {
      const retryableError = new NetworkError(
        'TIMEOUT',
        'Request timeout',
        'Connection timed out'
      );

      const nonRetryableError = new ValidationError(
        'INVALID_INPUT',
        'Invalid input',
        'Check your input'
      );

      expect(errorHandler.isRetryable(retryableError.toJSON())).toBe(true);
      expect(errorHandler.isRetryable(nonRetryableError.toJSON())).toBe(false);
    });

    it('should classify and check retryability for unknown errors', () => {
      const networkError = new Error('Connection refused');
      const validationError = new Error('Invalid format provided');

      expect(errorHandler.isRetryable(networkError)).toBe(true);
      expect(errorHandler.isRetryable(validationError)).toBe(false);
    });
  });

  describe('Error Statistics', () => {
    it('should request error statistics', async () => {
      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-01-31');
      const filters = {
        category: ErrorCategory.BANKING_API,
        severity: ErrorSeverity.HIGH
      };

      const stats = await errorHandler.getErrorStats(startTime, endTime, filters);

      expect(stats).toEqual({
        totalErrors: 0,
        errorsByCategory: {},
        errorsBySeverity: {},
        retryableErrors: 0,
        topErrorCodes: []
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Error statistics requested',
        expect.objectContaining({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          filters,
          operation: 'error_stats'
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle errors without messages', async () => {
      const error = new Error();
      error.message = '';

      const classified = await errorHandler.handleError(error);

      expect(classified.message).toBe('');
      expect(classified.userMessage).toBe('An unexpected error occurred. Please try again or contact support.');
    });

    it('should handle null context gracefully', async () => {
      const error = new Error('Test error');

      const classified = await errorHandler.handleError(error, undefined);

      expect(classified.context).toBeUndefined();
    });

    it('should handle errors with circular references in context', async () => {
      const error = new Error('Test error');
      const circular: any = { name: 'test' };
      circular.self = circular;

      const context = { circular } as any;

      await expect(errorHandler.handleError(error, context)).resolves.not.toThrow();
    });
  });
});