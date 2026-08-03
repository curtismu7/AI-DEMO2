/**
 * Banking API Scope Configuration
 *
 * **Single source of truth:** See SCOPE_VOCABULARY.md for canonical scope registry,
 * resource server mapping, route enforcement index, and deprecation path.
 *
 * This file defines scope constants used throughout the BFF. Scope names are canonical
 * per D-02 (Phase 146 Scope Vocabulary Alignment).
 *
 * Canonical scopes issued by PingOne resource server:
 * - read — read access (accounts, transactions)
 * - write — write access (deposits, withdrawals, transfers)
 * - admin — full admin access
 * - ai:agent — AI agent identification
 * - ai_agent — identity marker for agent clients (legacy OIDC scope)
 */

/**
 * Default space-separated OIDC scopes for PingOne (authorize, CIBA, client metadata fallbacks).
 * Includes offline_access so the app can receive a refresh token when PingOne allows it on the app.
 */
const PINGONE_OIDC_DEFAULT_SCOPES_SPACE = 'openid profile email offline_access';

const BANKING_SCOPES = {
  // Core banking scopes — canonical names per D-02 (Phase 146)
  BANKING_READ: 'read',
  BANKING_WRITE: 'write',

  // Administrative scope (consolidated from admin:full, admin:read, admin:write)
  ADMIN: 'admin:read',

  // Sensitive data scope (consolidated from sensitive:read, sensitive:write)
  SENSITIVE: 'sensitive:read',

  // AI Agent scope (consolidated from ai:agent:read, ai:agent:write, ai:agent:admin)
  AI_AGENT: 'ai:agent:read',

  // Agent identity marker
  AI_AGENT_IDENTITY: 'ai_agent',

  // MCP scope
  MCP_INVOKE: 'mcp:invoke',

  // Agent invoke scope
  AGENT_INVOKE: 'agent:invoke'
};

// Compound scopes (backward compatibility — to be deprecated in a future phase)
// See SCOPE_VOCABULARY.md § Deprecation Path
const COMPOUND_SCOPES = {
  ACCOUNTS_READ: 'accounts:read',
  TRANSACTIONS_READ: 'transactions:read',
  TRANSACTIONS_WRITE: 'transactions:write',
  // Phase 267 — domain-specific scope for the mortgage path.
  // Required for the api_key disposition that calls banking_api_resource_server.
  // The gateway verifies the user's token includes this scope before performing
  // the bearer→X-API-Key swap; the mortgage service itself does NOT check scope
  // (it gates on X-API-Key only — service-to-service trust).
  MORTGAGE_READ: 'mortgage:read'
};

// User type to canonical scope mappings (reference: SCOPE_VOCABULARY.md § User Type Scope Assignments)
const USER_TYPE_SCOPES = {
  // Admin users get full access
  admin: [
    BANKING_SCOPES.ADMIN,         // Full admin access
    BANKING_SCOPES.BANKING_READ,  // Read all accounts + transactions
    BANKING_SCOPES.BANKING_WRITE, // Write all banking operations
    BANKING_SCOPES.SENSITIVE,     // Sensitive data access
    BANKING_SCOPES.AI_AGENT       // AI agent identification
  ],
  
  // Customer users get read/write access but no admin
  customer: [
    BANKING_SCOPES.BANKING_READ,  // Read own accounts + transactions
    BANKING_SCOPES.BANKING_WRITE, // Write banking operations
    BANKING_SCOPES.AI_AGENT       // AI agent identification
  ],
  
  // Read-only users get only read access
  readonly: [
    BANKING_SCOPES.BANKING_READ   // Read-only access
  ],
  
  // AI agents get full access including AI agent scope
  ai_agent: [
    BANKING_SCOPES.AI_AGENT,          // AI agent identification (resource server)
    BANKING_SCOPES.AI_AGENT_IDENTITY, // AI agent identity (OIDC)
    BANKING_SCOPES.BANKING_READ,      // Read accounts + transactions
    BANKING_SCOPES.BANKING_WRITE      // Write banking operations
  ]
};

// Environment-specific scope configurations
const ENVIRONMENT_CONFIGS = {
  development: {
    // Development allows all scopes for testing
    allowedScopes: Object.values(BANKING_SCOPES),
    strictValidation: false,
    debugScopes: true,
    defaultUserType: 'customer',
    scopeValidationTimeout: 5000, // 5 seconds
    cacheTokenValidation: false
  },
  
  test: {
    // Test environment with relaxed validation
    allowedScopes: Object.values(BANKING_SCOPES),
    strictValidation: false,
    debugScopes: true,
    defaultUserType: 'customer',
    scopeValidationTimeout: 1000, // 1 second for fast tests
    cacheTokenValidation: false,
    skipTokenSignatureValidation: true
  },
  
  staging: {
    // Staging environment with production-like settings
    allowedScopes: Object.values(BANKING_SCOPES),
    strictValidation: true,
    debugScopes: false,
    defaultUserType: 'readonly',
    scopeValidationTimeout: 10000, // 10 seconds
    cacheTokenValidation: true,
    cacheTTL: 300 // 5 minutes
  },
  
  production: {
    // Production environment with strict validation
    allowedScopes: Object.values(BANKING_SCOPES),
    strictValidation: true,
    debugScopes: false,
    defaultUserType: 'readonly',
    scopeValidationTimeout: 10000, // 10 seconds
    cacheTokenValidation: true,
    cacheTTL: 600 // 10 minutes
  }
};

// Route-to-scope mapping (enhanced from existing middleware)
const ROUTE_SCOPE_MAP = {
  // Account routes
  'GET /api/accounts': [BANKING_SCOPES.BANKING_READ],
  'GET /api/accounts/my': [BANKING_SCOPES.BANKING_READ],
  'GET /api/accounts/:id': [BANKING_SCOPES.BANKING_READ],
  'GET /api/accounts/:id/balance': [BANKING_SCOPES.BANKING_READ],
  'POST /api/accounts': [BANKING_SCOPES.BANKING_WRITE],
  'PUT /api/accounts/:id': [BANKING_SCOPES.BANKING_WRITE],
  'DELETE /api/accounts/:id': [BANKING_SCOPES.BANKING_WRITE],
  
  // Transaction routes
  'GET /api/transactions': [BANKING_SCOPES.BANKING_READ],
  'GET /api/transactions/my': [BANKING_SCOPES.BANKING_READ],
  'GET /api/transactions/:id': [BANKING_SCOPES.BANKING_READ],
  'POST /api/transactions': [BANKING_SCOPES.BANKING_WRITE],
  'POST /api/transactions/deposit': [BANKING_SCOPES.BANKING_WRITE],
  'POST /api/transactions/withdraw': [BANKING_SCOPES.BANKING_WRITE],
  'POST /api/transactions/transfer': [BANKING_SCOPES.BANKING_WRITE],
  'PUT /api/transactions/:id': [BANKING_SCOPES.BANKING_WRITE],
  'DELETE /api/transactions/:id': [BANKING_SCOPES.BANKING_WRITE],
  
  // Admin routes
  'GET /api/admin/*': [BANKING_SCOPES.ADMIN],
  'POST /api/admin/*': [BANKING_SCOPES.ADMIN],
  'PUT /api/admin/*': [BANKING_SCOPES.ADMIN],
  'DELETE /api/admin/*': [BANKING_SCOPES.ADMIN],
  
  // Sensitive data routes
  'GET /api/sensitive/*': [BANKING_SCOPES.SENSITIVE],
  'POST /api/sensitive/*': [BANKING_SCOPES.SENSITIVE],
  'PUT /api/sensitive/*': [BANKING_SCOPES.SENSITIVE],
  
  // User routes (general banking read access)
  'GET /api/users': [BANKING_SCOPES.BANKING_READ],
  'GET /api/users/me': [BANKING_SCOPES.BANKING_READ],
  'GET /api/users/:id': [BANKING_SCOPES.BANKING_READ],
  'POST /api/users': [BANKING_SCOPES.BANKING_WRITE],
  'PUT /api/users/:id': [BANKING_SCOPES.BANKING_WRITE],
  'DELETE /api/users/:id': [BANKING_SCOPES.BANKING_WRITE]
};

// OAuth provider scope configuration templates
const OAUTH_PROVIDER_SCOPE_CONFIGS = {
  // PingOne AI IAM Core scope configuration
  pingone_ai_core: {
    // Admin client scopes
    adminClient: {
      defaultScopes: ['openid', 'profile', 'email', 'offline_access'],
      bankingScopes: [
        BANKING_SCOPES.ADMIN,
        BANKING_SCOPES.BANKING_READ,
        BANKING_SCOPES.BANKING_WRITE,
        BANKING_SCOPES.SENSITIVE,
        BANKING_SCOPES.AI_AGENT
      ]
    },
    
    // End user client scopes
    endUserClient: {
      defaultScopes: ['openid', 'profile', 'email'],
      bankingScopes: [
        BANKING_SCOPES.BANKING_READ,
        BANKING_SCOPES.BANKING_WRITE,
        BANKING_SCOPES.AI_AGENT
      ]
    },
    
    // AI agent client scopes
    aiAgentClient: {
      defaultScopes: ['openid', 'profile', 'offline_access'],
      bankingScopes: [
        BANKING_SCOPES.AI_AGENT,
        BANKING_SCOPES.AI_AGENT_IDENTITY,
        BANKING_SCOPES.BANKING_READ,
        BANKING_SCOPES.BANKING_WRITE
      ]
    }
  }
};

// Get configuration for current environment
const getCurrentEnvironmentConfig = () => {
  const env = process.env.NODE_ENV || 'development';
  return ENVIRONMENT_CONFIGS[env] || ENVIRONMENT_CONFIGS.development;
};

// Get scopes for user type
const getScopesForUserType = (userType) => {
  return USER_TYPE_SCOPES[userType] || USER_TYPE_SCOPES.readonly;
};

// Validate scope against environment configuration
const isValidScope = (scope) => {
  const config = getCurrentEnvironmentConfig();
  return config.allowedScopes.includes(scope);
};

// Get OAuth provider configuration
const getOAuthProviderConfig = (provider = 'pingone_ai_core') => {
  return OAUTH_PROVIDER_SCOPE_CONFIGS[provider] || OAUTH_PROVIDER_SCOPE_CONFIGS.pingone_ai_core;
};

/**
 * DEPRECATION NOTICE (Phase 146)
 *
 * Old scope naming:
 * - 'general:read' → now 'read'
 * - 'general:write' → now 'write'
 *
 * Compound scopes (accounts:read, transactions:read/write) are
 * kept for backward compatibility via COMPOUND_SCOPES but marked for deprecation.
 *
 * See SCOPE_VOCABULARY.md for full deprecation path.
 */

module.exports = {
  PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
  BANKING_SCOPES,
  COMPOUND_SCOPES,
  USER_TYPE_SCOPES,
  ENVIRONMENT_CONFIGS,
  ROUTE_SCOPE_MAP,
  OAUTH_PROVIDER_SCOPE_CONFIGS,
  getCurrentEnvironmentConfig,
  getScopesForUserType,
  isValidScope,
  getOAuthProviderConfig
};
