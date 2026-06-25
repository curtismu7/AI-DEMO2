/**
 * Configuration Management
 * Handles environment-based configuration loading and validation
 */

import { BankingMCPServerConfig, EnvironmentVariables } from '../interfaces/config';
import { Environment, getEnvironmentConfig, getCurrentEnvironment } from './environments';
import { ConfigurationValidator, ConfigurationValidationError } from './validator';

export class ConfigurationError extends Error {
  constructor(message: string, public validationErrors?: ConfigurationValidationError[]) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class ConfigurationManager {
  private validator = new ConfigurationValidator();
  private environment: Environment;
  private config?: BankingMCPServerConfig;

  constructor(environment?: Environment) {
    this.environment = environment || getCurrentEnvironment();
  }

  public loadConfiguration(): BankingMCPServerConfig {
    if (this.config) {
      return this.config;
    }

    const env = process.env as EnvironmentVariables;
    
    // Validate environment variables first
    const envValidation = this.validator.validateEnvironmentVariables(env);
    if (!envValidation.isValid) {
      throw new ConfigurationError(
        'Environment variable validation failed',
        envValidation.errors
      );
    }

    // Load environment-specific configuration
    const environmentConfig = getEnvironmentConfig(this.environment);
    this.config = environmentConfig.getConfig(env);

    // Validate the final configuration
    const configValidation = this.validator.validateConfiguration(this.config, this.environment);
    if (!configValidation.isValid) {
      throw new ConfigurationError(
        'Configuration validation failed',
        configValidation.errors
      );
    }

    // Log warnings if any
    if (configValidation.warnings.length > 0) {
      console.warn('Configuration warnings:');
      configValidation.warnings.forEach(warning => console.warn(`  - ${warning}`));
    }

    return this.config;
  }

  public getEnvironment(): Environment {
    return this.environment;
  }

  public reloadConfiguration(): BankingMCPServerConfig {
    this.config = undefined;
    return this.loadConfiguration();
  }

  public validateCurrentConfiguration(): void {
    if (!this.config) {
      throw new ConfigurationError('No configuration loaded. Call loadConfiguration() first.');
    }

    const validation = this.validator.validateConfiguration(this.config, this.environment);
    if (!validation.isValid) {
      throw new ConfigurationError(
        'Current configuration is invalid',
        validation.errors
      );
    }
  }
}

// Legacy functions for backward compatibility
export function loadConfiguration(): BankingMCPServerConfig {
  const manager = new ConfigurationManager();
  return manager.loadConfiguration();
}

export function validateConfiguration(config: BankingMCPServerConfig): void {
  const validator = new ConfigurationValidator();
  const environment = getCurrentEnvironment();
  const validation = validator.validateConfiguration(config, environment);
  
  if (!validation.isValid) {
    const errorMessages = validation.errors.map(error => error.message).join('; ');
    throw new ConfigurationError(errorMessages, validation.errors);
  }
}

// Export all configuration functionality
export * from '../interfaces/config';
export * from './environments';
export * from './validator';
export * from './loader';

// Export the main configuration manager as default
export { ConfigurationManager as default } from './index';