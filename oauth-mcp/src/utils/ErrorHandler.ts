/**
 * Comprehensive error handling and classification system
 */

import { Logger } from './Logger.js';

export enum ErrorCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  BANKING_API = 'banking_api',
  VALIDATION = 'validation',
  NETWORK = 'network',
  SYSTEM = 'system',
  MCP_PROTOCOL = 'mcp_protocol',
  SESSION = 'session',
  SECURITY = 'security'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface ErrorContext {
  userId?: string;
  agentId?: string;
  sessionId?: string;
  operation?: string;
  resourceId?: string;
  resourceType?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  timestamp?: Date;
  additionalData?: Record<string, any>;
}

export interface ClassifiedError {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  code: string;
  message: string;
  userMessage: string;
  originalError?: Error;
  context?: ErrorContext;
  timestamp: Date;
  retryable: boolean;
  actionRequired?: string;
}

/**
 * Base error class for banking MCP server
 */
export class BankingMCPError extends Error {
  public readonly id: string;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly code: string;
  public readonly userMessage: string;
  public readonly context?: ErrorContext;
  public readonly retryable: boolean;
  public readonly actionRequired?: string;
  public readonly cause?: Error;

  constructor(
    category: ErrorCategory,
    severity: ErrorSeverity,
    code: string,
    message: string,
    userMessage: string,
    context?: ErrorContext,
    retryable: boolean = false,
    actionRequired?: string,
    originalError?: Error
  ) {
    super(message);
    this.name = 'BankingMCPError';
    this.id = this.generateErrorId();
    this.category = category;
    this.severity = severity;
    this.code = code;
    this.userMessage = userMessage;
    this.context = context;
    this.retryable = retryable;
    this.actionRequired = actionRequired;

    if (originalError) {
      this.stack = originalError.stack;
      (this as any).cause = originalError;
    }
  }

  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  toJSON(): ClassifiedError {
    return {
      id: this.id,
      category: this.category,
      severity: this.severity,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      originalError: (this as any).cause as Error,
      context: this.context,
      timestamp: new Date(),
      retryable: this.retryable,
      actionRequired: this.actionRequired
    };
  }
}

/**
 * Specific error classes for different categories
 */
export class AuthenticationError extends BankingMCPError {
  constructor(
    code: string,
    message: string,
    userMessage: string,
    context?: ErrorContext,
    actionRequired?: string
  ) {
    super(
      ErrorCategory.AUTHENTICATION,
      ErrorSeverity.HIGH,
      code,
      message,
      userMessage,
      context,
      false,
      actionRequired
    );
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends BankingMCPError {
  constructor(
    code: string,
    message: string,
    userMessage: string,
    context?: ErrorContext,
    actionRequired?: string
  ) {
    super(
      ErrorCategory.AUTHORIZATION,
      ErrorSeverity.HIGH,
      code,
      message,
      userMessage,
      context,
      false,
      actionRequired
    );
    this.name = 'AuthorizationError';
  }
}

export class BankingAPIError extends BankingMCPError {
  constructor(
    code: string,
    message: string,
    userMessage: string,
    context?: ErrorContext,
    retryable: boolean = true,
    originalError?: Error
  ) {
    super(
      ErrorCategory.BANKING_API,
      ErrorSeverity.MEDIUM,
      code,
      message,
      userMessage,
      context,
      retryable,
      undefined,
      originalError
    );
    this.name = 'BankingAPIError';
  }
}

export class ValidationError extends BankingMCPError {
  constructor(
    code: string,
    message: string,
    userMessage: string,
    context?: ErrorContext
  ) {
    super(
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      code,
      message,
      userMessage,
      context,
      false
    );
    this.name = 'ValidationError';
  }
}

export class NetworkError extends BankingMCPError {
  constructor(
    code: string,
    message: string,
    userMessage: string,
    context?: ErrorContext,
    originalError?: Error
  ) {
    super(
      ErrorCategory.NETWORK,
      ErrorSeverity.MEDIUM,
      code,
      message,
      userMessage,
      context,
      true,
      undefined,
      originalError
    );
    this.name = 'NetworkError';
  }
}

export class SystemError extends BankingMCPError {
  constructor(
    code: string,
    message: string,
    userMessage: string,
    context?: ErrorContext,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    originalError?: Error
  ) {
    super(
      ErrorCategory.SYSTEM,
      severity,
      code,
      message,
      userMessage,
      context,
      false,
      undefined,
      originalError
    );
    this.name = 'SystemError';
  }
}

export class MCPProtocolError extends BankingMCPError {
  constructor(
    code: string,
    message: string,
    userMessage: string,
    context?: ErrorContext,
    retryable: boolean = false
  ) {
    super(
      ErrorCategory.MCP_PROTOCOL,
      ErrorSeverity.MEDIUM,
      code,
      message,
      userMessage,
      context,
      retryable
    );
    this.name = 'MCPProtocolError';
  }
}

export class SessionError extends BankingMCPError {
  constructor(
    code: string,
    message: string,
    userMessage: string,
    context?: ErrorContext,
    actionRequired?: string
  ) {
    super(
      ErrorCategory.SESSION,
      ErrorSeverity.MEDIUM,
      code,
      message,
      userMessage,
      context,
      false,
      actionRequired
    );
    this.name = 'SessionError';
  }
}

export class SecurityError extends BankingMCPError {
  constructor(
    code: string,
    message: string,
    userMessage: string,
    context?: ErrorContext,
    severity: ErrorSeverity = ErrorSeverity.CRITICAL
  ) {
    super(
      ErrorCategory.SECURITY,
      severity,
      code,
      message,
      userMessage,
      context,
      false
    );
    this.name = 'SecurityError';
  }
}

/**
 * Error handler and classifier
 */
export class ErrorHandler {
  private logger: Logger;
  private static instance: ErrorHandler;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  static getInstance(logger?: Logger): ErrorHandler {
    if (!ErrorHandler.instance) {
      if (!logger) {
        throw new Error('Logger instance required for first initialization');
      }
      ErrorHandler.instance = new ErrorHandler(logger);
    }
    return ErrorHandler.instance;
  }

  /**
   * Classify and handle any error
   */
  async handleError(
    error: Error | BankingMCPError,
    context?: ErrorContext,
    operation?: string
  ): Promise<ClassifiedError> {
    let classifiedError: ClassifiedError;

    if (error instanceof BankingMCPError) {
      classifiedError = error.toJSON();
      if (context) {
        classifiedError.context = { ...classifiedError.context, ...context };
      }
    } else {
      classifiedError = this.classifyError(error, context, operation);
    }

    // Log the error
    await this.logError(classifiedError);

    // Handle security incidents
    if (classifiedError.category === ErrorCategory.SECURITY) {
      await this.handleSecurityIncident(classifiedError);
    }

    return classifiedError;
  }

  /**
   * Classify unknown errors
   */
  private classifyError(
    error: Error,
    context?: ErrorContext,
    operation?: string
  ): ClassifiedError {
    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    // Network-related errors
    if (errorMessage.includes('network') || errorMessage.includes('timeout') || 
        errorMessage.includes('connection') || errorName.includes('timeout')) {
      return new NetworkError(
        'NETWORK_ERROR',
        error.message,
        'A network error occurred. Please try again.',
        context,
        error
      ).toJSON();
    }

    // Authentication-related errors
    if (errorMessage.includes('unauthorized') || errorMessage.includes('authentication') ||
        errorMessage.includes('token') || errorMessage.includes('login')) {
      return new AuthenticationError(
        'AUTH_ERROR',
        error.message,
        'Authentication failed. Please check your credentials.',
        context,
        'Please re-authenticate'
      ).toJSON();
    }

    // Authorization-related errors
    if (errorMessage.includes('forbidden') || errorMessage.includes('permission') ||
        errorMessage.includes('access denied') || errorMessage.includes('scope')) {
      return new AuthorizationError(
        'AUTHZ_ERROR',
        error.message,
        'You do not have permission to perform this action.',
        context,
        'Contact administrator for access'
      ).toJSON();
    }

    // Validation errors
    if (errorMessage.includes('validation') || errorMessage.includes('invalid') ||
        errorMessage.includes('required') || errorMessage.includes('format')) {
      return new ValidationError(
        'VALIDATION_ERROR',
        error.message,
        'Invalid input provided. Please check your request.',
        context
      ).toJSON();
    }

    // Banking API errors
    if (operation && operation.includes('banking') || 
        errorMessage.includes('account') || errorMessage.includes('transaction')) {
      return new BankingAPIError(
        'BANKING_API_ERROR',
        error.message,
        'Banking service is temporarily unavailable. Please try again.',
        context,
        true,
        error
      ).toJSON();
    }

    // Default to system error
    return new SystemError(
      'UNKNOWN_ERROR',
      error.message,
      'An unexpected error occurred. Please try again or contact support.',
      context,
      ErrorSeverity.MEDIUM,
      error
    ).toJSON();
  }

  /**
   * Log classified error
   */
  private async logError(error: ClassifiedError): Promise<void> {
    const logContext = {
      errorId: error.id,
      category: error.category,
      severity: error.severity,
      code: error.code,
      retryable: error.retryable,
      ...error.context
    };

    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        await this.logger.error(`Critical error: ${error.message}`, logContext, error.originalError);
        break;
      case ErrorSeverity.HIGH:
        await this.logger.error(`High severity error: ${error.message}`, logContext, error.originalError);
        break;
      case ErrorSeverity.MEDIUM:
        await this.logger.warn(`Medium severity error: ${error.message}`, logContext);
        break;
      case ErrorSeverity.LOW:
        await this.logger.info(`Low severity error: ${error.message}`, logContext);
        break;
    }
  }

  /**
   * Handle security incidents
   */
  private async handleSecurityIncident(error: ClassifiedError): Promise<void> {
    await this.logger.logSecurityEvent(
      'suspicious_activity',
      {
        agentId: error.context?.agentId,
        userId: error.context?.userId,
        sessionId: error.context?.sessionId,
        ipAddress: error.context?.ipAddress,
        details: `Security error: ${error.code} - ${error.message}`,
        severity: error.severity
      }
    );
  }

  /**
   * Create user-friendly error response
   */
  createErrorResponse(error: ClassifiedError): {
    error: {
      code: string;
      message: string;
      category: string;
      retryable: boolean;
      actionRequired?: string;
      errorId: string;
    };
  } {
    return {
      error: {
        code: error.code,
        message: error.userMessage,
        category: error.category,
        retryable: error.retryable,
        actionRequired: error.actionRequired,
        errorId: error.id
      }
    };
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error: Error | ClassifiedError): boolean {
    if ('retryable' in error) {
      return error.retryable;
    }
    
    const classified = this.classifyError(error as Error);
    return classified.retryable;
  }

  /**
   * Get error statistics
   */
  async getErrorStats(
    startTime: Date,
    endTime: Date,
    filters?: {
      category?: ErrorCategory;
      severity?: ErrorSeverity;
      userId?: string;
      agentId?: string;
    }
  ): Promise<{
    totalErrors: number;
    errorsByCategory: Record<ErrorCategory, number>;
    errorsBySeverity: Record<ErrorSeverity, number>;
    retryableErrors: number;
    topErrorCodes: Array<{ code: string; count: number }>;
  }> {
    // In a real implementation, this would query the actual error logs
    await this.logger.debug('Error statistics requested', {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      filters,
      operation: 'error_stats'
    });

    return {
      totalErrors: 0,
      errorsByCategory: {} as Record<ErrorCategory, number>,
      errorsBySeverity: {} as Record<ErrorSeverity, number>,
      retryableErrors: 0,
      topErrorCodes: []
    };
  }
}