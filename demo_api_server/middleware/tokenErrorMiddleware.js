/**
 * tokenErrorMiddleware.js
 *
 * Express middleware that validates token type (user vs agent vs system)
 * and returns educational error messages on mismatch.
 *
 * Phase 156: Improve security error messages
 */

const { sendErrorResponse, ERROR_CODES } = require('../services/errorSchemaService');
const { buildTokenTypeMismatch } = require('../services/errorMessageBuilder');
const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');

/**
 * Create middleware that validates the token type claim.
 *
 * @param {string} requiredTokenType - Required token type ('user', 'agent', 'system')
 * @returns {Function} Express middleware
 */
function tokenErrorMiddleware(requiredTokenType) {
  return (req, res, next) => {
    try {
      // Try to get token from multiple sources
      const authHeader = req.headers.authorization;
      const sessionToken = req.session?.oauthTokens?.accessToken;
      const rawToken = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7)
        : sessionToken;

      if (!rawToken) {
        // No token at all — let downstream auth middleware handle it
        return next();
      }

      // Decode token (do not verify — that's handled by other middleware)
      const decoded = jwt.decode(rawToken);
      if (!decoded) {
        return next();
      }

      // Determine actual token type from claims
      const actualTokenType = decoded.token_type
        || decoded.client_id && !decoded.sub ? 'system'
        : decoded.act ? 'agent'
        : 'user';

      if (actualTokenType !== requiredTokenType) {
        const scopes = decoded.scope
          ? decoded.scope.split(' ')
          : [];
        const details = buildTokenTypeMismatch(requiredTokenType, actualTokenType, scopes);
        return sendErrorResponse(res, ERROR_CODES.TOKEN_TYPE_MISMATCH, {
          ...details,
          tokens_involved: {
            ...details.tokens_involved,
            token_sub: decoded.sub,
            token_iss: decoded.iss,
          },
        });
      }

      next();
    } catch (err) {
      logger.error('tokenErrorMiddleware unexpected error', { error: err.message });
      next();
    }
  };
}

module.exports = tokenErrorMiddleware;
