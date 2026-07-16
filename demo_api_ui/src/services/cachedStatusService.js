/**
 * Cached status endpoint service
 * Deduplicates and caches common status endpoint calls to reduce excessive polling.
 * Each status endpoint has a 3-second TTL — requests within that window reuse cached results.
 * Cache auto-clears on login/logout events (userAuthenticated / userLoggedOut).
 */

const cache = {};
const CACHE_TTL_MS = 3000; // 3 seconds

// Auto-invalidate cache on auth transitions.
// Listeners are idempotent (module loads once in bundled SPA) but guarded
// with an _initialized flag to prevent accumulation during HMR / SSR.
let _listenersAttached = false;
if (typeof window !== 'undefined' && !_listenersAttached) {
  _listenersAttached = true;
  window.addEventListener('userAuthenticated', () => clearStatusCache());
  window.addEventListener('userLoggedOut', () => clearStatusCache());
}

/**
 * Get cached status with request deduplication.
 * If a request is already in flight, returns the same promise.
 * If a cached response exists and hasn't expired, returns cached promise.
 * Otherwise, makes a fresh request.
 */
export async function getCachedStatus(url, config = {}) {
  const now = Date.now();
  const cacheKey = url;
  const cached = cache[cacheKey];

  // Return cached promise if still valid
  if (cached && cached.expires > now) {
    return cached.promise;
  }

  // Status checks are background operations — silent by default to avoid triggering the spinner.
  // Callers can pass { _silent: false } to explicitly opt-in to spinner visibility.
  const silent = config._silent !== false;
  const requestConfig = {
    credentials: 'include',
    ...(silent && { _silent: true }),
  };

  // Make request and cache it. Silent status endpoints must stay silent.
  const promise = fetch(url, requestConfig)
    .then((r) => {
      if (!r.ok) throw new Error(`${url} returned ${r.status}`);
      const contentType = r.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`${url} returned ${contentType}, expected application/json`);
      }
      return r.json();
    })
    .then((data) => {
      // Anchor expiry to resolution time, not request-start, so slow requests get a full TTL
      cache[cacheKey] = { promise: Promise.resolve(data), expires: Date.now() + CACHE_TTL_MS };
      return data;
    })
    .catch((err) => {
      // Don't cache errors; allow retry on next call
      delete cache[cacheKey];
      throw err;
    });

  // Store the promise immediately so subsequent calls get the same one
  cache[cacheKey] = { promise, expires: now + CACHE_TTL_MS };
  return promise;
}

/**
 * Convenience wrapper returning { data: parsedJson } shape (axios-compatible).
 * Uses same-origin fetch with credentials. Cached with 3s TTL + in-flight dedup.
 */
export async function getCachedJson(url) {
  const data = await getCachedStatus(url);
  return { data };
}

/**
 * Clear all cached status responses.
 * Useful for explicit refresh or when user logs out.
 */
export function clearStatusCache() {
  Object.keys(cache).forEach((key) => {
    delete cache[key];
  });
}

/**
 * Clear a specific status endpoint from cache.
 */
export function clearStatusCacheFor(url) {
  delete cache[url];
}
