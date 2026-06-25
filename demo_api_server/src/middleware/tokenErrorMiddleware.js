/**
 * Token Type Error Middleware
 * 
 * Validates token type (user, agent, system) and rejects with educational error if mismatch.
 * Must be placed BEFORE route handlers that require a specific token type.
 * 
 * Usage:
 *   router.post('/mcp/tool', tokenErrorMiddleware('agent'), (req, res) => { ... })
 */

import ErrorSchemaService, { ERROR_CODES } from '../services/errorSchemaService.js';
import ErrorMessageBuilder from '../services/errorMessageBuilder.js';

/**
 * Create middleware that validates token type
 * 
 * @param {string} requiredTokenType - Expected token type: 'user', 'agent', 'system'
 * @param {object} options - Additional options
 * @returns {function} Express middleware
 */
export default function tokenErrorMiddleware(requiredTokenType, options = {}) {
  return (req, res, next) => {
    // Extract token from request (assumes token is already decoded and attached to req.user)
    const token = req.user?.token;
    const actualTokenType = token?.token_type || token?.typ;

    // If no token at all, let other middleware handle it (auth middleware)
    if (!token) {
      return next();
    }

    // Check if token type matches what's required
    if (actualTokenType && actualTokenType !== requiredTokenType) {
      const messageDetails = ErrorMessageBuilder.buildTokenTypeMismatch(
        requiredTokenType,
        actualTokenType,
        token?.scopes || []
      );

      const errorResponse = ErrorSchemaService.buildErrorResponse(
        ERROR_CODES.TOKEN_TYPE_MISMATCH,
        {
          message: messageDetails.what_failed,
          ...messageDetails,
        }
      );

      const statusCode = ErrorSchemaService.getStatusCode(ERROR_CODES.TOKEN_TYPE_MISMATCH);
      return res.status(statusCode).json(errorResponse);
    }

    // Token type matches, proceed
    next();
  };
}
