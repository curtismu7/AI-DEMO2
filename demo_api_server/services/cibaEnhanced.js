/**
 * Enhanced CIBA Service with improved error handling and retry logic
 * Extends the base CIBA service with production-grade resilience
 */

const cibaService = require('./cibaService');
const { logger } = require('../utils/logger');

const { PINGONE_OIDC_DEFAULT_SCOPES_SPACE } = require('../config/scopes');

/**
 * CIBA error types for better error handling
 */
const CIBAErrorType = {
  AUTHORIZATION_PENDING: 'authorization_pending',
  SLOW_DOWN: 'slow_down',
  ACCESS_DENIED: 'access_denied',
  EXPIRED_TOKEN: 'expired_token',
  INVALID_REQUEST: 'invalid_request',
  TIMEOUT: 'timeout',
  NETWORK_ERROR: 'network_error'
};

/**
 * Enhanced initiate with retry logic for transient failures
 */
async function initiateBackchannelAuthWithRetry(
  loginHint, 
  bindingMessage, 
  scope = PINGONE_OIDC_DEFAULT_SCOPES_SPACE, 
  acrValues = '',
  maxRetries = 3
) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await cibaService.initiateBackchannelAuth(
        loginHint, 
        bindingMessage, 
        scope, 
        acrValues
      );
      
      logger.info('CIBA authentication initiated', {
        loginHint,
        auth_req_id: result.auth_req_id,
        expires_in: result.expires_in,
        attempt
      });
      
      return result;
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      const isRetryable = isRetryableError(error);
      
      if (!isRetryable || attempt === maxRetries) {
        logger.error('CIBA initiation failed', {
          loginHint,
          attempt,
          error: error.message,
          errorCode: error.response?.data?.error
        });
        throw enhanceError(error, 'CIBA_INITIATION_FAILED');
      }
      
      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      logger.warn(`CIBA initiation failed, retrying in ${delay}ms`, {
        attempt,
        error: error.message
      });
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Enhanced polling with better status tracking and error messages
 */
async function pollWithStatus(authReqId, onStatusUpdate) {
  const startTime = Date.now();
  let pollCount = 0;
  let interval = 5; // Start with 5 seconds
  const maxAttempts = 60; // 5 minutes max
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    pollCount++;
    await sleep(interval * 1000);
    
    try {
      const tokens = await cibaService.pollForTokens(authReqId);
      
      if (onStatusUpdate) {
        onStatusUpdate({
          status: 'approved',
          pollCount,
          elapsedSeconds: Math.floor((Date.now() - startTime) / 1000)
        });
      }
      
      logger.info('CIBA authentication approved', {
        auth_req_id: authReqId,
        pollCount,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000)
      });
      
      return tokens;
    } catch (error) {
      const errorCode = error.response?.data?.error;
      const errorDescription = error.response?.data?.error_description;
      
      if (errorCode === CIBAErrorType.AUTHORIZATION_PENDING) {
        // Normal - user hasn't approved yet
        if (onStatusUpdate) {
          onStatusUpdate({
            status: 'pending',
            pollCount,
            elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
            message: 'Waiting for user approval...'
          });
        }
        continue;
      }
      
      if (errorCode === CIBAErrorType.SLOW_DOWN) {
        // Server asking us to back off
        interval = Math.min(interval + 5, 30);
        
        if (onStatusUpdate) {
          onStatusUpdate({
            status: 'slow_down',
            pollCount,
            interval,
            message: `Slowing down polling to ${interval}s intervals`
          });
        }
        
        logger.warn('CIBA slow_down received', { auth_req_id: authReqId, newInterval: interval });
        continue;
      }
      
      if (errorCode === CIBAErrorType.ACCESS_DENIED) {
        logger.warn('CIBA authentication denied by user', { auth_req_id: authReqId });
        
        if (onStatusUpdate) {
          onStatusUpdate({
            status: 'denied',
            pollCount,
            message: 'User denied the authentication request'
          });
        }
        
        throw enhanceError(error, 'CIBA_ACCESS_DENIED', 'User denied the authentication request');
      }
      
      if (errorCode === CIBAErrorType.EXPIRED_TOKEN) {
        logger.warn('CIBA auth_req_id expired', { auth_req_id: authReqId });
        
        if (onStatusUpdate) {
          onStatusUpdate({
            status: 'expired',
            pollCount,
            message: 'Authentication request expired. Please try again.'
          });
        }
        
        throw enhanceError(error, 'CIBA_EXPIRED', 'Authentication request expired');
      }
      
      // Unknown error
      logger.error('CIBA polling error', {
        auth_req_id: authReqId,
        errorCode,
        errorDescription,
        pollCount
      });
      
      throw enhanceError(error, 'CIBA_POLLING_ERROR', errorDescription || 'Unknown polling error');
    }
  }
  
  // Timeout
  logger.error('CIBA authentication timeout', {
    auth_req_id: authReqId,
    pollCount,
    maxAttempts
  });
  
  if (onStatusUpdate) {
    onStatusUpdate({
      status: 'timeout',
      pollCount,
      message: 'Authentication request timed out. User did not respond in time.'
    });
  }
  
  throw enhanceError(
    new Error('Timeout'),
    'CIBA_TIMEOUT',
    'User did not respond within the allowed time'
  );
}

/**
 * Check if an error is retryable (transient network/server error)
 */
function isRetryableError(error) {
  // Network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }
  
  // 5xx server errors
  if (error.response?.status >= 500 && error.response?.status < 600) {
    return true;
  }
  
  // Rate limiting
  if (error.response?.status === 429) {
    return true;
  }
  
  return false;
}

/**
 * Enhance error with additional context
 */
function enhanceError(originalError, code, userMessage) {
  const enhanced = new Error(userMessage || originalError.message);
  enhanced.code = code;
  enhanced.originalError = originalError;
  enhanced.statusCode = originalError.response?.status;
  enhanced.errorData = originalError.response?.data;
  return enhanced;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get user-friendly error message
 */
function getUserFriendlyErrorMessage(error) {
  const errorCode = error.code || error.response?.data?.error;
  
  const messages = {
    'CIBA_ACCESS_DENIED': 'You denied the authentication request. Please try again if this was a mistake.',
    'CIBA_EXPIRED': 'The authentication request expired. Please start a new login attempt.',
    'CIBA_TIMEOUT': 'The authentication request timed out. Please check your email or notification and try again.',
    'CIBA_INITIATION_FAILED': 'Failed to start authentication. Please check your email address and try again.',
    'authorization_pending': 'Waiting for your approval. Please check your email or device.',
    'slow_down': 'Please wait a moment before trying again.',
    'access_denied': 'Authentication was denied.',
    'expired_token': 'The authentication request has expired.',
    'invalid_request': 'Invalid authentication request. Please try again.'
  };
  
  return messages[errorCode] || 'An error occurred during authentication. Please try again.';
}

module.exports = {
  initiateBackchannelAuthWithRetry,
  pollWithStatus,
  getUserFriendlyErrorMessage,
  CIBAErrorType,
  // Re-export base service functions
  ...cibaService
};
