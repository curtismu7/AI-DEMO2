/**
 * OAuth Provider Monitoring Utility
 * Tracks response times, failure rates, and health status
 */

const { logger, LOG_CATEGORIES } = require('./logger');

class OAuthProviderMonitor {
  constructor() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      averageResponseTime: 0,
      lastHealthCheck: null,
      healthStatus: 'unknown',
      errorCounts: {},
      recentErrors: [],
      maxRecentErrors: 50
    };
    
    this.circuitBreaker = {
      isOpen: false,
      failureCount: 0,
      failureThreshold: parseInt(process.env.OAUTH_FAILURE_THRESHOLD) || 5,
      resetTimeout: parseInt(process.env.OAUTH_RESET_TIMEOUT) || 60000, // 1 minute
      lastFailureTime: null
    };
  }

  recordRequest(success, responseTime, errorType = null, metadata = {}) {
    this.metrics.totalRequests++;
    this.metrics.totalResponseTime += responseTime;
    this.metrics.averageResponseTime = this.metrics.totalResponseTime / this.metrics.totalRequests;

    if (success) {
      this.metrics.successfulRequests++;
      this.resetCircuitBreaker();
      
      logger.logTokenIntrospection(true, responseTime, {
        total_requests: this.metrics.totalRequests,
        success_rate: this.getSuccessRate(),
        avg_response_time: Math.round(this.metrics.averageResponseTime),
        ...metadata
      });
    } else {
      this.metrics.failedRequests++;
      this.recordFailure(errorType, responseTime, metadata);
      
      logger.logTokenIntrospection(false, responseTime, {
        error_type: errorType,
        total_requests: this.metrics.totalRequests,
        success_rate: this.getSuccessRate(),
        failure_count: this.circuitBreaker.failureCount,
        circuit_breaker_open: this.circuitBreaker.isOpen,
        ...metadata
      });
    }
  }

  recordFailure(errorType, responseTime, metadata = {}) {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailureTime = Date.now();

    // Track error types
    if (errorType) {
      this.metrics.errorCounts[errorType] = (this.metrics.errorCounts[errorType] || 0) + 1;
    }

    // Store recent errors for analysis
    const errorEntry = {
      timestamp: new Date().toISOString(),
      errorType,
      responseTime,
      metadata
    };
    
    this.metrics.recentErrors.unshift(errorEntry);
    if (this.metrics.recentErrors.length > this.metrics.maxRecentErrors) {
      this.metrics.recentErrors.pop();
    }

    // Check if circuit breaker should open
    if (this.circuitBreaker.failureCount >= this.circuitBreaker.failureThreshold) {
      this.openCircuitBreaker();
    }
  }

  openCircuitBreaker() {
    if (!this.circuitBreaker.isOpen) {
      this.circuitBreaker.isOpen = true;
      
      logger.error(LOG_CATEGORIES.PROVIDER_HEALTH, 'OAuth provider circuit breaker opened', {
        failure_count: this.circuitBreaker.failureCount,
        failure_threshold: this.circuitBreaker.failureThreshold,
        recent_errors: this.metrics.recentErrors.slice(0, 5) // Last 5 errors
      });

      // Schedule circuit breaker reset
      setTimeout(() => {
        this.resetCircuitBreaker();
      }, this.circuitBreaker.resetTimeout);
    }
  }

  resetCircuitBreaker() {
    if (this.circuitBreaker.isOpen || this.circuitBreaker.failureCount > 0) {
      const wasOpen = this.circuitBreaker.isOpen;
      
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failureCount = 0;
      this.circuitBreaker.lastFailureTime = null;

      if (wasOpen) {
        logger.info(LOG_CATEGORIES.PROVIDER_HEALTH, 'OAuth provider circuit breaker reset', {
          success_rate: this.getSuccessRate(),
          avg_response_time: Math.round(this.metrics.averageResponseTime)
        });
      }
    }
  }

  isCircuitBreakerOpen() {
    // Auto-reset if timeout has passed
    if (this.circuitBreaker.isOpen && 
        this.circuitBreaker.lastFailureTime && 
        Date.now() - this.circuitBreaker.lastFailureTime > this.circuitBreaker.resetTimeout) {
      this.resetCircuitBreaker();
    }
    
    return this.circuitBreaker.isOpen;
  }

  getSuccessRate() {
    if (this.metrics.totalRequests === 0) return 0;
    return Math.round((this.metrics.successfulRequests / this.metrics.totalRequests) * 100);
  }

  getHealthStatus() {
    // No data yet — don't report healthy or unhealthy, just unknown
    if (this.metrics.totalRequests === 0) {
      return 'unknown';
    }

    const successRate = this.getSuccessRate();
    const avgResponseTime = this.metrics.averageResponseTime;
    
    if (this.circuitBreaker.isOpen) {
      return 'critical';
    } else if (successRate < 50) {
      return 'unhealthy';
    } else if (successRate < 90 || avgResponseTime > 5000) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.getSuccessRate(),
      healthStatus: this.getHealthStatus(),
      circuitBreaker: {
        isOpen: this.circuitBreaker.isOpen,
        failureCount: this.circuitBreaker.failureCount,
        failureThreshold: this.circuitBreaker.failureThreshold
      }
    };
  }

  logHealthSummary() {
    this.metrics.lastHealthCheck = new Date().toISOString();
    const metrics = this.getMetrics();

    // Skip the periodic log entirely when there has been no OAuth traffic yet.
    // With 0 requests the success rate is 0 which would otherwise fire a
    // noisy ERROR every 5 minutes even on a healthy, idle server.
    if (metrics.totalRequests === 0) {
      return;
    }
    
    logger.logProviderHealth(
      metrics.healthStatus === 'healthy',
      Math.round(metrics.averageResponseTime),
      {
        health_status: metrics.healthStatus,
        total_requests: metrics.totalRequests,
        success_rate: metrics.successRate,
        circuit_breaker_open: metrics.circuitBreaker.isOpen,
        top_errors: this.getTopErrors()
      }
    );
  }

  getTopErrors(limit = 5) {
    return Object.entries(this.metrics.errorCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([errorType, count]) => ({ errorType, count }));
  }

  // Periodic health check and logging
  startPeriodicHealthCheck(intervalMs = 300000) { // 5 minutes default
    this.healthCheckInterval = setInterval(() => {
      this.logHealthSummary();
    }, intervalMs);
  }

  // Stop the periodic health check
  stop() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}

// Create singleton instance
const oauthMonitor = new OAuthProviderMonitor();

module.exports = {
  oauthMonitor,
  OAuthProviderMonitor
};