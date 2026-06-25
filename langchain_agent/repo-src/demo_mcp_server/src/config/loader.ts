/**
 * Secure Configuration Loader
 * Handles secure loading of configuration from various sources
 */

import * as fs from 'fs';
import * as path from 'path';
import { BankingMCPServerConfig, EnvironmentVariables } from '../interfaces/config';
import { ConfigurationManager, ConfigurationError } from './index';
import { Environment } from './environments';

export interface ConfigurationSource {
  type: 'environment' | 'file' | 'vault';
  path?: string;
  required?: boolean;
}

export class SecureConfigurationLoader {
  private configManager: ConfigurationManager;
  private sources: ConfigurationSource[] = [];

  constructor(environment?: Environment) {
    this.configManager = new ConfigurationManager(environment);
  }

  public addSource(source: ConfigurationSource): void {
    this.sources.push(source);
  }

  public loadFromEnvironment(): BankingMCPServerConfig {
    return this.configManager.loadConfiguration();
  }

  public loadFromFile(filePath: string): BankingMCPServerConfig {
    if (!fs.existsSync(filePath)) {
      throw new ConfigurationError(`Configuration file not found: ${filePath}`);
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const fileConfig = JSON.parse(fileContent);
      
      // Merge file config with environment variables
      const mergedEnv = this.mergeWithEnvironment(fileConfig);
      
      // Temporarily set environment variables
      const originalEnv = { ...process.env };
      Object.assign(process.env, mergedEnv);
      
      try {
        const config = this.configManager.reloadConfiguration();
        return config;
      } finally {
        // Restore original environment
        process.env = originalEnv;
      }
    } catch (error) {
      throw new ConfigurationError(
        `Failed to load configuration from file: ${filePath}`,
        error instanceof Error ? [error as any] : undefined
      );
    }
  }

  public loadFromMultipleSources(): BankingMCPServerConfig {
    const mergedConfig: Partial<EnvironmentVariables> = {};

    for (const source of this.sources) {
      try {
        switch (source.type) {
          case 'environment':
            Object.assign(mergedConfig, process.env);
            break;
          case 'file':
            if (source.path) {
              const fileConfig = this.loadConfigFromFile(source.path);
              Object.assign(mergedConfig, fileConfig);
            }
            break;
          case 'vault':
            // Placeholder for vault integration
            console.warn('Vault configuration source not yet implemented');
            break;
        }
      } catch (error) {
        if (source.required) {
          throw new ConfigurationError(
            `Failed to load required configuration source: ${source.type}`,
            error instanceof Error ? [error as any] : undefined
          );
        } else {
          console.warn(`Optional configuration source failed: ${source.type}`, error);
        }
      }
    }

    // Temporarily set merged environment
    const originalEnv = { ...process.env };
    Object.assign(process.env, mergedConfig);

    try {
      return this.configManager.reloadConfiguration();
    } finally {
      // Restore original environment
      process.env = originalEnv;
    }
  }

  public validateConfigurationFile(filePath: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!fs.existsSync(filePath)) {
      errors.push(`Configuration file not found: ${filePath}`);
      return { isValid: false, errors };
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const config = JSON.parse(fileContent);

      // Validate required fields
      const requiredFields = [
        'PINGONE_BASE_URL',
        'PINGONE_CLIENT_ID',
        'PINGONE_CLIENT_SECRET',
        'ENCRYPTION_KEY'
      ];

      for (const field of requiredFields) {
        if (!config[field]) {
          errors.push(`Missing required field: ${field}`);
        }
      }

      // Validate URL formats
      const urlFields = ['PINGONE_BASE_URL', 'BANKING_API_BASE_URL'];
      for (const field of urlFields) {
        if (config[field] && !this.isValidUrl(config[field])) {
          errors.push(`Invalid URL format for field: ${field}`);
        }
      }

      // Validate numeric fields
      const numericFields = [
        'MCP_SERVER_PORT',
        'MAX_CONNECTIONS',
        'SESSION_TIMEOUT',
        'BANKING_API_TIMEOUT'
      ];

      for (const field of numericFields) {
        if (config[field] && isNaN(parseInt(config[field]))) {
          errors.push(`Invalid numeric value for field: ${field}`);
        }
      }

    } catch (error) {
      errors.push(`Invalid JSON format: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return { isValid: errors.length === 0, errors };
  }

  public createExampleConfigFile(outputPath: string, environment: Environment): void {
    const exampleConfig = this.generateExampleConfig(environment);
    
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(exampleConfig, null, 2));
  }

  private loadConfigFromFile(filePath: string): Partial<EnvironmentVariables> {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContent);
  }

  private mergeWithEnvironment(fileConfig: any): EnvironmentVariables {
    return {
      ...fileConfig,
      ...process.env
    } as EnvironmentVariables;
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private generateExampleConfig(environment: Environment): Partial<EnvironmentVariables> {
    const baseConfig: Partial<EnvironmentVariables> = {
      // Server configuration
      MCP_SERVER_HOST: '0.0.0.0',
      MCP_SERVER_PORT: '8080',
      MAX_CONNECTIONS: '100',
      SESSION_TIMEOUT: '3600',

      // PingOne configuration (required)
      PINGONE_BASE_URL: 'https://your-pingone-environment.pingidentity.com',
      PINGONE_CLIENT_ID: 'your-client-id-here',
      PINGONE_CLIENT_SECRET: 'your-client-secret-here',
      PINGONE_INTROSPECTION_ENDPOINT: 'https://your-pingone-environment.pingidentity.com/as/introspect',
      PINGONE_AUTHORIZATION_ENDPOINT: 'https://your-pingone-environment.pingidentity.com/as/authorize',
      PINGONE_TOKEN_ENDPOINT: 'https://your-pingone-environment.pingidentity.com/as/token',

      // Banking API configuration
      BANKING_API_BASE_URL: 'http://localhost:3001',
      BANKING_API_TIMEOUT: '30000',
      BANKING_API_MAX_RETRIES: '3',
      CIRCUIT_BREAKER_THRESHOLD: '5',

      // Security configuration (required)
      ENCRYPTION_KEY: 'your-32-character-encryption-key-here-minimum-length',
      TOKEN_STORAGE_PATH: './data/tokens',
      SESSION_CLEANUP_INTERVAL: '300',
      MAX_SESSION_DURATION: '86400',

      // Logging configuration
      LOG_LEVEL: 'INFO',
      AUDIT_LOG_PATH: './logs/audit.log',
      SECURITY_LOG_PATH: './logs/security.log'
    };

    // Environment-specific overrides
    switch (environment) {
      case Environment.DEVELOPMENT:
        return {
          ...baseConfig,
          LOG_LEVEL: 'DEBUG',
          SESSION_TIMEOUT: '1800',
          MAX_CONNECTIONS: '10'
        };
      case Environment.PRODUCTION:
        return {
          ...baseConfig,
          LOG_LEVEL: 'WARN',
          MAX_CONNECTIONS: '200',
          BANKING_API_BASE_URL: 'https://banking-api.example.com'
        };
      case Environment.TEST:
        return {
          ...baseConfig,
          LOG_LEVEL: 'ERROR',
          SESSION_TIMEOUT: '300',
          MAX_CONNECTIONS: '5'
        };
      default:
        return baseConfig;
    }
  }
}

// Utility functions for configuration management
export function loadConfigurationFromFile(filePath: string, environment?: Environment): BankingMCPServerConfig {
  const loader = new SecureConfigurationLoader(environment);
  return loader.loadFromFile(filePath);
}

export function createExampleConfig(outputPath: string, environment: Environment = Environment.DEVELOPMENT): void {
  const loader = new SecureConfigurationLoader(environment);
  loader.createExampleConfigFile(outputPath, environment);
}

export function validateConfigFile(filePath: string): { isValid: boolean; errors: string[] } {
  const loader = new SecureConfigurationLoader();
  return loader.validateConfigurationFile(filePath);
}