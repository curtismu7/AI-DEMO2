const axios = require('axios');
const { logger, LOG_CATEGORIES } = require('../utils/logger');
const { oauthMonitor } = require('../utils/oauthMonitor');
const posthog = require('../services/posthog');

// OAuth-specific error types
const OAUTH_ERROR_TYPES = {
  INVALID_TOKEN: 'invalid_token',
  EXPIRED_TOKEN: 'expired_token',
  INSUFFICIENT_SCOPE: 'insufficient_scope',
  AUTHENTICATION_REQUIRED: 'authentication_required',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  TOKEN_INTROSPECTION_FAILED: 'token_introspection_failed',
  MALFORMED_TOKEN: 'malformed_token'
};

// Standard OAuth error response format
class OAuthError extends Error {
  constructor(type, description, statusCode = 401, additionalData = {}) {
    super(description);
    this.name = 'OAuthError';
    this.type = type;
    this.statusCode = statusCode;
    this.additionalData = additionalData;
  }

  toJSON() {
    const response = {
      error: this.type,
      error_description: this.message
    };

    // Add additional data based on error type
    if (this.type === OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE) {
      response.required_scopes = this.additionalData.requiredScopes || [];
      response.provided_scopes = this.additionalData.providedScopes || [];
    }

    if (this.additionalData.hint) {
      response.error_hint = this.additionalData.hint;
    }

    if (this.additionalData.uri) {
      response.error_uri = this.additionalData.uri;
    }

    return response;
  }
}

// Enhanced error response formatter
const formatOAuthErrorResponse = (error, req) => {
  const timestamp = new Date().toISOString();
  const requestId = req.headers['x-request-id'] || generateRequestId();
  
  let errorResponse = {
    timestamp,
    request_id: requestId,
    path: req.originalUrl || req.path || req.url,
    method: req.method
  };

  if (error instanceof OAuthError) {
    errorResponse = { ...errorResponse, ...error.toJSON() };
  } else {
    // Handle generic errors
    errorResponse.error = 'server_error';
    errorResponse.error_description = 'An internal server error occurred';
    
    // Include detailed error in development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.debug_info = {
        message: error.message,
        stack: error.stack
      };
    }
  }

  return errorResponse;
};

// Generate unique request ID for error tracking
const generateRequestId = () => {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
};

// Enhanced token validation with detailed error handling and monitoring
const validateTokenWithErrorHandling = async (token, oauthConfig, requestContext = {}) => {
  const startTime = Date.now();
  const { method = 'UNKNOWN', path = 'UNKNOWN', userAgent = 'UNKNOWN', ip = 'UNKNOWN' } = requestContext;
  
  // Log validation attempt
  logger.debug(LOG_CATEGORIES.OAUTH_VALIDATION, 'Starting OAuth token validation', {
    method,
    path,
    user_agent: userAgent,
    client_ip: ip,
    token_length: token ? token.length : 0
  });

  if (!token) {
    const error = new OAuthError(
      OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
      'Access token is required',
      401,
      { hint: 'Include a valid Bearer token in the Authorization header' }
    );
    
    logger.logAuthenticationAttempt(false, {
      method,
      path,
      error_type: OAUTH_ERROR_TYPES.AUTHENTICATION_REQUIRED,
      reason: 'missing_token',
      user_agent: userAgent,
      client_ip: ip
    });
    
    throw error;
  }

  // Check if token is malformed
  if (!token.includes('.') || token.split('.').length !== 3) {
    const error = new OAuthError(
      OAUTH_ERROR_TYPES.MALFORMED_TOKEN,
      'Token format is invalid',
      401,
      { hint: 'Token must be a valid JWT format' }
    );
    
    logger.logAuthenticationAttempt(false, {
      method,
      path,
      error_type: OAUTH_ERROR_TYPES.MALFORMED_TOKEN,
      reason: 'invalid_format',
      token_parts: token.split('.').length,
      user_agent: userAgent,
      client_ip: ip
    });
    
    throw error;
  }

  // Skip introspection if token signature validation is disabled (for testing)
  const SKIP_TOKEN_SIGNATURE_VALIDATION = process.env.SKIP_TOKEN_SIGNATURE_VALIDATION === 'true';
  if (SKIP_TOKEN_SIGNATURE_VALIDATION) {
    logger.warn(LOG_CATEGORIES.OAUTH_VALIDATION, 'Skipping OAuth token introspection for testing', {
      method,
      path,
      environment: process.env.NODE_ENV
    });
    
    const decoded = require('jsonwebtoken').decode(token);
    if (!decoded) {
      const error = new OAuthError(
        OAUTH_ERROR_TYPES.MALFORMED_TOKEN,
        'Failed to decode token',
        401
      );
      
      logger.logAuthenticationAttempt(false, {
        method,
        path,
        error_type: OAUTH_ERROR_TYPES.MALFORMED_TOKEN,
        reason: 'decode_failed',
        validation_skipped: true
      });
      
      throw error;
    }
    
    const responseTime = Date.now() - startTime;
    logger.logAuthenticationAttempt(true, {
      method,
      path,
      validation_skipped: true,
      response_time_ms: responseTime,
      subject: decoded.sub
    });
    
    // Return a mock introspection result for testing
    return {
      active: true,
      sub: decoded.sub,
      scope: decoded.scope,
      exp: decoded.exp,
      iat: decoded.iat
    };
  }

  // Check circuit breaker before making request
  if (oauthMonitor.isCircuitBreakerOpen()) {
    const error = new OAuthError(
      OAUTH_ERROR_TYPES.PROVIDER_UNAVAILABLE,
      'OAuth provider is temporarily unavailable (circuit breaker open)',
      503,
      { 
        hint: 'Please try again later',
        circuit_breaker_open: true
      }
    );
    
    logger.error(LOG_CATEGORIES.OAUTH_VALIDATION, 'Token validation blocked by circuit breaker', {
      method,
      path,
      circuit_breaker_open: true
    });
    
    throw error;
  }

  try {
    // Attempt token introspection with OAuth provider
    const introspectionResult = await introspectTokenWithRetry(token, oauthConfig, 3, requestContext);
    const responseTime = Date.now() - startTime;
    
    if (!introspectionResult.active) {
      // Determine if token is expired or invalid
      const decoded = require('jsonwebtoken').decode(token);
      let errorType = OAUTH_ERROR_TYPES.INVALID_TOKEN;
      let errorMessage = 'Access token is invalid or has been revoked';
      let additionalData = { hint: 'Obtain a new access token through the authorization flow' };
      
      if (decoded && decoded.exp && decoded.exp * 1000 < Date.now()) {
        errorType = OAUTH_ERROR_TYPES.EXPIRED_TOKEN;
        errorMessage = 'Access token has expired';
        additionalData = { 
          hint: 'Refresh your access token or re-authenticate',
          expired_at: new Date(decoded.exp * 1000).toISOString()
        };
      }
      
      const error = new OAuthError(errorType, errorMessage, 401, additionalData);
      
      // Record failed validation
      oauthMonitor.recordRequest(false, responseTime, errorType, {
        method,
        path,
        reason: 'inactive_token',
        subject: decoded?.sub
      });
      
      logger.logAuthenticationAttempt(false, {
        method,
        path,
        error_type: errorType,
        reason: 'inactive_token',
        response_time_ms: responseTime,
        subject: decoded?.sub,
        expired: decoded?.exp ? decoded.exp * 1000 < Date.now() : false
      });
      
      throw error;
    }

    // Record successful validation
    oauthMonitor.recordRequest(true, responseTime, null, {
      method,
      path,
      subject: introspectionResult.sub
    });
    
    logger.logAuthenticationAttempt(true, {
      method,
      path,
      response_time_ms: responseTime,
      subject: introspectionResult.sub,
      scopes: introspectionResult.scope
    });

    return introspectionResult;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    if (error instanceof OAuthError) {
      // Record the specific OAuth error
      oauthMonitor.recordRequest(false, responseTime, error.type, {
        method,
        path,
        error_message: error.message
      });
      throw error;
    }

    // Handle OAuth provider unavailability
    let errorType = OAUTH_ERROR_TYPES.TOKEN_INTROSPECTION_FAILED;
    let errorMessage = 'Failed to validate token with OAuth provider';
    let statusCode = 502;
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      errorType = OAUTH_ERROR_TYPES.PROVIDER_UNAVAILABLE;
      errorMessage = 'OAuth provider is temporarily unavailable';
      statusCode = 503;
    }
    
    const oauthError = new OAuthError(
      errorType,
      errorMessage,
      statusCode,
      { 
        hint: errorType === OAUTH_ERROR_TYPES.PROVIDER_UNAVAILABLE ? 'Please try again later' : 'Token validation service is experiencing issues',
        provider_error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        error_code: error.code
      }
    );
    
    // Record the failure
    oauthMonitor.recordRequest(false, responseTime, errorType, {
      method,
      path,
      error_code: error.code,
      error_message: error.message
    });
    
    logger.logAuthenticationAttempt(false, {
      method,
      path,
      error_type: errorType,
      error_code: error.code,
      response_time_ms: responseTime,
      provider_error: error.message
    });
    
    throw oauthError;
  }
};

// Token introspection with retry logic, circuit breaker pattern, and comprehensive logging
const introspectTokenWithRetry = async (token, oauthConfig, maxRetries = 3, requestContext = {}) => {
  let lastError;
  const { method = 'UNKNOWN', path = 'UNKNOWN' } = requestContext;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptStartTime = Date.now();
    
    try {
      logger.debug(LOG_CATEGORIES.TOKEN_INTROSPECTION, `Token introspection attempt ${attempt}/${maxRetries}`, {
        method,
        path,
        attempt,
        max_retries: maxRetries,
        endpoint: oauthConfig.tokenEndpoint?.replace('/access_token', '/introspect')
      });

      const response = await axios.post(
        oauthConfig.tokenEndpoint.replace('/access_token', '/introspect'),
        new URLSearchParams({
          token: token,
          client_id: oauthConfig.clientId,
          client_secret: oauthConfig.clientSecret
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          timeout: 5000, // 5 second timeout
          validateStatus: () => true
        }
      );

      const responseTime = Date.now() - attemptStartTime;
      
      logger.debug(LOG_CATEGORIES.TOKEN_INTROSPECTION, 'Token introspection successful', {
        method,
        path,
        attempt,
        response_time_ms: responseTime,
        status_code: response.status,
        token_active: response.data?.active
      });

      return response.data;
    } catch (error) {
      lastError = error;
      const responseTime = Date.now() - attemptStartTime;
      
      logger.warn(LOG_CATEGORIES.TOKEN_INTROSPECTION, `Token introspection attempt ${attempt} failed`, {
        method,
        path,
        attempt,
        response_time_ms: responseTime,
        error_code: error.code,
        error_message: error.message,
        status_code: error.response?.status,
        will_retry: attempt < maxRetries && !(error.response && error.response.status >= 400 && error.response.status < 500)
      });
      
      // Don't retry on client errors (4xx)
      if (error.response && error.response.status >= 400 && error.response.status < 500) {
        logger.error(LOG_CATEGORIES.TOKEN_INTROSPECTION, 'Token introspection failed with client error - no retry', {
          method,
          path,
          status_code: error.response.status,
          error_data: error.response.data
        });
        break;
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = 2 ** (attempt - 1) * 1000; // 1s, 2s, 4s
        
        logger.debug(LOG_CATEGORIES.TOKEN_INTROSPECTION, `Waiting ${delay}ms before retry`, {
          method,
          path,
          attempt,
          delay_ms: delay
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  logger.error(LOG_CATEGORIES.TOKEN_INTROSPECTION, 'All token introspection attempts failed', {
    method,
    path,
    total_attempts: maxRetries,
    final_error: lastError.message,
    error_code: lastError.code,
    status_code: lastError.response?.status
  });
  
  throw lastError;
};

// Enhanced scope validation with detailed error information and logging
const validateScopesWithErrorHandling = (userScopes, requiredScopes, requireAll = false, requestContext = {}) => {
  const { method = 'UNKNOWN', path = 'UNKNOWN', userId = 'UNKNOWN' } = requestContext;
  
  if (!Array.isArray(userScopes)) {
    userScopes = [];
  }
  
  if (!Array.isArray(requiredScopes) || requiredScopes.length === 0) {
    logger.debug(LOG_CATEGORIES.SCOPE_VALIDATION, 'No scopes required - access granted', {
      method,
      path,
      user_id: userId,
      user_scopes: userScopes
    });
    return true; // No scopes required
  }

  logger.debug(LOG_CATEGORIES.SCOPE_VALIDATION, 'Starting scope validation', {
    method,
    path,
    user_id: userId,
    required_scopes: requiredScopes,
    user_scopes: userScopes,
    validation_mode: requireAll ? 'all_required' : 'any_required'
  });

  let hasAccess = false;
  let missingScopes = [];
  let matchingScopes = [];

  if (requireAll) {
    // AND logic - user must have ALL required scopes
    missingScopes = requiredScopes.filter(scope => !userScopes.includes(scope));
    matchingScopes = requiredScopes.filter(scope => userScopes.includes(scope));
    hasAccess = missingScopes.length === 0;
  } else {
    // OR logic - user must have at least ONE of the required scopes
    matchingScopes = requiredScopes.filter(scope => userScopes.includes(scope));
    hasAccess = matchingScopes.length > 0;
    
    if (!hasAccess) {
      missingScopes = requiredScopes; // All scopes are missing in OR logic
    }
  }

  if (!hasAccess) {
    const errorMessage = requireAll 
      ? `Access denied. All of the following scopes are required: ${requiredScopes.join(', ')}`
      : `Access denied. At least one of the following scopes is required: ${requiredScopes.join(', ')}`;
    
    const error = new OAuthError(
      OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE,
      errorMessage,
      403,
      {
        requiredScopes,
        providedScopes: userScopes,
        missingScopes,
        matchingScopes,
        validationMode: requireAll ? 'all_required' : 'any_required',
        hint: requireAll 
          ? 'Request additional scopes through the authorization flow'
          : 'Ensure your token includes at least one of the required scopes'
      }
    );
    
    logger.logScopeValidation(false, {
      method,
      path,
      user_id: userId,
      required_scopes: requiredScopes,
      user_scopes: userScopes,
      missing_scopes: missingScopes,
      matching_scopes: matchingScopes,
      validation_mode: requireAll ? 'all_required' : 'any_required',
      error_type: OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE
    });
    
    throw error;
  }

  logger.logScopeValidation(true, {
    method,
    path,
    user_id: userId,
    required_scopes: requiredScopes,
    user_scopes: userScopes,
    matching_scopes: matchingScopes,
    validation_mode: requireAll ? 'all_required' : 'any_required'
  });

  return true;
};

// Enhanced OAuth error handling middleware with comprehensive logging
const oauthErrorHandler = (error, req, res, _next) => {
  const requestContext = {
    method: req.method,
    path: req.path || req.url,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.connection.remoteAddress,
    userId: req.user?.id || 'anonymous'
  };

  // Log error with structured logging
  logger.logErrorHandling(error.type || 'unknown_error', {
    ...requestContext,
    error_message: error.message,
    error_type: error.type || 'unknown',
    status_code: error.statusCode || 500,
    stack_trace: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    additional_data: error.additionalData || {}
  });

  // Log specific OAuth error types with additional context
  if (error instanceof OAuthError) {
    switch (error.type) {
      case OAUTH_ERROR_TYPES.INSUFFICIENT_SCOPE:
        logger.warn(LOG_CATEGORIES.AUTHORIZATION, 'Access denied due to insufficient scopes', {
          ...requestContext,
          required_scopes: error.additionalData?.requiredScopes || [],
          provided_scopes: error.additionalData?.providedScopes || [],
          missing_scopes: error.additionalData?.missingScopes || []
        });
        break;
        
      case OAUTH_ERROR_TYPES.PROVIDER_UNAVAILABLE:
        logger.error(LOG_CATEGORIES.PROVIDER_HEALTH, 'OAuth provider unavailable', {
          ...requestContext,
          provider_error: error.additionalData?.provider_error,
          circuit_breaker_open: error.additionalData?.circuit_breaker_open || false
        });
        break;
        
      case OAUTH_ERROR_TYPES.EXPIRED_TOKEN:
        logger.info(LOG_CATEGORIES.AUTHENTICATION, 'Token expired - user needs to refresh', {
          ...requestContext,
          expired_at: error.additionalData?.expired_at
        });
        break;
        
      case OAUTH_ERROR_TYPES.INVALID_TOKEN:
        logger.warn(LOG_CATEGORIES.AUTHENTICATION, 'Invalid token detected', {
          ...requestContext,
          token_length: req.headers.authorization?.split(' ')[1]?.length || 0
        });
        break;
        
      default:
        logger.error(LOG_CATEGORIES.OAUTH_VALIDATION, 'OAuth validation error', {
          ...requestContext,
          error_type: error.type
        });
    }
  } else {
    // Log non-OAuth errors
    logger.error(LOG_CATEGORIES.ERROR_HANDLING, 'Non-OAuth error in OAuth handler', {
      ...requestContext,
      error_name: error.name,
      error_message: error.message
    });
    posthog.captureException(error, requestContext.userId !== 'anonymous' ? requestContext.userId : undefined, {
      path: requestContext.path,
      method: requestContext.method,
    });
  }

  // Format and send error response
  const errorResponse = formatOAuthErrorResponse(error, req);
  const statusCode = error.statusCode || (error instanceof OAuthError ? error.statusCode : 500);
  
  res.status(statusCode).json(errorResponse);
};

// Graceful degradation handler for OAuth provider outages
const createGracefulDegradationHandler = (fallbackValidation) => {
  return async (token, oauthConfig) => {
    try {
      return await validateTokenWithErrorHandling(token, oauthConfig);
    } catch (error) {
      if (error.type === OAUTH_ERROR_TYPES.PROVIDER_UNAVAILABLE && fallbackValidation) {
        console.warn('[OAuth] Provider unavailable, using fallback validation');
        return await fallbackValidation(token);
      }
      throw error;
    }
  };
};

// Enhanced health check for OAuth provider with comprehensive monitoring
const checkOAuthProviderHealth = async (oauthConfig) => {
  const startTime = Date.now();
  
  try {
    logger.debug(LOG_CATEGORIES.PROVIDER_HEALTH, 'Starting OAuth provider health check', {
      issuer: oauthConfig.issuer
    });

    const healthCheckUrl = `${oauthConfig.issuer}/.well-known/openid-configuration`;
    const response = await axios.get(healthCheckUrl, { timeout: 3000, validateStatus: () => true });
    const responseTime = Date.now() - startTime;
    
    const healthResult = {
      healthy: true,
      responseTime,
      timestamp: new Date().toISOString(),
      statusCode: response.status,
      endpoint: healthCheckUrl
    };
    
    logger.logProviderHealth(true, responseTime, {
      status_code: response.status,
      endpoint: healthCheckUrl,
      issuer: response.data?.issuer
    });
    
    return healthResult;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    const healthResult = {
      healthy: false,
      error: error.message,
      errorCode: error.code,
      statusCode: error.response?.status,
      responseTime,
      timestamp: new Date().toISOString()
    };
    
    logger.logProviderHealth(false, responseTime, {
      error_message: error.message,
      error_code: error.code,
      status_code: error.response?.status,
      endpoint: `${oauthConfig.issuer}/.well-known/openid-configuration`
    });
    
    return healthResult;
  }
};

module.exports = {
  OAuthError,
  OAUTH_ERROR_TYPES,
  formatOAuthErrorResponse,
  validateTokenWithErrorHandling,
  validateScopesWithErrorHandling,
  oauthErrorHandler,
  createGracefulDegradationHandler,
  checkOAuthProviderHealth,
  introspectTokenWithRetry
};