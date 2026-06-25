'use strict';

/**
 * PingOne user lookup for contextual binding in the authz decision layer.
 *
 * Fetches user status and enabled flag from the PingOne Management API using
 * worker client credentials. Results are cached (TTL: 5 min) so we don't add
 * a round-trip to every tool call.
 *
 * Used by decision.js to verify:
 *   - User exists in PingOne
 *   - User account is enabled (not disabled or locked)
 *   - User status is ACTIVE (not INACTIVE, LOCKED, PASSWORD_EXPIRED)
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NOT_FOUND_CACHE_TTL_MS = 15 * 1000; // 15 s — short TTL so newly-provisioned users aren't blocked long

// In-memory cache: sub → { enabled, status, fetchedAt }
const _cache = new Map();

// Worker token cache
let _workerToken = null;
let _workerTokenExpiry = 0;
let _workerTokenPromise = null;

function _envOrDefault(key, fallback = '') {
  return process.env[key] || fallback;
}

async function _getWorkerToken() {
  const now = Date.now() / 1000;
  if (_workerToken && now < _workerTokenExpiry - 30) return _workerToken;

  // Deduplicate concurrent fetches — all callers await the same promise
  if (_workerTokenPromise) return _workerTokenPromise;

  _workerTokenPromise = (async () => {
    const clientId     = _envOrDefault('PINGONE_WORKER_CLIENT_ID');
    const clientSecret = _envOrDefault('PINGONE_WORKER_CLIENT_SECRET');
    const envId        = _envOrDefault('PINGONE_ENVIRONMENT_ID');
    const region       = _envOrDefault('PINGONE_REGION', 'com');

    if (!clientId || !clientSecret || !envId) {
      throw new Error('PingOne worker credentials not configured (PINGONE_WORKER_CLIENT_ID / SECRET / ENVIRONMENT_ID)');
    }

    const tokenUrl = `https://auth.pingone.${region}/${envId}/as/token`;
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials' });

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => resp.status);
      throw new Error(`Worker token request failed: ${err}`);
    }

    const data = await resp.json();
    _workerToken = data.access_token;
    _workerTokenExpiry = now + (data.expires_in || 3600);
    return _workerToken;
  })().finally(() => { _workerTokenPromise = null; });

  return _workerTokenPromise;
}

/**
 * Look up a PingOne user by their sub (UUID). Returns:
 *   { enabled: boolean, status: string, found: boolean }
 *
 * Caches results for CACHE_TTL_MS. On any network/API error returns
 * { enabled: true, status: 'UNKNOWN', found: false } so a lookup failure
 * does NOT block a legitimate request — the other authz rules still apply.
 */
async function lookupUser(sub) {
  if (!sub) return { enabled: false, status: 'MISSING_SUB', found: false };

  const cached = _cache.get(sub);
  if (cached && Date.now() - cached.fetchedAt < (cached.ttl ?? CACHE_TTL_MS)) {
    return { enabled: cached.enabled, status: cached.status, found: cached.found };
  }

  try {
    const token = await _getWorkerToken();
    const envId  = _envOrDefault('PINGONE_ENVIRONMENT_ID');
    const region = _envOrDefault('PINGONE_REGION', 'com');

    const url = `https://api.pingone.${region}/v1/environments/${envId}/users/${sub}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });

    if (resp.status === 404) {
      const result = { enabled: false, status: 'NOT_FOUND', found: false };
      _cache.set(sub, { ...result, fetchedAt: Date.now(), ttl: NOT_FOUND_CACHE_TTL_MS });
      return result;
    }

    if (!resp.ok) {
      console.warn(`[pingOneUserLookup] API error ${resp.status} for sub=${sub} — failing open`);
      return { enabled: true, status: 'UNKNOWN', found: false };
    }

    const user = await resp.json();
    const result = {
      enabled: user.enabled !== false,
      status:  user.status || 'ACTIVE',
      found:   true,
    };
    _cache.set(sub, { ...result, fetchedAt: Date.now() });
    return result;

  } catch (err) {
    // Network failure or timeout — fail open so infra issues don't block users
    console.warn(`[pingOneUserLookup] Lookup failed for sub=${sub}: ${err.message} — failing open`);
    return { enabled: true, status: 'UNKNOWN', found: false };
  }
}

/** Expose cache clear for testing. */
function clearCache() { _cache.clear(); _workerToken = null; _workerTokenExpiry = 0; }

// Evict stale entries every 10 minutes to prevent unbounded Map growth.
setInterval(() => {
  const now = Date.now();
  for (const [sub, entry] of _cache) {
    if (now - entry.fetchedAt >= (entry.ttl ?? CACHE_TTL_MS)) {
      _cache.delete(sub);
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = { lookupUser, clearCache };
