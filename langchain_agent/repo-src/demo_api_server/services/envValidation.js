/**
 * Environment Variable Validation Service
 * 
 * Validates required environment variables for different deployment scenarios
 * and provides helpful error messages for missing configurations.
 */

'use strict';

const hosting = require('../config/hosting');

// Required environment variables for different scenarios
const REQUIRED_VARS = {
  // Base OAuth configuration (always required)
  base: [
    'PINGONE_CORE_CLIENT_ID',
    'PINGONE_CORE_CLIENT_SECRET',
    'PINGONE_CORE_REDIRECT_URI',
    'PINGONE_ENVIRONMENT_ID',
    'PINGONE_REGION',
  ],

  // 2-exchange delegation configuration
  twoExchange: [
    'USE_AGENT_ACTOR_FOR_MCP',
    'AGENT_OAUTH_CLIENT_ID',
    'AGENT_OAUTH_CLIENT_SECRET',
    'AGENT_OAUTH_CLIENT_SCOPES',
  ],

  // Management API configuration
  managementApi: [
    'PINGONE_MANAGEMENT_API_TOKEN',
  ],

  // Optional but recommended
  recommended: [
    'ADMIN_POPULATION_ID',
    'PINGONE_CORE_USER_CLIENT_ID',
    'PINGONE_CORE_USER_CLIENT_SECRET',
    'PINGONE_CORE_USER_REDIRECT_URI',
  ]
};

/**
 * Validate environment variables and return validation results
 */
function validateEnvironment() {
  const results = {
    valid: true,
    errors: [],
    warnings: [],
    missing: [],
    scenario: null,
    recommendations: []
  };

  // Determine deployment scenario
  results.scenario = determineScenario();

  // Validate base requirements
  validateRequiredVars(REQUIRED_VARS.base, results, 'Base OAuth configuration');

  // Validate scenario-specific requirements
  if (results.scenario.includes('two-exchange')) {
    validateRequiredVars(REQUIRED_VARS.twoExchange, results, '2-exchange delegation');
  }

  if (results.scenario.includes('management-api')) {
    validateRequiredVars(REQUIRED_VARS.managementApi, results, 'Management API');
  }

  // Check recommended variables
  checkRecommendedVars(REQUIRED_VARS.recommended, results);

  // Generate recommendations
  generateRecommendations(results);

  return results;
}

/**
 * Determine the current deployment scenario
 */
function determineScenario() {
  const scenarios = [];

  // Check for 2-exchange delegation
  if (process.env.USE_AGENT_ACTOR_FOR_MCP === 'true') {
    scenarios.push('two-exchange');
  }

  // Check for Management API usage
  if (process.env.PINGONE_MANAGEMENT_API_TOKEN) {
    scenarios.push('management-api');
  }

  return scenarios.length > 0 ? scenarios.join('+') : 'basic';
}

/**
 * Validate a set of required variables
 */
function validateRequiredVars(vars, results, category) {
  const missing = vars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    results.valid = false;
    results.errors.push({
      category,
      missing,
      message: `Missing required environment variables for ${category}`
    });
    results.missing.push(...missing);
  }
}

/**
 * Check recommended variables
 */
function checkRecommendedVars(vars, results) {
  const missing = vars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    results.warnings.push({
      category: 'Recommended',
      missing,
      message: 'Missing recommended environment variables (optional but improves functionality)'
    });
  }
}

/**
 * Generate helpful recommendations based on validation results
 */
function generateRecommendations(results) {
  const recommendations = [];

  // Base OAuth recommendations
  if (results.missing.includes('PINGONE_CORE_CLIENT_ID')) {
    recommendations.push({
      priority: 'high',
      title: 'Set up PingOne OAuth Client',
      description: 'Create a Backend-for-Frontend (BFF) OAuth client in PingOne and configure PINGONE_CORE_CLIENT_ID and PINGONE_CORE_CLIENT_SECRET',
      steps: [
        'Go to PingOne Admin → Applications → Applications',
        'Create a new Web App application',
        'Set the client ID and secret in your environment variables'
      ]
    });
  }

  // 2-exchange recommendations
  if (results.missing.includes('AGENT_OAUTH_CLIENT_ID') && results.scenario.includes('two-exchange')) {
    recommendations.push({
      priority: 'high',
      title: 'Configure Agent OAuth Client',
      description: 'Create a Worker application for the AI agent to enable 2-exchange delegation',
      steps: [
        'Go to PingOne Admin → Applications → Applications',
        'Create a new Worker application',
        'Enable Token Exchange grant on your BFF application',
        'Set AGENT_OAUTH_CLIENT_ID and AGENT_OAUTH_CLIENT_SECRET'
      ]
    });
  }

  // Management API recommendations
  if (results.missing.includes('PINGONE_MANAGEMENT_API_TOKEN') && results.scenario.includes('management-api')) {
    recommendations.push({
      priority: 'medium',
      title: 'Generate Management API Token',
      description: 'Create a service account with Management API access for automation',
      steps: [
        'Go to PingOne Admin → Service Accounts',
        'Create a new service account with Management API scope',
        'Generate and set PINGONE_MANAGEMENT_API_TOKEN'
      ]
    });
  }

  results.recommendations = recommendations;
}

/**
 * Get validation results for API response
 */
function getValidationSummary() {
  const validation = validateEnvironment();
  
  return {
    valid: validation.valid,
    scenario: validation.scenario,
    errorCount: validation.errors.length,
    warningCount: validation.warnings.length,
    missingVars: validation.missing,
    recommendations: validation.recommendations,
    hostedOn: hosting.isReplit() ? 'replit' : 'local'
  };
}

/**
 * Check if 2-exchange delegation is properly configured
 */
function isTwoExchangeConfigured() {
  const required = [
    'USE_AGENT_ACTOR_FOR_MCP',
    'AGENT_OAUTH_CLIENT_ID',
    'AGENT_OAUTH_CLIENT_SECRET'
  ];
  
  return required.every(varName => process.env[varName]);
}

/**
 * Get configuration status for frontend display
 */
function getConfigurationStatus() {
  const validation = validateEnvironment();

  return {
    oauth: {
      configured: REQUIRED_VARS.base.every(varName => process.env[varName]),
      missing: REQUIRED_VARS.base.filter(varName => !process.env[varName])
    },
    twoExchange: {
      enabled: process.env.USE_AGENT_ACTOR_FOR_MCP === 'true',
      configured: isTwoExchangeConfigured(),
      missing: REQUIRED_VARS.twoExchange.filter(varName => !process.env[varName])
    },
    managementApi: {
      available: !!(process.env.PINGONE_MANAGEMENT_API_TOKEN),
      missing: REQUIRED_VARS.managementApi.filter(varName => !process.env[varName])
    },
    overall: {
      valid: validation.valid,
      scenario: validation.scenario,
      readyForProduction: validation.valid
    }
  };
}

module.exports = {
  validateEnvironment,
  getValidationSummary,
  getConfigurationStatus,
  isTwoExchangeConfigured
};
