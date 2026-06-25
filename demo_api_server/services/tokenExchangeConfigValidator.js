/**
 * Token Exchange Configuration Validator
 * Comprehensive validation for RFC 8693 token exchange configuration
 * 
 * Phase 56-03: Configuration and Environment Validation
 */

const configStore = require('./configStore');

/**
 * Validates token exchange configuration with detailed reporting
 * @returns {Object} Validation result with recommendations
 */
function validateTokenExchangeConfig() {
  const result = {
    valid: true,
    mode: 'unknown',
    missing: [],
    warnings: [],
    recommendations: [],
    sections: {
      single: { valid: true, missing: [], warnings: [] },
      double: { valid: true, missing: [], warnings: [] },
      common: { valid: true, missing: [], warnings: [] }
    }
  };

  // Common configuration validation
  validateCommonConfig(result);
  
  // Single exchange validation
  validateSingleExchangeConfig(result);
  
  // Double exchange validation  
  validateDoubleExchangeConfig(result);
  
  // Determine overall mode and validity
  determineExchangeMode(result);
  
  return result;
}

/**
 * Validates common configuration required for all exchange modes
 */
function validateCommonConfig(result) {
  const common = result.sections.common;
  
  // Required PingOne configuration
  const requiredCommon = [
    { key: 'pingone_environment_id', name: 'PingOne Environment ID', critical: true },
    { key: 'pingone_region', name: 'PingOne Region', critical: true },
    { key: 'pingone_core_client_id', name: 'PingOne Core Client ID', critical: true },
    { key: 'pingone_core_client_secret', name: 'PingOne Core Client Secret', critical: true }
  ];
  
  requiredCommon.forEach(({ key, name, critical }) => {
    const value = configStore.getEffective(key) || process.env[getEnvVarName(key)];
    if (!value) {
      common.missing.push({ key, name, critical });
      common.valid = false;
      result.missing.push(name);
    }
  });
  
  // Optional but recommended configuration
  const recommendedCommon = [
    { key: 'pingone_resource_mcp_server_uri', name: 'MCP Resource URI (PINGONE_RESOURCE_MCP_SERVER_URI)', reason: 'Required for token exchange audience — maps to Super Banking MCP Server in PingOne' },
    { key: 'mcp_server_url', name: 'MCP Server URL', reason: 'Required for WebSocket connection' }
  ];
  
  recommendedCommon.forEach(({ key, name, reason }) => {
    const value = configStore.getEffective(key) || process.env[getEnvVarName(key)];
    if (!value) {
      common.warnings.push({ key, name, reason });
      result.warnings.push(`${name} recommended: ${reason}`);
    }
  });
  
  // Validate MCP resource URI format
  const mcpResourceUri = configStore.getEffective('pingone_resource_mcp_server_uri');
  if (mcpResourceUri && !isValidUrl(mcpResourceUri)) {
    common.warnings.push({ 
      key: 'pingone_resource_mcp_server_uri', 
      name: 'MCP Resource URI (PINGONE_RESOURCE_MCP_SERVER_URI)', 
      reason: 'Invalid URL format' 
    });
    result.warnings.push('MCP Resource URI has invalid URL format');
  }
}

/**
 * Validates single exchange configuration
 */
function validateSingleExchangeConfig(result) {
  const single = result.sections.single;
  
  // Single exchange specific configuration
  const singleRequired = [
    { key: 'admin_client_id', name: 'Admin Client ID', critical: true },
    { key: 'admin_client_secret', name: 'Admin Client Secret', critical: true }
  ];
  
  singleRequired.forEach(({ key, name, critical }) => {
    const value = configStore.getEffective(key) || process.env[getEnvVarName(key)];
    if (!value) {
      single.missing.push({ key, name, critical });
      single.valid = false;
    }
  });
  
  // Feature flag validation
  const ffTwoExchange = configStore.getEffective('ff_two_exchange_delegation') === 'true';
  if (!ffTwoExchange && !single.valid) {
    single.warnings.push({
      key: 'ff_two_exchange_delegation',
      name: 'Two-Exchange Feature Flag',
      reason: 'Single exchange mode enabled but admin credentials missing'
    });
  }
}

/**
 * Validates double exchange configuration
 */
function validateDoubleExchangeConfig(result) {
  const double = result.sections.double;
  
  // Double exchange specific configuration
  const doubleRequired = [
    { key: 'pingone_ai_agent_client_id', name: 'AI Agent Client ID (PINGONE_AI_AGENT_CLIENT_ID — Super Banking AI Agent App)', critical: true },
    { key: 'pingone_ai_agent_client_secret', name: 'AI Agent Client Secret (PINGONE_AI_AGENT_CLIENT_SECRET)', critical: true },
    { key: 'pingone_mcp_token_exchanger_client_id', name: 'MCP Token Exchanger Client ID (PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID — Super Banking MCP Token Exchanger)', critical: true },
    { key: 'pingone_mcp_token_exchanger_client_secret', name: 'MCP Token Exchanger Client Secret (PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET)', critical: true }
  ];
  
  doubleRequired.forEach(({ key, name, critical }) => {
    const value = configStore.getEffective(key) || process.env[getEnvVarName(key)];
    if (!value) {
      double.missing.push({ key, name, critical });
      double.valid = false;
    }
  });
  
  // Audience configuration validation
  const audienceConfig = [
    { key: 'agent_gateway_audience', name: 'Agent Gateway Audience', reason: 'Required for AI actor token' },
    { key: 'mcp_gateway_audience', name: 'MCP Gateway Audience', reason: 'Required for MCP actor token' },
    { key: 'mcp_resource_uri_two_exchange', name: 'Two-Exchange Resource URI', reason: 'Required for final token audience' }
  ];
  
  audienceConfig.forEach(({ key, name, reason }) => {
    const value = configStore.getEffective(key) || process.env[getEnvVarName(key)];
    if (!value) {
      double.warnings.push({ key, name, reason });
    } else if (!isValidUrl(value)) {
      double.warnings.push({ key, name, reason: 'Invalid URL format' });
    }
  });
  
  // Authentication method validation
  const authMethods = [
    { key: 'ai_agent_token_endpoint_auth_method', name: 'AI Agent Auth Method' },
    { key: 'mcp_exchanger_token_endpoint_auth_method', name: 'MCP Exchanger Auth Method' }
  ];
  
  authMethods.forEach(({ key, name }) => {
    const value = configStore.getEffective(key) || process.env[getEnvVarName(key)];
    if (value && !['basic', 'post'].includes(value.toLowerCase())) {
      double.warnings.push({ 
        key, 
        name, 
        reason: 'Invalid auth method (must be "basic" or "post")' 
      });
    }
  });
}

/**
 * Determines the exchange mode and overall validity
 */
function determineExchangeMode(result) {
  const ffTwoExchange = configStore.getEffective('ff_two_exchange_delegation') === 'true';
  const singleValid = result.sections.single.valid;
  const doubleValid = result.sections.double.valid;
  const commonValid = result.sections.common.valid;
  
  if (!commonValid) {
    result.valid = false;
    result.mode = 'invalid';
    result.recommendations.push('Fix common configuration issues first');
    return;
  }
  
  if (ffTwoExchange) {
    result.mode = doubleValid ? 'double' : 'double-incomplete';
    result.valid = doubleValid;
    if (!doubleValid) {
      result.recommendations.push('Configure double exchange credentials or disable ff_two_exchange_delegation');
    }
  } else {
    result.mode = singleValid ? 'single' : 'single-incomplete';
    result.valid = singleValid;
    if (!singleValid) {
      result.recommendations.push('Configure single exchange credentials or enable ff_two_exchange_delegation');
    }
  }
  
  // Mode-specific recommendations
  if (result.mode === 'single') {
    result.recommendations.push('Consider enabling two-exchange delegation for enhanced security');
  } else if (result.mode === 'double') {
    result.recommendations.push('Two-exchange delegation is properly configured');
  }
}

/**
 * Maps config keys to environment variable names
 */
function getEnvVarName(configKey) {
  const envVarMap = {
    'pingone_environment_id': 'PINGONE_ENVIRONMENT_ID',
    'pingone_region': 'PINGONE_REGION',
    'pingone_core_client_id': 'PINGONE_CORE_CLIENT_ID',
    'pingone_core_client_secret': 'PINGONE_CORE_CLIENT_SECRET',
    'admin_client_id': 'ADMIN_CLIENT_ID',
    'admin_client_secret': 'ADMIN_CLIENT_SECRET',
    'pingone_ai_agent_client_id': 'PINGONE_AI_AGENT_CLIENT_ID',
    'pingone_ai_agent_client_secret': 'PINGONE_AI_AGENT_CLIENT_SECRET',
    'pingone_mcp_token_exchanger_client_id': 'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID',
    'pingone_mcp_token_exchanger_client_secret': 'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET',
    // backward-compat aliases (read from configStore which already maps old → new)
    'ai_agent_client_id': 'PINGONE_AI_AGENT_CLIENT_ID',
    'ai_agent_client_secret': 'PINGONE_AI_AGENT_CLIENT_SECRET',
    'agent_oauth_client_id': 'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID',
    'agent_oauth_client_secret': 'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET',
    'agent_gateway_audience': 'AGENT_GATEWAY_AUDIENCE',
    'mcp_gateway_audience': 'PINGONE_RESOURCE_MCP_GATEWAY_URI',
    'pingone_resource_mcp_server_uri': 'PINGONE_RESOURCE_MCP_SERVER_URI',
    'mcp_resource_uri': 'PINGONE_RESOURCE_MCP_SERVER_URI',
    'mcp_resource_uri_two_exchange': 'PINGONE_RESOURCE_TWO_EXCHANGE_URI',
    'mcp_server_url': 'MCP_SERVER_URL',
    'ai_agent_token_endpoint_auth_method': 'AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD',
    'mcp_exchanger_token_endpoint_auth_method': 'MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD'
  };
  
  return envVarMap[configKey] || configKey.toUpperCase();
}

/**
 * Validates URL format
 */
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Generates configuration report for documentation
 */
function generateConfigReport() {
  const validation = validateTokenExchangeConfig();
  
  return {
    timestamp: new Date().toISOString(),
    exchangeMode: validation.mode,
    isValid: validation.valid,
    summary: {
      totalMissing: validation.missing.length,
      totalWarnings: validation.warnings.length,
      sections: {
        common: validation.sections.common.valid,
        single: validation.sections.single.valid,
        double: validation.sections.double.valid
      }
    },
    details: validation,
    recommendations: validation.recommendations
  };
}

/**
 * Validates configuration for specific exchange mode
 */
function validateExchangeMode(mode) {
  const validation = validateTokenExchangeConfig();
  
  if (mode === 'single') {
    return {
      valid: validation.sections.common.valid && validation.sections.single.valid,
      issues: [...validation.sections.common.missing, ...validation.sections.single.missing],
      warnings: [...validation.sections.common.warnings, ...validation.sections.single.warnings]
    };
  } else if (mode === 'double') {
    return {
      valid: validation.sections.common.valid && validation.sections.double.valid,
      issues: [...validation.sections.common.missing, ...validation.sections.double.missing],
      warnings: [...validation.sections.common.warnings, ...validation.sections.double.warnings]
    };
  }
  
  return validation;
}

module.exports = {
  validateTokenExchangeConfig,
  generateConfigReport,
  validateExchangeMode
};
