/**
 * bankingRestartNotificationService.js
 * 
 * Centralized service for detecting server restarts (504s, timeouts) and triggering restart notifications.
 * 
 * When the BFF returns 504 or connection times out:
 * - Shows a modal with "Server is restarting" message
 * - Auto-retries with exponential backoff (1s, 2s, 4s, max 30s)
 * - Auto-dismisses when server comes back online
 * 
 * Usage:
 *   - In App.js: call monitorApiHealth() once on app mount
 *   - In components: use useRestartModal() hook to get modal state and controls
 *   - From API handlers: errors automatically trigger via fetch wrapper
 */

import { useState, useEffect } from 'react';

let globalRestartState = {
  isVisible: false,
  attemptCount: 0,
  maxAttempts: 30,
  baseDelay: 1000, // 1s
  maxDelay: 30000, // 30s
  currentDelay: 1000,
  retryTimeoutId: null,
  isRetrying: false,
};

let contextSubscribers = [];

/**
 * Notify all subscribers (components using the hook) of state changes
 */
function notifySubscribers() {
  contextSubscribers.forEach((callback) => callback({ ...globalRestartState }));
}

/**
 * Subscribe to state changes (used by hook)
 */
function subscribe(callback) {
  contextSubscribers.push(callback);
  return () => {
    contextSubscribers = contextSubscribers.filter((cb) => cb !== callback);
  };
}

/**
 * Show restart modal
 */
export function showRestartModal() {
  if (!globalRestartState.isVisible) {
    globalRestartState.isVisible = true;
    notifySubscribers();
  }
}

/**
 * Hide restart modal
 */
export function hideRestartModal() {
  if (globalRestartState.isVisible) {
    globalRestartState.isVisible = false;
    globalRestartState.attemptCount = 0;
    globalRestartState.currentDelay = globalRestartState.baseDelay;
    globalRestartState.isRetrying = false;
    if (globalRestartState.retryTimeoutId) {
      clearTimeout(globalRestartState.retryTimeoutId);
      globalRestartState.retryTimeoutId = null;
    }
    notifySubscribers();
  }
}

/**
 * Increment attempt counter
 */
function incrementAttempt() {
  globalRestartState.attemptCount += 1;
  notifySubscribers();
}

/**
 * Calculate next delay with exponential backoff
 */
function getNextDelay() {
  const nextDelay = Math.min(
    globalRestartState.currentDelay * 2,
    globalRestartState.maxDelay
  );
  globalRestartState.currentDelay = nextDelay;
  return nextDelay;
}

/**
 * Check server health by calling a lightweight endpoint
 */
export async function checkServerHealth(timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('/api/health', {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    clearTimeout(timeoutId);

    // Any response (200, 500, etc.) means server is reachable
    return response.ok || response.status >= 400;
  } catch (error) {
    clearTimeout(timeoutId);
    // Timeout or network error means server is unreachable
    console.warn('[RestartNotification] Health check failed:', error.message);
    return false;
  }
}

/**
 * Retry health check with exponential backoff
 */
async function retryHealthCheck() {
  if (globalRestartState.attemptCount >= globalRestartState.maxAttempts) {
    console.warn('[RestartNotification] Max retries reached');
    // Keep modal visible, stop retrying
    globalRestartState.isRetrying = false;
    return false;
  }

  incrementAttempt();
  const isHealthy = await checkServerHealth();

  if (isHealthy) {
    hideRestartModal();
    return true;
  }

  // Schedule next retry
  const nextDelay = getNextDelay();

  globalRestartState.retryTimeoutId = setTimeout(retryHealthCheck, nextDelay);
  return false;
}

/**
 * Handle 504 or timeout error — trigger restart notification
 */
export function handle504Error(error) {
  console.warn('[RestartNotification] 504 or timeout detected:', error?.message);
  showRestartModal();

  if (!globalRestartState.isRetrying) {
    globalRestartState.isRetrying = true;
    // Clear any existing timeout
    if (globalRestartState.retryTimeoutId) {
      clearTimeout(globalRestartState.retryTimeoutId);
    }
    // Start retrying immediately
    retryHealthCheck();
  }
}

/**
 * Manual retry triggered by user clicking "Retry Now" button
 */
export async function manualRetry() {
  // Clear pending timeout and retry immediately
  if (globalRestartState.retryTimeoutId) {
    clearTimeout(globalRestartState.retryTimeoutId);
  }
  globalRestartState.retryTimeoutId = null;
  globalRestartState.isRetrying = true;
  notifySubscribers();
  return await retryHealthCheck();
}

/**
 * Wrap global fetch to intercept 504s and timeouts
 */
const originalFetch = window.fetch;
window.fetch = function (...args) {
  const timeoutMs = 5000; // 5s timeout for API calls
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const fetchPromise = originalFetch.apply(this, args);

  return fetchPromise
    .then(async (response) => {
      clearTimeout(timeoutId);

      if (response.status === 504) {
        console.warn('[RestartNotification] 504 Server Unavailable');
        handle504Error(new Error('504 Server Unavailable'));
      } else if (globalRestartState.isVisible) {
        // Any non-504 response means the server is reachable — dismiss immediately
        hideRestartModal();
      }

      return response;
    })
    .catch((error) => {
      clearTimeout(timeoutId);

      // Check for timeout (AbortError) or connection errors
      if (
        error.name === 'AbortError' ||
        error.message === 'Failed to fetch' ||
        error.message.includes('ERR_CONNECTION')
      ) {
        console.warn('[RestartNotification] Connection timeout or network error');
        handle504Error(error);
      }

      throw error;
    });
};

/**
 * React hook to use restart modal state in components
 */
export function useRestartModal() {
  const [state, setState] = useState({ ...globalRestartState });

  useEffect(() => {
    const unsubscribe = subscribe((newState) => {
      setState(newState);
    });

    // Set initial state
    setState({ ...globalRestartState });

    return unsubscribe;
  }, []);

  return {
    isVisible: state.isVisible,
    attemptCount: state.attemptCount,
    maxAttempts: state.maxAttempts,
    retryNow: manualRetry,
    closeModal: hideRestartModal,
  };
}

/**
 * Initialize API health monitoring
 * Call once in App.js on mount
 */
export function monitorApiHealth() {
  // Fetch wrapper is already in place; nothing else needed
}

/**
 * Export for testing purposes
 */
export const __internal__ = {
  getGlobalState: () => globalRestartState,
  resetState: () => {
    globalRestartState = {
      isVisible: false,
      attemptCount: 0,
      maxAttempts: 30,
      baseDelay: 1000,
      maxDelay: 30000,
      currentDelay: 1000,
      retryTimeoutId: null,
      isRetrying: false,
    };
    contextSubscribers = [];
    notifySubscribers();
  },
};

const bankingRestartNotificationService = {
  useRestartModal,
  monitorApiHealth,
  checkServerHealth,
  handle504Error,
  manualRetry,
};

export default bankingRestartNotificationService;
