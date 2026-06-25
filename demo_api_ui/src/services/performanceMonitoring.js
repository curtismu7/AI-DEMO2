/**
 * Performance monitoring service
 * Tracks Core Web Vitals and reports to analytics
 *
 * Google Core Web Vitals:
 * - LCP (Largest Contentful Paint) — ~2.5s (how quickly page content loads)
 * - FID (First Input Delay) — ~100ms (responsiveness to user input)
 * - CLS (Cumulative Layout Shift) — ~0.1 (visual stability)
 *
 * @module performanceMonitoring
 */

/**
 * Initialize Web Vitals monitoring
 * Reports metrics when page becomes hidden or unloads
 *
 * @param {Function} onMetric - Callback function for each metric
 *
 * @example
 * import { initWebVitals } from './services/performanceMonitoring';
 *
 * initWebVitals((metric) => {
 *   console.log(metric.name, metric.value);
 *   // Send to analytics service
 *   analyticsService.trackMetric(metric);
 * });
 */
export function initWebVitals(onMetric) {
  if ("web-vitals" in window) {
    return; // Already initialized
  }

  // Lazy load web-vitals package
  import("web-vitals")
    .then((module) => {
      const { getCLS, getFID, getFCP, getLCP, getTTFB } = module;

      // Cumulative Layout Shift
      getCLS((metric) => {
        reportMetric("CLS", metric, onMetric);
      });

      // First Input Delay
      getFID((metric) => {
        reportMetric("FID", metric, onMetric);
      });

      // First Contentful Paint
      getFCP((metric) => {
        reportMetric("FCP", metric, onMetric);
      });

      // Largest Contentful Paint
      getLCP((metric) => {
        reportMetric("LCP", metric, onMetric);
      });

      // Time to First Byte
      getTTFB((metric) => {
        reportMetric("TTFB", metric, onMetric);
      });

      // Custom navigation timing
      reportNavigationTiming(onMetric);
    })
    .catch((err) => {
      console.warn("[PerformanceMonitoring] Failed to load web-vitals:", err);
    });
}

/**
 * Report a metric to the callback
 * @private
 */
function reportMetric(name, metric, onMetric) {
  const data = {
    name,
    value: metric.value,
    rating: metric.rating, // 'good', 'needs-improvement', 'poor'
    delta: metric.delta,
    id: metric.id,
    timestamp: metric.startTime + metric.duration,
  };

  if (onMetric) {
    try {
      onMetric(data);
    } catch (err) {
      console.error("[PerformanceMonitoring] Error in metric callback:", err);
    }
  }

  // Log in development
  if (process.env.NODE_ENV === "development") {
    console.debug(`[Metrics] ${name}:`, {
      value: data.value.toFixed(2),
      rating: data.rating,
    });
  }
}

/**
 * Report custom navigation timing metrics
 * @private
 */
function reportNavigationTiming(onMetric) {
  if (!window.performance || !window.performance.timing) {
    return;
  }

  const timing = window.performance.timing;
  const navigation = window.performance.navigation;

  // Wait for page load
  window.addEventListener("load", () => {
    setTimeout(() => {
      const metrics = {
        "DOM Content Loaded":
          timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
        "Page Load Time": timing.loadEventEnd - timing.navigationStart,
        "Time to First Interactive":
          timing.domInteractive - timing.navigationStart,
        "Time to DOM Content Loaded":
          timing.domContentLoadedEventEnd - timing.navigationStart,
        "Navigation Type": navigation.type === 0 ? "navigate" : "reload",
      };

      Object.entries(metrics).forEach(([name, value]) => {
        if (onMetric && value > 0) {
          onMetric({
            name: `Custom: ${name}`,
            value: Math.round(value),
            rating: getPerformanceRating(name, value),
          });
        }
      });
    }, 0);
  });
}

/**
 * Get performance rating based on metric name and value
 * @private
 */
function getPerformanceRating(name, value) {
  const thresholds = {
    "DOM Content Loaded": { good: 1000, poor: 3000 },
    "Page Load Time": { good: 2500, poor: 4000 },
    "Time to First Interactive": { good: 3000, poor: 5000 },
    "Time to DOM Content Loaded": { good: 1500, poor: 3500 },
  };

  const threshold = thresholds[name];
  if (!threshold) return "unknown";

  if (value <= threshold.good) return "good";
  if (value <= threshold.poor) return "needs-improvement";
  return "poor";
}

/**
 * Get current performance metrics
 * Useful for manual performance checks
 *
 * @returns {Object} Current performance metrics
 */
export function getPerformanceMetrics() {
  if (!window.performance) return null;

  const metrics = {
    memoryUsage: null,
    navigationTiming: null,
    resourceTiming: null,
  };

  // Memory usage (Chrome only)
  if (performance.memory) {
    metrics.memoryUsage = {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      heapUsagePercent:
        (performance.memory.usedJSHeapSize /
          performance.memory.jsHeapSizeLimit) *
        100,
    };
  }

  // Navigation timing
  if (performance.timing) {
    const t = performance.timing;
    metrics.navigationTiming = {
      dnsLookup: t.domainLookupEnd - t.domainLookupStart,
      tcpConnection: t.connectEnd - t.connectStart,
      serverResponse: t.responseEnd - t.requestStart,
      domProcessing: t.domComplete - t.domLoading,
      pageLoad: t.loadEventEnd - t.navigationStart,
    };
  }

  // Resource timing (top 10 slowest)
  if (performance.getEntriesByType) {
    metrics.resourceTiming = performance
      .getEntriesByType("resource")
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map((entry) => ({
        name: entry.name.split("/").pop(),
        duration: Math.round(entry.duration),
        size: entry.transferSize || 0,
      }));
  }

  return metrics;
}

/**
 * Send metrics to analytics service
 * @param {Function} sendMetric - Analytics send function
 * @param {string} serviceName - Name of analytics service (for logging)
 */
export function connectToAnalytics(sendMetric, serviceName = "Analytics") {
  initWebVitals((metric) => {
    try {
      sendMetric({
        event: "performance_metric",
        metric_name: metric.name,
        metric_value: metric.value,
        metric_rating: metric.rating,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error(`[${serviceName}] Failed to send metric:`, err);
    }
  });
}

const performanceMonitoringService = {
  initWebVitals,
  getPerformanceMetrics,
  connectToAnalytics,
};
export default performanceMonitoringService;
