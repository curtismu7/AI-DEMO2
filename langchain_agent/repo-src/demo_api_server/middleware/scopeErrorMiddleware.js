/**
 * scopeErrorMiddleware.js
 *
 * Express middleware that validates required scopes on the token
 * and returns educational error messages if scopes are missing.
 *
 * Phase 156: Improve security error messages
 */

const { sendErrorResponse, ERROR_CODES } = require('../services/errorSchemaService');
const { buildScopeViolation } = require('../services/errorMessageBuilder');
const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');

/**
 * Create middleware that validates required OAuth scopes.
 *
 * @param {string[]} requiredScopes - Array of required scope strings
 * @param {object} [options] - Options
 * @param {boolean} [options.requireAll=true] - Whether all scopes are required (vs any)
 * @returns {Function} Express middleware
 */
function scopeErrorMiddleware(requiredScopes, options) {
  const { requireAll = true } = options || {};

  return (req, res, next) => {
    try {
      // Get scopes from request (set by upstream middleware) or decode from token
      let tokenScopes = req.tokenScopes;

      if (!tokenScopes) {
        const authHeader = req.headers.authorization;
        const sessionToken = req.session?.oauthTokens?.accessToken;
        const rawToken = authHeader?.startsWith('Bearer ')
          ? authHeader.substring(7)
          : sessionToken;

        if (!rawToken) {
          return next();
        }

        const decoded = jwt.decode(rawToken);
        tokenScopes = decoded?.scope
          ? decoded.scope.split(' ').filter(Boolean)
          : [];
      }

      // Check scope coverage
      const tokenScopeSet = new Set(tokenScopes);
      const missing = requiredScopes.filter(s => !tokenScopeSet.has(s));

      const hasAccess = requireAll
        ? missing.length === 0
        : missing.length < requiredScopes.length;

      if (!hasAccess) {
        const details = buildScopeViolation(requiredScopes, tokenScopes);
        return sendErrorResponse(res, ERROR_CODES.SCOPE_VIOLATION, {
          ...details,
          tokens_involved: {
            ...details.tokens_involved,
            require_all: requireAll,
          },
        });
      }

      next();
    } catch (err) {
      logger.error('scopeErrorMiddleware unexpected error', { error: err.message });
      next();
    }
  };
}

module.exports = scopeErrorMiddleware;
