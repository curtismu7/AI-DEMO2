#!/usr/bin/env node
/**
 * Configuration Validation Script
 * Validates configuration files and environment variables
 */

const fs = require('fs');
const path = require('path');

// Required environment variables
const REQUIRED_ENV_VARS = [
  'PINGONE_BASE_URL',
  'PINGONE_CLIENT_ID',
  'PINGONE_CLIENT_SECRET',
  'PINGONE_INTROSPECTION_ENDPOINT',
  'PINGONE_AUTHORIZATION_ENDPOINT',
  'PINGONE_TOKEN_ENDPOINT',
  'ENCRYPTION_KEY'
];

// Optional environment variables with validation
const OPTIONAL_ENV_VARS = {
  MCP_SERVER_HOST: { type: 'string', default: '0.0.0.0' },
  MCP_SERVER_PORT: { type: 'number', default: 8080, min: 1, max: 65535 },
  MAX_CONNECTIONS: { type: 'number', default: 100, min: 1 },
  SESSION_TIMEOUT: { type: 'number', default: 3600, min: 60 },
  BANKING_API_BASE_URL: { type: 'url', default: 'http://localhost:3001' },
  BANKING_API_TIMEOUT: { type: 'number', default: 30000, min: 1000 },
  BANKING_API_MAX_RETRIES: { type: 'number', default: 3, min: 0 },
  CIRCUIT_BREAKER_THRESHOLD: { type: 'number', default: 5, min: 1 },
  TOKEN_STORAGE_PATH: { type: 'string', default: './data/tokens' },
  SESSION_CLEANUP_INTERVAL: { type: 'number', default: 300, min: 30 },
  MAX_SESSION_DURATION: { type: 'number', default: 86400, min: 3600 },
  LOG_LEVEL: { type: 'enum', values: ['ERROR', 'WARN', 'INFO', 'DEBUG'], default: 'INFO' },
  AUDIT_LOG_PATH: { type: 'string', default: './logs/audit.log' },
  SECURITY_LOG_PATH: { type: 'string', default: './logs/security.log' }
};

function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function validateEnvironmentVariables() {
  const errors = [];
  const warnings = [];
  
  console.log('🔍 Validating environment variables...\n');
  
  // Check required variables
  for (const varName of REQUIRED_ENV_VARS) {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      errors.push(`❌ Required environment variable ${varName} is missing or empty`);
    } else {
      console.log(`✅ ${varName}: Set`);
      
      // Additional validation for specific variables
      if (varName.includes('URL') || varName.includes('ENDPOINT')) {
        if (!validateUrl(value)) {
          errors.push(`❌ ${varName} is not a valid URL: ${value}`);
        } else if (!value.startsWith('https://')) {
          warnings.push(`⚠️  ${varName} should use HTTPS for security`);
        }
      }
      
      if (varName === 'ENCRYPTION_KEY') {
        if (value.length < 32) {
          errors.push(`❌ ${varName} must be at least 32 characters long`);
        } else if (value.length < 64) {
          warnings.push(`⚠️  ${varName} should be at least 64 characters for better security`);
        }
      }
    }
  }
  
  console.log('');
  
  // Check optional variables
  for (const [varName, config] of Object.entries(OPTIONAL_ENV_VARS)) {
    const value = process.env[varName];
    
    if (value) {
      let isValid = true;
      
      switch (config.type) {
        case 'number':
          const numValue = parseInt(value);
          if (isNaN(numValue)) {
            errors.push(`❌ ${varName} must be a valid number: ${value}`);
            isValid = false;
          } else {
            if (config.min !== undefined && numValue < config.min) {
              errors.push(`❌ ${varName} must be at least ${config.min}: ${numValue}`);
              isValid = false;
            }
            if (config.max !== undefined && numValue > config.max) {
              errors.push(`❌ ${varName} must be at most ${config.max}: ${numValue}`);
              isValid = false;
            }
          }
          break;
          
        case 'url':
          if (!validateUrl(value)) {
            errors.push(`❌ ${varName} is not a valid URL: ${value}`);
            isValid = false;
          }
          break;
          
        case 'enum':
          if (!config.values.includes(value.toUpperCase())) {
            errors.push(`❌ ${varName} must be one of: ${config.values.join(', ')}`);
            isValid = false;
          }
          break;
      }
      
      if (isValid) {
        console.log(`✅ ${varName}: ${value}`);
      }
    } else {
      console.log(`ℹ️  ${varName}: Using default (${config.default})`);
    }
  }
  
  return { errors, warnings };
}

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const config = {};
  
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }
    
    // Parse KEY=value format
    const equalIndex = trimmedLine.indexOf('=');
    if (equalIndex > 0) {
      const key = trimmedLine.substring(0, equalIndex).trim();
      let value = trimmedLine.substring(equalIndex + 1).trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      config[key] = value;
    }
  }
  
  return config;
}

function validateConfigFile(filePath) {
  console.log(`\n🔍 Validating configuration file: ${filePath}\n`);
  
  if (!fs.existsSync(filePath)) {
    return { errors: [`❌ Configuration file not found: ${filePath}`], warnings: [] };
  }
  
  try {
    const fileExtension = path.extname(filePath).toLowerCase();
    let config;
    
    if (fileExtension === '.json') {
      // Parse JSON files
      const content = fs.readFileSync(filePath, 'utf8');
      config = JSON.parse(content);
    } else if (filePath.includes('.env') || fileExtension === '.env') {
      // Parse .env files
      config = parseEnvFile(filePath);
    } else {
      return { 
        errors: [`❌ Unsupported file format: ${filePath}. Supported formats: .json, .env`], 
        warnings: [] 
      };
    }
    
    const errors = [];
    const warnings = [];
    
    // Validate required fields
    for (const field of REQUIRED_ENV_VARS) {
      if (!config[field] || config[field].trim() === '') {
        errors.push(`❌ Missing required field: ${field}`);
      } else if (config[field].includes('your-') || config[field].includes('replace-with')) {
        errors.push(`❌ Field ${field} contains placeholder value, please update with actual configuration`);
      } else {
        console.log(`✅ ${field}: Set`);
        
        // Additional validation for specific fields
        if (field.includes('URL') || field.includes('ENDPOINT')) {
          if (!validateUrl(config[field])) {
            errors.push(`❌ ${field} is not a valid URL: ${config[field]}`);
          } else if (!config[field].startsWith('https://')) {
            warnings.push(`⚠️  ${field} should use HTTPS for security`);
          }
        }
        
        if (field === 'ENCRYPTION_KEY') {
          if (config[field].length < 32) {
            errors.push(`❌ ${field} must be at least 32 characters long`);
          } else if (config[field].length < 64) {
            warnings.push(`⚠️  ${field} should be at least 64 characters for better security`);
          }
        }
      }
    }
    
    // Validate optional fields
    for (const [field, validation] of Object.entries(OPTIONAL_ENV_VARS)) {
      if (config[field]) {
        let isValid = true;
        
        switch (validation.type) {
          case 'number':
            const numValue = parseInt(config[field]);
            if (isNaN(numValue)) {
              errors.push(`❌ ${field} must be a valid number: ${config[field]}`);
              isValid = false;
            } else {
              if (validation.min !== undefined && numValue < validation.min) {
                errors.push(`❌ ${field} must be at least ${validation.min}: ${numValue}`);
                isValid = false;
              }
              if (validation.max !== undefined && numValue > validation.max) {
                errors.push(`❌ ${field} must be at most ${validation.max}: ${numValue}`);
                isValid = false;
              }
            }
            break;
            
          case 'url':
            if (!validateUrl(config[field])) {
              errors.push(`❌ ${field} is not a valid URL: ${config[field]}`);
              isValid = false;
            }
            break;
            
          case 'enum':
            if (!validation.values.includes(config[field].toUpperCase())) {
              errors.push(`❌ ${field} must be one of: ${validation.values.join(', ')}`);
              isValid = false;
            }
            break;
        }
        
        if (isValid) {
          console.log(`✅ ${field}: ${config[field]}`);
        }
      }
    }
    
    return { errors, warnings };
    
  } catch (error) {
    return { 
      errors: [`❌ Failed to parse configuration file: ${error.message}`], 
      warnings: [] 
    };
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  
  try {
    const config = parseEnvFile(filePath);
    
    // Load config into process.env for validation
    for (const [key, value] of Object.entries(config)) {
      if (!process.env[key]) {  // Don't override existing env vars
        process.env[key] = value;
      }
    }
    
    console.log(`📁 Loaded configuration from: ${filePath}\n`);
  } catch (error) {
    console.log(`❌ Failed to load configuration file: ${error.message}\n`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const configFile = args[0];
  
  console.log('🏦 Banking MCP Server - Configuration Validator\n');
  console.log('================================================\n');
  
  let totalErrors = 0;
  let totalWarnings = 0;
  
  // Load config file into environment if provided
  if (configFile) {
    loadEnvFile(configFile);
  }
  
  // Validate environment variables (now includes loaded config)
  const envValidation = validateEnvironmentVariables();
  totalErrors += envValidation.errors.length;
  totalWarnings += envValidation.warnings.length;
  
  // Validate config file structure if provided
  if (configFile) {
    const fileValidation = validateConfigFile(configFile);
    
    // Only count structural errors, not missing values (already counted in env validation)
    const structuralErrors = fileValidation.errors.filter(error => 
      !error.includes('Missing required field') && 
      !error.includes('placeholder value')
    );
    
    totalErrors += structuralErrors.length;
    totalWarnings += fileValidation.warnings.length;
    
    // Print structural errors
    structuralErrors.forEach(error => console.log(error));
    fileValidation.warnings.forEach(warning => console.log(warning));
  }
  
  // Print environment validation results
  console.log('\n📋 Validation Summary\n');
  console.log('====================\n');
  
  envValidation.errors.forEach(error => console.log(error));
  envValidation.warnings.forEach(warning => console.log(warning));
  
  console.log(`\n📊 Results: ${totalErrors} errors, ${totalWarnings} warnings\n`);
  
  if (totalErrors > 0) {
    console.log('❌ Configuration validation failed. Please fix the errors above.');
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log('⚠️  Configuration validation passed with warnings. Consider addressing them for better security.');
    process.exit(0);
  } else {
    console.log('✅ Configuration validation passed successfully!');
    process.exit(0);
  }
}

// Handle script execution
if (require.main === module) {
  main();
}

module.exports = { validateEnvironmentVariables, validateConfigFile };