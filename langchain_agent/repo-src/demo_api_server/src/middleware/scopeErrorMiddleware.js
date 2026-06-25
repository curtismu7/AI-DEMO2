/**
 * Scope Error Middleware
 * 
 * Validates that token has all required scopes and rejects with educational error if not.
 * Must be placed BEFORE route handlers that require specific scopes.
 * 
 * Usage:
 *   router.post('/accounts/transfer', 
 *     scopeErrorMiddleware(['write', 'transfer']), 
 *     (req, res) => { ... })
 */

import ErrorSchemaService, { ERROR_CODES } from '../services/errorSchemaService.js';
import ErrorMessageBuilder from '../services/errorMessageBuilder.js';

/**
 * Create middleware that validates required scopes
 * 
 * @param {string|string[]} requiredScopes - Single scope or array of required scopes
 * @param {object} options - Additional options
 * @returns {function} Express middleware
 */
export default function scopeErrorMiddleware(requiredScopes, options = {}) {
  // Normalize to array
  const scopesArray = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];

  return (req, res, next) => {
    // Extract scopes from token (assumes token is already decoded and attached to req.user)
    const tokenScopes = req.user?.scopes || req.user?.token?.scopes || [];

    // If no token at all, let other middleware handle it (auth middleware)
    if (!req.user || !req.user.token) {
      return next();
    }

    // Check if token has all required scopes
    const hasAllScopes = scopesArray.every(requiredScope =>
      tokenScopes.some(tokenScope =>
        // Handle both exact matches and wildcard/prefix matches
        tokenScope === requiredScope || 
        tokenScope.startsWith(requiredScope.split(':')[0] + ':*')
      )
    );

    if (!hasAllScopes) {
      const messageDetails = ErrorMessageBuilder.buildScopeViolation(
        scopesArray,
        tokenScopes
      );

      const errorResponse = ErrorSchemaService.buildErrorResponse(
        ERROR_CODES.SCOPE_VIOLATION,
        {
          message: messageDetails.what_failed,
          tokens_involved: {
            required_scopes: scopesArray,
            token_scopes: tokenScopes,
            missing_scopes: messageDetails.missing_scopes,
          },
          ...messageDetails,
        }
      );

      const statusCode = ErrorSchemaService.getStatusCode(ERROR_CODES.SCOPE_VIOLATION);
      return res.status(statusCode).json(errorResponse);
    }

    // Token has all required scopes, proceed
    next();
  };
}
