/**
 * Error Retry Strategy — Exponential backoff for transient errors
 *
 * Automatically retries transient errors (network, rate limit, 5xx) with
 * exponential backoff + jitter. CONFIG and USER errors fail immediately.
 *
 * Backoff: 500ms → 1s → 2s → 4s → max 10s
 * Jitter: ±10% to prevent thundering herd
 */

class ErrorRetryStrategy {
  static DEFAULT_MAX_ATTEMPTS = 3;
  static BASE_DELAY_MS = 500;
  static MAX_DELAY_MS = 10000;
  static JITTER_PERCENT = 0.1;

  /**
   * Check if error is retryable (TRANSIENT category)
   * @param {Error} error
   * @returns {boolean}
   */
  static canRetry(error) {
    const classification = error.classification || {};
    return (
      classification.category === 'TRANSIENT' &&
      classification.retryable === true
    );
  }

  /**
   * Calculate exponential backoff delay with jitter
   * @param {number} attemptNumber - 0-indexed attempt number
   * @returns {number} Delay in milliseconds
   */
  static getRetryDelay(attemptNumber) {
    const baseDelay = this.BASE_DELAY_MS * Math.pow(2, attemptNumber);
    const cappedDelay = Math.min(baseDelay, this.MAX_DELAY_MS);

    // Add jitter: ±JITTER_PERCENT
    const jitterRange = cappedDelay * this.JITTER_PERCENT;
    const jitter = Math.random() * jitterRange * 2 - jitterRange;

    return Math.round(cappedDelay + jitter);
  }

  /**
   * Execute function with automatic retry on transient errors
   * @param {Function} fn - Async function to execute
   * @param {object} opts
   * @param {number} [opts.maxAttempts=3] - Max retry attempts
   * @param {Function} [opts.onRetry] - Called on retry: (attempt, delay, error)
   * @param {Function} [opts.onSuccess] - Called on success: (result, attempt)
   * @param {Function} [opts.onFailure] - Called on final failure: (error, attempts)
   * @returns {Promise<any>} Result from fn or throws final error
   */
  static async executeWithRetry(
    fn,
    {
      maxAttempts = this.DEFAULT_MAX_ATTEMPTS,
      onRetry,
      onSuccess,
      onFailure,
    } = {}
  ) {
    let lastError;
    let lastResult;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        lastResult = await fn();

        // Success
        if (onSuccess) {
          onSuccess(lastResult, attempt);
        }

        return lastResult;
      } catch (err) {
        lastError = err;

        // Check if retryable
        if (!this.canRetry(err) || attempt >= maxAttempts - 1) {
          // Not retryable or last attempt — fail
          if (onFailure) {
            onFailure(err, attempt + 1);
          }
          throw err;
        }

        // Schedule retry
        const delay = this.getRetryDelay(attempt);
        if (onRetry) {
          onRetry(attempt, delay, err);
        }

        await this._sleep(delay);
      }
    }

    // Should not reach here, but fallback
    throw lastError;
  }

  /**
   * Sleep for ms milliseconds
   * @private
   */
  static _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Retry with exponential backoff (simplified, no callbacks)
   * @param {Function} fn
   * @param {number} [maxAttempts=3]
   * @returns {Promise<any>}
   */
  static async retry(fn, maxAttempts = this.DEFAULT_MAX_ATTEMPTS) {
    return this.executeWithRetry(fn, { maxAttempts });
  }

  /**
   * Wrap axios/fetch request with retry logic.
   * Accepts either a Promise (single-shot, no retries) or a factory function
   * (() => Promise) that is called fresh on each attempt.
   * @param {Promise|Function} requestOrFactory
   * @param {object} [opts]
   * @returns {Promise}
   */
  static async retryRequest(requestOrFactory, opts = {}) {
    if (typeof requestOrFactory !== 'function') {
      // Passing a bare Promise means retries re-await the same settled result (no new request).
      // Pass a () => Promise factory so each attempt issues a fresh request.
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          '[ErrorRetryStrategy] retryRequest received a Promise instead of a factory — retries will be no-ops. Pass () => yourPromise() instead.'
        );
      }
    }
    const factory =
      typeof requestOrFactory === 'function'
        ? requestOrFactory
        : () => requestOrFactory;
    return this.executeWithRetry(factory, opts);
  }
}

export default ErrorRetryStrategy;
