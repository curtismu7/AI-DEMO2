/**
 * Error tracking and monitoring service
 * Integrates with Sentry for production error reporting
 *
 * @module errorTracking
 */

let Sentry = null;

/**
 * Initialize Sentry error tracking
 * Call this early in app startup (before rendering)
 *
 * @param {Object} options - Sentry configuration
 * @param {string} options.dsn - Sentry DSN (get from Sentry project settings)
 * @param {string} options.environment - Environment name (development, staging, production)
 * @param {number} options.tracesSampleRate - Performance monitoring sample rate (0-1)
 *
 * @example
 * import { initErrorTracking } from './services/errorTracking';
 *
 * if (process.env.REACT_APP_SENTRY_DSN) {
 *   initErrorTracking({
 *     dsn: process.env.REACT_APP_SENTRY_DSN,
 *     environment: process.env.NODE_ENV,
 *     tracesSampleRate: 0.1,
 *   });
 * }
 */
export function initErrorTracking(options = {}) {
  if (!options.dsn) {
    console.warn(
      "[ErrorTracking] Sentry DSN not configured, error tracking disabled",
    );
    return;
  }

  try {
    // Lazy load Sentry only if configured
    // This prevents import errors if Sentry package is not installed
    import("@sentry/react").then((sentryModule) => {
      Sentry = sentryModule;
      Sentry.init({
        dsn: options.dsn,
        environment: options.environment || process.env.NODE_ENV,
        tracesSampleRate: options.tracesSampleRate || 0.1,
        integrations: [
          new Sentry.Replay({
            maskAllText: true, // Mask sensitive data
            blockAllMedia: true, // Don't record media
          }),
        ],
        replaysSessionSampleRate: 0.1, // Record 10% of sessions
        replaysOnErrorSampleRate: 1.0, // Record 100% of error sessions
      });
    });
  } catch (error) {
    console.error("[ErrorTracking] Failed to initialize Sentry:", error);
  }
}

/**
 * Capture an exception and send to Sentry
 * @param {Error} error - Error object
 * @param {Object} context - Additional context data
 */
export function captureException(error, context = {}) {
  if (!Sentry) return;

  try {
    Sentry.captureException(error, {
      contexts: {
        ...context,
        userContext: {
          user_id: getUserId(),
        },
      },
    });
  } catch (err) {
    console.error("[ErrorTracking] Failed to capture exception:", err);
  }
}

/**
 * Capture a message (non-error)
 * @param {string} message - Message to log
 * @param {string} level - Severity level (info, warning, error)
 * @param {Object} context - Additional context data
 */
export function captureMessage(message, level = "info", context = {}) {
  if (!Sentry) return;

  try {
    Sentry.captureMessage(message, level, {
      contexts: context,
    });
  } catch (err) {
    console.error("[ErrorTracking] Failed to capture message:", err);
  }
}

/**
 * Set user context for error tracking
 * @param {Object} user - User object { id, email, name }
 */
export function setUserContext(user) {
  if (!Sentry) return;

  try {
    Sentry.setUser({
      id: user?.id,
      email: user?.email,
      username: user?.name,
    });
  } catch (err) {
    console.error("[ErrorTracking] Failed to set user context:", err);
  }
}

/**
 * Clear user context (on logout)
 */
export function clearUserContext() {
  if (!Sentry) return;
  try {
    Sentry.setUser(null);
  } catch (err) {
    console.error("[ErrorTracking] Failed to clear user context:", err);
  }
}

/**
 * Add breadcrumb (action tracking for debugging)
 * @param {Object} breadcrumb - Breadcrumb data
 * @param {string} breadcrumb.message - Breadcrumb message
 * @param {string} breadcrumb.category - Category (e.g., 'auth', 'api', 'navigation')
 * @param {string} breadcrumb.level - Severity level
 * @param {Object} breadcrumb.data - Additional data
 */
export function addBreadcrumb(breadcrumb) {
  if (!Sentry) return;

  try {
    Sentry.captureMessage(breadcrumb.message, "debug", {
      tags: { category: breadcrumb.category },
    });
  } catch (err) {
    console.error("[ErrorTracking] Failed to add breadcrumb:", err);
  }
}

/**
 * Start a transaction for performance monitoring
 * @param {Object} options - Transaction options
 * @param {string} options.name - Transaction name
 * @param {string} options.op - Operation type (e.g., 'http.request', 'db.query')
 * @returns {Object} Transaction span object
 */
export function startTransaction(options = {}) {
  if (!Sentry) return null;

  try {
    return Sentry.startTransaction({
      name: options.name || "transaction",
      op: options.op || "unknown",
    });
  } catch (err) {
    console.error("[ErrorTracking] Failed to start transaction:", err);
    return null;
  }
}

/**
 * Helper to get current user ID from session/store
 * @returns {string|null} User ID or null
 */
function getUserId() {
  try {
    // Try to get from sessionStorage
    const session = sessionStorage.getItem("user_session");
    if (session) {
      const parsed = JSON.parse(session);
      return parsed.id || null;
    }
  } catch (_) {
    // Ignore errors
  }
  return null;
}

const errorTrackingService = {
  initErrorTracking,
  captureException,
  captureMessage,
  setUserContext,
  clearUserContext,
  addBreadcrumb,
  startTransaction,
};
export default errorTrackingService;
