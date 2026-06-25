/**
 * errorSchemaService.js
 *
 * Standardized error response builder for security error messages.
 * Converts generic auth/scope/delegation errors into educational responses
 * that teach WHY security decisions were made.
 *
 * Phase 156: Improve security error messages
 */

const { logger } = require('../utils/logger');

/**
 * All supported security error codes
 */
const ERROR_CODES = {
  TOKEN_TYPE_MISMATCH: 'TOKEN_TYPE_MISMATCH',
  SCOPE_VIOLATION: 'SCOPE_VIOLATION',
  AUDIENCE_MISMATCH: 'AUDIENCE_MISMATCH',
  DELEGATION_CLAIM_MISSING: 'DELEGATION_CLAIM_MISSING',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  POLICY_VIOLATION: 'POLICY_VIOLATION',
};

/**
 * Map error codes to HTTP status codes
 */
const STATUS_CODE_MAP = {
  [ERROR_CODES.TOKEN_TYPE_MISMATCH]: 403,
  [ERROR_CODES.SCOPE_VIOLATION]: 403,
  [ERROR_CODES.AUDIENCE_MISMATCH]: 401,
  [ERROR_CODES.DELEGATION_CLAIM_MISSING]: 401,
  [ERROR_CODES.TOKEN_EXPIRED]: 401,
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]: 429,
  [ERROR_CODES.INSUFFICIENT_PERMISSIONS]: 403,
  [ERROR_CODES.POLICY_VIOLATION]: 403,
};

/**
 * Build a standardized educational error response.
 *
 * @param {string} errorCode - One of ERROR_CODES
 * @param {object} details - Error details (what_failed, why, teaching, fix, tokens_involved)
 * @returns {object} Formatted error response
 */
function buildErrorResponse(errorCode, details) {
  if (!ERROR_CODES[errorCode]) {
    logger.warn('Unknown error code used in buildErrorResponse', { errorCode });
  }

  return {
    error: errorCode,
    message: details.message || details.what_failed || 'Security validation failed',
    details: {
      what_failed: details.what_failed || 'Unknown validation failure',
      why: details.why || '',
      teaching: details.teaching || '',
      tokens_involved: details.tokens_involved || {},
      fix: details.fix || 'Contact your system administrator.',
    },
    documentation_link: `https://docs.pingidentity.com/errors/${errorCode}`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get the HTTP status code for a given error code.
 *
 * @param {string} errorCode - One of ERROR_CODES
 * @returns {number} HTTP status code
 */
function getStatusCode(errorCode) {
  return STATUS_CODE_MAP[errorCode] || 500;
}

/**
 * Send a formatted error response via Express res object.
 *
 * @param {object} res - Express response object
 * @param {string} errorCode - One of ERROR_CODES
 * @param {object} details - Error details
 */
function sendErrorResponse(res, errorCode, details) {
  const statusCode = getStatusCode(errorCode);
  const body = buildErrorResponse(errorCode, details);
  logger.warn('Security error response', {
    error_code: errorCode,
    status: statusCode,
    what_failed: details.what_failed,
  });
  return res.status(statusCode).json(body);
}

module.exports = {
  ERROR_CODES,
  STATUS_CODE_MAP,
  buildErrorResponse,
  getStatusCode,
  sendErrorResponse,
};
