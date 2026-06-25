/**
 * Token Introspection Service
 * Validates tokens by calling PingOne's RFC 7662 introspection endpoint.
 * Required for Phase 91: External MCP client access
 * 
 * Purpose: External clients use this endpoint to validate their Bearer tokens
 * and extract authorized scopes before calling MCP tools.
 */

'use strict';

const crypto = require('crypto');
const axios = require('axios');
const configStore = require('./configStore');
const oauthEndpointResolver = require('./oauthEndpointResolver');
const { logger, LOG_CATEGORIES } = require('../utils/logger');
const { logEvent: logAppEvent, EVENT_CATEGORIES } = require('./appEventService');

// In-memory token introspection cache
const introspectionCache = new Map();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds
// Periodic cache eviction — prevent unbounded Map growth (fix: Review.md #19)
// Runs every 60s; removes entries whose TTL has expired
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of introspectionCache) {
    if (now >= entry.expiresAt) {
      introspectionCache.delete(key);
    }
  }
}, 60 * 1000).unref(); // .unref() prevents this timer from blocking process exit


/**
 * Hash a token for cache key (never store raw token)
 * @param {string} token
 * @returns {string} SHA256 hash
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Decode a JWT access token's issuing client from the client_id (or azp) claim,
 * without signature verification. Returns null for opaque (non-JWT) tokens.
 * Handles both base64url (real PingOne tokens) and standard base64.
 * @param {string} token
 * @returns {string|null}
 */
function extractTokenClientId(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return payload.client_id || payload.azp || null;
  } catch (_e) {
    return null;
  }
}

/**
 * Pick introspection credentials for a token based on the client that issued it.
 * PingOne enforces a same-client rule on RFC 7662 — a client can only introspect
 * tokens it issued — so a token is introspected with ITS issuer's credentials.
 *
 * Resolution (the Worker is deliberately NOT in this chain — introspecting a user
 * token as the Worker returns active:false and triggers a false reauth loop):
 *   1. the token's issuing client, matched by client_id (CLIENT_SECRET_POST)
 *   2. PINGONE_INTROSPECTION_CLIENT_* — a dedicated introspection client, ops
 *      (defaults to CLIENT_SECRET_BASIC; override with PINGONE_INTROSPECTION_AUTH_METHOD)
 *   3. Demo User App (PINGONE_USER_CLIENT_*) — default issuer of the pre-flighted tokens
 * When none is configured, returns undefined creds so validateToken skips the call.
 *
 * @param {string} token
 * @returns {{clientId: string|undefined, clientSecret: string|undefined, authMethod: string}}
 */
function selectIntrospectionCredentials(token) {
  const tokenClientId = extractTokenClientId(token);
  if (tokenClientId) {
    // Known confidential clients, each able to introspect its own tokens.
    // Provision-script aliases are accepted as secondary names.
    const matrix = [
      { id: process.env.PINGONE_USER_CLIENT_ID, secret: process.env.PINGONE_USER_CLIENT_SECRET },
      { id: process.env.PINGONE_ADMIN_CLIENT_ID, secret: process.env.PINGONE_ADMIN_CLIENT_SECRET },
      {
        id: process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID || process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID,
        secret: process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET || process.env.PINGONE_MCP_EXCHANGER_CLIENT_SECRET,
      },
      { id: process.env.MCP_GW_CLIENT_ID, secret: process.env.MCP_GW_CLIENT_SECRET },
      {
        id: process.env.PINGONE_AGENT_CLIENT_ID || process.env.AGENT_CLIENT_ID,
        secret: process.env.PINGONE_AGENT_CLIENT_SECRET || process.env.AGENT_CLIENT_SECRET,
      },
      { id: process.env.PINGONE_AI_AGENT_CLIENT_ID, secret: process.env.PINGONE_AI_AGENT_CLIENT_SECRET },
    ];
    const match = matrix.find((c) => c.id && c.id === tokenClientId && c.secret);
    if (match) return { clientId: match.id, clientSecret: match.secret, authMethod: 'post' };
  }
  // Dedicated introspection client (ops) — takes precedence over the user-app
  // default. Defaults to CLIENT_SECRET_BASIC.
  if (process.env.PINGONE_INTROSPECTION_CLIENT_ID && process.env.PINGONE_INTROSPECTION_CLIENT_SECRET) {
    return {
      clientId: process.env.PINGONE_INTROSPECTION_CLIENT_ID,
      clientSecret: process.env.PINGONE_INTROSPECTION_CLIENT_SECRET,
      authMethod: process.env.PINGONE_INTROSPECTION_AUTH_METHOD || 'basic',
    };
  }
  // Demo User App — default issuer of the user tokens this service pre-flights (POST).
  if (process.env.PINGONE_USER_CLIENT_ID && process.env.PINGONE_USER_CLIENT_SECRET) {
    return {
      clientId: process.env.PINGONE_USER_CLIENT_ID,
      clientSecret: process.env.PINGONE_USER_CLIENT_SECRET,
      authMethod: process.env.PINGONE_INTROSPECTION_AUTH_METHOD || 'post',
    };
  }
  // Nothing configured — NOT the Worker. Undefined creds make validateToken throw
  // INTROSPECTION_NOT_CONFIGURED, which the caller treats as "skipped".
  return { clientId: undefined, clientSecret: undefined, authMethod: 'post' };
}

/**
 * Validate a token by calling PingOne's introspection endpoint (RFC 7662).
 * Returns token metadata including scopes.
 * 
 * @param {string} token - Bearer token to validate
 * @returns {Promise<{valid: boolean, scopes: string[], sub: string, exp: number, aud: string, client_id: string, token_type: string}>}
 */
async function validateToken(token, opts = {}) {
  if (typeof token !== 'string' || !token.trim()) {
    return { valid: false };
  }

  // Cache key includes the introspecting client so a result from one client never
  // masks a different client's self-introspection result for the same token. Mirror
  // the identity resolution below (opts → dedicated introspection client → user app).
  const introspectingClient =
    opts.clientId ||
    process.env.PINGONE_INTROSPECTION_CLIENT_ID ||
    process.env.PINGONE_USER_CLIENT_ID ||
    'unset';
  const tokenHash = `${hashToken(token)}:${introspectingClient}`;

  // Check cache first
  const cached = introspectionCache.get(tokenHash);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  try {
    // Prefer explicit env var; fall back to auto-derived PingOne endpoint ({base}/introspect)
    const introspectionUrl =
      process.env.PINGONE_INTROSPECTION_ENDPOINT ||
      configStore.getEffective('pingone_introspection_endpoint') ||
      (() => { const base = oauthEndpointResolver.getTokenEndpoint?.(); return base ? base.replace('/token', '/introspect') : ''; })();

    // ── Introspection credentials — per-token-issuer selection ────────────────
    // PingOne enforces a same-client rule on RFC 7662: a client can only
    // introspect tokens IT issued; introspecting another client's token returns
    // 401 invalid_client (or 200 {active:false}). So introspect each token with
    // the credentials of the client that issued it (from its client_id/azp
    // claim). Tokens from unknown issuers (or opaque, non-JWT tokens) fall back
    // to the Worker. opts.clientId lets callers override when they know the issuer.
    let clientId, clientSecret, authMethod;
    if (opts.clientId) {
      clientId = opts.clientId;
      clientSecret = opts.clientSecret;
      authMethod = opts.authMethod || 'post';
    } else {
      ({ clientId, clientSecret, authMethod } = selectIntrospectionCredentials(token));
    }

    if (!introspectionUrl || !clientId || !clientSecret) {
      logger.warn('Token introspection credentials missing', {
        hasEndpoint: !!introspectionUrl,
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
      });
      // Throw so the caller's catch treats this as "not configured / skipped" rather
      // than interpreting { valid: false } as "PingOne said the token is inactive".
      // agentMcpTokenService catches anything that isn't TOKEN_INACTIVE and logs it
      // as a skipped event, allowing the tool call to proceed with a valid session.
      throw Object.assign(new Error('Token introspection not configured'), { code: 'INTROSPECTION_NOT_CONFIGURED' });
    }

    // Call PingOne introspection endpoint
    // Support both 'basic' (Authorization header) and 'post' (body) auth methods
    const formBody = authMethod === 'basic'
      ? new URLSearchParams({ token })
      : new URLSearchParams({ token, client_id: clientId, client_secret: clientSecret });
    const authHeaders = authMethod === 'basic'
      ? { 'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64') }
      : {};
    const response = await axios.post(
      introspectionUrl,
      formBody,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...authHeaders,
        },
        timeout: 5000, // 5 second timeout
      }
    );

    const introspectionResult = response.data;

    // Extract and normalize scopes
    const scopes = extractScopes(introspectionResult);

    // Build result object following RFC 7662
    const result = {
      valid: introspectionResult.active === true,
      scopes,
      sub: introspectionResult.sub || null,
      exp: introspectionResult.exp || null,
      aud: introspectionResult.aud || null,
      client_id: introspectionResult.client_id || null,
      token_type: introspectionResult.token_type || 'Bearer',
      ...(introspectionResult.username && { username: introspectionResult.username }),
      ...(introspectionResult.iat && { iat: introspectionResult.iat }),
    };

    // Cache the result, but respect token expiration
    let cacheDuration = CACHE_TTL_MS;
    if (result.exp) {
      const tokenExpiresIn = result.exp * 1000 - Date.now();
      if (tokenExpiresIn > 0 && tokenExpiresIn < CACHE_TTL_MS) {
        cacheDuration = tokenExpiresIn;
      }
    }

    introspectionCache.set(tokenHash, {
      result,
      expiresAt: Date.now() + cacheDuration,
    });

    // Audit logging (never log the token itself)
    logger.info(LOG_CATEGORIES.AUTH, 'Token introspection completed', {
      token_hash: tokenHash.substring(0, 16),
      valid: result.valid,
      scopes: scopes.length,
      client_id: result.client_id,
    });
    logAppEvent(EVENT_CATEGORIES.INTROSPECTION, result.valid ? 'info' : 'warning',
      result.valid ? 'Token introspected — PingOne confirmed active' : 'Token introspected — PingOne returned inactive',
      { tag: result.valid ? 'introspection/active' : 'introspection/inactive',
        metadata: { active: result.valid, sub: result.sub || null, client_id: result.client_id || null, scopeCount: (result.scopes || []).length, scopes: result.scopes || [], exp: result.exp || null } });

    return result;
  } catch (error) {
    logger.error(LOG_CATEGORIES.ERROR, 'Token introspection failed', {
      error: error.message,
      endpoint: process.env.PINGONE_INTROSPECTION_ENDPOINT,
      timeout: error.code === 'ECONNABORTED',
    });
    logAppEvent(EVENT_CATEGORIES.INTROSPECTION, 'error', `Token introspection failed: ${error.message}`,
      { tag: 'introspection/error', metadata: { error: error.message } });

    return {
      valid: false,
      error: 'token_introspection_failed',
    };
  }
}

/**
 * Extract scopes from PingOne introspection response.
 * Handles both space-separated strings and arrays.
 *
 * @param {object} introspectionResponse - PingOne introspection API response
 * @returns {string[]} Array of scopes
 */
function extractScopes(introspectionResponse) {
  if (!introspectionResponse || !introspectionResponse.scope) {
    return [];
  }

  const scopeField = introspectionResponse.scope;

  // If scope is already an array
  if (Array.isArray(scopeField)) {
    return scopeField.filter(s => typeof s === 'string' && s.length > 0);
  }

  // If scope is a space-separated string
  if (typeof scopeField === 'string') {
    return scopeField
      .split(/\s+/)
      .filter(s => s.length > 0);
  }

  return [];
}

/**
 * Clear introspection cache (useful for testing)
 */
function clearCache() {
  introspectionCache.clear();
}

/**
 * Get cache stats (for monitoring/debugging)
 */
function getCacheStats() {
  const now = Date.now();
  let validEntries = 0;
  let expiredEntries = 0;

  for (const entry of introspectionCache.values()) {
    if (entry.expiresAt > now) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }

  return {
    size: introspectionCache.size,
    valid: validEntries,
    expired: expiredEntries,
  };
}

module.exports = {
  validateToken,
  extractScopes,
  clearCache,
  getCacheStats,
};
