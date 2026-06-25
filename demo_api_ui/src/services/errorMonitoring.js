/**
 * errorMonitoring.js
 * Tracks and logs API errors, retries, and failures for observability.
 * Used by apiErrorHandler and other components for analytics/debugging.
 */

/**
 * Error event logger — track all errors, retries, and failures
 */
class ErrorMonitor {
  constructor() {
    this.events = [];
    this.maxEvents = 500; // Keep last 500 events in memory
    this.listeners = [];
    this.config = {
      enableLogging: true,
      enableAnalytics: false, // Set to true to send to analytics
      analyticsEndpoint: '/api/errors/log',
    };
  }

  /**
   * Log an API call attempt
   * @param {object} event - { endpoint, attemptNumber, classification, timestamp, duration }
   */
  logAttempt(event) {
    const entry = {
      type: 'attempt',
      timestamp: Date.now(),
      ...event,
    };

    this._addEvent(entry);

    if (this.config.enableLogging) {
      console.debug('[ErrorMonitor]', `${event.endpoint} attempt ${event.attemptNumber}`, {
        classification: event.classification?.type,
        duration: event.duration,
      });
    }
  }

  /**
   * Log a successful retry after failures
   * @param {object} event - { endpoint, totalAttempts, elapsedTime }
   */
  logRetrySuccess(event) {
    const entry = {
      type: 'retry_success',
      timestamp: Date.now(),
      ...event,
    };

    this._addEvent(entry);

    if (this.config.enableLogging) {
      console.info(
        '[ErrorMonitor]',
        `${event.endpoint} succeeded after ${event.totalAttempts} attempts (${event.elapsedTime}ms)`
      );
    }
  }

  /**
   * Log a failure after all retries exhausted
   * @param {object} event - { endpoint, totalAttempts, error, classification }
   */
  logRetryFailure(event) {
    const entry = {
      type: 'retry_failure',
      timestamp: Date.now(),
      ...event,
    };

    this._addEvent(entry);

    if (this.config.enableLogging) {
      console.error('[ErrorMonitor]', `${event.endpoint} failed after ${event.totalAttempts} retries`, {
        error: event.error?.message,
        code: event.classification?.code,
      });
    }
  }

  /**
   * Log session restoration attempt
   * @param {object} event - { statusEndpoints, attemptNumber, found }
   */
  logSessionRestore(event) {
    const entry = {
      type: 'session_restore',
      timestamp: Date.now(),
      ...event,
    };

    this._addEvent(entry);

    if (this.config.enableLogging && event.found) {
      console.info('[ErrorMonitor]', `Session restored on attempt ${event.attemptNumber}`);
    }
  }

  /**
   * Get recent error events for debugging
   * @param {number} count - Number of recent events (default 10)
   * @returns {array}
   */
  getRecentEvents(count = 10) {
    return this.events.slice(-count);
  }

  /**
   * Get error statistics
   * @returns {object} - { total, byType, byEndpoint, failureRate }
   */
  getStats() {
    const stats = {
      total: this.events.length,
      byType: {},
      byEndpoint: {},
      byClassification: {},
      failureRate: 0,
    };

    this.events.forEach(event => {
      // By type
      stats.byType[event.type] = (stats.byType[event.type] || 0) + 1;

      // By endpoint
      if (event.endpoint) {
        stats.byEndpoint[event.endpoint] = (stats.byEndpoint[event.endpoint] || 0) + 1;
      }

      // By classification
      if (event.classification?.type) {
        const key = event.classification.type;
        stats.byClassification[key] = (stats.byClassification[key] || 0) + 1;
      }
    });

    // Calculate failure rate
    const failures = stats.byType.retry_failure || 0;
    const successes = stats.byType.retry_success || 0;
    if (failures + successes > 0) {
      stats.failureRate = failures / (failures + successes);
    }

    return stats;
  }

  /**
   * Clear all logged events
   */
  clear() {
    this.events = [];
  }

  /**
   * Export events for debugging or analytics
   * @returns {array} - Copy of all events
   */
  export() {
    return [...this.events];
  }

  /**
   * Subscribe to error events
   * @param {Function} callback - Called with { type, timestamp, ...event }
   * @returns {Function} - Unsubscribe function
   */
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Configure monitoring behavior
   * @param {object} config - { enableLogging, enableAnalytics, analyticsEndpoint }
   */
  configure(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Internal: Add event and notify listeners
   * @private
   */
  _addEvent(entry) {
    this.events.push(entry);

    // Keep only recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Notify listeners
    this.listeners.forEach(callback => {
      try {
        callback(entry);
      } catch (err) {
        console.warn('[ErrorMonitor] Listener error:', err.message);
      }
    });

    // Send to analytics if enabled
    if (this.config.enableAnalytics) {
      this._sendAnalytics(entry);
    }
  }

  /**
   * Send event to analytics endpoint
   * @private
   */
  _sendAnalytics(entry) {
    // Fire-and-forget analytics call (don't block on errors)
    fetch(this.config.analyticsEndpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {
      // Silently fail — don't let analytics errors impact the app
    });
  }
}

// Singleton instance
const errorMonitor = new ErrorMonitor();

export default errorMonitor;
export { ErrorMonitor };
