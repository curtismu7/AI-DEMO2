/**
 * Auth Error Handler Middleware — Centralized auth error response formatter
 *
 * Catches all auth-related errors and formats them according to error classification:
 *   - TRANSIENT: Include retry guidance
 *   - USER: Include re-auth guidance
 *   - CONFIG: Hide sensitive details, include support contact
 *   - UNKNOWN: Generic message, log fully
 *
 * Uses PingOneErrorClassifier to categorize errors for consistent handling.
 */

const ErrorSchemaService = require('../services/errorSchemaService');

/**
 * Format error response based on classification category
 * @param {Error} err
 * @param {object} classification
 * @returns {object} Response body
 */
function buildErrorResponse(err, classification) {
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@example.com';
  const docsUrl = process.env.DOCS_URL || 'https://docs.example.com';
  const statusPageUrl = process.env.STATUS_PAGE_URL || 'https://status.example.com';

  const baseResponse = {
    error: classification.code,
    message: mapCategoryToMessage(classification.category),
    timestamp: new Date().toISOString(),
    request_id: err.requestId || generateRequestId(),
    classification: {
      category: classification.category,
      retryable: classification.retryable,
      userAction: classification.userAction,
    },
  };

  // Include context based on category
  if (classification.context) {
    if (classification.category === 'CONFIG') {
      // Hide sensitive details from users for config errors
      baseResponse.details = {
        what: classification.context.what,
        action: 'Contact support with the request ID above',
      };
    } else if (classification.category === 'USER') {
      baseResponse.details = {
        what: classification.context.what,
        fix: classification.context.fix,
      };
    } else if (classification.category === 'TRANSIENT') {
      baseResponse.details = {
        what: classification.context.what,
        recoveryStrategy: classification.context.recoveryStrategy,
      };
    } else {
      // UNKNOWN
      baseResponse.details = {
        what: classification.context.what,
      };
    }
  }

  // Add support contact for config and unknown errors
  if (classification.category === 'CONFIG' || classification.category === 'UNKNOWN') {
    baseResponse.support = {
      email: supportEmail,
      docs: `${docsUrl}/errors/${classification.code}`,
      status_page: statusPageUrl,
    };
  }

  return baseResponse;
}

/**
 * Map error category to user-friendly message
 * @param {string} category
 * @returns {string}
 */
function mapCategoryToMessage(category) {
  const messages = {
    TRANSIENT: 'Temporary service issue. Please retry your request.',
    USER: 'Your session or token is invalid. Please re-authenticate.',
    CONFIG: 'System configuration issue detected. Our team has been notified.',
    UNKNOWN: 'An unexpected error occurred. Please try again or contact support.',
  };
  return messages[category] || 'An error occurred. Please try again.';
}

/**
 * Generate a unique request ID for tracking
 * @returns {string}
 */
function generateRequestId() {
  return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Auth error handler middleware
 * Use as: app.use(authErrorHandler);
 *
 * Expects errors to have a .classification property (attached by enhanced services)
 */
function authErrorHandler(err, req, res, next) {
  // Attach request ID to error for tracking
  if (!err.requestId) {
    err.requestId = generateRequestId();
  }

  // If error has classification, format it
  if (err.classification) {
    const { category, code } = err.classification;
    const statusCode = ErrorSchemaService.getStatusCode(code);
    const responseBody = buildErrorResponse(err, err.classification);

    return res.status(statusCode).json(responseBody);
  }

  // Fallback for unclassified errors
  const statusCode = 500;
  const responseBody = {
    error: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
    request_id: err.requestId,
    classification: {
      category: 'UNKNOWN',
      retryable: false,
      userAction: 'contact-support',
    },
  };

  res.status(statusCode).json(responseBody);
}

module.exports = authErrorHandler;
