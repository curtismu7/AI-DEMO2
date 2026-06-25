'use strict';

const jwt = require('jsonwebtoken');

/**
 * Token Display Service
 * Provides token decoding and display formatting for educational purposes
 */

/**
 * Decode JWT token without verification (for display/education only)
 * @param {string} token - JWT token string
 * @returns {object|null} Decoded claims or null if invalid
 */
function decodeToken(token) {
  if (!token) return null;
  
  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) return null;
    
    return {
      header: decoded.header,
      payload: decoded.payload,
      signature: decoded.signature
    };
  } catch (err) {
    console.error('[tokenDisplayService] Failed to decode token:', err.message);
    return null;
  }
}

/**
 * Format token claims for display
 * @param {object} claims - JWT payload claims
 * @returns {object} Formatted claims with descriptions
 */
function formatClaims(claims) {
  const formatted = {};
  
  for (const [key, value] of Object.entries(claims)) {
    formatted[key] = {
      value,
      description: getClaimDescription(key, value)
    };
  }
  
  return formatted;
}

/**
 * Get human-readable description for common JWT claims
 * @param {string} claim - Claim name
 * @param {*} value - Claim value
 * @returns {string} Description
 */
function getClaimDescription(claim, value) {
  const descriptions = {
    iss: 'Issuer - URL of the authorization server that issued the token',
    sub: 'Subject - Unique identifier of the user or entity',
    aud: 'Audience - Intended recipient(s) of the token',
    exp: 'Expiration - Unix timestamp when the token expires',
    iat: 'Issued At - Unix timestamp when the token was issued',
    jti: 'JWT ID - Unique identifier for the token (used for revocation)',
    scope: 'Scopes - OAuth 2.0 scopes granted to this token',
    client_id: 'Client ID - OAuth client identifier',
    azp: 'Authorized Party - Client ID that requested the token',
    act: 'Actor - Delegation information (RFC 8693 token exchange)',
    auth_time: 'Authentication Time - When the user authenticated',
    nonce: 'Nonce - Random value used to prevent replay attacks',
    acr: 'Authentication Context Reference - Authentication strength level',
    amr: 'Authentication Methods Reference - How the user authenticated',
    at_hash: 'Access Token Hash - Hash of the access token (for ID tokens)'
  };
  
  if (descriptions[claim]) {
    return descriptions[claim];
  }
  
  // Handle nested objects
  if (typeof value === 'object' && value !== null) {
    return 'Nested object - contains additional claims';
  }
  
  return 'Custom claim - application-specific data';
}

/**
 * Get token summary information
 * @param {string} token - JWT token string
 * @returns {object} Token summary
 */
function getTokenSummary(token) {
  const decoded = decodeToken(token);
  if (!decoded) {
    return {
      valid: false,
      error: 'Invalid token'
    };
  }
  
  const { payload } = decoded;
  const now = Math.floor(Date.now() / 1000);
  
  return {
    valid: true,
    tokenType: classifyTokenType(payload),
    issuer: payload.iss,
    subject: payload.sub,
    audience: Array.isArray(payload.aud) ? payload.aud : [payload.aud],
    scopes: Array.isArray(payload.scope) ? payload.scope : (payload.scope ? payload.scope.split(' ') : []),
    expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    expired: payload.exp ? payload.exp < now : null,
    issuedAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
    actor: payload.act ? {
      clientId: payload.act.client_id,
      sub: payload.act.sub
    } : null,
    hasActor: !!payload.act
  };
}

/**
 * Classify token type based on claims
 * @param {object} payload - JWT payload
 * @returns {string} Token type
 */
function classifyTokenType(payload) {
  if (!payload) return 'unknown';
  
  // Check for actor claim (RFC 8693 token exchange)
  if (payload.act) {
    if (payload.sub && payload.act.client_id) {
      return 'exchanged_token';
    }
    return 'actor_token';
  }
  
  // Check for agent-specific scopes
  if (payload.scope) {
    const scopes = Array.isArray(payload.scope) ? payload.scope : payload.scope.split(' ');
    if (scopes.some(s => s.startsWith('agent:') || s.includes('agent'))) {
      return 'agent_token';
    }
  }
  
  // Check for typical user token claims
  if (payload.sub && !payload.act) {
    return 'user_token';
  }
  
  return 'unknown';
}

/**
 * Decode and format a JWT string for display.
 * Returns the JWT decoded into header, payload (with human-readable claim descriptions
 * via formatClaims), summary, and optionally the full token string.
 *
 * NOTE: `decoded.payload` values are wrapped objects `{ value, description }`, not raw values.
 * For raw JWT parts without description wrapping, use the /api/token-display/raw-decode endpoint.
 *
 * @param {string} token - Raw JWT string (not verified, display only)
 * @param {{ includeFullToken?: boolean, includeClaims?: boolean }} [options]
 * @returns {{
 *   success: boolean,
 *   summary: { subject?: string, issuer?: string, audience?: string, expiresAt?: string },
 *   decoded: {
 *     header: { alg: string, kid?: string, typ?: string },
 *     payload: { [claim: string]: { value: any, description: string } },
 *     signature: string
 *   } | null,
 *   fullToken: string
 * } | { success: false, error: string }}
 */
function formatTokenForDisplay(token, options = {}) {
  const { includeFullToken = false, includeClaims = true } = options;
  
  const decoded = decodeToken(token);
  if (!decoded) {
    return {
      success: false,
      error: 'Unable to decode token'
    };
  }
  
  const summary = getTokenSummary(token);
  
  return {
    success: true,
    summary,
    decoded: includeClaims ? {
      header: decoded.header,
      payload: formatClaims(decoded.payload),
      signature: includeFullToken ? decoded.signature : '*** (hidden for security)'
    } : null,
    fullToken: includeFullToken ? token : '*** (hidden for security)'
  };
}

module.exports = {
  decodeToken,
  formatClaims,
  getClaimDescription,
  getTokenSummary,
  classifyTokenType,
  formatTokenForDisplay
};
