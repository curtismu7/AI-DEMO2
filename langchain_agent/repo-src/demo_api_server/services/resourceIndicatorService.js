/**
 * resourceIndicatorService.js
 *
 * RFC 8707 Resource Indicators Implementation
 * Provides resource indicator management, validation, and binding for OAuth 2.0 flows.
 */

const crypto = require('crypto');
const configStore = require('./configStore');

/**
 * Resource indicator configuration and definitions
 */
const RESOURCE_DEFINITIONS = {
  'enduser.ping.demo/': {
    name: 'Banking API',
    description: 'Core banking operations and account management',
    scopes: ['read', 'write', 'transactions:read', 'accounts:read'],
    icon: '🏦',
    category: 'core',
    required: false
  },
  'mcpserver.ping.demo/': {
    name: 'AI Agent Server',
    description: 'AI agent and MCP protocol server',
    scopes: ['ai:act', 'ai:read', 'ai:write', 'agent:manage'],
    icon: '🤖',
    category: 'ai',
    required: false
  },
  'https://admin-api.ping.demo/': {
    name: 'Admin API',
    description: 'Administrative operations and user management',
    scopes: ['admin:read', 'admin:write', 'users:manage', 'config:read'],
    icon: '⚙️',
    category: 'admin',
    required: false
  },
  'https://config-api.ping.demo/': {
    name: 'Configuration API',
    description: 'System configuration and settings',
    scopes: ['config:read', 'config:write', 'settings:manage'],
    icon: '🔧',
    category: 'config',
    required: false
  }
};

/**
 * Resource indicator configuration
 */
const RESOURCE_CONFIG = {
  enabled: configStore.getEffective('ff_rfc_9728_enabled') === true,
  defaultResources: ['enduser.ping.demo/'],
  maxResources: configStore.getEffective('max_resources_per_token') || 3,
  requireUserConsent: true,
  resourceSelection: {
    mode: 'user_selectable', // 'auto', 'user_selectable', 'required'
    showDescriptions: true,
    groupByCategory: true,
    allowMultiSelect: true
  },
  validation: {
    strictResourceBinding: true,
    allowSubdomainAccess: false,
    requireExactMatch: true,
    validateResourceFormat: true
  }
};

/**
 * Validate resource URI format according to RFC 8707
 * @param {string} resourceUri - Resource URI to validate
 * @returns {boolean} - True if valid format
 */
function validateResourceFormat(resourceUri) {
  if (!resourceUri || typeof resourceUri !== 'string') {
    return false;
  }

  // RFC 8707: Resource indicators must be absolute URIs
  try {
    const url = new URL(resourceUri);
    
    // Must be HTTPS
    if (url.protocol !== 'https:') {
      return false;
    }
    
    // Must have a hostname
    if (!url.hostname) {
      return false;
    }
    
    // Must end with / (resource indicator convention)
    if (!resourceUri.endsWith('/')) {
      return false;
    }
    
    // Validate against known resource patterns
    const validPatterns = [
      /^https:\/\/.*\.pingdemo\.com\/$/,
      /^https:\/\/pingone\.com\/.*\/$/,
      /^https:\/\/auth\.pingone\..*\/.*\/$/
    ];
    
    return validPatterns.some(pattern => pattern.test(resourceUri));
  } catch (error) {
    return false;
  }
}

/**
 * Get available resources for a client
 * @param {string} clientId - OAuth client ID
 * @returns {Array} - Array of available resource definitions
 */
function getAvailableResources(clientId) {
  const clientConfig = getClientResourceConfig(clientId);
  const availableResources = [];
  
  for (const [resourceUri, definition] of Object.entries(RESOURCE_DEFINITIONS)) {
    if (clientConfig.allowedResources.includes(resourceUri)) {
      availableResources.push({
        uri: resourceUri,
        ...definition
      });
    }
  }
  
  return availableResources;
}

/**
 * Get client-specific resource configuration
 * @param {string} clientId - OAuth client ID
 * @returns {object} - Client resource configuration
 */
function getClientResourceConfig(clientId) {
  const defaultConfig = {
    allowedResources: Object.keys(RESOURCE_DEFINITIONS),
    defaultResources: RESOURCE_CONFIG.defaultResources,
    maxResources: RESOURCE_CONFIG.maxResources,
    requireConsent: RESOURCE_CONFIG.requireUserConsent
  };
  
  // Client-specific configurations
  const clientConfigs = {
    'banking-demo-client': {
      allowedResources: [
        'enduser.ping.demo/',
        'mcpserver.ping.demo/'
      ],
      defaultResources: ['enduser.ping.demo/'],
      maxResources: 2,
      requireConsent: true
    },
    'admin-client': {
      allowedResources: [
        'https://admin-api.ping.demo/',
        'https://config-api.ping.demo/'
      ],
      defaultResources: ['https://admin-api.ping.demo/'],
      maxResources: 2,
      requireConsent: true
    }
  };
  
  return clientConfigs[clientId] || defaultConfig;
}

/**
 * Validate resource selection against client configuration
 * @param {string} clientId - OAuth client ID
 * @param {Array} selectedResources - Selected resource URIs
 * @returns {object} - Validation result
 */
function validateResourceSelection(clientId, selectedResources) {
  const clientConfig = getClientResourceConfig(clientId);
  const errors = [];
  const warnings = [];
  
  // Check if resource indicators are enabled
  if (!RESOURCE_CONFIG.enabled) {
    return {
      valid: false,
      errors: ['Resource indicators are not enabled'],
      warnings: []
    };
  }
  
  // Validate resource count
  if (selectedResources.length > clientConfig.maxResources) {
    errors.push(`Maximum ${clientConfig.maxResources} resources allowed`);
  }
  
  // Validate each resource
  for (const resourceUri of selectedResources) {
    // Validate format
    if (!validateResourceFormat(resourceUri)) {
      errors.push(`Invalid resource format: ${resourceUri}`);
      continue;
    }
    
    // Check if resource is allowed for client
    if (!clientConfig.allowedResources.includes(resourceUri)) {
      errors.push(`Resource not allowed for client: ${resourceUri}`);
    }
    
    // Check if resource exists in definitions
    if (!RESOURCE_DEFINITIONS[resourceUri]) {
      warnings.push(`Unknown resource: ${resourceUri}`);
    }
  }
  
  // Check for required resources
  if (clientConfig.requireConsent && selectedResources.length === 0) {
    errors.push('At least one resource must be selected');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    allowedResources: selectedResources.filter(resource => 
      clientConfig.allowedResources.includes(resource) && 
      validateResourceFormat(resource)
    )
  };
}

/**
 * Validate that scopes are compatible with resources
 * @param {Array} scopes - Requested scopes
 * @param {Array} resources - Selected resources
 * @returns {object} - Validation result
 */
function validateScopeResourceCompatibility(scopes, resources) {
  const resourceScopeMap = {
    'enduser.ping.demo/': ['read', 'write', 'transfer', 'transactions:', 'accounts:', 'mortgage:', 'ai:', 'admin:', 'users:'],
    'mcpserver.ping.demo/': ['ai:', 'agent:', 'mcp:'],
    'https://admin-api.ping.demo/': ['admin:', 'users:', 'config:'],
    'https://config-api.ping.demo/': ['config:', 'settings:']
  };
  
  const validScopes = [];
  const invalidScopes = [];
  
  for (const scope of scopes) {
    const isValidForResource = resources.some(resource => {
      const allowedPrefixes = resourceScopeMap[resource];
      return allowedPrefixes?.some(prefix => scope.startsWith(prefix));
    });
    
    if (isValidForResource) {
      validScopes.push(scope);
    } else {
      invalidScopes.push(scope);
    }
  }
  
  return {
    validScopes,
    invalidScopes,
    compatible: invalidScopes.length === 0
  };
}

/**
 * Create resource binding for token
 * @param {object} token - Token payload
 * @param {Array} resources - Resource URIs
 * @returns {object} - Token with resource binding
 */
function createResourceBinding(token, resources) {
  if (!resources || resources.length === 0) {
    return token;
  }
  
  // Sort resources for consistent binding
  const sortedResources = [...resources].sort();
  
  // Create binding hash
  const binding = {
    resources: sortedResources,
    client_id: token.client_id,
    user_id: token.sub,
    timestamp: Math.floor(Date.now() / 1000)
  };
  
  const bindingHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(binding))
    .digest('hex');
  
  return {
    ...token,
    resource: sortedResources,
    aud: sortedResources, // RFC 8707: aud can be array of resource URIs
    resource_binding: bindingHash
  };
}

/**
 * Validate resource binding in token
 * @param {object} token - Decoded JWT token
 * @param {string} requestResource - Requested resource URI
 * @returns {boolean} - True if binding is valid
 */
function validateResourceBinding(token, requestResource) {
  if (!RESOURCE_CONFIG.validation.strictResourceBinding) {
    return true;
  }
  
  // Get token resources
  const tokenResources = token.resource || token.aud || [];
  
  // Check if token is bound to requested resource
  if (!Array.isArray(tokenResources)) {
    return tokenResources === requestResource;
  }
  
  return tokenResources.includes(requestResource);
}

/**
 * Prevent cross-resource token usage
 * @param {object} token - Decoded JWT token
 * @param {string} targetResource - Target resource URI
 * @returns {boolean} - True if cross-resource usage is prevented
 */
function validateCrossResourceUsage(token, targetResource) {
  const allowedResources = token.resource || token.aud || [];
  
  // Strict validation - token must be bound to exact resource
  if (!validateResourceBinding(token, targetResource)) {
    return false;
  }
  
  // Additional validation for resource patterns
  const resourcePattern = /^https:\/\/([^.]+)\.pingdemo\.com\/(.*)$/;
  const tokenMatch = allowedResources[0]?.match(resourcePattern);
  const targetMatch = targetResource?.match(resourcePattern);
  
  // Prevent subdomain/resource crossing
  if (tokenMatch && targetMatch && tokenMatch[1] !== targetMatch[1]) {
    return false;
  }
  
  return true;
}

/**
 * Get resource from request
 * @param {object} req - Express request object
 * @returns {string|null} - Resource URI from request
 */
function getResourceFromRequest(req) {
  // Check resource in headers
  const resourceHeader = req.headers['x-resource-uri'];
  if (resourceHeader) {
    return resourceHeader;
  }
  
  // Check resource in query parameters
  const resourceParam = req.query.resource;
  if (resourceParam) {
    return resourceParam;
  }
  
  // Check resource in request body
  if (req.body && req.body.resource) {
    return req.body.resource;
  }
  
  // Derive from request path
  const path = req.path;
  if (path.startsWith('/banking')) {
    return 'enduser.ping.demo/';
  } else if (path.startsWith('/mcp')) {
    return 'mcpserver.ping.demo/';
  } else if (path.startsWith('/admin')) {
    return 'https://admin-api.ping.demo/';
  } else if (path.startsWith('/config')) {
    return 'https://config-api.ping.demo/';
  }
  
  return null;
}

/**
 * Filter scopes based on resources
 * @param {Array} scopes - Requested scopes
 * @param {Array} resources - Selected resources
 * @returns {Array} - Filtered scopes
 */
function filterScopesByResources(scopes, resources) {
  const compatibility = validateScopeResourceCompatibility(scopes, resources);
  return compatibility.validScopes;
}

/**
 * Get default resources for client
 * @param {string} clientId - OAuth client ID
 * @returns {Array} - Default resource URIs
 */
function getDefaultResources(clientId) {
  const clientConfig = getClientResourceConfig(clientId);
  return clientConfig.defaultResources;
}

/**
 * Check if resource indicators are enabled
 * @returns {boolean} - True if enabled
 */
function isResourceIndicatorsEnabled() {
  return RESOURCE_CONFIG.enabled;
}

module.exports = {
  // Resource definitions and configuration
  RESOURCE_DEFINITIONS,
  RESOURCE_CONFIG,
  
  // Validation functions
  validateResourceFormat,
  validateResourceSelection,
  validateScopeResourceCompatibility,
  validateResourceBinding,
  validateCrossResourceUsage,
  
  // Resource management
  getAvailableResources,
  getClientResourceConfig,
  getDefaultResources,
  filterScopesByResources,
  
  // Token binding
  createResourceBinding,
  
  // Request handling
  getResourceFromRequest,
  
  // Configuration
  isResourceIndicatorsEnabled
};
