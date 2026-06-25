/**
 * Token Validation Mode Configuration
 *
 * Supports two token validation strategies:
 *
 * 1. introspection — Call PingOne introspection endpoint (RFC 7662) for real-time
 *    token validation. Detects revoked tokens. Adds ~50ms latency (mitigated by caching).
 *    Best for: user-facing APIs, high-security operations, compliance requirements.
 *
 * 2. jwt — Validate JWT signature locally (RS256 with PingOne public key).
 *    Fast (~1ms), no network call needed, works offline.
 *    Limitation: Cannot detect revoked tokens (remains valid until expiry).
 *    Best for: Internal APIs, fallback mode, high-throughput scenarios.
 *
 * The system defaults to introspection (most secure) and falls back to jwt
 * if introspection is unavailable.
 *
 * References:
 * - RFC 7662: OAuth 2.0 Token Introspection
 * - docs/INTROSPECTION_VALIDATION_GUIDE.md
 */

'use strict';

/**
 * Available validation mode identifiers
 */
const VALIDATION_MODES = {
  INTROSPECTION: 'introspection',
  JWT: 'jwt',
};

/**
 * All supported modes as an array (used for validation)
 */
const SUPPORTED_MODES = Object.values(VALIDATION_MODES);

/**
 * Default mode: introspection (RFC 7662, most secure)
 * Override via VALIDATION_MODE environment variable
 */
const DEFAULT_MODE = VALIDATION_MODES.INTROSPECTION;

// Current validation mode — seeded from env var, can be changed at runtime
let currentMode = (() => {
  const envMode = process.env.VALIDATION_MODE;
  if (envMode && SUPPORTED_MODES.includes(envMode)) {
    return envMode;
  }
  if (envMode) {
    console.warn(
      `[validationModeConfig] Unknown VALIDATION_MODE env var: "${envMode}". ` +
        `Using default: "${DEFAULT_MODE}". Supported: ${SUPPORTED_MODES.join(', ')}`
    );
  }
  return DEFAULT_MODE;
})();

/**
 * Check if a given mode identifier is supported
 * @param {string} mode
 * @returns {boolean}
 */
function isValidMode(mode) {
  return SUPPORTED_MODES.includes(mode);
}

/**
 * Get the current validation mode
 * @returns {'introspection' | 'jwt'} Current mode
 */
function getValidationMode() {
  return currentMode;
}

/**
 * Set the validation mode at runtime
 * Changes take effect immediately for subsequent requests.
 * Note: In-memory only — does not persist to .env or database.
 *
 * @param {'introspection' | 'jwt'} mode - New mode to set
 * @throws {Error} If mode is not supported
 */
function setValidationMode(mode) {
  if (!isValidMode(mode)) {
    throw new Error(
      `Invalid validation mode: "${mode}". ` +
        `Supported modes: ${SUPPORTED_MODES.join(', ')}`
    );
  }
  const previous = currentMode;
  currentMode = mode;
  console.log(
    `[validationModeConfig] Validation mode changed: ${previous} → ${mode}`
  );
}

/**
 * Reset validation mode to default (introspection)
 * Used in tests and when clearing configuration.
 */
function resetValidationMode() {
  currentMode = DEFAULT_MODE;
}

/**
 * Get a human-readable description of a validation mode
 * @param {'introspection' | 'jwt'} [mode] - Mode to describe (defaults to current mode)
 * @returns {string} Description suitable for display in UI or logs
 */
function getModeDescription(mode) {
  const target = mode || currentMode;
  switch (target) {
    case VALIDATION_MODES.INTROSPECTION:
      return 'Introspection (Real-time, RFC 7662) — Validates via PingOne endpoint, detects revoked tokens, ~50ms with caching';
    case VALIDATION_MODES.JWT:
      return 'JWT Local Validation (Fast, Offline) — Validates signature only, cannot detect revocation, ~1ms';
    default:
      return `Unknown mode: ${target}`;
  }
}

/**
 * Get metadata for a validation mode (for UI display)
 * @param {'introspection' | 'jwt'} [mode] - Mode (defaults to current)
 * @returns {{mode: string, name: string, description: string, pros: string[], cons: string[]}}
 */
function getModeMetadata(mode) {
  const target = mode || currentMode;
  const metadata = {
    introspection: {
      mode: 'introspection',
      name: 'Introspection (Recommended)',
      description: 'Calls PingOne introspection endpoint (RFC 7662) to validate tokens in real-time.',
      pros: [
        'Detects revoked or suspended tokens immediately',
        'Real-time authorization (scope/attribute changes take effect immediately)',
        'Compliant with OAuth 2.0 RFC 7662 standard',
        'Cache-optimized: ~50ms with 30s TTL cache',
      ],
      cons: [
        'Requires network access to PingOne',
        'Adds ~50ms latency (mitigated by caching)',
        'Falls back to JWT if PingOne unavailable',
      ],
    },
    jwt: {
      mode: 'jwt',
      name: 'JWT Local Validation',
      description: 'Validates token signature locally using PingOne public key (RS256).',
      pros: [
        'Very fast (~1ms, no network call)',
        'Works offline or when PingOne is unavailable',
        'Ideal for high-throughput internal APIs',
      ],
      cons: [
        'Cannot detect revoked tokens',
        'Changes to user scope/attributes take ~1 hour to take effect (until expiry)',
        'Not recommended for high-security operations (money transfer, PII access)',
      ],
    },
  };

  return metadata[target] || { mode: target, name: target, description: getModeDescription(target), pros: [], cons: [] };
}

module.exports = {
  VALIDATION_MODES,
  SUPPORTED_MODES,
  DEFAULT_MODE,
  getValidationMode,
  setValidationMode,
  resetValidationMode,
  isValidMode,
  getModeDescription,
  getModeMetadata,
};
