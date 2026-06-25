/**
 * OAuth 2.0 Token Endpoint Routes
 * RFC 6749 compliant token endpoint with client credentials grant support
 * 
 * Phase 57-02: Client Credentials Token Service
 * Security-focused implementation with comprehensive validation
 */

'use strict';

const express = require('express');
const router = express.Router();
const {
  processClientCredentialsGrant,
  introspectToken,
  revokeToken,
  validateTokenForApi,
  getTokenStatistics,
  cleanupExpiredTokens
} = require('../services/clientCredentialsTokenService');

/**
 * Middleware to extract client credentials from Authorization header
 */
function extractClientCredentials(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    // Try to get credentials from request body (client_secret_post method)
    const clientId = req.body.client_id;
    const clientSecret = req.body.client_secret;
    
    if (!clientId || !clientSecret) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Client authentication failed'
      });
    }
    
    req.clientCredentials = {
      method: 'client_secret_post',
      client_id: clientId,
      client_secret: clientSecret
    };
    
    return next();
  }

  // Parse Basic authentication header
  if (!authHeader.startsWith('Basic ')) {
    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'Invalid authentication method'
    });
  }

  try {
    const base64Credentials = authHeader.slice(6); // Remove 'Basic '
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [client_id, client_secret] = credentials.split(':');

    if (!client_id || !client_secret) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Invalid client credentials format'
      });
    }

    req.clientCredentials = {
      method: 'client_secret_basic',
      client_id,
      client_secret
    };

    next();
  } catch (error) {
    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'Invalid authentication header'
    });
  }
}

/**
 * Middleware to extract request metadata for audit logging
 */
function extractRequestMetadata(req, res, next) {
  req.metadata = {
    sourceIP: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    requestId: req.id || require('crypto').randomUUID()
  };
  next();
}

/**
 * POST /api/oauth/token
 * OAuth 2.0 token endpoint - RFC 6749 compliant
 */
router.post('/token', extractRequestMetadata, async (req, res, next) => {
  try {
    // Parse form-encoded request body
    const grant_type = req.body.grant_type;
    const scope = req.body.scope;
    const { client_id, client_secret } = req.clientCredentials;

    // Validate content type for form-encoded data
    const contentType = req.get('Content-Type');
    if (contentType && !contentType.includes('application/x-www-form-urlencoded')) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Content-Type must be application/x-www-form-urlencoded'
      });
    }

    const tokenRequest = {
      grant_type,
      scope,
      client_id,
      client_secret
    };

    const tokenResponse = await processClientCredentialsGrant(tokenRequest, req.metadata);

    // Set cache control headers
    res.set({
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache'
    });

    res.json(tokenResponse);

  } catch (error) {
    console.error('[OAuth Token] Error processing grant:', error);
    
    const statusCode = error.status || 500;
    const errorCode = error.code || 'server_error';
    const errorMessage = error.message || 'Internal server error';

    res.status(statusCode).json({
      error: errorCode,
      error_description: errorMessage
    });
  }
});

/**
 * POST /api/oauth/introspect
 * Token introspection endpoint - RFC 7662 compliant
 */
router.post('/introspect', extractRequestMetadata, (req, res, next) => {
  try {
    const token = req.body.token;
    
    if (!token) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Token parameter is required'
      });
    }

    const introspection = introspectToken(token, req.metadata);

    res.json(introspection);

  } catch (error) {
    console.error('[OAuth Introspect] Error:', error);
    
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
});

/**
 * POST /api/oauth/revoke
 * Token revocation endpoint - RFC 7009 compliant
 */
router.post('/revoke', extractRequestMetadata, (req, res, next) => {
  try {
    const token = req.body.token;
    const token_type_hint = req.body.token_type_hint;
    
    if (!token) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Token parameter is required'
      });
    }

    const revocation = revokeToken(token, req.metadata);

    // Always return 200 for revocation (RFC 7009)
    res.status(200).json({});

  } catch (error) {
    console.error('[OAuth Revoke] Error:', error);
    
    // Always return 200 for revocation to avoid token leakage
    res.status(200).json({});
  }
});

/**
 * GET /api/oauth/token/statistics
 * Token statistics endpoint (admin only)
 */
router.get('/token/statistics', extractRequestMetadata, async (req, res, next) => {
  try {
    // Check admin permissions
    const token = req.session?.oauthTokens;
    if (!token) {
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Authentication required'
      });
    }

    const userScopes = token.scope ? token.scope.split(' ') : [];
    const hasAdminScope = userScopes.some(scope => 
      scope.startsWith('admin:') || scope === 'users:manage'
    );

    if (!hasAdminScope) {
      return res.status(403).json({
        error: 'insufficient_scope',
        error_description: 'Admin access required'
      });
    }

    const stats = getTokenStatistics();
    res.json(stats);

  } catch (error) {
    console.error('[OAuth Stats] Error:', error);
    
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
});

/**
 * POST /api/oauth/token/cleanup
 * Token cleanup endpoint (admin only, for maintenance)
 */
router.post('/token/cleanup', extractRequestMetadata, async (req, res, next) => {
  try {
    // Check admin permissions
    const token = req.session?.oauthTokens;
    if (!token) {
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Authentication required'
      });
    }

    const userScopes = token.scope ? token.scope.split(' ') : [];
    const hasAdminScope = userScopes.some(scope => 
      scope.startsWith('admin:') || scope === 'users:manage'
    );

    if (!hasAdminScope) {
      return res.status(403).json({
        error: 'insufficient_scope',
        error_description: 'Admin access required'
      });
    }

    const cleanedCount = cleanupExpiredTokens();
    res.json({
      cleaned_tokens: cleanedCount,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[OAuth Cleanup] Error:', error);
    
    res.status(500).json({
      error: 'server_error',
      error_description: 'Internal server error'
    });
  }
});

/**
 * Middleware for validating OAuth tokens in API routes
 * This can be used by other routes to validate client credentials tokens
 */
function validateOAuthToken(requiredScopes = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Access token required'
      });
    }

    const token = authHeader.slice(7); // Remove 'Bearer '
    
    try {
      const validation = validateTokenForApi(token, requiredScopes, {
        sourceIP: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        requestId: req.id || require('crypto').randomUUID()
      });

      if (!validation.valid) {
        return res.status(401).json({
          error: 'invalid_token',
          error_description: 'Invalid access token'
        });
      }

      // Attach token info to request for downstream use
      req.oauthToken = validation.payload;
      req.oauthTokenScopes = validation.tokenScopes;

      next();
    } catch (error) {
      const statusCode = error.status || 401;
      const errorCode = error.code || 'invalid_token';
      const errorMessage = error.message || 'Invalid access token';

      res.status(statusCode).json({
        error: errorCode,
        error_description: errorMessage
      });
    }
  };
}

/**
 * Error handling middleware
 */
router.use((err, req, res, next) => {
  console.error('[OAuth Token] Unhandled error:', err);
  
  res.status(500).json({
    error: 'server_error',
    error_description: 'Internal server error'
  });
});

// Export the validation middleware for use in other routes
module.exports = router;
module.exports.validateOAuthToken = validateOAuthToken;
