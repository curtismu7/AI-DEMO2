/**
 * Audience (aud) Validation Service
 *
 * Validates that OAuth tokens include the correct 'aud' (audience) claim,
 * preventing token confusion attacks where a token for one API is used for another.
 *
 * VALIDATION POLICY: FAIL CLOSED
 * If aud does not match expected value, reject (return invalid, never allow).
 * This is a security-critical validation point.
 *
 * References:
 * - RFC 6749: OAuth 2.0 Authorization Framework (aud claim in access tokens)
 * - RFC 7662: OAuth 2.0 Token Introspection (aud in introspection response)
 * - RFC 8693: OAuth 2.0 Token Exchange (aud parameter for target resource)
 * - docs/ACTOR_TOKEN_TERMINOLOGY.md: Understanding aud in delegation context
 */

'use strict';

const { logger } = require("../utils/logger");
const audConfig = require('../config/audConfigTemplate');

/**
 * Validate the 'aud' claim in a decoded JWT token
 *
 * The aud claim identifies the intended recipient(s) of the token.
 * A token can have multiple valid audiences (aud as array), but must include
 * at least one audience that matches the expected value.
 *
 * FAIL CLOSED: If aud doesn't match, reject with error.
 *
 * @param {Object} decoded - Decoded JWT token (from jwt.verify or token introspection)
 * @param {string} expectedAud - Expected audience value (single value)
 * @returns {{valid: boolean, error?: string, matchedAud?: string}}
 *   - valid: true if aud matches expected value
 *   - error: description of mismatch (if valid=false)
 *   - matchedAud: actual aud value that matched (if valid=true)
 */
function validateAudClaim(decoded, expectedAud) {
  // Sanity checks
  if (!decoded) {
    logger.error('audValidationService: decoded token is null/undefined');
    return { valid: false, error: 'Token not decoded' };
  }

  if (!expectedAud) {
    logger.error('audValidationService: expectedAud is null/undefined');
    return { valid: false, error: 'Expected audience not specified' };
  }

  // Extract aud claim (can be string or array)
  const { aud } = decoded;

  if (!aud) {
    logger.warn('Token missing aud claim', {
      subject: decoded.sub,
      expectedAud,
      issuer: decoded.iss,
    });
    return { valid: false, error: 'Missing aud claim in token (FAIL CLOSED)' };
  }

  // Normalize aud to array (RFC 6749 allows both string and array)
  const tokenAuds = Array.isArray(aud) ? aud : [aud];

  // FAIL CLOSED: Check if any of the token's audiences match the expected audience
  // Exact string match required (no wildcards, no partial matches)
  const matched = tokenAuds.some((audValue) => audValue === expectedAud);

  if (!matched) {
    // Log security event: aud mismatch (potential attack, misconfiguration, or environment issue)
    logger.warn('SECURITY EVENT: Audience mismatch - TOKEN REJECTED (FAIL CLOSED)', {
      tokenAuds: tokenAuds.join(', '),
      expectedAud,
      subject: decoded.sub || '(no sub)',
      actor: decoded.act?.sub || '(no actor)', // if agent token
      issuer: decoded.iss || '(no issuer)',
      scopes: decoded.scope || '(no scope)',
      timestamp: new Date().toISOString(),
    });

    return {
      valid: false,
      error: `Token aud [${tokenAuds.join(', ')}] does not match expected [${expectedAud}]`,
    };
  }

  // Audit log: aud validation succeeded
  logger.debug('Audience validation passed', {
    aud: aud,
    expectedAud,
    subject: decoded.sub || '(no sub)',
  });

  return {
    valid: true,
    matchedAud: expectedAud,
  };
}

/**
 * Validate aud claim for a specific HTTP route
 *
 * Combines:
 * 1. Look up expected aud for the route
 * 2. Validate token's aud matches expected aud
 *
 * @param {Object} token - Decoded JWT token
 * @param {string} method - HTTP method (GET, POST, etc)
 * @param {string} path - Request path (/api/transactions, etc)
 * @returns {{valid: boolean, error?: string}}
 */
function validateAudForRoute(token, method, path) {
  // Get expected aud for this route
  const expectedAud = audConfig.getExpectedAudForRoute(method, path);

  // If route doesn't require aud validation, skip
  if (expectedAud === null) {
    logger.debug('Route does not require aud validation', { method, path });
    return { valid: true };
  }

  // Validate token aud against expected aud
  return validateAudClaim(token, expectedAud);
}

/**
 * Get the expected audience for a given route
 *
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @returns {string|null} - Expected aud value, or null if not required
 */
function getExpectedAud(method, path) {
  return audConfig.getExpectedAudForRoute(method, path);
}

/**
 * Validate aud claim AND optional scope requirements
 *
 * Some routes require BOTH:
 * 1. Correct aud claim (recipient is correct)
 * 2. Correct scopes (permissions are sufficient)
 *
 * Both must pass; if either fails, request is rejected.
 *
 * @param {Object} token - Decoded JWT token
 * @param {Object} options - {
 *   expectedAud: string,              // Required aud value
 *   requiredScopes?: string[],        // Optional array of required scopes
 * }
 * @returns {{valid: boolean, errors: string[]}} Combined validation result
 */
function validateAudAndScopes(token, options) {
  const errors = [];

  // Validate aud
  if (!options.expectedAud) {
    errors.push('Expected audience not specified');
  } else {
    const audValidation = validateAudClaim(token, options.expectedAud);
    if (!audValidation.valid) {
      errors.push(audValidation.error);
    }
  }

  // Optionally validate scopes (if required)
  if (options.requiredScopes && options.requiredScopes.length > 0) {
    if (!token.scope) {
      errors.push(`Missing required scopes: ${options.requiredScopes.join(', ')}`);
    } else {
      const tokenScopes = token.scope.split(' ');
      const missingScopes = options.requiredScopes.filter(
        (scope) => !tokenScopes.includes(scope)
      );
      if (missingScopes.length > 0) {
        errors.push(`Missing required scopes: ${missingScopes.join(', ')}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * AudValidationError
 *
 * Thrown when aud validation fails critically.
 * Used for explicit error handling in routes that need special behavior.
 *
 * @example
 *   try {
 *     const validation = validateAudClaim(token, expectedAud);
 *     if (!validation.valid) {
 *       throw new AudValidationError(validation.error, { path: req.path });
 *     }
 *   } catch (err) {
 *     // Handle aud validation error
 *   }
 */
class AudValidationError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'AudValidationError';
    this.context = context;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AudValidationError.prototype);
  }
}

/**
 * Test helper: Generate a token with specific aud for testing
 * @private
 */
function _createTestToken(aud, overrides = {}) {
  return {
    sub: 'test-user',
    aud,
    scope: 'openid profile',
    iss: 'https://auth.pingone.test',
    ...overrides,
  };
}

module.exports = {
  // Main validation functions
  validateAudClaim,
  getExpectedAud,
  validateAudForRoute,
  validateAudAndScopes,

  // Error class
  AudValidationError,

  // Test helper (don't use in production)
  _createTestToken,
};
