'use strict';

// RFC 8693 §5.2: Standardized Error Codes (Phase 56-05)

const ERROR_CODES = {
  // Configuration Errors (operational, not RFC)
  'config.missing_credentials': {
    http_status: 500,
    oauth_error: 'server_error',
    description: 'Application credentials not configured',
    category: 'Configuration',
  },
  'config.invalid_audience': {
    http_status: 500,
    oauth_error: 'server_error',
    description: 'Invalid or missing token audience configuration',
    category: 'Configuration',
  },

  // RFC 8693 §5.2 Error Codes
  'invalid_request': {
    http_status: 400,
    oauth_error: 'invalid_request',
    description: 'The request is missing a required parameter or is otherwise malformed',
    category: 'Request',
  },
  'invalid_client': {
    http_status: 401,
    oauth_error: 'invalid_client',
    description: 'Client authentication failed (unknown client or unsupported auth method)',
    category: 'Authentication',
  },
  'invalid_grant': {
    http_status: 400,
    oauth_error: 'invalid_grant',
    description: 'The provided grant is invalid or expired',
    category: 'Authorization',
  },
  'invalid_scope': {
    http_status: 400,
    oauth_error: 'invalid_scope',
    description: 'The requested scope is invalid, unknown, or exceeds what was granted',
    category: 'Scope',
  },
  'unauthorized_client': {
    http_status: 403,
    oauth_error: 'unauthorized_client',
    description: 'The client is not authorized for this method',
    category: 'Authorization',
  },
  'unsupported_grant_type': {
    http_status: 400,
    oauth_error: 'unsupported_grant_type',
    description: 'The authorization grant type is not supported',
    category: 'Request',
  },
  'server_error': {
    http_status: 500,
    oauth_error: 'server_error',
    description: 'The authorization server encountered an unexpected condition',
    category: 'Server',
  },
  'temporarily_unavailable': {
    http_status: 503,
    oauth_error: 'temporarily_unavailable',
    description: 'The authorization server is unable to handle the request (temp overload)',
    category: 'Server',
  },

  // Custom/Extended Errors
  'access_denied': {
    http_status: 403,
    oauth_error: 'access_denied',
    description: 'The resource owner or authorization server denied the request',
    category: 'Authorization',
  },
  'insufficient_scope': {
    http_status: 403,
    oauth_error: 'insufficient_scope',
    description: 'The access token provided does not have the required scope',
    category: 'Scope',
  },
  'invalid_token': {
    http_status: 401,
    oauth_error: 'invalid_token',
    description: 'The access token provided is expired, revoked, or invalid',
    category: 'Authentication',
  },
  'token_expired': {
    http_status: 401,
    oauth_error: 'invalid_token',
    description: 'The token has expired',
    category: 'Authentication',
  },
  'may_act_validation_failed': {
    http_status: 400,
    oauth_error: 'invalid_grant',
    description: 'The may_act claim does not match the request context',
    category: 'Authorization',
  },
  'subject_mismatch': {
    http_status: 400,
    oauth_error: 'invalid_grant',
    description: 'The subject claim does not match user identity',
    category: 'Authorization',
  },
};

/**
 * Get error details and metadata for an error code.
 * @param {string} errorCode
 * @returns {{ http_status: number, oauth_error: string, description: string, category: string }}
 */
function getErrorDetails(errorCode) {
  return ERROR_CODES[errorCode] || {
    http_status: 500,
    oauth_error: 'server_error',
    description: 'Unknown error',
    category: 'Server',
  };
}

/**
 * Map internal error messages to standardized RFC 8693 error codes.
 * @param {string} errorMessage
 * @returns {string}
 */
function mapErrorToCode(errorMessage) {
  const msg = String(errorMessage).toLowerCase();

  if (msg.includes('credentials not configured')) return 'config.missing_credentials';
  if (msg.includes('invalid audience')) return 'config.invalid_audience';

  if (msg.includes('invalid_client') || msg.includes('client authentication failed')) return 'invalid_client';
  if (msg.includes('invalid_grant') || msg.includes('grant')) return 'invalid_grant';
  if (msg.includes('invalid_scope') || msg.includes('scope_mismatch')) return 'invalid_scope';
  if (msg.includes('unauthorized_client')) return 'unauthorized_client';
  if (msg.includes('unsupported_grant_type')) return 'unsupported_grant_type';
  if (msg.includes('token_expired') || msg.includes('expired')) return 'token_expired';
  if (msg.includes('invalid_token')) return 'invalid_token';

  if (msg.includes('may_act')) return 'may_act_validation_failed';
  if (msg.includes('subject')) return 'subject_mismatch';
  if (msg.includes('access_denied')) return 'access_denied';
  if (msg.includes('insufficient_scope')) return 'insufficient_scope';
  if (msg.includes('malformed') || msg.includes('invalid_request')) return 'invalid_request';

  return 'server_error';
}

module.exports = { ERROR_CODES, getErrorDetails, mapErrorToCode };
