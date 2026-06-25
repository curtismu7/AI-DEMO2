// banking_api_server/config/tokenExchangeConfig.js
/**
 * Token Exchange Mode Configuration
 * 
 * Supports dual-mode token exchange:
 * 1. RFC 8693 (default) — stable, production-ready
 * 2. Transaction Tokens (draft) — experimental, opt-in via TOKEN_EXCHANGE_MODE
 * 
 * Auto-fallback ensures stability: if primary mode fails, retry with fallback mode.
 */

'use strict';

const VALID_MODES = ['rfc_8693', 'transaction_tokens'];
const DEFAULT_MODE = 'rfc_8693';

/**
 * Token exchange configuration object
 */
const config = {
  // Primary token exchange mode
  mode: process.env.TOKEN_EXCHANGE_MODE || DEFAULT_MODE,
  
  // Enable automatic fallback to alternate mode if primary fails
  autoFallback: process.env.TOKEN_EXCHANGE_AUTO_FALLBACK !== 'false',
  
  // Log when modes switch (useful for debugging)
  logModeSwitches: process.env.TOKEN_EXCHANGE_LOG_MODE_SWITCHES !== 'false',

  /**
   * Validate that a mode string is recognized
   * @param {string} m - mode to validate
   * @returns {boolean}
   */
  isValidMode(m) {
    return VALID_MODES.includes(m);
  },

  /**
   * Get the fallback mode (the other mode)
   * RFC 8693 ↔ Transaction Tokens
   * @returns {string}
   */
  getFallbackMode() {
    return this.mode === 'rfc_8693' ? 'transaction_tokens' : 'rfc_8693';
  },

  /**
   * Log startup configuration (called once on BFF server start)
   */
  logStartup() {
    const modeStr = this.isValidMode(this.mode) ? this.mode : `${this.mode} (INVALID, defaulting to ${DEFAULT_MODE})`;
    const msg = `[TokenExchange] Mode: ${modeStr}, AutoFallback: ${this.autoFallback}`;
    console.log(msg);
  },
};

// Validate mode on load
if (!config.isValidMode(config.mode)) {
  console.warn(`[TokenExchange] Invalid TOKEN_EXCHANGE_MODE: "${config.mode}". Must be one of: ${VALID_MODES.join(', ')}. Defaulting to "${DEFAULT_MODE}".`);
  config.mode = DEFAULT_MODE;
}

module.exports = config;
