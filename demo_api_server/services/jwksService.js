/**
 * JWKS key-set cache for PingOne.
 * Fetches /.well-known/jwks.json once per hour (configurable via JWKS_CACHE_MAX_AGE env,
 * seconds). Converts each JWK to a Node crypto.KeyObject so jsonwebtoken can verify
 * RS256 / RS384 / RS512 signatures without an extra library.
 *
 * Used by tokenVerificationService to cryptographically verify exchanged tokens.
 * RFC 7517 — JSON Web Key (JWK)
 */
'use strict';

const crypto = require('crypto');
const axios = require('axios');
const endpointResolver = require('./oauthEndpointResolver');
const { logger, LOG_CATEGORIES } = require('../utils/logger');

/** Key set cache TTL in ms (default 1 hour). */
const CACHE_MAX_AGE_MS = Math.max(
  60_000,
  parseInt(process.env.JWKS_CACHE_MAX_AGE || '3600', 10) * 1000
);

/** @type {Map<string, {keyObject: crypto.KeyObject, alg: string, use: string}>|null} */
let _cachedKeys = null;
let _cacheExpiry = 0;

/**
 * Fetch JWKS from PingOne and convert to crypto.KeyObject map keyed by kid.
 * @returns {Promise<Map<string, {keyObject: crypto.KeyObject, alg: string, use: string}>|null>}
 */
async function _fetchAndBuildKeyMap() {
  const jwksUri = endpointResolver.getJwksUri();

  if (!jwksUri) {
    logger.warn(LOG_CATEGORIES.AUTHENTICATION, 'jwksService: JWKS URI not configured — skipping JWKS fetch');
    return null;
  }

  const response = await axios.get(jwksUri, {
    timeout: 5000,
    headers: { Accept: 'application/json' },
  });

  const keys = Array.isArray(response.data?.keys) ? response.data.keys : [];
  const keyMap = new Map();

  for (const jwk of keys) {
    if (!jwk.kid || jwk.use === 'enc') continue; // skip encryption keys
    try {
      const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      keyMap.set(jwk.kid, { keyObject, alg: jwk.alg || 'RS256', use: jwk.use || 'sig' });
    } catch (err) {
      logger.warn(LOG_CATEGORIES.AUTHENTICATION, `jwksService: failed to import key kid=${jwk.kid}: ${err.message}`);
    }
  }

  logger.info(LOG_CATEGORIES.AUTHENTICATION, `jwksService: cached ${keyMap.size} JWKS key(s) from ${jwksUri}`);
  return keyMap;
}

/**
 * Return the cached key map, refreshing if stale.
 * Returns null when JWKS is unavailable (network error, not configured).
 */
async function getKeys() {
  if (_cachedKeys && Date.now() < _cacheExpiry) return _cachedKeys;
  try {
    _cachedKeys = await _fetchAndBuildKeyMap();
    _cacheExpiry = Date.now() + CACHE_MAX_AGE_MS;
    return _cachedKeys;
  } catch (err) {
    logger.warn(LOG_CATEGORIES.AUTHENTICATION, `jwksService: JWKS fetch failed — ${err.message}`);
    // Keep stale cache on transient network error
    return _cachedKeys;
  }
}

/**
 * Resolve the crypto.KeyObject for a given kid (or the first sig key if kid is absent).
 * Returns null if JWKS is unavailable.
 * @param {string|null} kid
 * @returns {Promise<{keyObject: crypto.KeyObject, alg: string}|null>}
 */
async function getPublicKey(kid) {
  const keys = await getKeys();
  if (!keys || keys.size === 0) return null;

  if (kid && keys.has(kid)) return keys.get(kid);

  // kid unknown — refresh once in case PingOne rotated
  if (kid && Date.now() >= _cacheExpiry - CACHE_MAX_AGE_MS / 2) {
    try {
      _cachedKeys = await _fetchAndBuildKeyMap();
      _cacheExpiry = Date.now() + CACHE_MAX_AGE_MS;
      if (_cachedKeys?.has(kid)) return _cachedKeys.get(kid);
    } catch (_) {}
  }

  // Fall back to first signature key
  for (const entry of (keys.values())) {
    if (entry.use === 'sig') return entry;
  }
  return keys.values().next().value || null;
}

/**
 * Exact JWKS membership test for a kid. Distinct from getPublicKey, which
 * deliberately falls back to the first signature key and therefore can never
 * report a kid as absent.
 *
 * @param {string|null} kid
 * @returns {Promise<boolean|null>} true = published, false = not published,
 *   null = unknown (no kid, or JWKS unavailable)
 */
async function hasKid(kid) {
  if (!kid) return null;
  const keys = await getKeys();
  if (!keys || keys.size === 0) return null;   // unavailable → unknown
  if (keys.has(kid)) return true;
  // Absent from the cached keyset — refresh once before concluding false, in
  // case PingOne rotated signing keys since the cache was built. getKeys()
  // returns a STALE cache on network failure, so without this a legitimately
  // rotated key would be reported as forged.
  try {
    _cachedKeys = await _fetchAndBuildKeyMap();
    _cacheExpiry = Date.now() + CACHE_MAX_AGE_MS;
    return !!_cachedKeys?.has(kid);
  } catch (_) {
    return null;                                // unresolvable → unknown
  }
}

/** Force-invalidate the cache (for testing or after key rotation). */
function clearCache() {
  _cachedKeys = null;
  _cacheExpiry = 0;
}

module.exports = { getKeys, getPublicKey, hasKid, clearCache };
