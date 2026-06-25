/**
 * Audience (aud) Validation Middleware
 *
 * Express middleware that validates the 'aud' (audience) claim in incoming OAuth tokens
 * before the request reaches route handlers.
 *
 * VALIDATION POLICY: FAIL CLOSED
 * If aud doesn't match expected value for the route, reject with 401 Unauthorized.
 *
 * Prevents token confusion attacks: a token issued for API A cannot be used for API B.
 *
 * Usage in server.js:
 *   const audValidationMiddleware = require('./middleware/audValidationMiddleware');
 *   // Apply AFTER authentication middleware (which sets req.user.decoded)
 *   // Apply BEFORE route handlers
 *   app.use(audValidationMiddleware);
 *
 * References:
 * - RFC 6749: OAuth 2.0 Authorization Framework
 * - RFC 8693: OAuth 2.0 Token Exchange (aud claim binding)
 * - banking_api_server/services/audValidationService.js
 */

'use strict';

const audService = require('../services/audValidationService');
const { logger } = require('../utils/logger');


/**
 * Middleware function: Validate audience (aud) claim in incoming OAuth tokens
 *
 * Validates that the token's aud claim matches the expected audience for this endpoint.
 * Called for every request after authentication (req.user.decoded exists).
 *
 * If aud validation fails → return 401 Unauthorized (fail closed)
 * If aud validation passes → attach expected aud to request, continue to next middleware/handler
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void} Calls next() or sends error response
 */
function audValidationMiddleware(req, res, next) {
  // ─── Step 1: Determine if this route requires aud validation ──────────────────

  // Skip aud validation for:
  // - Health check / metrics endpoints (not protected)
  // - Public endpoints (no token)
  // - Well-known OpenID endpoints (.well-known/*, oauth metadata)
  // - Routes explicitly marked with req.skipAudValidation = true
  if (
    req.skipAudValidation === true ||
    req.path === '/health' ||
    req.path === '/metrics' ||
    req.path === '/status' ||
    req.path.startsWith('/.well-known/') ||
    req.path.startsWith('/oauth/') ||
    req.path === '/api/public'
  ) {
    logger.debug('Aud validation skipped (public or health endpoint)', { path: req.path });
    return next();
  }

  // ─── Step 2: Check if request has a decoded token ───────────────────────────

  // If no req.user or no decoded token, skip aud validation
  // (authentication middleware should have set these for protected routes)
  if (!req.user || !req.user.decoded) {
    logger.debug('No decoded token in req.user, skipping aud validation', {
      path: req.path,
      hasUser: !!req.user,
    });
    return next();
  }

  // ─── Step 3: Validate aud claim ───────────────────────────────────────────

  const decoded = req.user.decoded;
  const validation = audService.validateAudForRoute(decoded, req.method, req.path);

  if (!validation.valid) {
    // Aud validation failed → REJECT with 401 (fail closed)
    logger.warn('Aud validation failed - rejecting request', {
      path: req.path,
      method: req.method,
      subject: decoded.sub || '(no subject)',
      actor: decoded.act?.sub || '(no actor)',
      tokenAud: decoded.aud || '(no aud)',
      expectedAud: audService.getExpectedAud(req.method, req.path),
      error: validation.error,
    });

    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Token audience does not match this API.',
      error_uri: 'https://tools.ietf.org/html/rfc6750#section-3.1',
      details: validation.error,
    });
  }

  // ─── Step 4: Aud validation passed → attach to request and continue ────────

  // Attach expected aud to request for route handlers to use (optional)
  // Routes can use req.expectedAud if they need to verify additional constraints
  req.expectedAud = audService.getExpectedAud(req.method, req.path);

  logger.debug('Aud validation passed', {
    path: req.path,
    method: req.method,
    subject: decoded.sub || '(no subject)',
    aud: decoded.aud,
  });

  next();
}

/**
 * Helper: Skip aud validation for a specific middleware
 *
 * Use this helper to wrap a route that should skip aud validation
 * (e.g., public endpoints, internal health checks)
 *
 * @example
 *   const skipAudValidation = skipAudCheckFor();
 *   app.use('/health', skipAudValidation, healthCheckRoute);
 */
function skipAudCheckFor() {
  return (req, res, next) => {
    req.skipAudValidation = true;
    next();
  };
}

module.exports = audValidationMiddleware;
module.exports.skipAudCheckFor = skipAudCheckFor;
