#!/usr/bin/env node
/**
 * Create Example Configuration Script
 * Generates example configuration files for different environments
 */

const fs = require('fs');
const path = require('path');

const ENVIRONMENTS = {
  development: {
    description: 'Development environment configuration',
    config: {
      // Server configuration
      MCP_SERVER_HOST: 'localhost',
      MCP_SERVER_PORT: '8080',
      MAX_CONNECTIONS: '10',
      SESSION_TIMEOUT: '1800',

      // PingOne AI IAM Core configuration (required - replace with your values)
      PINGONE_BASE_URL: 'https://your-environment-id.forgeblocks.com:443',
      PINGONE_CLIENT_ID: 'your-client-id-here',
      PINGONE_CLIENT_SECRET: 'your-client-secret-here',
      PINGONE_INTROSPECTION_ENDPOINT: 'https://your-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/introspect',
      PINGONE_AUTHORIZATION_ENDPOINT: 'https://your-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      PINGONE_TOKEN_ENDPOINT: 'https://your-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token',

      // Banking API configuration
      BANKING_API_BASE_URL: 'http://localhost:3001',
      BANKING_API_TIMEOUT: '10000',
      BANKING_API_MAX_RETRIES: '2',
      CIRCUIT_BREAKER_THRESHOLD: '3',

      // Security configuration (required)
      ENCRYPTION_KEY: 'your-64-character-encryption-key-here-replace-with-secure-random-key',
      TOKEN_STORAGE_PATH: './dev-data/tokens',
      SESSION_CLEANUP_INTERVAL: '60',
      MAX_SESSION_DURATION: '7200',

      // Logging configuration
      LOG_LEVEL: 'DEBUG',
      AUDIT_LOG_PATH: './dev-logs/audit.log',
      SECURITY_LOG_PATH: './dev-logs/security.log'
    }
  },
  
  staging: {
    description: 'Staging environment configuration',
    config: {
      // Server configuration
      MCP_SERVER_HOST: '0.0.0.0',
      MCP_SERVER_PORT: '8080',
      MAX_CONNECTIONS: '50',
      SESSION_TIMEOUT: '3600',

      // PingOne AI IAM Core configuration (required - replace with your values)
      PINGONE_BASE_URL: 'https://your-staging-environment-id.forgeblocks.com:443',
      PINGONE_CLIENT_ID: 'your-staging-client-id-here',
      PINGONE_CLIENT_SECRET: 'your-staging-client-secret-here',
      PINGONE_INTROSPECTION_ENDPOINT: 'https://your-staging-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/introspect',
      PINGONE_AUTHORIZATION_ENDPOINT: 'https://your-staging-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      PINGONE_TOKEN_ENDPOINT: 'https://your-staging-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token',

      // Banking API configuration
      BANKING_API_BASE_URL: 'https://staging-banking-api.example.com',
      BANKING_API_TIMEOUT: '20000',
      BANKING_API_MAX_RETRIES: '3',
      CIRCUIT_BREAKER_THRESHOLD: '5',

      // Security configuration (required)
      ENCRYPTION_KEY: 'your-64-character-encryption-key-here-replace-with-secure-random-key',
      TOKEN_STORAGE_PATH: '/app/data/tokens',
      SESSION_CLEANUP_INTERVAL: '300',
      MAX_SESSION_DURATION: '43200',

      // Logging configuration
      LOG_LEVEL: 'INFO',
      AUDIT_LOG_PATH: '/app/logs/audit.log',
      SECURITY_LOG_PATH: '/app/logs/security.log'
    }
  },
  
  production: {
    description: 'Production environment configuration',
    config: {
      // Server configuration
      MCP_SERVER_HOST: '0.0.0.0',
      MCP_SERVER_PORT: '8080',
      MAX_CONNECTIONS: '200',
      SESSION_TIMEOUT: '3600',

      // PingOne AI IAM Core configuration (required - replace with your values)
      PINGONE_BASE_URL: 'https://your-production-environment-id.forgeblocks.com:443',
      PINGONE_CLIENT_ID: 'your-production-client-id-here',
      PINGONE_CLIENT_SECRET: 'your-production-client-secret-here',
      PINGONE_INTROSPECTION_ENDPOINT: 'https://your-production-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/introspect',
      PINGONE_AUTHORIZATION_ENDPOINT: 'https://your-production-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      PINGONE_TOKEN_ENDPOINT: 'https://your-production-environment-id.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token',

      // Banking API configuration
      BANKING_API_BASE_URL: 'https://banking-api.example.com',
      BANKING_API_TIMEOUT: '30000',
      BANKING_API_MAX_RETRIES: '3',
      CIRCUIT_BREAKER_THRESHOLD: '10',

      // Security configuration (required)
      ENCRYPTION_KEY: 'your-64-character-encryption-key-here-replace-with-secure-random-key',
      TOKEN_STORAGE_PATH: '/app/data/tokens',
      SESSION_CLEANUP_INTERVAL: '300',
      MAX_SESSION_DURATION: '86400',

      // Logging configuration
      LOG_LEVEL: 'WARN',
      AUDIT_LOG_PATH: '/app/logs/audit.log',
      SECURITY_LOG_PATH: '/app/logs/security.log'
    }
  }
};

function generateSecureKey(length = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function createConfigFile(environment, outputPath, generateKeys = false) {
  const envConfig = ENVIRONMENTS[environment];
  if (!envConfig) {
    throw new Error(`Unknown environment: ${environment}`);
  }
  
  const config = { ...envConfig.config };
  
  // Generate secure encryption key if requested
  if (generateKeys) {
    config.ENCRYPTION_KEY = generateSecureKey(64);
  }
  
  const header = `# ${envConfig.description}
# Generated on: ${new Date().toISOString()}
# 
# IMPORTANT SECURITY NOTES:
# 1. Replace all placeholder values with your actual configuration
# 2. Never commit this file with real secrets to version control
# 3. Use environment variables or secure secret management in production
# 4. Ensure the ENCRYPTION_KEY is at least 64 characters long
# 5. Use HTTPS URLs for all PingOne endpoints
#
# Usage:
# - Copy this file to .env (for development)
# - Set these as environment variables (for production)
# - Use with docker: docker run --env-file .env.${environment} banking-mcp-server
#

`;
  
  const content = header + Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
  
  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, content);
  
  return {
    path: outputPath,
    environment,
    description: envConfig.description,
    generatedKeys: generateKeys
  };
}

function createDockerEnvFile(environment, outputPath) {
  const envConfig = ENVIRONMENTS[environment];
  if (!envConfig) {
    throw new Error(`Unknown environment: ${environment}`);
  }
  
  const config = { ...envConfig.config };
  
  // Docker-specific adjustments
  if (environment === 'production' || environment === 'staging') {
    config.MCP_SERVER_HOST = '0.0.0.0';
    config.TOKEN_STORAGE_PATH = '/app/data/tokens';
    config.AUDIT_LOG_PATH = '/app/logs/audit.log';
    config.SECURITY_LOG_PATH = '/app/logs/security.log';
  }
  
  const header = `# Docker environment file for ${environment}
# Generated on: ${new Date().toISOString()}
# 
# This file is used with Docker containers
# Usage: docker run --env-file ${path.basename(outputPath)} banking-mcp-server
#

`;
  
  const content = header + Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
  
  fs.writeFileSync(outputPath, content);
  
  return {
    path: outputPath,
    environment,
    type: 'docker'
  };
}

function main() {
  const args = process.argv.slice(2);
  const environment = args[0] || 'development';
  const outputPath = args[1];
  const generateKeys = args.includes('--generate-keys');
  const dockerFormat = args.includes('--docker');
  
  console.log('🏦 Banking MCP Server - Configuration Generator\n');
  console.log('===============================================\n');
  
  if (!ENVIRONMENTS[environment]) {
    console.error(`❌ Unknown environment: ${environment}`);
    console.error(`Available environments: ${Object.keys(ENVIRONMENTS).join(', ')}`);
    process.exit(1);
  }
  
  try {
    let result;
    
    if (outputPath) {
      // Generate specific file
      if (dockerFormat) {
        result = createDockerEnvFile(environment, outputPath);
        console.log(`✅ Created Docker environment file: ${result.path}`);
      } else {
        result = createConfigFile(environment, outputPath, generateKeys);
        console.log(`✅ Created ${result.environment} configuration: ${result.path}`);
        if (result.generatedKeys) {
          console.log('🔑 Generated secure encryption key');
        }
      }
    } else {
      // Generate all environment files
      const results = [];
      
      for (const env of Object.keys(ENVIRONMENTS)) {
        const filename = `.env.${env}`;
        const result = createConfigFile(env, filename, generateKeys);
        results.push(result);
        console.log(`✅ Created ${result.environment} configuration: ${result.path}`);
      }
      
      // Also create Docker environment files
      for (const env of Object.keys(ENVIRONMENTS)) {
        const filename = `.env.docker.${env}`;
        const result = createDockerEnvFile(env, filename);
        results.push(result);
        console.log(`✅ Created Docker ${result.environment} configuration: ${result.path}`);
      }
      
      if (generateKeys) {
        console.log('🔑 Generated secure encryption keys for all environments');
      }
    }
    
    console.log('\n📋 Next Steps:\n');
    console.log('1. Review and update the generated configuration files');
    console.log('2. Replace placeholder values with your actual PingOne configuration');
    console.log('3. Ensure encryption keys are secure and properly stored');
    console.log('4. Validate configuration: npm run config:validate');
    console.log('5. Never commit files with real secrets to version control');
    
  } catch (error) {
    console.error(`❌ Error creating configuration: ${error.message}`);
    process.exit(1);
  }
}

// Handle script execution
if (require.main === module) {
  main();
}

module.exports = { createConfigFile, createDockerEnvFile, generateSecureKey };