'use strict';

/**
 * Shared bounded-token-cache eviction (IN-03).
 *
 * tokenExchange.ts and auth/McpTokenExchangeClient.ts both held a
 * byte-for-byte-identical `_cacheInsertWithEviction`: Map + hard cap +
 * sweep-expired-then-FIFO-evict-oldest. The duplication was the only real
 * cost (no functional bug — Node is single-threaded and the `while` always
 * terminates because each iteration deletes one key). This module is the
 * single source of truth so a future tuning of eviction reaches both caches.
 *
 * Eviction semantics (unchanged from HI-06):
 *   1. Only act when the map is at/over `max`.
 *   2. First sweep all entries whose `expiresAt <= now` (cheap reclaim).
 *   3. If still at/over `max`, FIFO-evict the oldest insertion until under.
 */

export interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Insert `value` under `key`, enforcing the `max` cap with sweep+FIFO eviction.
 * The `while` terminates: `cache.keys().next().value` is `undefined` only on an
 * empty map (guarded by `break`), and each iteration deletes exactly one key.
 */
export function cacheInsertWithEviction(
  cache: Map<string, CachedToken>,
  key: string,
  value: CachedToken,
  max: number,
): void {
  if (cache.size >= max) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
    }
    while (cache.size >= max) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}
