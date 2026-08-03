/**
 * Configuration Validation
 * Comprehensive validation for all configuration parameters
 */

import { DemoMCPServerConfig, EnvironmentVariables } from '../interfaces/config';
import { Environment } from './environments';

export class ConfigurationValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public value?: any
  ) {
    super(message);
    this.name = 'ConfigurationValidationError';
  }
}

export interface ValidationResult {
  isValid: boolean;
  errors: ConfigurationValidationError[];
  warnings: string[];
}

export class ConfigurationValidator {
  private errors: ConfigurationValidationError[] = [];
  private warnings: string[] = [];

  public validateEnvironmentVariables(env: EnvironmentVariables): ValidationResult {
    this.errors = [];
    this.warnings = [];

    // Validate required environment variables
    this.validateRequiredEnvVars(env);
    
    // Validate optional environment variables format
    this.validateOptionalEnvVars(env);

    return {
      isValid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }

  public validateConfiguration(config: DemoMCPServerConfig, environment: Environment): ValidationResult {
    this.errors = [];
    this.warnings = [];

    this.validateServerConfig(config.server);
    this.validatePingOneConfig(config.pingone);
    this.validateBankingApiConfig(config.bankingApi);
    this.validateSecurityConfig(config.security, environment);
    this.validateLoggingConfig(config.logging);

    return {
      isValid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }

  private validateRequiredEnvVars(env: EnvironmentVariables): void {
    const requiredVars: (keyof EnvironmentVariables)[] = [
      'PINGONE_BASE_URL',
      'PINGONE_CLIENT_ID',
      'PINGONE_CLIENT_SECRET',
      'PINGONE_INTROSPECTION_ENDPOINT',
      'PINGONE_AUTHORIZATION_ENDPOINT',
      'PINGONE_TOKEN_ENDPOINT',
      'ENCRYPTION_KEY'
    ];

    for (const varName of requiredVars) {
      const value = env[varName];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        this.errors.push(new ConfigurationValidationError(
          `Required environment variable ${varName} is missing or empty`,
          varName,
          value
        ));
      }
    }
  }

  private validateOptionalEnvVars(env: EnvironmentVariables): void {
    // Validate numeric environment variables
    const numericVars: (keyof EnvironmentVariables)[] = [
      'MCP_SERVER_PORT',
      'MAX_CONNECTIONS',
      'SESSION_TIMEOUT',
      'BANKING_API_TIMEOUT',
      'BANKING_API_MAX_RETRIES',
      'CIRCUIT_BREAKER_THRESHOLD',
      'SESSION_CLEANUP_INTERVAL',
      'MAX_SESSION_DURATION'
    ];

    for (const varName of numericVars) {
      const value = env[varName];
      if (value && isNaN(parseInt(value))) {
        this.errors.push(new ConfigurationValidationError(
          `Environment variable ${varName} must be a valid number`,
          varName,
          value
        ));
      }
    }

    // Validate URL format for optional URLs
    if (env.BANKING_API_BASE_URL && !this.isValidUrl(env.BANKING_API_BASE_URL)) {
      this.errors.push(new ConfigurationValidationError(
        'BANKING_API_BASE_URL must be a valid URL',
        'BANKING_API_BASE_URL',
        env.BANKING_API_BASE_URL
      ));
    }

    // Validate log level
    if (env.LOG_LEVEL) {
      const validLevels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
      if (!validLevels.includes(env.LOG_LEVEL.toUpperCase())) {
        this.errors.push(new ConfigurationValidationError(
          `LOG_LEVEL must be one of: ${validLevels.join(', ')}`,
          'LOG_LEVEL',
          env.LOG_LEVEL
        ));
      }
    }
  }

  private validateServerConfig(server: DemoMCPServerConfig['server']): void {
    // Validate port
    if (server.port < 1 || server.port > 65535) {
      this.errors.push(new ConfigurationValidationError(
        'Server port must be between 1 and 65535',
        'server.port',
        server.port
      ));
    }

    // Validate host
    if (!server.host || server.host.trim() === '') {
      this.errors.push(new ConfigurationValidationError(
        'Server host cannot be empty',
        'server.host',
        server.host
      ));
    }

    // Validate maxConnections
    if (server.maxConnections < 1) {
      this.errors.push(new ConfigurationValidationError(
        'Max connections must be greater than 0',
        'server.maxConnections',
        server.maxConnections
      ));
    }

    if (server.maxConnections > 1000) {
      this.warnings.push('Max connections is very high (>1000), ensure your system can handle this load');
    }

    // Validate sessionTimeout
    if (server.sessionTimeout < 60) {
      this.errors.push(new ConfigurationValidationError(
        'Session timeout must be at least 60 seconds',
        'server.sessionTimeout',
        server.sessionTimeout
      ));
    }

    if (server.sessionTimeout > 86400) {
      this.warnings.push('Session timeout is very long (>24 hours), consider security implications');
    }
  }

  private validatePingOneConfig(pingone: DemoMCPServerConfig['pingone']): void {
    // Validate base URL
    if (!pingone.baseUrl.startsWith('https://')) {
      this.errors.push(new ConfigurationValidationError(
        'PingOne base URL must use HTTPS',
        'pingone.baseUrl',
        pingone.baseUrl
      ));
    }

    if (!this.isValidUrl(pingone.baseUrl)) {
      this.errors.push(new ConfigurationValidationError(
        'PingOne base URL must be a valid URL',
        'pingone.baseUrl',
        pingone.baseUrl
      ));
    }

    // Validate client ID format (UUID-like)
    if (!this.isValidUuid(pingone.clientId)) {
      this.warnings.push('PingOne client ID should be a valid UUID format');
    }

    // Validate endpoints are URLs
    const endpoints = [
      { field: 'tokenIntrospectionEndpoint', value: pingone.tokenIntrospectionEndpoint },
      { field: 'authorizationEndpoint', value: pingone.authorizationEndpoint },
      { field: 'tokenEndpoint', value: pingone.tokenEndpoint }
    ];

    for (const endpoint of endpoints) {
      if (!this.isValidUrl(endpoint.value)) {
        this.errors.push(new ConfigurationValidationError(
          `PingOne ${endpoint.field} must be a valid URL`,
          `pingone.${endpoint.field}`,
          endpoint.value
        ));
      }

      if (!endpoint.value.startsWith('https://')) {
        this.errors.push(new ConfigurationValidationError(
          `PingOne ${endpoint.field} must use HTTPS`,
          `pingone.${endpoint.field}`,
          endpoint.value
        ));
      }
    }

    // Validate client secret length
    if (pingone.clientSecret.length < 16) {
      this.warnings.push('PingOne client secret seems short, ensure it meets security requirements');
    }
  }

  private validateBankingApiConfig(bankingApi: DemoMCPServerConfig['bankingApi']): void {
    // Validate base URL
    if (!this.isValidUrl(bankingApi.baseUrl)) {
      this.errors.push(new ConfigurationValidationError(
        'Banking API base URL must be a valid URL',
        'bankingApi.baseUrl',
        bankingApi.baseUrl
      ));
    }

    // Validate timeout
    if (bankingApi.timeout < 1000) {
      this.errors.push(new ConfigurationValidationError(
        'Banking API timeout must be at least 1000ms',
        'bankingApi.timeout',
        bankingApi.timeout
      ));
    }

    if (bankingApi.timeout > 120000) {
      this.warnings.push('Banking API timeout is very long (>2 minutes), consider user experience');
    }

    // Validate max retries
    if (bankingApi.maxRetries < 0) {
      this.errors.push(new ConfigurationValidationError(
        'Banking API max retries must be non-negative',
        'bankingApi.maxRetries',
        bankingApi.maxRetries
      ));
    }

    if (bankingApi.maxRetries > 10) {
      this.warnings.push('Banking API max retries is very high (>10), consider timeout implications');
    }

    // Validate circuit breaker threshold
    if (bankingApi.circuitBreakerThreshold < 1) {
      this.errors.push(new ConfigurationValidationError(
        'Circuit breaker threshold must be at least 1',
        'bankingApi.circuitBreakerThreshold',
        bankingApi.circuitBreakerThreshold
      ));
    }
  }

  private validateSecurityConfig(security: DemoMCPServerConfig['security'], environment: Environment): void {
    // Fatal boot guard: SKIP_TOKEN_SIGNATURE_VALIDATION=true outside development
    // disables signature verification entirely — must never run in staging or production.
    // (Documented as "already fatal via ConfigManager" in TokenIntrospector.ts — this is
    // the enforcement that makes that comment true.)
    if (process.env.SKIP_TOKEN_SIGNATURE_VALIDATION === 'true' && environment !== Environment.DEVELOPMENT) {
      this.errors.push(new ConfigurationValidationError(
        'SKIP_TOKEN_SIGNATURE_VALIDATION=true is forbidden outside development — this flag disables agent token signature verification and must not run in staging or production',
        'SKIP_TOKEN_SIGNATURE_VALIDATION'
      ));
    }

    // Validate encryption key
    if (security.encryptionKey.length < 32) {
      this.errors.push(new ConfigurationValidationError(
        'Encryption key must be at least 32 characters long',
        'security.encryptionKey',
        '***REDACTED***'
      ));
    }

    if (security.encryptionKey.length < 64 && environment === Environment.PRODUCTION) {
      this.warnings.push('Consider using a longer encryption key (64+ characters) for production');
    }

    // Validate token storage path
    if (!security.tokenStoragePath || security.tokenStoragePath.trim() === '') {
      this.errors.push(new ConfigurationValidationError(
        'Token storage path cannot be empty',
        'security.tokenStoragePath',
        security.tokenStoragePath
      ));
    }

    // Validate session cleanup interval
    if (security.sessionCleanupInterval < 30) {
      this.errors.push(new ConfigurationValidationError(
        'Session cleanup interval must be at least 30 seconds',
        'security.sessionCleanupInterval',
        security.sessionCleanupInterval
      ));
    }

    // Validate max session duration
    if (security.maxSessionDuration < 3600) {
      this.errors.push(new ConfigurationValidationError(
        'Max session duration must be at least 1 hour (3600 seconds)',
        'security.maxSessionDuration',
        security.maxSessionDuration
      ));
    }

    if (security.maxSessionDuration > 604800) {
      this.warnings.push('Max session duration is very long (>1 week), consider security implications');
    }
  }

  private validateLoggingConfig(logging: DemoMCPServerConfig['logging']): void {
    // Validate log level
    const validLevels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
    if (!validLevels.includes(logging.level.toUpperCase())) {
      this.errors.push(new ConfigurationValidationError(
        `Log level must be one of: ${validLevels.join(', ')}`,
        'logging.level',
        logging.level
      ));
    }

    // Validate log paths
    if (!logging.auditLogPath || logging.auditLogPath.trim() === '') {
      this.errors.push(new ConfigurationValidationError(
        'Audit log path cannot be empty',
        'logging.auditLogPath',
        logging.auditLogPath
      ));
    }

    if (!logging.securityLogPath || logging.securityLogPath.trim() === '') {
      this.errors.push(new ConfigurationValidationError(
        'Security log path cannot be empty',
        'logging.securityLogPath',
        logging.securityLogPath
      ));
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private isValidUuid(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}