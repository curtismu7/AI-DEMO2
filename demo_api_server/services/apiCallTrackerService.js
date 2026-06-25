/**
 * apiCallTrackerService.js
 *
 * Service for tracking API calls with request/response details for educational purposes.
 * Captures JSON bodies, headers, and metadata for display on the PingOne test page.
 * Also tracks tokens separately for decoding/display without sanitizing headers.
 */

const crypto = require('crypto');
const sseHub = require('./pingoneTestSseHub');

// In-memory storage for API calls (production should use database)
const apiCalls = new Map();
const MAX_CALLS_PER_SESSION = 100;

// In-memory storage for tokens per session (for decoding/display)
const sessionTokens = new Map();
const MAX_TOKENS_PER_SESSION = 50;

/**
 * Track an API call with request/response details
 */
async function trackApiCall(callData) {
  const {
    method,
    url,
    requestHeaders = {},
    requestBody = null,
    responseStatus,
    responseHeaders = {},
    responseBody = null,
    duration = null,
    timestamp = new Date().toISOString(),
    category = 'general',
    description = ''
  } = callData;

  const call = {
    id: crypto.randomUUID(),
    timestamp,
    method,
    url,
    category,
    description: description || `${method} ${url}`,
    request: {
      headers: sanitizeHeaders(requestHeaders),
      body: requestBody ? formatBody(requestBody) : null
    },
    response: {
      status: responseStatus,
      headers: sanitizeHeaders(responseHeaders),
      body: responseBody ? formatBody(responseBody) : null
    },
    duration,
    success: responseStatus >= 200 && responseStatus < 300
  };

  // Store call by session ID if provided, otherwise use 'default'
  const sessionId = callData.sessionId || 'default';
  if (!apiCalls.has(sessionId)) {
    apiCalls.set(sessionId, []);
  }
  apiCalls.get(sessionId).push(call);

  // Keep only last MAX_CALLS_PER_SESSION calls
  const sessionCalls = apiCalls.get(sessionId);
  if (sessionCalls.length > MAX_CALLS_PER_SESSION) {
    apiCalls.set(sessionId, sessionCalls.slice(-MAX_CALLS_PER_SESSION));
  }

  console.log('[apiCallTracker] Tracked call:', { id: call.id, method: call.method, url: call.url, status: call.response.status });

  // Push to any open SSE streams for this session
  sseHub.publishApiCall(sessionId, {
    method: call.method,
    url: call.url,
    status: call.response.status,
    duration: call.duration,
    category: call.category,
    description: call.description,
  });

  return call;
}

/**
 * Get all API calls for a session
 */
function getApiCalls(sessionId = 'default', limit = 50) {
  const calls = apiCalls.get(sessionId) || [];
  return calls.slice(-limit);
}

/**
 * Clear API calls for a session
 */
function clearApiCalls(sessionId = 'default') {
  apiCalls.delete(sessionId);
  console.log('[apiCallTracker] Cleared calls for session:', sessionId);
}

/**
 * Sanitize headers by removing sensitive values
 */
function sanitizeHeaders(headers) {
  const sensitiveKeys = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token'];
  const sanitized = { ...headers };

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.includes(lowerKey)) {
      const value = sanitized[key];
      if (typeof value === 'string' && value.length > 20) {
        sanitized[key] = value.substring(0, 10) + '***' + value.substring(value.length - 10);
      } else if (value) {
        sanitized[key] = '***REDACTED***';
      }
    }
  }

  return sanitized;
}

/**
 * Format body for display (pretty print JSON if possible)
 */
function formatBody(body) {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return body;
    }
  }
  if (typeof body === 'object') {
    return JSON.stringify(body, null, 2);
  }
  return String(body);
}

/**
 * Get statistics about API calls
 */
function getApiCallStats(sessionId = 'default') {
  const calls = apiCalls.get(sessionId) || [];

  if (calls.length === 0) {
    return { total: 0, successful: 0, failed: 0, categories: {} };
  }

  const successful = calls.filter(c => c.success).length;
  const failed = calls.length - successful;
  const categories = {};

  for (const call of calls) {
    const cat = call.category || 'general';
    categories[cat] = (categories[cat] || 0) + 1;
  }

  return {
    total: calls.length,
    successful,
    failed,
    categories,
    averageDuration: calls.reduce((sum, c) => sum + (c.duration || 0), 0) / calls.length
  };
}

/**
 * Track a token for a session (separate from API calls to avoid sanitization)
 */
function trackToken(sessionId = 'default', tokenData) {
  const { token, tokenType, description } = tokenData;
  
  if (!token) return;
  
  if (!sessionTokens.has(sessionId)) {
    sessionTokens.set(sessionId, []);
  }
  
  const tokens = sessionTokens.get(sessionId);
  tokens.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    token,
    tokenType: tokenType || 'unknown',
    description: description || 'Token'
  });
  
  // Keep only last MAX_TOKENS_PER_SESSION tokens
  if (tokens.length > MAX_TOKENS_PER_SESSION) {
    sessionTokens.set(sessionId, tokens.slice(-MAX_TOKENS_PER_SESSION));
  }
  
  console.log('[apiCallTracker] Tracked token:', { sessionId, tokenType, description });
}

/**
 * Get all tokens for a session
 */
function getSessionTokens(sessionId = 'default') {
  return sessionTokens.get(sessionId) || [];
}

/**
 * Clear tokens for a session
 */
function clearSessionTokens(sessionId = 'default') {
  sessionTokens.delete(sessionId);
  console.log('[apiCallTracker] Cleared tokens for session:', sessionId);
}

module.exports = {
  trackApiCall,
  getApiCalls,
  clearApiCalls,
  getApiCallStats,
  trackToken,
  getSessionTokens,
  clearSessionTokens
};
