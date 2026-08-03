'use strict';

/**
 * Shared resolver for BFF_INTERNAL_SECRET, the shared secret guarding the
 * internal-only endpoints (/internal/vault/service-key, /internal/id-token,
 * the MCP flag + audit-ingest routes).
 *
 * Why this exists: six routes each did
 *
 *   const INTERNAL_SECRET = process.env.BFF_INTERNAL_SECRET || DEFAULT;
 *   const INTERNAL_SECRET_BUF = Buffer.from(INTERNAL_SECRET);
 *
 * at module scope. Routes are required from server.js long before the vault is
 * opened (mounts start at server.js:302, loadVaultIntoConfigStore runs ~2500),
 * so a vault-supplied BFF_INTERNAL_SECRET could never be seen — every one of
 * them silently kept the committed public default. Resolving lazily, per call,
 * is what lets the vault actually supply this secret.
 *
 * Comparison stays constant-time: a short-circuit equality leaks per-byte timing
 * to anyone who can reach the bound interface.
 */

const crypto = require('node:crypto');

// Must match demo_mcp_gateway/src/config.ts DEFAULT_BFF_INTERNAL_SECRET.
const DEFAULT_INTERNAL_SECRET = 'dev-shared-secret-change-me';

/** Current secret, resolved at call time (never cached — the vault sets it late). */
function internalSecret() {
  return process.env.BFF_INTERNAL_SECRET || DEFAULT_INTERNAL_SECRET;
}

/** True when nothing has overridden the committed, publicly-known default. */
function isDefaultInternalSecret() {
  return internalSecret() === DEFAULT_INTERNAL_SECRET;
}

/**
 * Constant-time compare of a presented x-internal-gateway-secret header.
 * @param {unknown} presented
 * @returns {boolean}
 */
function internalSecretMatches(presented) {
  const expected = Buffer.from(internalSecret());
  const buf = typeof presented === 'string' ? Buffer.from(presented) : null;
  return (
    !!buf &&
    buf.length === expected.length &&
    crypto.timingSafeEqual(buf, expected)
  );
}

module.exports = {
  DEFAULT_INTERNAL_SECRET,
  internalSecret,
  isDefaultInternalSecret,
  internalSecretMatches,
};
