/**
 * configHostnameService — manages runtime hostname configuration
 *
 * Provides centralized access to the configured hostname (URL where the BFF is exposed).
 * Used by OAuth redirect URIs and other components that need the BFF's public URL.
 *
 * Storage:
 * - In-memory cache: immediate access, survives short restarts
 * - configStore persistence: survives BFF reboots, shared across instances on Vercel
 *
 * Exports:
 *   getConfiguredHostname()         → returns current hostname string
 *   setConfiguredHostname(hostname) → async validates and stores new hostname
 *   InvalidHostnameError            → error class for validation failures
 */

'use strict';

const configStore = require('./configStore');
const { logger } = require('../utils/logger');

// In-memory cache — holds the authoritative hostname value
let _hostnameCache = null;
const CONFIG_KEY = 'CONFIGURED_HOSTNAME';
const DEFAULT_HOSTNAME = process.env.PUBLIC_APP_URL || 'https://api.ping.demo:3001';

// Regex for hostname validation: https?://host(:port)?
// Allows:
// - https:// or http://
// - domain: alphanumeric, dots, hyphens
// - optional port: 1-5 digits
// Examples: https://api.ping.demo:4000, http://localhost:3000, https://staging.app.com
const HOSTNAME_REGEX = /^https?:\/\/[a-zA-Z0-9.-]+(:\d{1,5})?$/;

/**
 * Custom error for hostname validation failures
 */
class InvalidHostnameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidHostnameError';
  }
}

/**
 * Validates hostname format
 * Rules:
 * - Must include protocol: https:// or http://
 * - Must include host (domain or localhost)
 * - May include port (e.g., :4000, :3000)
 * - Port must be 1-65535
 *
 * @param {string} hostname
 * @throws {InvalidHostnameError}
 */
function validateHostname(hostname) {
  if (typeof hostname !== 'string' || !hostname.trim()) {
    throw new InvalidHostnameError('Hostname must be a non-empty string');
  }

  if (!HOSTNAME_REGEX.test(hostname)) {
    throw new InvalidHostnameError(
      `Invalid hostname format: "${hostname}". Expected format: https://domain.com or https://localhost:4000`
    );
  }

  // Extract and validate port if present
  const portMatch = hostname.match(/:(\d+)$/);
  if (portMatch) {
    const port = parseInt(portMatch[1], 10);
    if (port < 1 || port > 65535) {
      throw new InvalidHostnameError(`Port must be between 1 and 65535, got ${port}`);
    }
  }
}

/**
 * Gets the currently configured hostname
 * Falls back to DEFAULT_HOSTNAME if not yet configured
 *
 * @returns {string} hostname
 */
function getConfiguredHostname() {
  // Return in-memory cache if available
  if (_hostnameCache !== null) {
    return _hostnameCache;
  }

  // Try to load from configStore
  try {
    const stored = configStore.get(CONFIG_KEY);
    if (stored) {
      _hostnameCache = stored;
      return _hostnameCache;
    }
  } catch (error) {
    logger.error('hostname_config', 'Failed to read hostname from configStore', {
      error: error.message,
    });
  }

  // Fall back to default — do NOT cache the fallback so config changes and
  // test env-var overrides are not permanently blocked by an early call.
  return DEFAULT_HOSTNAME;
}

/**
 * Sets the hostname configuration
 * Validates format, updates in-memory cache, and persists to configStore
 *
 * @param {string} hostname
 * @throws {InvalidHostnameError} if validation fails
 * @returns {Promise<void>}
 */
async function setConfiguredHostname(hostname) {
  // Validate first
  validateHostname(hostname);

  const previousHostname = _hostnameCache || getConfiguredHostname();

  // Update in-memory cache
  _hostnameCache = hostname;

  // Persist to configStore
  try {
    await configStore.setConfig({
      [CONFIG_KEY]: hostname,
    });
    logger.info('hostname_config', `Hostname configuration updated: ${previousHostname} → ${hostname}`, {
      previous: previousHostname,
      new: hostname,
    });
  } catch (error) {
    // Revert cache on persistence failure
    _hostnameCache = previousHostname;
    logger.error('hostname_config', 'Failed to persist hostname to configStore', {
      error: error.message,
      hostname,
    });
    throw new Error('Failed to persist hostname configuration');
  }
}

/**
 * Returns the hostname ONLY if it was explicitly stored in configStore or set
 * via setConfiguredHostname(). Returns null if only the DEFAULT_HOSTNAME env-var
 * fallback would be used (so callers can skip this layer and apply their own
 * resolution priority).
 *
 * @returns {string|null}
 */
function getExplicitlyConfiguredHostnameOrNull() {
  if (_hostnameCache !== null) return _hostnameCache;
  try {
    const stored = configStore.get(CONFIG_KEY);
    if (stored) {
      _hostnameCache = stored;
      return stored;
    }
  } catch (error) {
    // ignore
  }
  return null;
}

module.exports = {
  getConfiguredHostname,
  getExplicitlyConfiguredHostnameOrNull,
  setConfiguredHostname,
  InvalidHostnameError,
};
