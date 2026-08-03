/**
 * Security-aware logging system for the Banking MCP Server
 * Provides structured logging with sensitive data filtering
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, any>;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  operation?: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  auditLogPath?: string;
  securityLogPath?: string;
  applicationLogPath?: string;
  maxFileSize?: number;
  maxFiles?: number;
}

/**
 * Sensitive data patterns to filter from logs
 */
const SENSITIVE_PATTERNS = [
  /bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
  /access_token["\s]*[:=]["\s]*[a-zA-Z0-9\-._~+/]+=*/gi,
  /refresh_token["\s]*[:=]["\s]*[a-zA-Z0-9\-._~+/]+=*/gi,
  /authorization["\s]*[:=]["\s]*bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
  /password["\s]*[:=]["\s]*[^"\s,}]+/gi,
  /secret["\s]*[:=]["\s]*[^"\s,}]+/gi,
  /key["\s]*[:=]["\s]*[^"\s,}]+/gi
];

const SENSITIVE_KEYS = [
  'password',
  'secret',
  'key',
  'token',
  'authorization',
  'access_token',
  'refresh_token',
  'client_secret',
  'private_key',
  'passphrase'
];

/**
 * Security-aware logger that filters sensitive data
 */
export class Logger {
  private config: LoggerConfig;
  private static instance: Logger;

  constructor(config: LoggerConfig) {
    this.config = config;
  }

  static getInstance(config?: LoggerConfig): Logger {
    if (!Logger.instance) {
      if (!config) {
        throw new Error('Logger configuration required for first initialization');
      }
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  /**
   * Filter sensitive data from any value
   */
  private filterSensitiveData(value: any, visited = new WeakSet()): any {
    if (typeof value === 'string') {
      let filtered = value;
      SENSITIVE_PATTERNS.forEach(pattern => {
        filtered = filtered.replace(pattern, '[REDACTED]');
      });
      return filtered;
    }

    if (Array.isArray(value)) {
      if (visited.has(value)) {
        return '[Circular Reference]';
      }
      visited.add(value);
      const result = value.map(item => this.filterSensitiveData(item, visited));
      visited.delete(value);
      return result;
    }

    if (value && typeof value === 'object') {
      if (visited.has(value)) {
        return '[Circular Reference]';
      }
      visited.add(value);
      
      const filtered: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_KEYS.some(sensitiveKey => lowerKey.includes(sensitiveKey))) {
          filtered[key] = '[REDACTED]';
        } else {
          filtered[key] = this.filterSensitiveData(val, visited);
        }
      }
      visited.delete(value);
      return filtered;
    }

    return value;
  }

  /**
   * Create a structured log entry
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message: this.filterSensitiveData(message) as string
    };

    if (context) {
      entry.context = this.filterSensitiveData(context);
      
      // Extract common fields for easier querying
      if (context.userId) entry.userId = context.userId;
      if (context.sessionId) entry.sessionId = context.sessionId;
      if (context.agentId) entry.agentId = context.agentId;
      if (context.operation) entry.operation = context.operation;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: this.filterSensitiveData(error.message) as string,
        code: (error as any).code
      };
      
      if (this.config.level >= LogLevel.DEBUG && error.stack) {
        entry.error.stack = this.filterSensitiveData(error.stack) as string;
      }
    }

    return entry;
  }

  /**
   * Write log entry to appropriate destinations
   */
  private async writeLog(entry: LogEntry, logType: 'application' | 'audit' | 'security' = 'application'): Promise<void> {
    const logString = JSON.stringify(entry);

    // Console output
    if (this.config.enableConsole) {
      const levelNum = LogLevel[entry.level as keyof typeof LogLevel];
      if (levelNum <= this.config.level) {
        console.log(logString);
      }
    }

    // File output (simplified for this implementation)
    if (this.config.enableFile) {
      // In a real implementation, this would use proper file rotation
      // For now, we'll just indicate where the log would be written
      const logPath = this.getLogPath(logType);
      if (logPath) {
        // File writing would be implemented here with proper rotation
        // console.log(`Would write to ${logPath}: ${logString}`);
      }
    }
  }

  private getLogPath(logType: 'application' | 'audit' | 'security'): string | undefined {
    switch (logType) {
      case 'audit':
        return this.config.auditLogPath;
      case 'security':
        return this.config.securityLogPath;
      case 'application':
        return this.config.applicationLogPath;
      default:
        return this.config.applicationLogPath;
    }
  }

  // Public logging methods
  async error(message: string, context?: Record<string, any>, error?: Error): Promise<void> {
    const entry = this.createLogEntry(LogLevel.ERROR, message, context, error);
    await this.writeLog(entry);
  }

  async warn(message: string, context?: Record<string, any>): Promise<void> {
    if (this.config.level >= LogLevel.WARN) {
      const entry = this.createLogEntry(LogLevel.WARN, message, context);
      await this.writeLog(entry);
    }
  }

  async info(message: string, context?: Record<string, any>): Promise<void> {
    if (this.config.level >= LogLevel.INFO) {
      const entry = this.createLogEntry(LogLevel.INFO, message, context);
      await this.writeLog(entry);
    }
  }

  async debug(message: string, context?: Record<string, any>): Promise<void> {
    if (this.config.level >= LogLevel.DEBUG) {
      const entry = this.createLogEntry(LogLevel.DEBUG, message, context);
      await this.writeLog(entry);
    }
  }

  // Specialized logging methods for banking operations
  async logAuthenticationEvent(
    event: 'agent_auth' | 'user_auth' | 'token_refresh' | 'auth_failure',
    context: {
      agentId?: string;
      userId?: string;
      sessionId?: string;
      success: boolean;
      reason?: string;
      ipAddress?: string;
    }
  ): Promise<void> {
    const entry = this.createLogEntry(
      LogLevel.INFO,
      `Authentication event: ${event}`,
      {
        ...context,
        operation: 'authentication',
        eventType: event
      }
    );
    await this.writeLog(entry, 'security');
  }

  async logBankingOperation(
    operation: string,
    context: {
      userId: string;
      sessionId: string;
      agentId?: string;
      accountId?: string;
      amount?: number;
      success: boolean;
      duration?: number;
      error?: string;
    }
  ): Promise<void> {
    const entry = this.createLogEntry(
      LogLevel.INFO,
      `Banking operation: ${operation}`,
      {
        ...context,
        operation: 'banking'
      }
    );
    await this.writeLog(entry, 'audit');
  }

  async logSecurityEvent(
    event: 'unauthorized_access' | 'token_theft_attempt' | 'suspicious_activity' | 'rate_limit_exceeded',
    context: {
      agentId?: string;
      userId?: string;
      sessionId?: string;
      ipAddress?: string;
      details?: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
    }
  ): Promise<void> {
    const entry = this.createLogEntry(
      LogLevel.WARN,
      `Security event: ${event}`,
      {
        ...context,
        operation: 'security',
        eventType: event
      }
    );
    await this.writeLog(entry, 'security');
  }
}

/**
 * Default logger configuration
 */
export const createDefaultLoggerConfig = (): LoggerConfig => ({
  level: LogLevel.INFO,
  enableConsole: true,
  enableFile: true,
  auditLogPath: './logs/audit.log',
  securityLogPath: './logs/security.log',
  applicationLogPath: './logs/application.log',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5
});