/**
 * appConfig.js
 * Centralized configuration constants extracted from hardcoded values.
 * Update here to change thresholds, timeouts, and retry behavior across the app.
 */

export const APP_CONFIG = {
  // ══════════════════════════════════════════════════════════════════════════
  // Session & Timing
  // ══════════════════════════════════════════════════════════════════════════

  // Session expiry warning threshold (5 minutes before expiry)
  SESSION_EXPIRY_WARNING_MS: 5 * 60 * 1000,

  // Interval to check session health
  SESSION_CHECK_INTERVAL_MS: 1000,

  // Session rehydration cold-start retry delays (after OAuth redirect)
  SESSION_REHYDRATION_RETRY_DELAYS_MS: [0, 600, 1400, 2500],

  // ══════════════════════════════════════════════════════════════════════════
  // API Retry & Timeout
  // ══════════════════════════════════════════════════════════════════════════

  // Maximum number of retries for transient API failures
  API_MAX_RETRIES: 3,

  // Base delay for exponential backoff (ms)
  API_RETRY_BASE_DELAY_MS: 200,

  // Maximum delay for exponential backoff (ms)
  API_RETRY_MAX_DELAY_MS: 10000,

  // Request timeout (30 seconds)
  API_TIMEOUT_MS: 30000,

  // ══════════════════════════════════════════════════════════════════════════
  // Toast Notifications
  // ══════════════════════════════════════════════════════════════════════════

  TOAST_DURATION_MS: {
    SUCCESS_ACTION: 4000,
    ERROR_SHORT: 3000,
    ERROR_LONG: 6000,
    INFO_TOKEN: 5000,
    TOOLS_LOADED: 3000,
    WARNING: 4000,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Transaction Thresholds (USD)
  // ══════════════════════════════════════════════════════════════════════════

  THRESHOLDS: {
    // Amount above which Human-in-the-Loop approval is required
    HITL_DEFAULT: 500,

    // Amount above which Step-up MFA is required
    MFA_DEFAULT: 500,

    // Demo scenario large transfer amount
    DEMO_LARGE_TRANSFER: 99999.99,

    // Demo HITL consent test ($600 for testing consent + MFA flow)
    DEMO_HITL_TRANSFER: 600,

    // Minimum transaction amount (1 cent)
    MIN_TRANSACTION: 0.01,

    // Maximum transaction amount (1 million)
    MAX_TRANSACTION: 1_000_000,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Compliance & Security
  // ══════════════════════════════════════════════════════════════════════════

  // Total steps in compliance flow
  COMPLIANCE_STEP_COUNT: 12,

  // Timeout waiting for step-up MFA completion
  STEP_UP_TIMEOUT_MS: 30000,

  // ══════════════════════════════════════════════════════════════════════════
  // Storage & Limits
  // ══════════════════════════════════════════════════════════════════════════

  STORAGE_KEYS: {
    PENDING_NL: 'bx_agent_pending_nl',
    PENDING_ACTION: '_agent_pending_auth_action',
    COMPLIANCE_MODAL: 'compliance_modal_popout',
  },

  // Maximum response size (prevent DoS)
  RESPONSE_LIMITS: {
    MAX_BODY_LENGTH: 5 * 1024 * 1024, // 5MB
    MAX_ACCOUNTS: 100,
    MAX_TRANSACTIONS: 500,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // UI & Display
  // ══════════════════════════════════════════════════════════════════════════

  // Maximum length for UI text fields
  TEXT_LENGTH_LIMITS: {
    DESCRIPTION: 500,
    ACCOUNT_NAME: 100,
    ACCOUNT_NUMBER: 20,
  },

  // Debounce/throttle delays
  DEBOUNCE_MS: {
    SEARCH: 300,
    INPUT: 200,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Feature Flags (runtime overrideable)
  // ══════════════════════════════════════════════════════════════════════════

  // Enable verbose debug logging
  DEBUG_MODE: false,

  // Enable strict validation (fail on malformed data vs fallback)
  STRICT_VALIDATION: false,
};

export default APP_CONFIG;
