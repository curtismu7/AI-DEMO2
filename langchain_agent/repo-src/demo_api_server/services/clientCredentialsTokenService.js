/**
 * OAuth 2.0 Client Credentials Token Service
 * RFC 6749 §4.4 compliant implementation with 30-minute TTL
 * 
 * Phase 57-02: Client Credentials Token Service
 * Security-focused implementation with comprehensive validation and audit logging
 */

'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { validateClientCredentials } = require('./oauthClientRegistry');
const { writeExchangeEvent } = require('./exchangeAuditStore');

/**
 * Token configuration
 */
const TOKEN_CONFIG = {
  // Short TTL so the token chain can show real-time expiry during demos.
  accessTokenTTL: 60, // 60 seconds
  issuer: process.env.JWT_ISSUER || 'enduser.ping.demo',
  algorithm: 'RS256', // Use RSA for production, can fallback to HS256 for development
  // For development, we'll use HS256 with a secret key
  secretKey: process.env.JWT_SECRET || 'development-secret-key-change-in-production'
};

/**
 * Token storage for introspection and revocation
 * In production, this should be stored in Redis or database
 */
const tokenStore = new Map();

/**
 * Token statistics for monitoring
 */
const tokenStats = {
  issued: 0,
  validated: 0,
  expired: 0,
  revoked: 0,
  failed: 0
};

/**
 * Audit event logging for token operations
 */
function logTokenEvent(eventType, tokenData, details = {}) {
  const auditEvent = {
    type: 'token-event',
    level: 'info',
    timestamp: new Date().toISOString(),
    eventType,
    tokenId: tokenData.jti || 'unknown',
    clientId: tokenData.client_id || 'unknown',
    scopes: tokenData.scope || [],
    ...details,
    security: {
      sourceIP: details.sourceIP || 'unknown',
      userAgent: details.userAgent || 'unknown',
      requestId: details.requestId || crypto.randomUUID()
    }
  };

  writeExchangeEvent(auditEvent).catch(err => {
    console.error('[TokenService] Failed to log token event:', err.message);
  });
}

/**
 * Validate requested scopes against client's registered scopes
 */
function validateRequestedScopes(requestedScopes, clientScopes) {
  if (!requestedScopes || requestedScopes.length === 0) {
    return { valid: true, validScopes: clientScopes };
  }

  const requestedSet = new Set(requestedScopes);
  const clientSet = new Set(clientScopes);
  
  // Check if all requested scopes are allowed for this client
  const invalidScopes = requestedScopes.filter(scope => !clientSet.has(scope));
  
  if (invalidScopes.length > 0) {
    return {
      valid: false,
      error: `Requested scopes not allowed: ${invalidScopes.join(', ')}`,
      invalidScopes
    };
  }

  return { valid: true, validScopes: requestedScopes };
}

/**
 * Generate JWT access token for client credentials
 */
function generateAccessToken(client, requestedScopes, metadata = {}) {
  const now = Math.floor(Date.now() / 1000);
  const tokenId = crypto.randomUUID();
  
  // Validate scopes
  const scopeValidation = validateRequestedScopes(requestedScopes, client.scope);
  if (!scopeValidation.valid) {
    const error = new Error(scopeValidation.error);
    error.status = 400;
    error.code = 'invalid_scope';
    throw error;
  }

  const tokenPayload = {
    // JWT standard claims
    iss: TOKEN_CONFIG.issuer,
    sub: client.userId || client.client_id,
    aud: client.scope, // Audience can be the scopes for client credentials
    exp: now + TOKEN_CONFIG.accessTokenTTL,
    iat: now,
    jti: tokenId,
    
    // OAuth 2.0 specific claims
    client_id: client.client_id,
    scope: scopeValidation.validScopes.join(' '),
    token_type: 'Bearer',
    
    // Custom claims for audit and monitoring
    token_use: 'client_credentials',
    auth_time: now,
    registration_metadata: client.registration_metadata
  };

  // Generate token
  let accessToken;
  if (TOKEN_CONFIG.algorithm === 'RS256' && process.env.JWT_PRIVATE_KEY) {
    // Production: Use RSA private key
    accessToken = jwt.sign(tokenPayload, process.env.JWT_PRIVATE_KEY, {
      algorithm: 'RS256',
      keyid: 'client-credentials-key'
    });
  } else {
    // Development: Use HS256 with secret
    accessToken = jwt.sign(tokenPayload, TOKEN_CONFIG.secretKey, {
      algorithm: 'HS256'
    });
  }

  // Store token for introspection and revocation
  const tokenRecord = {
    jti: tokenId,
    client_id: client.client_id,
    scope: scopeValidation.validScopes,
    issued_at: now,
    expires_at: now + TOKEN_CONFIG.accessTokenTTL,
    revoked: false,
    metadata: {
      sourceIP: metadata.sourceIP,
      userAgent: metadata.userAgent,
      requestId: metadata.requestId
    }
  };

  tokenStore.set(tokenId, tokenRecord);

  // Update statistics
  tokenStats.issued++;

  // Log token issuance
  logTokenEvent('token_issued', tokenPayload, {
    scope: scopeValidation.validScopes,
    expiresIn: TOKEN_CONFIG.accessTokenTTL,
    ...metadata
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_CONFIG.accessTokenTTL,
    scope: scopeValidation.validScopes.join(' ')
  };
}

/**
 * Validate and decode JWT access token
 */
function validateAccessToken(token, metadata = {}) {
  try {
    // Decode token first to get basic info
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) {
      throw new Error('Invalid token format');
    }

    const tokenId = decoded.payload.jti;
    if (!tokenId) {
      throw new Error('Token missing jti claim');
    }

    // Check if token is revoked
    const tokenRecord = tokenStore.get(tokenId);
    if (!tokenRecord) {
      throw new Error('Token not found');
    }

    if (tokenRecord.revoked) {
      throw new Error('Token has been revoked');
    }

    // Check expiration
    if (Date.now() / 1000 > tokenRecord.expires_at) {
      tokenStore.delete(tokenId);
      tokenStats.expired++;
      throw new Error('Token has expired');
    }

    // Verify JWT signature
    let verifiedPayload;
    if (TOKEN_CONFIG.algorithm === 'RS256' && process.env.JWT_PUBLIC_KEY) {
      // Production: Verify with RSA public key
      verifiedPayload = jwt.verify(token, process.env.JWT_PUBLIC_KEY, {
        algorithms: ['RS256']
      });
    } else {
      // Development: Verify with HS256 secret
      verifiedPayload = jwt.verify(token, TOKEN_CONFIG.secretKey, {
        algorithms: ['HS256']
      });
    }

    // Update statistics
    tokenStats.validated++;

    // Log token validation
    logTokenEvent('token_validated', verifiedPayload, metadata);

    return {
      valid: true,
      payload: verifiedPayload,
      tokenRecord
    };

  } catch (error) {
    tokenStats.failed++;
    
    let errorCode = 'invalid_token';
    let errorMessage = 'Invalid access token';

    if (error.name === 'TokenExpiredError') {
      errorCode = 'invalid_token';
      errorMessage = 'Token has expired';
    } else if (error.name === 'JsonWebTokenError') {
      errorCode = 'invalid_token';
      errorMessage = 'Invalid token format';
    } else if (error.message.includes('revoked')) {
      errorCode = 'invalid_token';
      errorMessage = 'Token has been revoked';
    }

    logTokenEvent('token_validation_failed', { jti: 'unknown' }, {
      error: errorMessage,
      errorCode,
      ...metadata
    });

    const tokenError = new Error(errorMessage);
    tokenError.code = errorCode;
    tokenError.status = 401;
    throw tokenError;
  }
}

/**
 * Process client credentials grant request
 */
async function processClientCredentialsGrant(request, metadata = {}) {
  const {
    grant_type,
    scope,
    client_id,
    client_secret
  } = request;

  // Validate grant type
  if (grant_type !== 'client_credentials') {
    const error = new Error('Unsupported grant type');
    error.code = 'unsupported_grant_type';
    error.status = 400;
    throw error;
  }

  // Validate client credentials
  const clientValidation = validateClientCredentials(client_id, client_secret);
  if (!clientValidation.valid) {
    const error = new Error(clientValidation.error);
    error.code = 'invalid_client';
    error.status = 401;
    throw error;
  }

  const client = clientValidation.client;

  // Parse requested scopes
  const requestedScopes = scope ? scope.split(' ').filter(Boolean) : [];

  // Generate access token
  const tokenResponse = generateAccessToken(client, requestedScopes, metadata);

  // Log successful grant
  logTokenEvent('client_credentials_grant_success', {
    client_id,
    scope: tokenResponse.scope
  }, metadata);

  return tokenResponse;
}

/**
 * Token introspection endpoint (RFC 7662)
 */
function introspectToken(token, metadata = {}) {
  try {
    const validation = validateAccessToken(token, metadata);
    
    if (!validation.valid) {
      return {
        active: false
      };
    }

    const { payload, tokenRecord } = validation;

    return {
      active: true,
      client_id: payload.client_id,
      scope: payload.scope,
      token_type: payload.token_type,
      exp: payload.exp,
      iat: payload.iat,
      nbf: payload.nbf,
      sub: payload.sub,
      aud: payload.aud,
      jti: payload.jti,
      token_use: payload.token_use
    };

  } catch (error) {
    return {
      active: false
    };
  }
}

/**
 * Revoke token
 */
function revokeToken(token, metadata = {}) {
  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.payload.jti) {
      throw new Error('Invalid token format');
    }

    const tokenId = decoded.payload.jti;
    const tokenRecord = tokenStore.get(tokenId);
    
    if (!tokenRecord) {
      // Token doesn't exist or already expired
      return { revoked: false, reason: 'Token not found' };
    }

    // Mark token as revoked
    tokenRecord.revoked = true;
    tokenRecord.revoked_at = Math.floor(Date.now() / 1000);
    tokenRecord.revocation_metadata = {
      sourceIP: metadata.sourceIP,
      userAgent: metadata.userAgent,
      requestId: metadata.requestId
    };

    tokenStore.set(tokenId, tokenRecord);

    // Update statistics
    tokenStats.revoked++;

    // Log token revocation
    logTokenEvent('token_revoked', decoded.payload, metadata);

    return { revoked: true };

  } catch (error) {
    return { revoked: false, reason: error.message };
  }
}

/**
 * Clean up expired tokens (should be run periodically)
 */
function cleanupExpiredTokens() {
  const now = Math.floor(Date.now() / 1000);
  let cleanedCount = 0;

  for (const [tokenId, tokenRecord] of tokenStore.entries()) {
    if (now > tokenRecord.expires_at) {
      tokenStore.delete(tokenId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`[TokenService] Cleaned up ${cleanedCount} expired tokens`);
    tokenStats.expired += cleanedCount;
  }

  return cleanedCount;
}

/**
 * Get token statistics
 */
function getTokenStatistics() {
  const activeTokens = Array.from(tokenStore.values()).filter(record => !record.revoked);
  
  return {
    ...tokenStats,
    active_tokens: activeTokens.length,
    revoked_tokens: Array.from(tokenStore.values()).filter(record => record.revoked).length,
    total_stored: tokenStore.size,
    token_ttl: TOKEN_CONFIG.accessTokenTTL,
    cleanup_needed: Date.now() / 1000 % TOKEN_CONFIG.accessTokenTTL < 60 // Cleanup needed within next minute
  };
}

/**
 * Validate token for API access (middleware helper)
 */
function validateTokenForApi(token, requiredScopes = [], metadata = {}) {
  const validation = validateAccessToken(token, metadata);
  
  if (!validation.valid) {
    return validation;
  }

  const { payload } = validation;
  const tokenScopes = payload.scope ? payload.scope.split(' ') : [];

  // Check if token has required scopes
  if (requiredScopes.length > 0) {
    const hasRequiredScopes = requiredScopes.every(requiredScope => 
      tokenScopes.includes(requiredScope)
    );

    if (!hasRequiredScopes) {
      const error = new Error('Insufficient scope for this operation');
      error.code = 'insufficient_scope';
      error.status = 403;
      error.required_scopes = requiredScopes;
      error.token_scopes = tokenScopes;
      throw error;
    }
  }

  return {
    valid: true,
    payload,
    tokenScopes
  };
}

module.exports = {
  processClientCredentialsGrant,
  validateAccessToken,
  introspectToken,
  revokeToken,
  cleanupExpiredTokens,
  getTokenStatistics,
  validateTokenForApi
};
