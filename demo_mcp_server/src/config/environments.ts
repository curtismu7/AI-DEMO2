/**
 * Environment-specific Configuration Classes
 * Provides configuration for different deployment environments
 */

import { BankingMCPServerConfig, EnvironmentVariables, SecurityConfig, ServerConfig, LoggingConfig } from '../interfaces/config';
import { BankingAPIConfig } from '../interfaces';

export enum Environment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
  TEST = 'test'
}

interface EnvironmentDefaults {
  server?: Partial<ServerConfig>;
  bankingApi?: Partial<BankingAPIConfig>;
  security?: Partial<SecurityConfig>;
  logging?: Partial<LoggingConfig>;
}

export abstract class BaseEnvironmentConfig {
  protected abstract getEnvironmentDefaults(): EnvironmentDefaults;
  
  public getConfig(env: EnvironmentVariables): BankingMCPServerConfig {
    const defaults = this.getEnvironmentDefaults();
    
    return {
      server: {
        host: env.MCP_SERVER_HOST || defaults.server?.host || '0.0.0.0',
        port: parseInt(env.MCP_SERVER_PORT || defaults.server?.port?.toString() || '8080'),
        maxConnections: parseInt(env.MAX_CONNECTIONS || defaults.server?.maxConnections?.toString() || '100'),
        sessionTimeout: parseInt(env.SESSION_TIMEOUT || defaults.server?.sessionTimeout?.toString() || '3600')
      },
      pingone: {
        baseUrl: env.PINGONE_BASE_URL!,
        // RFC 7662 introspection client. PingOne returns active:true ONLY to
        // the client that ISSUED the token (or a resource server that owns the
        // audience). In passthrough mode (MCP_GW_PASSTHROUGH_TO_MCP_SERVER=true)
        // the token arriving at the MCP server has aud=mcpgateway.ping.demo and
        // was issued by the MCP exchanger (GW_INTROSPECTION_CLIENT_ID). Use that
        // client for introspection; fall back to PINGONE_MCP_GATEWAY_CLIENT_ID /
        // MCP_GW_CLIENT_ID (gateway's own client) for non-passthrough mode, then
        // PINGONE_CLIENT_* for back-compat.
        // Invariant + rationale: REGRESSION_PLAN.md §4.
        clientId: env.GW_INTROSPECTION_CLIENT_ID || env.PINGONE_MCP_GATEWAY_CLIENT_ID || env.MCP_GW_CLIENT_ID || env.PINGONE_CLIENT_ID!,
        clientSecret: env.GW_INTROSPECTION_CLIENT_SECRET || env.PINGONE_MCP_GATEWAY_CLIENT_SECRET || env.MCP_GW_CLIENT_SECRET || env.PINGONE_CLIENT_SECRET!,
        tokenIntrospectionEndpoint: env.PINGONE_INTROSPECTION_ENDPOINT!,
        authorizationEndpoint: env.PINGONE_AUTHORIZATION_ENDPOINT!,
        tokenEndpoint: env.PINGONE_TOKEN_ENDPOINT!
      },
      bankingApi: {
        baseUrl: env.DEMO_API_BASE_URL || env.BANKING_API_BASE_URL || defaults.bankingApi?.baseUrl || 'http://localhost:3001',
        timeout: parseInt(env.BANKING_API_TIMEOUT || defaults.bankingApi?.timeout?.toString() || '30000'),
        maxRetries: parseInt(env.BANKING_API_MAX_RETRIES || defaults.bankingApi?.maxRetries?.toString() || '3'),
        circuitBreakerThreshold: parseInt(env.CIRCUIT_BREAKER_THRESHOLD || defaults.bankingApi?.circuitBreakerThreshold?.toString() || '5')
      },
      security: {
        encryptionKey: env.ENCRYPTION_KEY!,
        tokenStoragePath: env.TOKEN_STORAGE_PATH || defaults.security?.tokenStoragePath || './data/tokens',
        sessionCleanupInterval: parseInt(env.SESSION_CLEANUP_INTERVAL || defaults.security?.sessionCleanupInterval?.toString() || '300'),
        maxSessionDuration: parseInt(env.MAX_SESSION_DURATION || defaults.security?.maxSessionDuration?.toString() || '86400')
      },
      logging: {
        level: env.LOG_LEVEL || defaults.logging?.level || 'INFO',
        auditLogPath: env.AUDIT_LOG_PATH || defaults.logging?.auditLogPath || './logs/audit.log',
        securityLogPath: env.SECURITY_LOG_PATH || defaults.logging?.securityLogPath || './logs/security.log'
      }
    };
  }
}

export class DevelopmentConfig extends BaseEnvironmentConfig {
  protected getEnvironmentDefaults(): EnvironmentDefaults {
    return {
      server: {
        host: 'localhost',
        port: 8080,
        maxConnections: 10,
        sessionTimeout: 1800 // 30 minutes for development
      },
      bankingApi: {
        baseUrl: 'http://localhost:3001',
        timeout: 10000, // Shorter timeout for development
        maxRetries: 2,
        circuitBreakerThreshold: 3
      },
      security: {
        tokenStoragePath: './dev-data/tokens',
        sessionCleanupInterval: 60, // More frequent cleanup in dev
        maxSessionDuration: 7200 // 2 hours for development
      },
      logging: {
        level: 'DEBUG',
        auditLogPath: './dev-logs/audit.log',
        securityLogPath: './dev-logs/security.log'
      }
    };
  }
}

export class StagingConfig extends BaseEnvironmentConfig {
  protected getEnvironmentDefaults(): EnvironmentDefaults {
    return {
      server: {
        host: '0.0.0.0',
        port: 8080,
        maxConnections: 50,
        sessionTimeout: 3600 // 1 hour
      },
      bankingApi: {
        baseUrl: 'https://staging-banking-api.example.com',
        timeout: 20000,
        maxRetries: 3,
        circuitBreakerThreshold: 5
      },
      security: {
        tokenStoragePath: '/app/data/tokens',
        sessionCleanupInterval: 300, // 5 minutes
        maxSessionDuration: 43200 // 12 hours
      },
      logging: {
        level: 'INFO',
        auditLogPath: '/app/logs/audit.log',
        securityLogPath: '/app/logs/security.log'
      }
    };
  }
}

export class ProductionConfig extends BaseEnvironmentConfig {
  protected getEnvironmentDefaults(): EnvironmentDefaults {
    return {
      server: {
        host: '0.0.0.0',
        port: 8080,
        maxConnections: 200,
        sessionTimeout: 3600 // 1 hour
      },
      bankingApi: {
        baseUrl: 'https://banking-api.example.com',
        timeout: 30000,
        maxRetries: 3,
        circuitBreakerThreshold: 10
      },
      security: {
        tokenStoragePath: '/app/data/tokens',
        sessionCleanupInterval: 300, // 5 minutes
        maxSessionDuration: 86400 // 24 hours
      },
      logging: {
        level: 'WARN',
        auditLogPath: '/app/logs/audit.log',
        securityLogPath: '/app/logs/security.log'
      }
    };
  }
}

export class TestConfig extends BaseEnvironmentConfig {
  protected getEnvironmentDefaults(): EnvironmentDefaults {
    return {
      server: {
        host: 'localhost',
        port: 8081, // Test port
        maxConnections: 5,
        sessionTimeout: 300 // 5 minutes for tests
      },
      bankingApi: {
        baseUrl: 'http://localhost:3001',
        timeout: 5000, // Short timeout for tests
        maxRetries: 1,
        circuitBreakerThreshold: 2
      },
      security: {
        tokenStoragePath: './test-data/tokens',
        sessionCleanupInterval: 30, // Frequent cleanup in tests
        maxSessionDuration: 3600 // 1 hour minimum for tests
      },
      logging: {
        level: 'ERROR', // Minimal logging in tests
        auditLogPath: './test-logs/audit.log',
        securityLogPath: './test-logs/security.log'
      }
    };
  }
}

export function getEnvironmentConfig(environment: Environment): BaseEnvironmentConfig {
  switch (environment) {
    case Environment.DEVELOPMENT:
      return new DevelopmentConfig();
    case Environment.STAGING:
      return new StagingConfig();
    case Environment.PRODUCTION:
      return new ProductionConfig();
    case Environment.TEST:
      return new TestConfig();
    default:
      throw new Error(`Unknown environment: ${environment}`);
  }
}

export function getCurrentEnvironment(): Environment {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  
  switch (nodeEnv) {
    case 'development':
    case 'dev':
      return Environment.DEVELOPMENT;
    case 'staging':
    case 'stage':
      return Environment.STAGING;
    case 'production':
    case 'prod':
      return Environment.PRODUCTION;
    case 'test':
      return Environment.TEST;
    default:
      return Environment.DEVELOPMENT; // Default to development
  }
}