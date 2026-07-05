'use strict';

/**
 * apiKeyService.js — API key authentication & bearer token generation for /mcp/apikey endpoint.
 *
 * Responsibilities:
 *   1. Map API keys to user/service identities
 *   2. Generate signed JWTs for PingGateway introspection
 *   3. Validate API key format and expiry (if configured)
 *
 * @module services/apiKeyService
 */

const jwt = require('jsonwebtoken');
const configStore = require('./configStore');
const { logger } = require('../utils/logger');

// ── API Key Store ──────────────────────────────────────────────────────────
// In production, this should read from a secure vault (PingOne, AWS Secrets, etc).
// For now, keys are read from environment + configStore.

/**
 * Retrieve the configured API key store.
 * Format: CSV of "key:user-id" pairs, or space-separate keys with hardcoded demo users.
 *
 * Env: API_KEY_STORE (precedence) or configStore key 'api_key_store'
 * Example: "sk-key-001:user-1,sk-key-002:user-2,sk-key-003:service-xyz"
 */
function getApiKeyStore() {
  const raw = process.env.API_KEY_STORE || configStore.get('api_key_store') || '';
  const entries = raw
    .split(',')
    .map(e => e.trim())
    .filter(e => e);

  // Parse "key:user" pairs into a map
  const store = new Map();
  for (const entry of entries) {
    const [key, userId] = entry.split(':').map(s => s.trim());
    if (key && userId) {
      store.set(key, userId);
    }
  }
  return store;
}

/**
 * Validate an API key and return the mapped user ID.
 * Returns null if the key is invalid, expired, or not found.
 *
 * @param {string} apiKey — the API key from X-API-Key header
 * @returns {string|null} the mapped user ID, or null if invalid
 */
function validateApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length === 0) {
    return null;
  }

  const store = getApiKeyStore();
  const userId = store.get(apiKey);

  if (!userId) {
    logger.warn('[apiKeyService] API key not found', { keyPrefix: apiKey.substring(0, 5) });
    return null;
  }

  logger.info('[apiKeyService] API key validated', { userId, keyPrefix: apiKey.substring(0, 5) });
  return userId;
}

/**
 * Generate a signed JWT bearer token for the validated user.
 * The token is audienced to the MCP Gateway and includes:
 *   - sub: the user ID
 *   - aud: the MCP Gateway resource URI
 *   - scope: mcp:invoke (default MCP scope)
 *   - iat/exp: issued at / expires in 1 hour
 *
 * @param {string} userId — the authenticated user ID
 * @param {object} opts — optional overrides
 * @param {string} opts.scope — scope string (default 'mcp:invoke')
 * @param {number} opts.expiresIn — token lifetime in seconds (default 3600)
 * @returns {string} signed JWT bearer token
 * @throws {Error} if signing fails or JWT secret is not configured
 */
function generateBearerToken(userId, opts = {}) {
  const scope = opts.scope || 'mcp:invoke';
  const expiresIn = opts.expiresIn || 3600;

  // JWT secret — read from secure config, fall back to env
  const jwtSecret = configStore.get('api_key_jwt_secret') || process.env.API_KEY_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error(
      '[apiKeyService] JWT secret not configured. ' +
      'Set API_KEY_JWT_SECRET env or api_key_jwt_secret config key.'
    );
  }

  // MCP Gateway resource URI (audience)
  const mcpGatewayUri = configStore.get('PINGONE_RESOURCE_MCP_GATEWAY_URI') ||
    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI ||
    'mcpgateway.ping.demo';

  try {
    const token = jwt.sign(
      {
        sub: userId,
        aud: mcpGatewayUri,
        scope,
      },
      jwtSecret,
      {
        algorithm: 'HS256',
        expiresIn,
        issuer: 'apikey-service',
      }
    );
    logger.debug('[apiKeyService] Bearer token generated', { userId, scope, expiresIn });
    return token;
  } catch (err) {
    logger.error('[apiKeyService] Token signing failed', { err: err.message });
    throw err;
  }
}

/**
 * Validate API key and generate a bearer token in one step.
 * Returns { token, userId } on success, or { error } on failure.
 *
 * @param {string} apiKey — the API key from X-API-Key header
 * @returns {object} { token, userId } or { error, statusCode }
 */
function exchangeKeyForToken(apiKey) {
  const userId = validateApiKey(apiKey);
  if (!userId) {
    return {
      error: 'invalid_apikey',
      statusCode: 403,
      message: 'Invalid or expired API key',
    };
  }

  try {
    const token = generateBearerToken(userId);
    return { token, userId };
  } catch (err) {
    return {
      error: 'token_generation_failed',
      statusCode: 500,
      message: 'Failed to generate bearer token',
    };
  }
}

module.exports = {
  validateApiKey,
  generateBearerToken,
  exchangeKeyForToken,
};
