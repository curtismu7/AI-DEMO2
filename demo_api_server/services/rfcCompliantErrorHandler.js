/**
 * RFC Compliant Error Handler for Token Exchange
 * Implements RFC 6749 and RFC 8693 error response standards
 * 
 * Phase 56-04: Enhanced Error Handling and Audit Trail
 */

const { writeExchangeEvent } = require('./exchangeAuditStore');

/**
 * RFC 6749 §5.2 Error Response Structure
 */
class RFCCompliantError extends Error {
  constructor(error, description, state = null, uri = null) {
    super(description);
    this.name = 'RFCCompliantError';
    this.error = error;
    this.error_description = description;
    this.error_uri = uri;
    this.state = state;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    const result = {
      error: this.error,
      error_description: this.error_description,
      timestamp: this.timestamp
    };

    if (this.state) result.state = this.state;
    if (this.error_uri) result.error_uri = this.error_uri;

    return result;
  }
}

/**
 * RFC 8693 Token Exchange Error Codes
 */
const RFC8693_ERRORS = {
  // RFC 6749 errors (inherited)
  invalid_request: 'The request is missing a required parameter, includes an invalid parameter value, includes a parameter more than once, or is otherwise malformed.',
  invalid_client: 'Client authentication failed (e.g., unknown client, no client authentication included, or unsupported authentication method).',
  invalid_grant: 'The provided authorization grant (e.g., authorization code, resource owner credentials) is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.',
  unauthorized_client: 'The authenticated client is not authorized to use this authorization grant type.',
  unsupported_grant_type: 'The authorization grant type is not supported by the authorization server.',
  invalid_scope: 'The requested scope is invalid, unknown, or malformed.',
  
  // RFC 8693 specific errors
  invalid_target: 'The requested resource or token is not valid for the target resource server.',
  invalid_token: 'The provided token is not valid for the token exchange operation.',
  
  // Custom application errors
  exchange_not_configured: 'Token exchange is not properly configured.',
  actor_token_invalid: 'The actor token is invalid or expired.',
  subject_token_invalid: 'The subject token is invalid or expired.',
  audience_mismatch: 'Token audience does not match the requested resource.',
  scope_insufficient: 'Token does not contain sufficient scopes for the requested operation.',
  delegation_chain_broken: 'Delegation chain validation failed.',
  policy_violation: 'Token exchange violates security policy.'
};

/**
 * Creates RFC 6749 compliant error response
 */
function createRFCError(errorCode, description = null, context = {}) {
  const errorDesc = description || RFC8693_ERRORS[errorCode] || 'Unknown error occurred.';
  const error = new RFCCompliantError(errorCode, errorDesc, context.state, context.uri);
  
  // Log error for audit trail
  logErrorEvent(error, context);
  
  return error;
}

/**
 * Enhanced token exchange error with audit context
 */
function createTokenExchangeError(errorCode, exchangeContext = {}, originalError = null) {
  const context = {
    ...exchangeContext,
    exchangeType: exchangeContext.exchangeType || 'unknown',
    exchangeStep: exchangeContext.exchangeStep || null,
    originalError: originalError ? {
      message: originalError.message,
      code: originalError.code,
      httpStatus: originalError.httpStatus
    } : null
  };

  const description = RFC8693_ERRORS[errorCode] || 'Token exchange operation failed.';
  const error = new RFCCompliantError(errorCode, description, context.state);
  
  // Add exchange-specific metadata
  error.exchangeContext = {
    exchangeType: context.exchangeType,
    exchangeStep: context.exchangeStep,
    actorPresent: context.actorPresent || false,
    audience: context.audience || null,
    scopes: context.scopes || []
  };

  // Enhanced audit logging
  logTokenExchangeError(error, context, originalError);

  return error;
}

/**
 * Logs error events for audit trail
 */
function logErrorEvent(error, context) {
  const auditEvent = {
    type: 'error',
    level: 'error',
    timestamp: error.timestamp,
    error: {
      code: error.error,
      description: error.error_description,
      uri: error.error_uri,
      state: error.state
    },
    context: {
      endpoint: context.endpoint || null,
      method: context.method || null,
      userAgent: context.userAgent || null,
      ipAddress: context.ipAddress || null,
      requestId: context.requestId || null
    },
    security: {
      userId: context.userId || null,
      sessionId: context.sessionId || null,
      clientId: context.clientId || null
    }
  };

  writeExchangeEvent(auditEvent).catch(err => {
    console.error('[ErrorHandler] Failed to log error event:', err.message);
  });
}

/**
 * Enhanced token exchange error logging
 */
function logTokenExchangeError(error, context, originalError) {
  const auditEvent = {
    type: 'exchange-error',
    level: 'error',
    timestamp: error.timestamp,
    exchange: {
      type: context.exchangeType,
      step: context.exchangeStep,
      actorPresent: context.actorPresent,
      audience: context.audience,
      scopes: context.scopes,
      mode: context.mode || null
    },
    error: {
      code: error.error,
      description: error.error_description,
      originalError: originalError ? {
        message: originalError.message,
        code: originalError.code,
        pingoneError: originalError.pingoneError,
        pingoneErrorDescription: originalError.pingoneErrorDescription,
        httpStatus: originalError.httpStatus
      } : null
    },
    security: {
      userId: context.userId || null,
      sessionId: context.sessionId || null,
      clientId: context.clientId || null,
      userAgent: context.userAgent || null,
      ipAddress: context.ipAddress || null
    },
    request: {
      endpoint: context.endpoint || null,
      method: context.method || null,
      requestId: context.requestId || null,
      timestamp: context.requestTimestamp || null
    }
  };

  writeExchangeEvent(auditEvent).catch(err => {
    console.error('[ErrorHandler] Failed to log exchange error:', err.message);
  });
}

/**
 * Maps common errors to RFC 6749 error codes
 */
function mapErrorToRFCCode(error, context = {}) {
  // Network/connectivity errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return createRFCError('temporarily_unavailable', 'The authorization server is currently unable to process the request.', context);
  }

  // Timeout errors
  if (error.code === 'ETIMEDOUT') {
    return createRFCError('temporarily_unavailable', 'The authorization server request timed out.', context);
  }

  // Authentication errors
  if (error.message && error.message.includes('401')) {
    return createRFCError('invalid_client', 'Client authentication failed.', context);
  }

  // Authorization errors
  if (error.message && error.message.includes('403')) {
    return createRFCError('unauthorized_client', 'The authenticated client is not authorized to use this authorization grant type.', context);
  }

  // Not found errors
  if (error.message && error.message.includes('404')) {
    return createRFCError('invalid_target', 'The requested resource or token is not valid for the target resource server.', context);
  }

  // Bad request errors
  if (error.message && error.message.includes('400')) {
    return createRFCError('invalid_request', 'The request is malformed or contains invalid parameters.', context);
  }

  // Default error
  return createRFCError('invalid_request', error.message || 'An unknown error occurred.', context);
}

/**
 * Express middleware for RFC compliant error handling
 */
function rfcErrorHandler(options = {}) {
  return (err, req, res, next) => {
    // Skip if response already sent
    if (res.headersSent) {
      return next(err);
    }

    const context = {
      endpoint: req.path,
      method: req.method,
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip || req.connection.remoteAddress,
      requestId: req.id || null,
      userId: req.user?.sub || null,
      sessionId: req.sessionID || null,
      clientId: req.clientId || null
    };

    let rfcError;

    if (err instanceof RFCCompliantError) {
      rfcError = err;
      logErrorEvent(rfcError, context);
    } else {
      rfcError = mapErrorToRFCCode(err, context);
    }

    // Set appropriate HTTP status code
    const statusCode = getHTTPStatusForError(rfcError.error);
    
    // Set response headers
    res.set({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache'
    });

    // Send RFC compliant error response
    res.status(statusCode).json(rfcError.toJSON());
  };
}

/**
 * Maps RFC error codes to HTTP status codes
 */
function getHTTPStatusForError(errorCode) {
  const statusMap = {
    invalid_request: 400,
    invalid_client: 401,
    invalid_grant: 400,
    unauthorized_client: 403,
    unsupported_grant_type: 400,
    invalid_scope: 400,
    invalid_target: 400,
    invalid_token: 400,
    exchange_not_configured: 503,
    actor_token_invalid: 400,
    subject_token_invalid: 400,
    audience_mismatch: 400,
    scope_insufficient: 403,
    delegation_chain_broken: 400,
    policy_violation: 403,
    temporarily_unavailable: 503
  };

  return statusMap[errorCode] || 500;
}

/**
 * Validates error response format for RFC compliance
 */
function validateErrorResponse(response) {
  const required = ['error', 'error_description'];
  const missing = required.filter(field => !(field in response));
  
  if (missing.length > 0) {
    throw new Error(`Error response missing required fields: ${missing.join(', ')}`);
  }

  if (!Object.keys(RFC8693_ERRORS).includes(response.error)) {
    throw new Error(`Invalid error code: ${response.error}`);
  }

  return true;
}

/**
 * Creates structured audit event for token provenance tracking
 */
function createTokenProvenanceEvent(tokenInfo, exchangeContext) {
  return {
    type: 'token-provenance',
    level: 'info',
    timestamp: new Date().toISOString(),
    token: {
      type: tokenInfo.type,
      id: tokenInfo.id ? tokenInfo.id.substring(0, 8) + '...' : null,
      audience: tokenInfo.audience || null,
      scopes: tokenInfo.scopes || [],
      issuer: tokenInfo.issuer || null,
      issuedAt: tokenInfo.issuedAt || null,
      expiresAt: tokenInfo.expiresAt || null,
      claims: {
        sub: tokenInfo.claims?.sub || null,
        act: tokenInfo.claims?.act || null,
        scope: tokenInfo.claims?.scope || null
      }
    },
    exchange: {
      type: exchangeContext.exchangeType,
      step: exchangeContext.exchangeStep,
      mode: exchangeContext.mode,
      actorPresent: exchangeContext.actorPresent,
      delegationChain: exchangeContext.delegationChain || []
    },
    security: {
      userId: exchangeContext.userId || null,
      sessionId: exchangeContext.sessionId || null,
      clientId: exchangeContext.clientId || null
    },
    request: {
      endpoint: exchangeContext.endpoint,
      requestId: exchangeContext.requestId,
      timestamp: exchangeContext.timestamp
    }
  };
}

module.exports = {
  RFCCompliantError,
  createRFCError,
  createTokenExchangeError,
  rfcErrorHandler,
  validateErrorResponse,
  createTokenProvenanceEvent,
  RFC8693_ERRORS,
  mapErrorToRFCCode
};
