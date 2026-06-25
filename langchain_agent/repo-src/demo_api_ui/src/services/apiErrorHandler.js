/**
 * apiErrorHandler.js
 * Standardized API error classification and intelligent retry logic.
 * Prevents ad-hoc error handling scattered across the codebase.
 */

/**
 * Classify error type for recovery strategy.
 * @param {Error|Response} err - Error object or HTTP response
 * @returns {object} - { type, isRetryable, userMessage, code, statusCode }
 */
export function classifyApiError(err) {
  if (!err) {
    return {
      type: 'unknown',
      isRetryable: false,
      code: 'E_UNKNOWN',
      userMessage: 'An unexpected error occurred',
      statusCode: 0,
    };
  }

  // Network errors
  const networkPatterns = [
    'timed out',
    'ECONNREFUSED',
    'ENETUNREACH',
    'Failed to fetch',
    'mcp_error',
  ];

  const message = String(err.message || '');
  const isNetworkError = networkPatterns.some(pattern =>
    message.toLowerCase().includes(pattern.toLowerCase())
  );

  if (isNetworkError) {
    return {
      type: 'network',
      isRetryable: true,
      code: 'E_NETWORK',
      userMessage: 'Connection lost. Retrying…',
      statusCode: 0,
    };
  }

  // HTTP status errors
  if (err.status) {
    if (err.status === 401 || err.status === 403) {
      return {
        type: 'auth',
        isRetryable: true,
        code: `E_AUTH_${err.status}`,
        userMessage: 'Your session expired. Signing you in…',
        statusCode: err.status,
      };
    }

    if (err.status === 429) {
      return {
        type: 'rateLimit',
        isRetryable: true,
        code: 'E_RATE_LIMIT',
        userMessage: 'Too many requests. Please wait a moment.',
        statusCode: err.status,
      };
    }

    if (err.status >= 500) {
      return {
        type: 'server',
        isRetryable: true,
        code: `E_SERVER_${err.status}`,
        userMessage: 'Server error. Retrying…',
        statusCode: err.status,
      };
    }

    if (err.status >= 400) {
      return {
        type: 'client',
        isRetryable: false,
        code: `E_CLIENT_${err.status}`,
        userMessage: message || `Request failed (${err.status})`,
        statusCode: err.status,
      };
    }
  }

  // Generic error
  return {
    type: 'unknown',
    isRetryable: false,
    code: 'E_UNKNOWN',
    userMessage: message || 'Request failed',
    statusCode: 0,
  };
}

/**
 * Calculate exponential backoff delay with jitter.
 * @param {number} attemptNumber - 0-indexed attempt (0 = first retry)
 * @param {number} baseDelay - Base delay in ms (default 200)
 * @param {number} maxDelay - Maximum delay in ms (default 10000)
 * @returns {number} - Delay in ms with jitter
 */
export function getExponentialBackoffDelay(
  attemptNumber,
  baseDelay = 200,
  maxDelay = 10000
) {
  if (attemptNumber < 0) return 0;

  const jitter = Math.random() * 0.1; // ±5% jitter
  const delay = baseDelay * (2 ** attemptNumber) * (1 + jitter);
  return Math.min(Math.floor(delay), maxDelay);
}

/**
 * Cold-start retry delays for session rehydration.
 * Used after OAuth redirect when session needs immediate refresh.
 * @returns {number[]} - Delays in ms for each retry attempt
 */
export function getColdStartRetryDelays() {
  return [0, 600, 1400, 2500]; // Immediate, then backoff
}

/**
 * Execute with intelligent retry on transient failures.
 * @param {Function} fetchFn - Async function that returns Response
 * @param {object} options - { maxRetries, baseDelay, maxDelay, endpoint, onRetry }
 * @returns {Promise<Response>}
 */
export async function executeWithRetry(
  fetchFn,
  options = {}
) {
  const {
    maxRetries = 3,
    baseDelay = 200,
    maxDelay = 10000,
    endpoint = 'unknown',
    onRetry = null,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchFn();

      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        err.status = response.status;
        err.response = response;
        throw err;
      }

      return response;
    } catch (err) {
      lastError = err;
      const classification = classifyApiError(err);

      console.warn(
        `[API] ${endpoint} [attempt ${attempt + 1}/${maxRetries + 1}]: ${classification.code} — ${err.message}`
      );

      // Non-retryable or final attempt — give up
      if (!classification.isRetryable || attempt === maxRetries) {
        throw Object.assign(err, { classification });
      }

      // Calculate delay and retry
      const delayMs = getExponentialBackoffDelay(attempt, baseDelay, maxDelay);
      if (onRetry) {
        onRetry(attempt, delayMs, classification);
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Should not reach here, but safety fallback
  throw lastError;
}

const apiErrorHandler = {
  classifyApiError,
  getExponentialBackoffDelay,
  getColdStartRetryDelays,
  executeWithRetry,
};

export default apiErrorHandler;
