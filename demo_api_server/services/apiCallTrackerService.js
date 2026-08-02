/**
 * apiCallTrackerService.js
 *
 * Service for tracking API calls with request/response details for educational purposes.
 * Captures JSON bodies, headers, and metadata for display on the PingOne test page.
 * Also tracks tokens separately for decoding/display without sanitizing headers.
 *
 * Demo explorer: every tracked call is dual-written to GLOBAL_SESSION_ID so
 * /monitoring/api-explorer can show agent/MCP/BFF traffic even when those
 * requests lack the browser's express-session cookie.
 */

const crypto = require('crypto');
const sseHub = require('./pingoneTestSseHub');

/** Shared ring buffer read by the API Explorer monitoring page. */
const GLOBAL_SESSION_ID = '__global__';

// Per-call/-token console logs are chatty (status polls fire ~1s). Off by default.
const TRACKER_DEBUG = process.env.API_TRACKER_DEBUG === 'true';

// In-memory storage for API calls (production should use database)
const apiCalls = new Map();
const MAX_CALLS_PER_SESSION = 100;

// In-memory storage for tokens per session (for decoding/display)
const sessionTokens = new Map();
const MAX_TOKENS_PER_SESSION = 50;

/**
 * Push a call onto a session bucket, trimming to MAX_CALLS_PER_SESSION.
 * @param {string} sessionId
 * @param {object} call
 */
function pushCall(sessionId, call) {
  if (!apiCalls.has(sessionId)) {
    apiCalls.set(sessionId, []);
  }
  apiCalls.get(sessionId).push(call);
  const sessionCalls = apiCalls.get(sessionId);
  if (sessionCalls.length > MAX_CALLS_PER_SESSION) {
    apiCalls.set(sessionId, sessionCalls.slice(-MAX_CALLS_PER_SESSION));
  }
}

/**
 * Track an API call with request/response details.
 * Dual-writes into the shared global bucket for the monitoring explorer.
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
    // Alias for ApiExplorerPanel (expects durationMs)
    durationMs: duration,
    success: responseStatus >= 200 && responseStatus < 300
  };

  const sessionId = callData.sessionId || 'default';
  pushCall(sessionId, call);

  // Dual-write so agent/Bearer traffic (no browser cookie) still appears in the explorer
  if (sessionId !== GLOBAL_SESSION_ID) {
    pushCall(GLOBAL_SESSION_ID, call);
  }

  if (TRACKER_DEBUG) console.log('[apiCallTracker] Tracked call:', { id: call.id, method: call.method, url: call.url, status: call.response.status });

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
function getApiCalls(sessionId = GLOBAL_SESSION_ID, limit = 50) {
  const calls = apiCalls.get(sessionId) || [];
  return calls.slice(-limit);
}

/**
 * Clear API calls for a session
 */
function clearApiCalls(sessionId = GLOBAL_SESSION_ID) {
  apiCalls.delete(sessionId);
  console.log('[apiCallTracker] Cleared calls for session:', sessionId);
}

/**
 * Sanitize headers by removing sensitive values
 */
function sanitizeHeaders(headers) {
  const sensitiveKeys = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token'];
  // Truncation is deliberate for bearer tokens (this demo teaches token shape),
  // but a session cookie has no teaching value and its ends are enough to
  // fingerprint the admin's session — always redact those in full.
  const alwaysFullyRedact = ['cookie', 'set-cookie'];
  const sanitized = { ...headers };

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.includes(lowerKey)) {
      const value = sanitized[key];
      if (alwaysFullyRedact.includes(lowerKey) && value) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof value === 'string' && value.length > 20) {
        sanitized[key] = value.substring(0, 10) + '***' + value.substring(value.length - 10);
      } else if (value) {
        sanitized[key] = '***REDACTED***';
      }
    }
  }

  return sanitized;
}

/**
 * Server-side mirror of demo_api_ui/src/services/apiTrafficStore.js
 * REDACT_BODY_KEYS. The client buffer already redacted these; this side did
 * not, so `POST /api/admin/vault/unlock` parked the vault master password in
 * the shared __global__ bucket in plaintext.
 */
const REDACT_BODY_KEYS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'password',
  'token',
  'client_credentials',
  'code_verifier',
  'currentpassword',
  'newpassword',
]);

/**
 * Recursively replace known secret-bearing keys. Nested because bodies are not
 * always flat (`{ credentials: { password } }`).
 */
function redactBodyKeys(value) {
  if (Array.isArray(value)) return value.map(redactBodyKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_BODY_KEYS.has(k.toLowerCase())
        ? '***REDACTED***'
        : redactBodyKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * Format body for display (pretty print JSON if possible).
 * Redacts secret keys first — a tracked body is readable by every reader of
 * the shared explorer buffer.
 */
function formatBody(body) {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(redactBodyKeys(parsed), null, 2);
    } catch {
      return body;
    }
  }
  if (typeof body === 'object') {
    return JSON.stringify(redactBodyKeys(body), null, 2);
  }
  return String(body);
}

/**
 * Get statistics about API calls.
 * Includes ApiExplorerPanel aliases (success/errors/avgDurationMs).
 */
function getApiCallStats(sessionId = GLOBAL_SESSION_ID) {
  const calls = apiCalls.get(sessionId) || [];

  if (calls.length === 0) {
    return {
      total: 0,
      successful: 0,
      failed: 0,
      success: 0,
      errors: 0,
      categories: {},
      averageDuration: null,
      avgDurationMs: null,
    };
  }

  const successful = calls.filter(c => c.success).length;
  const failed = calls.length - successful;
  const categories = {};

  for (const call of calls) {
    const cat = call.category || 'general';
    categories[cat] = (categories[cat] || 0) + 1;
  }

  const averageDuration = calls.reduce((sum, c) => sum + (c.duration || 0), 0) / calls.length;

  return {
    total: calls.length,
    successful,
    failed,
    success: successful,
    errors: failed,
    categories,
    averageDuration,
    avgDurationMs: averageDuration,
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

  if (TRACKER_DEBUG) console.log('[apiCallTracker] Tracked token:', { sessionId, tokenType, description });
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

/**
 * Reset all in-memory stores (tests only).
 */
function _resetForTests() {
  apiCalls.clear();
  sessionTokens.clear();
}

module.exports = {
  GLOBAL_SESSION_ID,
  trackApiCall,
  getApiCalls,
  clearApiCalls,
  getApiCallStats,
  trackToken,
  getSessionTokens,
  clearSessionTokens,
  _resetForTests,
  redactBodyKeys,
};
