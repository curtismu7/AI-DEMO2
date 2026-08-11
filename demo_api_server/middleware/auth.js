const bcrypt = require('bcryptjs');
const oauthConfig = require('../config/oauth');
const configStore = require('../services/configStore');
const { validateToken: validatePingOneToken } = require('../services/tokenValidationService');
const { 
  BANKING_SCOPES, 
  ROUTE_SCOPE_MAP,
  getCurrentEnvironmentConfig,
  isValidScope
} = require('../config/scopes');
const { logger, LOG_CATEGORIES } = require('../utils/logger');
const { 
  OAuthError, 
  OAUTH_ERROR_TYPES, 
  validateScopesWithErrorHandling
} = require('./oauthErrorHandler');

// Environment configuration
const SKIP_TOKEN_SIGNATURE_VALIDATION = process.env.SKIP_TOKEN_SIGNATURE_VALIDATION === 'true';
const DEBUG_TOKENS = process.env.DEBUG_TOKENS === 'true';

// BFF resource URI — tokens arriving at this service must be issued for this audience.
// Reads ENDUSER_AUDIENCE (set by bootstrapPingOne) or the explicit override
// PINGONE_RESOURCE_BFF_URI. When configured, audience validation is mandatory and
// fail-closed: tokens with a missing or mismatched aud are rejected with 401.
const BFF_RESOURCE_URI =
  process.env.PINGONE_RESOURCE_BFF_URI ||
  process.env.ENDUSER_AUDIENCE ||
  null;

// MCP Gateway resource URI — accepted as an additional audience on the
// /api/path/vertical-tool callback route only. The MCP server calls back to
// the BFF with the gateway-audience token (aud=mcpgateway.ping.demo) after the
// gateway's Authorization Server has already made the PERMIT decision.
const MCP_GW_RESOURCE_URI = process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI || 'mcpgateway.ping.demo';
// PingGateway resource URI (RFC 8707) — accepted alongside MCP_GW_RESOURCE_URI on
// MCP callback / Path B identity routes when ff_mcp_gateway_pinggateway is ON.
const PINGGATEWAY_RESOURCE_URI =
  process.env.PINGONE_RESOURCE_PINGGATEWAY_URI ||
  process.env.MCP_PINGGATEWAY_RESOURCE_URI ||
  'https://api.ping.demo:3036/mcp';

// Secondary audience values used only for client-type detection (not for acceptance gating).
// A token must STILL match BFF_RESOURCE_URI to be accepted; these values are only used
// to label the token as enduser/ai_agent after it has already passed the aud check.
const ENDUSER_AUDIENCE  = process.env.ENDUSER_AUDIENCE  || BFF_RESOURCE_URI;
const AI_AGENT_AUDIENCE = process.env.AI_AGENT_AUDIENCE || null;
// MCP / gateway resource URIs — for reference only (these tokens never arrive at the BFF).
const MCP_RESOURCE_URI  = process.env.PINGONE_RESOURCE_MCP_SERVER_URI || null;
const BANKING_API_RESOURCE_URI = process.env.BANKING_API_RESOURCE_URI || null;
const MCP_GATEWAY_RESOURCE_URI = process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI || null;
// mcp-resource-server backend resource URI(s) — tokens minted for these audiences arrive on
// the investment BFF callback route (A2A nested-act chain, gateway Exchange #3 target).
// Comma-separated accepted list (same shape as MCP_SERVER_RESOURCE_URI): after #1269 the
// PingOne resource carries mcp-invest.ping.demo; mcp-resource-server.ping.demo stays valid
// for any caller still pinned to the old name. Never hardcode a default here (§1).
const MCP_RESOURCE_SERVER_AUDIENCES = String(
  process.env.PINGONE_RESOURCE_MCP_RESOURCE_SERVER_URI || '',
).split(',').map((s) => s.trim()).filter(Boolean);
const AI_AGENT_SCOPE = process.env.AI_AGENT_SCOPE || 'ai_agent';
const DEFAULT_USER_TYPE = process.env.DEFAULT_USER_TYPE || 'customer';

// Get current environment configuration
const envConfig = getCurrentEnvironmentConfig();

if (SKIP_TOKEN_SIGNATURE_VALIDATION) {
  console.warn('WARNING: Token signature validation is disabled. This should only be used in development!');
}

// Utility function to determine client type from OAuth token scopes
const determineClientType = (oauthToken) => {
  try {
    // Parse JWT payload without verification (just for reading claims)
    const parts = oauthToken.split('.');
    if (parts.length !== 3) {
      return 'unknown';
    }
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (!payload) {
      return 'unknown';
    }
    
    // Check for ai_agent scope first (most specific)
    if (payload.scope) {
      const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : payload.scope;
      if (scopes.includes(AI_AGENT_SCOPE)) {
        return 'ai_agent';
      }
    }
    
    // Fallback to audience-based detection for existing tokens
    if (payload.aud) {
      const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      
      if (audience.includes(ENDUSER_AUDIENCE)) {
        return 'enduser';
      } else if (audience.includes(AI_AGENT_AUDIENCE)) {
        return 'ai_agent';
      }
    }
    
    // Default to enduser for tokens without specific ai_agent scope
    return 'enduser';
  } catch (error) {
    console.error('Error determining client type from OAuth token:', error.message);
    return 'unknown';
  }
};

// Utility function to determine user type from OAuth token
const determineUserTypeFromToken = (payload) => {
  try {
    // Check for explicit user type in token claims
    if (payload.user_type) {
      return payload.user_type;
    }
    
    // Determine from scopes
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : (payload.scope || []);
    
    if (scopes.includes(BANKING_SCOPES.ADMIN)) {
      return 'admin';
    } else if (scopes.includes(BANKING_SCOPES.AI_AGENT)) {
      return 'ai_agent';
    } else if (scopes.some(scope => scope.includes('write'))) {
      return 'customer';
    } else if (scopes.some(scope => scope.includes('read'))) {
      return 'readonly';
    }
    
    // Fallback to default user type
    return DEFAULT_USER_TYPE;
  } catch (error) {
    logger.warn(LOG_CATEGORIES.SCOPE_VALIDATION, 'Error determining user type from token', {
      error_message: error.message
    });
    return DEFAULT_USER_TYPE;
  }
};

// Utility function to parse scopes from OAuth token with enhanced logging
const parseTokenScopes = (token, requestContext = {}) => {
  const { method = 'UNKNOWN', path = 'UNKNOWN' } = requestContext;
  
  try {
    // Parse JWT payload without verification (just for reading claims)
    const parts = token.split('.');
    if (parts.length !== 3) {
      logger.debug(LOG_CATEGORIES.SCOPE_VALIDATION, 'Invalid token format during scope parsing', {
        method,
        path,
        token_parts: parts.length
      });
      return [];
    }
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (!payload) {
      logger.debug(LOG_CATEGORIES.SCOPE_VALIDATION, 'Failed to decode token payload', {
        method,
        path
      });
      return [];
    }
    
    if (!payload.scope) {
      logger.debug(LOG_CATEGORIES.SCOPE_VALIDATION, 'No scope claim found in token', {
        method,
        path,
        available_claims: Object.keys(payload)
      });
      return [];
    }
    
    let parsedScopes = [];
    
    // Handle both string and array formats
    if (typeof payload.scope === 'string') {
      parsedScopes = payload.scope.split(' ').filter(scope => scope.trim().length > 0);
      logger.debug(LOG_CATEGORIES.SCOPE_VALIDATION, 'Parsed string format scopes', {
        method,
        path,
        raw_scope: payload.scope,
        parsed_scopes: parsedScopes,
        scope_count: parsedScopes.length
      });
    } else if (Array.isArray(payload.scope)) {
      parsedScopes = payload.scope.filter(scope => typeof scope === 'string' && scope.trim().length > 0);
      logger.debug(LOG_CATEGORIES.SCOPE_VALIDATION, 'Parsed array format scopes', {
        method,
        path,
        raw_scope: payload.scope,
        parsed_scopes: parsedScopes,
        scope_count: parsedScopes.length
      });
    } else {
      logger.warn(LOG_CATEGORIES.SCOPE_VALIDATION, 'Unexpected scope format in token', {
        method,
        path,
        scope_type: typeof payload.scope,
        scope_value: JSON.stringify(payload.scope)
      });
    }
    
    // Validate scopes against environment configuration if strict validation is enabled
    if (envConfig.strictValidation) {
      const validScopes = parsedScopes.filter(scope => isValidScope(scope));
      const invalidScopes = parsedScopes.filter(scope => !isValidScope(scope));
      
      if (invalidScopes.length > 0) {
        logger.warn(LOG_CATEGORIES.SCOPE_VALIDATION, 'Invalid scopes found in token', {
          method,
          path,
          invalid_scopes: invalidScopes,
          valid_scopes: validScopes
        });
      }
      
      return validScopes;
    }
    
    return parsedScopes;
  } catch (error) {
    logger.error(LOG_CATEGORIES.SCOPE_VALIDATION, 'Error parsing token scopes', {
      method,
      path,
      error_message: error.message,
      token_preview: token.substring(0, 50) + '...'
    });
    return [];
  }
};

// Use route-to-scope mapping from configuration
// (ROUTE_SCOPE_MAP is imported from config/scopes.js)

// Utility function to check if user has required scopes
const hasRequiredScopes = (userScopes, requiredScopes, requireAll = false) => {
  if (!Array.isArray(userScopes) || !Array.isArray(requiredScopes)) {
    if (DEBUG_TOKENS) {
      console.debug('[Scopes] Invalid input — userScopes or requiredScopes is not an array', { userScopes, requiredScopes });
    }
    return false;
  }
  
  // Check for admin scope - grants access to all endpoints
  if (userScopes.includes(BANKING_SCOPES.ADMIN)) {
    if (DEBUG_TOKENS) {
      console.debug('[Scopes] Admin scope detected — granting access (bypasses all scope checks)');
    }
    return true;
  }
  
  if (requiredScopes.length === 0) {
    if (DEBUG_TOKENS) {
      console.debug('[Scopes] No scopes required — granting access');
    }
    return true; // No scopes required
  }
  
  if (requireAll) {
    // AND logic - user must have ALL required scopes
    const missingScopes = requiredScopes.filter(scope => !userScopes.includes(scope));
    const hasAllScopes = missingScopes.length === 0;
    
    if (DEBUG_TOKENS) {
      if (hasAllScopes) {
        console.debug('[Scopes] ALL required scopes satisfied', { requiredScopes, userScopes });
      } else {
        console.debug('[Scopes] Missing required scopes (AND mode)', { missingScopes, requiredScopes, userScopes });
      }
    }
    
    return hasAllScopes;
  } else {
    // OR logic - user must have at least ONE of the required scopes
    const matchingScopes = requiredScopes.filter(scope => userScopes.includes(scope));
    const hasAnyScope = matchingScopes.length > 0;
    
    if (DEBUG_TOKENS) {
      if (hasAnyScope) {
        console.debug('[Scopes] At least one required scope matched (OR mode)', { matchingScopes, requiredScopes });
      } else {
        console.debug('[Scopes] No matching scopes found (OR mode)', { requiredScopes, userScopes });
      }
    }
    
    return hasAnyScope;
  }
};

// Middleware function to require specific scopes with enhanced error handling and logging
const requireScopes = (requiredScopes, requireAll = false) => {
  return (req, res, next) => {
    const requestContext = {
      method: req.method,
      path: req.path || req.url,
      userId: req.user?.id || 'anonymous',
      userAgent: req.headers?.['user-agent'],
      ip: req.ip || req.connection?.remoteAddress
    };

    try {
      // Ensure user is authenticated first
      if (!req.user) {
        logger.warn(LOG_CATEGORIES.AUTHORIZATION, 'Scope validation attempted without authenticated user', requestContext);
        
        throw new OAuthError(
          OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
          'Authentication required to access this resource',
          401,
          { hint: 'Include a valid Bearer token in the Authorization header' }
        );
      }
      
      // Get user scopes from the authenticated user object
      const userScopes = req.user.scopes || [];
      
      // Normalize required scopes to array
      const scopesToCheck = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];

      // Admin role bypass: users with role=admin are trusted as having all banking scopes.
      // This allows OAuth users whose PingOne token only carries standard OIDC scopes
      // (openid/profile/email) to still access admin-gated routes without requiring
      // custom * scopes to be provisioned in PingOne.
      if (req.user.role === 'admin') {
        logger.debug(LOG_CATEGORIES.AUTHORIZATION, 'Scope check bypassed — user has admin role', {
          ...requestContext,
          required_scopes: scopesToCheck
        });
        return next();
      }

      // Simplified-auth bypass: when ff_oidc_only_authorize is ON, the user token only carries
      // OIDC scopes (no *) because the authorize request was stripped down to avoid
      // PingOne's "May not request scopes for multiple resources" error. Scope gates on banking
      // routes relax to session-authenticated identity (same approach as admin role bypass).
      const oidcOnlyMode =
        configStore.getEffective('ff_oidc_only_authorize') === true ||
        configStore.getEffective('ff_oidc_only_authorize') === 'true';
      if (oidcOnlyMode && scopesToCheck.length > 0) {
        const requiresAdminScope = scopesToCheck.some(s => s === 'admin' || s.startsWith('admin:'));
        if (!requiresAdminScope) {
          logger.debug(LOG_CATEGORIES.AUTHORIZATION, 'Scope check bypassed — ff_oidc_only_authorize ON', {
            ...requestContext,
            required_scopes: scopesToCheck
          });
          return next();
        }
      }
      
      logger.debug(LOG_CATEGORIES.SCOPE_VALIDATION, 'Starting scope validation middleware', {
        ...requestContext,
        required_scopes: scopesToCheck,
        user_scopes: userScopes,
        validation_mode: requireAll ? 'all_required' : 'any_required'
      });
      
      // Use enhanced scope validation with detailed error handling
      validateScopesWithErrorHandling(userScopes, scopesToCheck, requireAll, requestContext);
      
      logger.debug(LOG_CATEGORIES.AUTHORIZATION, 'Scope validation successful - access granted', {
        ...requestContext,
        granted_scopes: scopesToCheck
      });
      
      next();
    } catch (error) {
      logger.logAuthorizationAttempt(false, {
        ...requestContext,
        error_type: error.type || 'access_denied',
        error_message: error.message,
        required_scopes: Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes],
        user_scopes: req.user?.scopes || []
      });
      
      // Format and send OAuth error response
      const errorResponse = {
        error: error.type || 'access_denied',
        error_description: error.message,
        timestamp: new Date().toISOString(),
        path: req.originalUrl || req.path || req.url,
        method: req.method
      };
      
      // Add additional OAuth error data
      if (error.additionalData) {
        Object.assign(errorResponse, error.additionalData);
      }
      
      return res.status(error.statusCode || 403).json(errorResponse);
    }
  };
};

// Utility function to decode and log OAuth token information
const logTokenInfo = (token, context = '') => {
  if (!DEBUG_TOKENS) return;
  
  try {
    // Parse JWT without verification (just for reading claims)
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.debug(`[${context}] Invalid token format`);
      return;
    }
    
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    if (!header || !payload) {
      console.debug(`[${context}] Failed to decode token`);
      return;
    }
    
    // Determine token type based on claims
    const isPingOneToken = payload.iss?.includes('pingone');
    
    const tokenType = isPingOneToken ? 'PINGONE OAUTH' : 'OAUTH';
    
    // Determine client type from scopes and audience for OAuth tokens
    let clientTypeFromToken = 'unknown';
    // Check scopes first
    if (payload.scope) {
      const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : payload.scope;
      if (scopes.includes(AI_AGENT_SCOPE)) {
        clientTypeFromToken = 'ai_agent';
      } else {
        clientTypeFromToken = 'enduser';
      }
    }
    // Fallback to audience-based detection
    else if (payload.aud) {
      const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (audience.includes(ENDUSER_AUDIENCE)) {
        clientTypeFromToken = 'enduser';
      } else if (audience.includes(AI_AGENT_AUDIENCE)) {
        clientTypeFromToken = 'ai_agent';
      }
    }
    
    console.debug(`[${context}] ${tokenType} Token Information:`);
    console.debug(`   Algorithm: ${header.alg}`);
    console.debug(`   Type: ${header.typ}`);
    if (header.kid) console.debug(`   Key ID: ${header.kid}`);
    
    // OAuth token format
    console.debug(`   Subject: ${payload.sub || 'N/A'}`);
    console.debug(`   Issuer: ${payload.iss || 'N/A'}`);
    console.debug(`   Audience: ${Array.isArray(payload.aud) ? payload.aud.join(', ') : payload.aud || 'N/A'}`);
    console.debug(`   Client Type: ${clientTypeFromToken}`);
    
    if (payload.preferred_username) console.debug(`   Username: ${payload.preferred_username}`);
    if (payload.email) console.log(`   Email: ${payload.email}`);
    if (payload.given_name) console.log(`   First Name: ${payload.given_name}`);
    if (payload.family_name) console.log(`   Last Name: ${payload.family_name}`);
    
    // Log roles/permissions
    if (payload.realm_access?.roles) {
      console.log(`   Realm Roles: ${payload.realm_access.roles.join(', ')}`);
    }
    if (payload.resource_access) {
      console.log(`   Resource Access: ${JSON.stringify(payload.resource_access)}`);
    }
    if (payload.scope) {
      console.log(`   Scopes: ${payload.scope}`);
    }
    
    // Common fields
    if (payload.exp) {
      const expDate = new Date(payload.exp * 1000);
      const now = new Date();
      const timeUntilExp = expDate.getTime() - now.getTime();
      console.log(`   Expires: ${expDate.toISOString()} (in ${Math.round(timeUntilExp / 1000 / 60)} minutes)`);
    }
    
    if (payload.iat) {
      const iatDate = new Date(payload.iat * 1000);
      console.log(`   Issued At: ${iatDate.toISOString()}`);
    }
    
    // Log any other custom claims not already covered
    const standardClaims = ['sub', 'iss', 'aud', 'exp', 'iat', 'nbf', 'jti', 'preferred_username', 'email', 'given_name', 'family_name', 'realm_access', 'resource_access', 'scope'];
    const customClaims = Object.keys(payload).filter(key => !standardClaims.includes(key));
    if (customClaims.length > 0) {
      console.log(`   Other Claims:`);
      customClaims.forEach(claim => {
        console.log(`     ${claim}: ${JSON.stringify(payload[claim])}`);
      });
    }
    
  } catch (error) {
    console.debug(`[${context}] Error decoding token: ${error.message}`);
  }
};



// Validate a PingOne access token using JWKS (JWT signature verification).
// Replaces the previous PingOne Core/ForgeRock introspection approach.
const validatePingOneCoreToken = async (token, requestContext = {}) => {
  const { method = 'UNKNOWN', path = 'UNKNOWN', baseUrl = '' } = requestContext;

  logger.debug(LOG_CATEGORIES.OAUTH_VALIDATION, 'Starting PingOne token validation', {
    method,
    path,
    token_length: token ? token.length : 0,
  });

  try {
    // Skip signature verification in dev if flag set (decode-only)
    if (SKIP_TOKEN_SIGNATURE_VALIDATION) {
      logger.warn(LOG_CATEGORIES.OAUTH_VALIDATION, 'Skipping token validation for testing', {
        method,
        path,
        environment: process.env.NODE_ENV,
      });

      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new OAuthError(OAUTH_ERROR_TYPES.MALFORMED_TOKEN, 'Invalid token format', 401);
      }
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      if (!payload) {
        throw new OAuthError(OAUTH_ERROR_TYPES.MALFORMED_TOKEN, 'Failed to decode token payload', 401);
      }
      logger.debug(LOG_CATEGORIES.OAUTH_VALIDATION, 'Token validation skipped - using decoded payload', {
        method,
        path,
        subject: payload.sub,
        scopes: payload.scope,
      });
      return { valid: true, decoded: payload };
    }

    // Validate using PingOne JWKS
    const payload = await validatePingOneToken(token, {
      jwksUri: oauthConfig.jwksEndpoint,
      issuer: oauthConfig.issuer,
    });

    // ── Audience validation (always-on when BFF_RESOURCE_URI is configured) ────
    // Tokens arriving at the BFF must be targeted at this service's resource URI.
    // Fail-closed by default: a missing aud claim is rejected when we know our
    // own audience, preventing tokens issued for other resource servers (MCP,
    // gateway, etc.) from being accepted here.
    //
    // PingOne default fallback: when no custom resource server is configured,
    // PingOne issues tokens with aud='https://api.pingone.com'. Accept this only
    // when BFF_RESOURCE_URI is NOT set (i.e. the operator has not provisioned a
    // dedicated resource server yet).
    const PINGONE_DEFAULT_AUD = 'https://api.pingone.com';
    if (BFF_RESOURCE_URI) {
      const tokenAuds = payload.aud
        ? (Array.isArray(payload.aud) ? payload.aud : [payload.aud])
        : [];

      if (tokenAuds.length === 0) {
        logger.warn(LOG_CATEGORIES.OAUTH_VALIDATION, 'Token has no aud claim — rejecting (BFF_RESOURCE_URI is configured)', {
          method, path,
          bff_resource_uri: BFF_RESOURCE_URI,
        });
        throw new OAuthError(
          OAUTH_ERROR_TYPES.INVALID_TOKEN,
          'Token is missing the aud claim. Tokens must be issued for this service.',
          401
        );
      }

      // Also accept the MCP gateway audience on MCP-server → BFF callback routes.
      // The gateway's Authorization Server already authorized the request; these
      // routes are internal MCP-server callbacks that execute tools or read data.
      // `path` is router-relative here (req.path inside each sub-router).
      // Banking data routes (/my, /:id, /:id/balance) are reached by BankingAPIClient
      // when TokenResolver falls back to agent-passthrough (no BANKING_API_RESOURCE_URI
      // configured). Gateway tokens are safe here: sub-scoped to the session user,
      // only obtainable via RFC 8693 exchange of a valid user token.
      // /identity is Path B (dual_token): Node gateway forwards the TX gateway
      // bearer + id_token to banking_resource_server. Accept gateway audiences.
      // Banking / Path-B MCP callbacks — gateway + MCP-server audiences only.
      const isMcpBankingCallback = path === '/vertical-tool' || path === '/api/path/vertical-tool'
        || path === '/identity' || path === '/api/resource-server/identity'
        || path === '/my'                              // GET /api/accounts/my, GET /api/transactions/my
        || /^\/[^/]+(\/balance)?$/.test(path)          // GET /api/accounts/:id, GET /api/accounts/:id/balance
        // Write callbacks from the same BankingAPIClient. Matched on baseUrl+method
        // (path is router-relative '/'), so only the exact mounted route is widened:
        //   create_transfer/deposit/withdrawal → POST /api/transactions
        //   request_fee_waiver                 → POST /api/accounts/:id/fee-waiver-request
        //   update_contact_email               → PATCH /api/accounts/:id/contact-email
        // The gateway's Authorize decision already ran for the tool call; HITL 428,
        // scope, and role enforcement on these routes still apply after this check.
        || (method === 'POST' && baseUrl === '/api/transactions' && path === '/')
        || (method === 'POST' && baseUrl === '/api/accounts' && /^\/[^/]+\/fee-waiver-request$/.test(path))
        || (method === 'PATCH' && baseUrl === '/api/accounts' && /^\/[^/]+\/contact-email$/.test(path));
      // A2A investment specialist callback — deliberately NOT folded into the
      // banking callback list above, and its audience is NOT added to gwAuds.
      // Doing so let an invest:read token (aud=mcp-resource-server.ping.demo) satisfy the
      // audience check on POST /api/transactions and the other write callbacks;
      // those routes then failed open past the banking write-scope gate, because
      // the token's scopes are invest:read rather than read/write.
      const isInvestPortfolioCallback =
        baseUrl === '/api/investment' && /^\/accounts\/[^/]+\/portfolio/.test(path);
      const gwAuds = String(MCP_GW_RESOURCE_URI).split(',').map((s) => s.trim()).filter(Boolean);
      if (PINGGATEWAY_RESOURCE_URI && !gwAuds.includes(PINGGATEWAY_RESOURCE_URI)) {
        gwAuds.push(PINGGATEWAY_RESOURCE_URI);
      }
      // MCP server resource URI (mcpserver.ping.demo) — Exchange #3 (PingGateway ->
      // MCP server) narrows the gateway-audience token to this audience per RFC 8693;
      // the MCP server's callback to this route forwards that same bearer, so it must
      // be accepted here on the same trust basis as the gateway audiences above
      // (sub-scoped, only obtainable via RFC 8693 exchange).
      if (MCP_RESOURCE_URI && !gwAuds.includes(MCP_RESOURCE_URI)) {
        gwAuds.push(MCP_RESOURCE_URI);
      }
      // mcp-resource-server's audiences are intentionally absent from gwAuds — Exchange #3
      // for the A2A investment specialist narrows the nested-act token to that audience,
      // and it is accepted ONLY on the portfolio callback below, never on a banking
      // read or write callback.
      const hasMatch = tokenAuds.includes(BFF_RESOURCE_URI) ||
        (isMcpBankingCallback && tokenAuds.some((a) => gwAuds.includes(a))) ||
        (isInvestPortfolioCallback && MCP_RESOURCE_SERVER_AUDIENCES.length > 0
          && tokenAuds.some((a) => MCP_RESOURCE_SERVER_AUDIENCES.includes(a)));
      if (!hasMatch) {
        logger.warn(LOG_CATEGORIES.OAUTH_VALIDATION, 'Token audience mismatch — rejecting', {
          method, path,
          token_aud: tokenAuds,
          expected: BFF_RESOURCE_URI,
        });
        throw new OAuthError(
          OAUTH_ERROR_TYPES.INVALID_TOKEN,
          `Token audience [${tokenAuds.join(', ')}] does not match this service's audience '${BFF_RESOURCE_URI}'.`,
          401
        );
      }

      logger.debug(LOG_CATEGORIES.OAUTH_VALIDATION, 'Audience check passed', {
        method, path,
        token_aud: tokenAuds,
        bff_resource_uri: BFF_RESOURCE_URI,
      });
    } else if (payload.aud) {
      // No BFF_RESOURCE_URI configured — accept only the PingOne default audience
      // so tokens from other resource servers still can't be replayed here.
      const tokenAuds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      const hasDefault = tokenAuds.includes(PINGONE_DEFAULT_AUD);
      if (!hasDefault) {
        logger.warn(LOG_CATEGORIES.OAUTH_VALIDATION, 'Token has custom aud but BFF_RESOURCE_URI not set — rejecting', {
          method, path,
          token_aud: tokenAuds,
          hint: 'Set ENDUSER_AUDIENCE or PINGONE_RESOURCE_BFF_URI to the BFF resource URI in .env',
        });
        throw new OAuthError(
          OAUTH_ERROR_TYPES.INVALID_TOKEN,
          `Token audience [${tokenAuds.join(', ')}] does not match the default PingOne audience. ` +
          `Configure ENDUSER_AUDIENCE or PINGONE_RESOURCE_BFF_URI to accept custom resource server tokens.`,
          401
        );
      }
    }

    logger.info(LOG_CATEGORIES.OAUTH_VALIDATION, 'PingOne JWKS token validation successful', {
      method,
      path,
      subject: payload.sub,
      scopes: payload.scope,
    });

    return { valid: true, decoded: payload };
  } catch (error) {
    const isTransient = error.message.includes('timed out') || error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED');
    const logFn = isTransient ? 'warn' : 'error';
    logger[logFn](LOG_CATEGORIES.OAUTH_VALIDATION, 'Token validation failed', {
      method,
      path,
      error_message: error.message,
    });

    if (error instanceof OAuthError) throw error;

    throw new OAuthError(
      OAUTH_ERROR_TYPES.INVALID_TOKEN,
      `PingOne token validation failed: ${error.message}`,
      401
    );
  }
};

// JWT token generation removed - OAuth tokens are now used directly

// Verify OAuth tokens with comprehensive logging and monitoring
const authenticateToken = async (req, res, next) => {
  const requestContext = {
    method: req.method,
    path: req.path || req.url,
    baseUrl: req.baseUrl || '',
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.connection.remoteAddress
  };

  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];

    logger.debug(LOG_CATEGORIES.AUTHENTICATION, 'Starting token authentication', {
      ...requestContext,
      has_auth_header: !!authHeader,
      has_token: !!token
    });

    if (!token) {
      // Backend-for-Frontend (BFF) session fallback: if the browser SPA has a valid session (session cookie),
      // use the session-stored token for validation instead of requiring the Authorization header.
      // This prevents token relay — the token never needs to leave the backend.
      const sessionToken = req.session?.oauthTokens?.accessToken;
      if (sessionToken) {
        // Reject the _cookie_session stub — it is a read-only identity placeholder
        // used only by /status endpoints. It carries no OAuth token, so any route
        // protected by authenticateToken must return 401 and prompt sign-in again.
        if (sessionToken === '_cookie_session') {
          logger.warn(LOG_CATEGORIES.AUTHENTICATION,
            '_cookie_session stub rejected on authenticated route — sign in required',
            requestContext);
          throw new OAuthError(
            OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
            'Session requires re-authentication (no OAuth token — please sign in again)',
            401,
            { hint: 'Sign in again to obtain a fresh access token', requiresLogin: true },
          );
        }

        logger.debug(LOG_CATEGORIES.AUTHENTICATION, 'Using session token as fallback (no Authorization header)', requestContext);
        // Validate session token WITHOUT mutating req.headers — avoids leaking
        // the token into downstream logging/audit that captures raw headers.
        const sessionTokenExtracted = sessionToken;
        try {
          const { valid, decoded, error } = await validatePingOneCoreToken(sessionTokenExtracted, requestContext);
          if (!valid) {
            logger.error(LOG_CATEGORIES.AUTHENTICATION, 'Session OAuth token validation failed', {
              ...requestContext,
              error_type: error?.type || 'unknown',
              error_message: error?.message || 'Unknown validation error'
            });
            throw error;
          }
          const clientType = determineClientType(sessionTokenExtracted);
          const scopes = parseTokenScopes(sessionTokenExtracted, requestContext);
          const userType = determineUserTypeFromToken(decoded);
          // Same client id as authorize flow (configStore: PINGONE_CORE_CLIENT_ID, PINGONE_ADMIN_CLIENT_ID, …)
          const adminClientId = String(oauthConfig.clientId || '').trim();
          const tokenClientId = decoded.azp || decoded.client_id;
          const isAdminClient = adminClientId && tokenClientId && tokenClientId === adminClientId;
          const su = req.session?.user;
          const sessionMatchesSub = su && (
            su.oauthId === decoded.sub ||
            su.id === decoded.sub
          );
          const sessionRole = sessionMatchesSub ? su.role : null;
          const derivedRole = (isAdminClient || sessionRole === 'admin') ? 'admin' : 'user';
          req.user = {
            id: decoded.sub,
            sub: decoded.sub,
            username: decoded.preferred_username || decoded.sub,
            email: decoded.email,
            firstName: decoded.given_name || null,
            lastName: decoded.family_name || null,
            name: decoded.name || null,
            role: derivedRole,
            clientType: clientType,
            userType: userType,
            tokenType: 'oauth',
            acr: decoded.acr || null,
            authTime: Number.isFinite(Number(decoded.auth_time)) ? Number(decoded.auth_time) : null, // OIDC auth_time — when the user actually authenticated (RFC 9470 freshness)
            scopes: scopes,
            isDelegated: !!decoded.act,
            actor: decoded.act || null
          };
          logger.info(LOG_CATEGORIES.AUTHENTICATION, 'Session-based token authentication successful (BFF)', {
            ...requestContext,
            subject: decoded.sub,
            client_type: clientType,
            user_type: userType
          });
          return next();
        } catch (sessionAuthError) {
          const isTransientErr = sessionAuthError.message.includes('timed out') || sessionAuthError.message.includes('ETIMEDOUT');
          if (isTransientErr) {
            // Already logged as WARN in validatePingOneCoreToken — skip duplicate
          } else {
            logger.error(LOG_CATEGORIES.AUTHENTICATION, 'Session token validation error', {
              ...requestContext,
              error_message: sessionAuthError.message
            });
          }
          if (sessionAuthError instanceof OAuthError) throw sessionAuthError;
          throw new OAuthError(OAUTH_ERROR_TYPES.INVALID_TOKEN, 'Session token validation failed', 401);
        }
      }

      const error = new OAuthError(
        OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
        'Access token is required',
        401,
        { hint: 'Include a valid Bearer token in the Authorization header' }
      );
      
      logger.logAuthenticationAttempt(false, {
        ...requestContext,
        error_type: OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
        reason: 'missing_token'
      });
      
      throw error;
    }

    // Log token information for debugging
    if (DEBUG_TOKENS) {
      logTokenInfo(token, `${req.method} ${req.path}`);
    }

    try {
      // Validate OAuth token with enhanced error handling
      const { valid, decoded, error } = await validatePingOneCoreToken(token, requestContext);
      
      if (!valid) {
        logger.error(LOG_CATEGORIES.AUTHENTICATION, 'OAuth token validation failed', {
          ...requestContext,
          error_type: error?.type || 'unknown',
          error_message: error?.message || 'Unknown validation error'
        });
        
        // The error should already be an OAuthError from validatePingOneCoreToken
        throw error;
      }

      // Determine client type from OAuth token audience
      const clientType = determineClientType(token);
      
      // Parse scopes from OAuth token with request context
      const scopes = parseTokenScopes(token, requestContext);
      
      // Determine user type from token payload
      const userType = determineUserTypeFromToken(decoded);

      logger.info(LOG_CATEGORIES.AUTHENTICATION, 'OAuth token authentication successful', {
        ...requestContext,
        subject: decoded.sub,
        username: decoded.preferred_username,
        client_type: clientType,
        user_type: userType,
        scopes: scopes,
        scope_count: scopes.length
      });
      
      // Map OAuth token claims to user model
      // Role determination: PingOne tokens don't include realm_access.roles (Keycloak claim).
      // Grant admin role if:
      //  1. The token was issued to the admin client (azp/client_id claim matches), OR
      //  2. The session already has this user recorded as admin (enrichment from OAuth callback)
      const adminClientId = String(oauthConfig.clientId || '').trim();
      const tokenClientId = decoded.azp || decoded.client_id;
      const isAdminClient = adminClientId && tokenClientId && tokenClientId === adminClientId;
      const su = req.session?.user;
      const sessionMatchesSub = su && (
        su.oauthId === decoded.sub ||
        su.id === decoded.sub
      );
      const sessionRole = sessionMatchesSub ? su.role : null;
      const derivedRole = (isAdminClient || sessionRole === 'admin') ? 'admin' : 'user';
      // `is_delegate` is the demo's user-attribute-driven delegation flag,
      // emitted as a SPEL token claim from the Super Banking API resource
      // (value = ${user.isDelegate}). PingOne user attributes are STRING-only,
      // so the value arrives as the literal string "true" / "false" — coerce
      // here so downstream code can do straight boolean checks. Distinct from
      // RFC 8693 `act` claim (handled below as `isDelegated`).
      const isBankDelegate =
        decoded.is_delegate === true ||
        decoded.is_delegate === 'true' ||
        decoded.isDelegate === true ||
        decoded.isDelegate === 'true';

      req.user = {
        id: decoded.sub,
        sub: decoded.sub,
        username: decoded.preferred_username || decoded.sub,
        email: decoded.email,
        firstName: decoded.given_name || null,
        lastName: decoded.family_name || null,
        name: decoded.name || null,
        role: derivedRole,
        clientType: clientType,
        userType: userType,
        tokenType: 'oauth',
        acr: decoded.acr || null,      // PingOne sets this when acr_values was requested
        authTime: Number.isFinite(Number(decoded.auth_time)) ? Number(decoded.auth_time) : null, // OIDC auth_time — when the user actually authenticated (RFC 9470 freshness)
        scopes: scopes,
        // RFC 8693 delegation: enrich req.user when token carries an act claim
        isDelegated: !!decoded.act,
        actor: decoded.act || null,    // { sub: <actor_client_id> } or { sub, act: { sub: ... } } for nested
        // Demo banking-delegate flag (separate from RFC 8693 isDelegated).
        // True for users with isDelegate=true on their PingOne profile.
        // Used by requireNotBankDelegate middleware to gate write operations
        // that delegates aren't authorized to perform (transfers, payments,
        // account create/delete, profile edits).
        isBankDelegate,
      };

      // Open-access Privilege hop only: banking DATA tools reach the BFF with a
      // worker-derived Step 9 token that has no user subject (client_credentials
      // → sub undefined), so /my would resolve to no accounts. Bind such a request
      // to a real demo user so the tools return real rows. Scoped tight: ONLY when
      // MCP_AUTH_DISABLED is on, the token has no sub, and the derived role is not
      // admin — a real user (has a sub) or an admin token is never rebound, so
      // requireNotAdmin and role enforcement are unchanged.
      if (process.env.MCP_AUTH_DISABLED === 'true' && !decoded.sub && derivedRole !== 'admin') {
        const demoUser = require('../services/openAccessDemoUser').resolveDemoUser();
        if (demoUser?.id) {
          req.user.id = demoUser.id;
          req.user.sub = demoUser.id;
          // Display fields so the banking page shows a real holder name, not a UUID.
          if (demoUser.username) req.user.username = demoUser.username;
          if (demoUser.email) req.user.email = demoUser.email;
          if (demoUser.firstName) req.user.firstName = demoUser.firstName;
          if (demoUser.lastName) req.user.lastName = demoUser.lastName;
          if (demoUser.name) req.user.name = demoUser.name;
          req.user.openAccessDemoBinding = true;
        }
      }

      return next();
    } catch (oauthError) {
      logger.error(LOG_CATEGORIES.AUTHENTICATION, 'OAuth token validation error', {
        ...requestContext,
        error_type: oauthError.type || 'unknown',
        error_message: oauthError.message
      });
      
      // Re-throw OAuth errors as-is
      if (oauthError instanceof OAuthError) {
        throw oauthError;
      }
      
      // Convert other errors to OAuth errors
      throw new OAuthError(
        OAUTH_ERROR_TYPES.INVALID_TOKEN,
        'Token validation failed',
        401,
        { 
          hint: 'Ensure your token is valid and not expired',
          details: process.env.NODE_ENV === 'development' ? oauthError.message : undefined
        }
      );
    }
  } catch (error) {
    // Skip redundant log for transient errors (already logged upstream)
    const isTransient = error.message && (error.message.includes('timed out') || error.message.includes('ETIMEDOUT'));
    if (isTransient) {
      // Already logged as WARN in validatePingOneCoreToken — skip duplicate
    } else {
      logger.logAuthenticationAttempt(false, {
        ...requestContext,
        error_type: error.type || 'authentication_failed',
        error_message: error.message,
        status_code: error.statusCode || 401
      });
    }
    
    // Format and send OAuth error response
    const errorResponse = {
      error: error.type || 'authentication_failed',
      error_description: error.message,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.path || req.url,
      method: req.method
    };

    const msg = String(error.message || '').toLowerCase();
    if ((error.statusCode || 401) === 401 && (msg.includes('expired') || error.type === 'invalid_token' || error.type === 'expired_token')) {
      errorResponse.requiresLogin = true;
      if (msg.includes('expired')) {
        errorResponse.error = 'session_expired';
      }
    }
    
    // Add additional OAuth error data
    if (error.additionalData) {
      Object.assign(errorResponse, error.additionalData);
    }
    
    return res.status(error.statusCode || 401).json(errorResponse);
  }
};

// Check if user is admin with enhanced error handling and logging
const requireAdmin = (req, res, next) => {
  const requestContext = {
    method: req.method,
    path: req.path || req.url,
    userId: req.user?.id || 'anonymous',
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.connection.remoteAddress
  };

  try {
    // Ensure user is authenticated first
    if (!req.user) {
      logger.warn(LOG_CATEGORIES.AUTHORIZATION, 'Admin check attempted without authenticated user', requestContext);
      
      throw new OAuthError(
        OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
        'Authentication required to access this resource',
        401,
        { hint: 'Include a valid Bearer token in the Authorization header' }
      );
    }
    
    logger.debug(LOG_CATEGORIES.AUTHORIZATION, 'Starting admin access check', {
      ...requestContext,
      username: req.user.username,
      user_role: req.user.role,
      token_type: req.user.tokenType
    });
    
    // Check if user has admin role (from user object) OR admin scope
    const userScopes = req.user.scopes || [];
    const hasAdminRole = req.user.role === 'admin';
    const hasAdminScope = userScopes.includes(BANKING_SCOPES.ADMIN);
    
    logger.debug(LOG_CATEGORIES.AUTHORIZATION, 'Checking admin access', {
      ...requestContext,
      user_scopes: userScopes,
      has_admin_role: hasAdminRole,
      has_admin_scope: hasAdminScope
    });
    
    // Grant access if user has admin role OR admin scope
    if (hasAdminRole || hasAdminScope) {
      logger.info(LOG_CATEGORIES.AUTHORIZATION, 'Admin access granted', {
        ...requestContext,
        username: req.user.username,
        access_reason: hasAdminScope ? 'admin scope' : 'admin role'
      });
      
      next();
    } else {
      throw new OAuthError(
        OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE,
        'Admin access required. User must have admin role or admin scope.',
        403,
        { 
          hint: 'Contact your administrator to grant admin privileges',
          required_access: 'admin role or admin scope'
        }
      );
    }
  } catch (error) {
    logger.logAuthorizationAttempt(false, {
      ...requestContext,
      error_type: error.type || 'access_denied',
      error_message: error.message,
      required_access: 'admin role or admin scope',
      user_role: req.user?.role,
      user_scopes: req.user?.scopes || []
    });
    
    // Format and send OAuth error response
    const errorResponse = {
      error: error.type || 'access_denied',
      error_description: error.message,
      timestamp: new Date().toISOString(),
      path: req.originalUrl || req.path || req.url,
      method: req.method
    };
    
    // Add additional OAuth error data
    if (error.additionalData) {
      Object.assign(errorResponse, error.additionalData);
    }
    
    return res.status(error.statusCode || 403).json(errorResponse);
  }
};

// Check if user owns the resource or is admin
const requireOwnershipOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthenticated', message: 'Authentication required.' });
  }
  const { userId } = req.params;
  
  if (req.user.role === 'admin' || req.user.id === userId) {
    next();
  } else {
    res.status(403).json({ error: 'Access denied' });
  }
};

// Block admin tokens from customer-only resources. The customer dashboard and
// its `/api/*/my` data endpoints are end-user surfaces — an admin token must
// not hydrate them. Callers should switch to a user token (POST /api/auth/switch
// with targetRole "customer") instead. Non-admin (customer/user) tokens pass.
const requireNotAdmin = (req, res, next) => {
  if (req.user?.role === 'admin') {
    return res.status(403).json({
      error: 'admin_token_forbidden',
      error_description: 'The customer dashboard is not available with an admin token. Switch to a user token to continue.',
      hint: 'POST /api/auth/switch with { "targetRole": "customer" }',
    });
  }
  next();
};

// Check if token is for end user UI
const requireEndUser = (req, res, next) => {
  if (req.user.clientType === 'enduser') {
    next();
  } else {
    res.status(403).json({ error: 'End user access required' });
  }
};

// Check if token is for AI agent
const requireAIAgent = (req, res, next) => {
  if (req.user.clientType === 'ai_agent') {
    next();
  } else {
    res.status(403).json({ error: 'AI agent access required' });
  }
};

/**
 * Require RFC 8693 delegation token (act claim) for AI agent requests.
 * Implements D-02: Backend validates act claim required.
 *
 * When the request comes from an AI agent (clientType === 'ai_agent'),
 * the token MUST contain an act claim proving delegation was performed
 * via token exchange. Direct pass-through of user tokens is rejected.
 *
 * Non-agent requests (enduser, admin) pass through unchanged.
 */
const requireDelegation = (req, res, next) => {
  // Only enforce delegation on agent requests
  if (req.user?.clientType !== 'ai_agent') {
    return next();
  }

  if (!req.user.isDelegated || !req.user.actor) {
    logger.warn(LOG_CATEGORIES.AUTHENTICATION, 'Agent request rejected: missing delegation token (act claim)', {
      userId: req.user.id,
      clientType: req.user.clientType,
      path: req.path,
      method: req.method,
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Delegation token required (missing act claim)',
      code: 'DELEGATION_REQUIRED',
    });
  }

  if (!req.user.actor.sub && !req.user.actor.client_id) {
    logger.warn(LOG_CATEGORIES.AUTHENTICATION, 'Agent request rejected: invalid delegation claim (no actor identity)', {
      userId: req.user.id,
      clientType: req.user.clientType,
      actor: req.user.actor,
      path: req.path,
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid delegation claim (missing actor identity)',
      code: 'INVALID_DELEGATION',
    });
  }

  logger.info(LOG_CATEGORIES.AUTHENTICATION, 'Agent request authorized via delegation', {
    userId: req.user.id,
    actorSub: req.user.actor.sub || req.user.actor.client_id,
    path: req.path,
    method: req.method,
  });

  next();
};

// Verify password
const verifyPassword = (password, hashedPassword) => {
  return bcrypt.compareSync(password, hashedPassword);
};

// Hash password
const hashPassword = (password) => {
  return bcrypt.hashSync(password, 10);
};


/**
 * Require an active session (req.session.user present).
 * Used on routes that need a logged-in browser session but may not carry a Bearer token.
 * Returns 401 { error: 'unauthenticated', message: '...' } if no session.
 */
const requireSession = (req, res, next) => {
  if (!req.session?.user) {
    return res.status(401).json({
      error: 'unauthenticated',
      message: 'A valid session is required. Please sign in.',
    });
  }
  next();
};

/**
 * Block demoDelegate users from a route.
 *
 * Reads req.user.isBankDelegate (set in authenticateToken from the
 * is_delegate / isDelegate token claim) and returns 403 when true.
 *
 * Demo policy: demoDelegate can read account details + balances and make
 * deposits, but cannot transfer, pay bills, create or close accounts, or
 * change their own profile. Apply this middleware to the routes that
 * delegates aren't authorized for.
 *
 * Operative AFTER authenticateToken — req.user must already be populated.
 */
const requireNotBankDelegate = (operationLabel = 'this operation') => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthenticated', message: 'Authentication required.' });
  }
  if (req.user.isBankDelegate === true) {
    logger.warn(LOG_CATEGORIES.AUTHORIZATION, 'Delegate user blocked from restricted operation', {
      userId: req.user.id,
      username: req.user.username,
      path: req.path,
      method: req.method,
      operation: operationLabel,
    });
    return res.status(403).json({
      error: 'forbidden_for_delegate',
      message: `Delegated users are not authorized to perform ${operationLabel}. Delegates can read accounts and make deposits.`,
      code: 'DELEGATE_RESTRICTED',
      allowed: ['read accounts', 'read balances', 'view account profile', 'deposit funds'],
      restricted: ['transfers', 'payments', 'account create/delete', 'profile changes'],
    });
  }
  return next();
};

/**
 * optionalAuthenticateToken — authenticate when the caller presents credentials,
 * pass through as a guest when they don't.
 *
 * For mounts that mix public and protected routes. Dropping `authenticateToken`
 * from such a mount is NOT equivalent: `req.user` is populated only by
 * `authenticateToken`, so removing it makes every downstream `requireSession` /
 * `requireAdmin` route 401/403 for signed-in users too.
 *
 * A present-but-invalid token still 401s — this widens who may reach the route,
 * never what an unauthenticated caller is treated as.
 */
const optionalAuthenticateToken = (req, res, next) => {
  const hasAuthHeader = !!req.headers['authorization']?.split(' ')[1];
  const sessionToken = req.session?.oauthTokens?.accessToken;
  // '_cookie_session' is a read-only identity stub carrying no OAuth token;
  // authenticateToken rejects it, so treat it as "no credentials" here.
  const hasSessionToken = !!sessionToken && sessionToken !== '_cookie_session';
  if (!hasAuthHeader && !hasSessionToken) {
    req.user = null;
    return next();
  }
  return authenticateToken(req, res, next);
};

module.exports = {
  authenticateToken,
  optionalAuthenticateToken,
  requireSession,
  requireAdmin,
  requireOwnershipOrAdmin,
  requireNotAdmin,
  requireEndUser,
  requireAIAgent,
  requireDelegation,
  requireNotBankDelegate,
  requireScopes,
  verifyPassword,
  hashPassword,
  determineClientType,
  determineUserTypeFromToken,
  parseTokenScopes,
  hasRequiredScopes,
  ROUTE_SCOPE_MAP: ROUTE_SCOPE_MAP // Use the imported ROUTE_SCOPE_MAP from config
};
