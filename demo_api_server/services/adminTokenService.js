/**
 * adminTokenService.js
 *
 * Admin token exchange functionality for Phase 44.
 * Detects admin sessions and uses admin tokens for MCP tool calls when appropriate.
 */

const configStore = require('./configStore');
const oauthService = require('./oauthService');
const { decodeJwtClaims } = require('./agentMcpTokenService');
const adminAuditService = require('./adminAuditService');

/**
 * Admin token configuration and constants
 */
const ADMIN_TOKEN_CONFIG = {
  // Admin-specific scopes for elevated privileges
  adminScopes: [
    'admin:read',
    'admin:write', 
    'admin:delete',
    'users:read',
    'users:manage',
    'read',
    'write'
  ],
  // Extended token lifetime for admin sessions (2 hours)
  adminTokenLifetime: 7200,
  // Admin refresh token lifetime (24 hours)
  adminRefreshTokenLifetime: 86400
};

// Read admin client ID at call time via configStore so Config UI updates take effect
// without a process restart (process.env is snapshotted at module load).
// Use 'pingone_admin_client_id' (resolves PINGONE_ADMIN_CLIENT_ID first) not 'admin_client_id'
// (which resolves PINGONE_AI_CORE_CLIENT_ID first and would shadow the intended admin client).
function getAdminClientId() {
  return configStore.getEffective('pingone_admin_client_id');
}

/**
 * Detect if the current session is an admin session
 * @param {object} session - Express session object
 * @returns {boolean} - True if admin session detected
 */
function isAdminSession(session) {
  if (!session || !session.oauthTokens) {
    return false;
  }

  // Check if the token was obtained using admin client credentials
  const clientId = session.oauthTokens.clientId || session.oauthTokens.azp;
  const adminClientId = getAdminClientId();

  if (!clientId || !adminClientId) {
    return false;
  }

  return clientId === adminClientId;
}

/**
 * Check if admin tokens should be used for the current request
 * @param {object} req - Express request object
 * @returns {boolean} - True if admin tokens should be used
 */
function shouldUseAdminToken(req) {
  // Check if admin token exchange is enabled
  if (!isAdminTokenExchangeEnabled()) {
    return false;
  }

  // Use req.user.role set by authenticateToken from the verified JWT
  return req.user?.role === 'admin';
}

/**
 * Get admin token from session
 * @param {object} session - Express session object
 * @returns {object|null} - Admin token object or null
 */
function getAdminTokenFromSession(session) {
  if (!isAdminSession(session)) {
    return null;
  }

  const tokens = session.oauthTokens;
  return {
    accessToken: tokens.accessToken || tokens.access_token,
    refreshToken: tokens.refreshToken || tokens.refresh_token,
    idToken: tokens.idToken,
    expiresAt: tokens.expiresAt,
    tokenType: tokens.tokenType || 'Bearer',
    clientId: tokens.clientId || tokens.azp,
    scopes: tokens.scope ? tokens.scope.split(' ') : []
  };
}

/**
 * Validate admin token claims
 * @param {object} claims - JWT claims object
 * @returns {object} - Validation result
 */
function validateAdminTokenClaims(claims) {
  const result = {
    valid: true,
    errors: [],
    warnings: []
  };

  // Check if token has required admin scopes
  if (!claims.scope) {
    result.valid = false;
    result.errors.push('Admin token missing scope claim');
    return result;
  }

  const tokenScopes = claims.scope.split(' ');
  const requiredAdminScopes = ['admin:read', 'admin:write'];
  
  for (const requiredScope of requiredAdminScopes) {
    if (!tokenScopes.includes(requiredScope)) {
      result.warnings.push(`Admin token missing required scope: ${requiredScope}`);
    }
  }

  // Check if token is expired
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
    result.valid = false;
    result.errors.push('Admin token has expired');
  }

  // Check if token audience is appropriate
  if (!claims.aud) {
    result.warnings.push('Admin token missing audience claim');
  }

  return result;
}

/**
 * Refresh admin token if needed
 * @param {string} refreshToken - Refresh token
 * @returns {object} - New token object or error
 */
async function refreshAdminToken(refreshToken) {
  try {
    const newTokens = await oauthService.refreshToken(refreshToken);
    
    return {
      success: true,
      tokens: {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token || refreshToken,
        idToken: newTokens.id_token,
        expiresAt: Date.now() + ((newTokens.expires_in || 3600) * 1000),
        tokenType: newTokens.token_type || 'Bearer',
        scopes: newTokens.scope ? newTokens.scope.split(' ') : []
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code || 'REFRESH_FAILED'
    };
  }
}

/**
 * Check if admin token exchange is enabled
 * @returns {boolean} - True if admin token exchange is enabled
 */
function isAdminTokenExchangeEnabled() {
  return configStore.getEffective('ff_admin_token_exchange') === true ||
         configStore.getEffective('ff_admin_token_exchange') === 'true';
}

/**
 * Get admin token information for logging and audit
 * @param {object} adminToken - Admin token object
 * @returns {object} - Sanitized admin token info
 */
function getAdminTokenInfo(adminToken) {
  if (!adminToken) {
    return null;
  }

  const decoded = decodeJwtClaims(adminToken.accessToken);
  const claims = decoded?.claims || {};

  return {
    clientId: adminToken.clientId,
    scopes: adminToken.scopes,
    expiresAt: adminToken.expiresAt,
    sub: claims.sub,
    aud: claims.aud,
    iss: claims.iss,
    iat: claims.iat,
    exp: claims.exp,
    // Include act claim if present for delegation tracking
    act: claims.act,
    mayAct: claims.may_act
  };
}

/**
 * Check if a tool requires admin privileges
 * @param {string} toolName - Name of the MCP tool
 * @returns {boolean} - True if tool requires admin privileges
 */
function toolRequiresAdminPrivileges(toolName) {
  // Define admin-only tools
  const adminOnlyTools = [
    'lookup_customer',
    'get_customer_profile',
    'get_customer_accounts',
    'get_customer_transactions',
    'freeze_account',
    'reset_customer_password',
    'adjust_balance',
    'delete_customer'
  ];

  return adminOnlyTools.includes(toolName);
}

/**
 * Determine if admin token should be used for a specific tool
 * @param {object} req - Express request object
 * @param {string} toolName - Name of the MCP tool
 * @returns {boolean} - True if admin token should be used
 */
function shouldUseAdminTokenForTool(req, toolName) {
  // Use admin token if:
  // 1. Admin token exchange is enabled
  // 2. This is an admin session
  // 3. Tool requires admin privileges OR admin is explicitly requested
  
  const adminEnabled = shouldUseAdminToken(req);
  const isAdmin = req.user?.role === 'admin';
  const toolRequiresAdmin = toolRequiresAdminPrivileges(toolName);

  return adminEnabled && isAdmin && (toolRequiresAdmin || (req.useAdminToken === true));
}

module.exports = {
  // Configuration
  ADMIN_TOKEN_CONFIG,
  
  // Session detection
  isAdminSession,
  shouldUseAdminToken,
  getAdminTokenFromSession,
  
  // Token validation
  validateAdminTokenClaims,
  getAdminTokenInfo,
  
  // Token operations
  refreshAdminToken,
  
  // Tool-specific logic
  toolRequiresAdminPrivileges,
  shouldUseAdminTokenForTool
};
