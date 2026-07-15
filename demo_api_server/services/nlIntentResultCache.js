// demo_api_server/services/nlIntentResultCache.js
/**
 * Short-TTL LRU cache for NL intent LLM results.
 * Skips repeat LLM rounds for the same message/vertical/provider/role.
 * Heuristic matches never need this — they are already zero-latency.
 */
'use strict';

const DEFAULT_TTL_MS = parseInt(process.env.NL_INTENT_CACHE_TTL_MS || '600000', 10); // 10 min
const DEFAULT_MAX = parseInt(process.env.NL_INTENT_CACHE_MAX || '100', 10);

/** @type {Map<string, { expiresAt: number, value: object }>} */
const store = new Map();
let ttlMs = Number.isFinite(DEFAULT_TTL_MS) && DEFAULT_TTL_MS > 0 ? DEFAULT_TTL_MS : 600000;
let maxEntries = Number.isFinite(DEFAULT_MAX) && DEFAULT_MAX > 0 ? DEFAULT_MAX : 100;

/**
 * Build a stable cache key from NL intent inputs.
 * @param {{ message: string, vertical?: string, provider?: string, role?: string }} parts
 * @returns {string}
 */
function key(parts = {}) {
  const msg = String(parts.message || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const vertical = String(parts.vertical || 'banking');
  const provider = String(parts.provider || 'auto');
  const role = String(parts.role || 'user');
  return `${vertical}|${provider}|${role}|${msg}`;
}

/**
 * Read a cached NL result if present and not expired.
 * @param {string} cacheKey
 * @returns {object|null}
 */
function get(cacheKey) {
  if (!cacheKey || ttlMs <= 0) return null;
  const hit = store.get(cacheKey);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(cacheKey);
    return null;
  }
  // Refresh insertion order for LRU semantics.
  store.delete(cacheKey);
  store.set(cacheKey, hit);
  return hit.value;
}

/**
 * Store a successful NL result. Skips empty / kind:none outcomes.
 * @param {string} cacheKey
 * @param {object} value
 */
function set(cacheKey, value) {
  if (!cacheKey || ttlMs <= 0 || !value || typeof value !== 'object') return;
  const kind = value?.result?.kind;
  if (!kind || kind === 'none') return;
  while (store.size >= maxEntries) {
    const oldest = store.keys().next().value;
    if (oldest == null) break;
    store.delete(oldest);
  }
  store.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
}

/** Clear all entries (tests). */
function clear() {
  store.clear();
}

/**
 * Test/config helpers.
 * @param {{ ttlMs?: number, maxEntries?: number }} opts
 */
function configure(opts = {}) {
  if (opts.ttlMs != null) ttlMs = Number(opts.ttlMs);
  if (opts.maxEntries != null) maxEntries = Number(opts.maxEntries);
}

function size() {
  return store.size;
}

module.exports = {
  key,
  get,
  set,
  clear,
  configure,
  size,
  __test: { store },
};
