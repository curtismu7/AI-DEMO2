/**
 * Configuration Tests
 * Tests for configuration loading and validation
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadConfiguration,
  ConfigurationError,
  ConfigurationManager,
  Environment,
  ConfigurationValidator,
  SecureConfigurationLoader,
  createExampleConfig,
  validateConfigFile
} from '../../src/config';
import { BankingMCPServerConfig } from '../../src/interfaces/config';

describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('loadConfiguration (legacy)', () => {
    it('should load configuration with all required environment variables', () => {
      // Set required environment variables
      process.env.NODE_ENV = 'development'; // Explicitly set environment
      process.env.PINGONE_BASE_URL = 'https://test.pingidentity.com';
      process.env.PINGONE_CLIENT_ID = 'test-client-id';
      process.env.PINGONE_CLIENT_SECRET = 'test-client-secret';
      process.env.PINGONE_INTROSPECTION_ENDPOINT = 'https://test.pingidentity.com/introspect';
      process.env.PINGONE_AUTHORIZATION_ENDPOINT = 'https://test.pingidentity.com/authorize';
      process.env.PINGONE_TOKEN_ENDPOINT = 'https://test.pingidentity.com/token';
      process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters-long-enough-for-validation';

      const config = loadConfiguration();

      expect(config).toBeDefined();
      expect(config.pingone.baseUrl).toBe('https://test.pingidentity.com');
      expect(config.pingone.clientId).toBe('test-client-id');
      expect(config.security.encryptionKey).toBe('test-encryption-key-32-characters-long-enough-for-validation');
    });

    it('should throw error when required environment variables are missing', () => {
      // Clear required environment variables
      delete process.env.PINGONE_BASE_URL;
      delete process.env.ENCRYPTION_KEY;

      expect(() => loadConfiguration()).toThrow(ConfigurationError);
    });
  });

  describe('ConfigurationManager', () => {
    let manager: ConfigurationManager;

    beforeEach(() => {
      // Set required environment variables
      process.env.PINGONE_BASE_URL = 'https://test.pingidentity.com';
      process.env.PINGONE_CLIENT_ID = 'test-client-id';
      process.env.PINGONE_CLIENT_SECRET = 'test-client-secret';
      process.env.PINGONE_INTROSPECTION_ENDPOINT = 'https://test.pingidentity.com/introspect';
      process.env.PINGONE_AUTHORIZATION_ENDPOINT = 'https://test.pingidentity.com/authorize';
      process.env.PINGONE_TOKEN_ENDPOINT = 'https://test.pingidentity.com/token';
      process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters-long';
    });

    it('should load development configuration', () => {
      manager = new ConfigurationManager(Environment.DEVELOPMENT);
      const config = manager.loadConfiguration();

      expect(config.server.host).toBe('localhost');
      expect(config.logging.level).toBe('DEBUG');
      expect(config.server.maxConnections).toBe(10);
    });

    it('should load production configuration', () => {
      manager = new ConfigurationManager(Environment.PRODUCTION);
      const config = manager.loadConfiguration();

      expect(config.server.host).toBe('0.0.0.0');
      expect(config.logging.level).toBe('WARN');
      expect(config.server.maxConnections).toBe(200);
    });

    it('should load test configuration', () => {
      // Use a longer encryption key for test environment
      process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters-long-enough-for-validation';
      
      manager = new ConfigurationManager(Environment.TEST);
      const config = manager.loadConfiguration();

      expect(config.server.host).toBe('localhost');
      expect(config.logging.level).toBe('ERROR');
      expect(config.server.maxConnections).toBe(5);
    });

    it('should cache configuration after first load', () => {
      manager = new ConfigurationManager(Environment.DEVELOPMENT);
      const config1 = manager.loadConfiguration();
      const config2 = manager.loadConfiguration();

      expect(config1).toBe(config2); // Same object reference
    });

    it('should reload configuration when requested', () => {
      manager = new ConfigurationManager(Environment.DEVELOPMENT);
      const config1 = manager.loadConfiguration();
      
      // Change environment variable
      process.env.MCP_SERVER_PORT = '9090';
      
      const config2 = manager.reloadConfiguration();
      expect(config2.server.port).toBe(9090);
      expect(config1).not.toBe(config2); // Different object reference
    });

    it('should validate current configuration', () => {
      manager = new ConfigurationManager(Environment.DEVELOPMENT);
      manager.loadConfiguration();

      expect(() => manager.validateCurrentConfiguration()).not.toThrow();
    });

    it('should throw error when validating without loading', () => {
      manager = new ConfigurationManager(Environment.DEVELOPMENT);

      expect(() => manager.validateCurrentConfiguration()).toThrow(ConfigurationError);
    });
  });

  describe('ConfigurationValidator', () => {
    let validator: ConfigurationValidator;
    let validConfig: BankingMCPServerConfig;

    beforeEach(() => {
      validator = new ConfigurationValidator();
      validConfig = {
        server: {
          host: '0.0.0.0',
          port: 8080,
          maxConnections: 100,
          sessionTimeout: 3600
        },
        pingone: {
          baseUrl: 'https://test.pingidentity.com',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          tokenIntrospectionEndpoint: 'https://test.pingidentity.com/introspect',
          authorizationEndpoint: 'https://test.pingidentity.com/authorize',
          tokenEndpoint: 'https://test.pingidentity.com/token'
        },
        bankingApi: {
          baseUrl: 'http://localhost:3001',
          timeout: 30000,
          maxRetries: 3,
          circuitBreakerThreshold: 5
        },
        security: {
          encryptionKey: 'test-encryption-key-32-characters-long',
          tokenStoragePath: './data/tokens',
          sessionCleanupInterval: 300,
          maxSessionDuration: 86400
        },
        logging: {
          level: 'INFO',
          auditLogPath: './logs/audit.log',
          securityLogPath: './logs/security.log'
        }
      };
    });

    it('should validate environment variables', () => {
      const env = {
        PINGONE_BASE_URL: 'https://test.pingidentity.com',
        PINGONE_CLIENT_ID: 'test-client-id',
        PINGONE_CLIENT_SECRET: 'test-client-secret',
        PINGONE_INTROSPECTION_ENDPOINT: 'https://test.pingidentity.com/introspect',
        PINGONE_AUTHORIZATION_ENDPOINT: 'https://test.pingidentity.com/authorize',
        PINGONE_TOKEN_ENDPOINT: 'https://test.pingidentity.com/token',
        ENCRYPTION_KEY: 'test-encryption-key-32-characters-long'
      };

      const result = validator.validateEnvironmentVariables(env);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required environment variables', () => {
      const env = {
        PINGONE_BASE_URL: 'https://test.pingidentity.com'
        // Missing other required variables
      } as any;

      const result = validator.validateEnvironmentVariables(env);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate configuration successfully', () => {
      const result = validator.validateConfiguration(validConfig, Environment.DEVELOPMENT);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid server configuration', () => {
      validConfig.server.port = 0;
      const result = validator.validateConfiguration(validConfig, Environment.DEVELOPMENT);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'server.port')).toBe(true);
    });

    it('should detect non-HTTPS PingOne URLs', () => {
      validConfig.pingone.baseUrl = 'http://test.pingidentity.com';
      const result = validator.validateConfiguration(validConfig, Environment.DEVELOPMENT);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'pingone.baseUrl')).toBe(true);
    });

    it('should generate warnings for production environment', () => {
      validConfig.security.encryptionKey = 'test-encryption-key-32-characters'; // Shorter key
      const result = validator.validateConfiguration(validConfig, Environment.PRODUCTION);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('SecureConfigurationLoader', () => {
    let loader: SecureConfigurationLoader;
    const testConfigPath = path.join(__dirname, 'test-config.json');

    beforeEach(() => {
      loader = new SecureConfigurationLoader(Environment.TEST);
    });

    afterEach(() => {
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }
    });

    it('should create example configuration file', () => {
      loader.createExampleConfigFile(testConfigPath, Environment.DEVELOPMENT);
      
      expect(fs.existsSync(testConfigPath)).toBe(true);
      
      const content = fs.readFileSync(testConfigPath, 'utf8');
      const config = JSON.parse(content);
      
      expect(config.PINGONE_BASE_URL).toBeDefined();
      expect(config.ENCRYPTION_KEY).toBeDefined();
      expect(config.LOG_LEVEL).toBe('DEBUG'); // Development default
    });

    it('should validate configuration file', () => {
      const validConfig = {
        PINGONE_BASE_URL: 'https://test.pingidentity.com',
        PINGONE_CLIENT_ID: 'test-client-id',
        PINGONE_CLIENT_SECRET: 'test-client-secret',
        PINGONE_INTROSPECTION_ENDPOINT: 'https://test.pingidentity.com/introspect',
        PINGONE_AUTHORIZATION_ENDPOINT: 'https://test.pingidentity.com/authorize',
        PINGONE_TOKEN_ENDPOINT: 'https://test.pingidentity.com/token',
        ENCRYPTION_KEY: 'test-encryption-key-32-characters-long'
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(validConfig, null, 2));

      const result = loader.validateConfigurationFile(testConfigPath);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid configuration file', () => {
      const invalidConfig = {
        PINGONE_BASE_URL: 'invalid-url',
        // Missing required fields
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(invalidConfig, null, 2));

      const result = loader.validateConfigurationFile(testConfigPath);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle missing configuration file', () => {
      const result = loader.validateConfigurationFile('./non-existent-config.json');
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('not found');
    });
  });

  describe('Utility functions', () => {
    const testConfigPath = path.join(__dirname, 'example-config.json');

    afterEach(() => {
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }
    });

    it('should create example config file', () => {
      createExampleConfig(testConfigPath, Environment.DEVELOPMENT);
      
      expect(fs.existsSync(testConfigPath)).toBe(true);
      
      const content = fs.readFileSync(testConfigPath, 'utf8');
      const config = JSON.parse(content);
      
      expect(config.LOG_LEVEL).toBe('DEBUG');
      expect(config.MAX_CONNECTIONS).toBe('10');
    });

    it('should validate config file', () => {
      const validConfig = {
        PINGONE_BASE_URL: 'https://test.pingidentity.com',
        PINGONE_CLIENT_ID: 'test-client-id',
        PINGONE_CLIENT_SECRET: 'test-client-secret',
        PINGONE_INTROSPECTION_ENDPOINT: 'https://test.pingidentity.com/introspect',
        PINGONE_AUTHORIZATION_ENDPOINT: 'https://test.pingidentity.com/authorize',
        PINGONE_TOKEN_ENDPOINT: 'https://test.pingidentity.com/token',
        ENCRYPTION_KEY: 'test-encryption-key-32-characters-long'
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(validConfig, null, 2));

      const result = validateConfigFile(testConfigPath);
      expect(result.isValid).toBe(true);
    });
  });
});