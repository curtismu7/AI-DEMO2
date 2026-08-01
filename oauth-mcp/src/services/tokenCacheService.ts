/**
 * Token Cache Service — In-memory TTL-aware cache for exchanged delegation tokens.
 * Implements D-01: Lazy + cache — exchange on first call, cache with TTL, re-exchange on expiry.
 *
 * Bounded by `maxSize` (default 500). A background sweep (default every 5 min) evicts expired
 * entries so the Map does not grow unboundedly in long-running processes. When the cache is full
 * at write time, expired entries are swept first; if still full the oldest inserted entry is
 * evicted (FIFO via Map insertion order).
 */

interface CacheEntry {
  token: string;
  expiresAt: number;
}

export class TokenCacheService {
  private cache: Map<string, CacheEntry> = new Map();

  /** Buffer in ms subtracted from expiry to avoid using nearly-expired tokens */
  private readonly expiryBufferMs: number;
  private readonly maxSize: number;
  private readonly sweepHandle: ReturnType<typeof setInterval> | null;

  constructor(
    expiryBufferMs: number = 30_000,
    maxSize: number = 500,
    sweepIntervalMs: number = 300_000,
  ) {
    this.expiryBufferMs = expiryBufferMs;
    this.maxSize = maxSize;

    this.sweepHandle =
      sweepIntervalMs > 0 ? setInterval(() => this.sweepExpired(), sweepIntervalMs) : null;

    // Allow the Node.js event loop to exit without waiting for the sweep timer.
    if (this.sweepHandle && typeof (this.sweepHandle as NodeJS.Timeout).unref === 'function') {
      (this.sweepHandle as NodeJS.Timeout).unref();
    }
  }

  private buildKey(userId: string, scopes: string[]): string {
    const sorted = [...scopes].sort();
    // Use '::' separator so a userId that itself contains ':' (e.g. "env:abc")
    // never collides with the scope portion of the key.
    return `${userId}::${sorted.join(' ')}`;
  }

  /** Remove all entries whose effective expiry (minus buffer) has passed. */
  sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiresAt - this.expiryBufferMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get a cached token for the given user and scope set.
   * Returns null if no entry exists or the token has expired.
   */
  get(userId: string, scopes: string[]): string | null {
    const key = this.buildKey(userId, scopes);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() >= entry.expiresAt - this.expiryBufferMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.token;
  }

  /**
   * Store a token with its absolute expiry timestamp (ms since epoch).
   * Enforces maxSize — sweeps expired entries first, then evicts the oldest entry if still full.
   */
  set(userId: string, scopes: string[], token: string, expiresAt: number): void {
    if (this.cache.size >= this.maxSize) {
      this.sweepExpired();
      // If still at capacity after sweep, evict the oldest inserted entry (FIFO).
      if (this.cache.size >= this.maxSize) {
        const oldestKey = this.cache.keys().next().value as string | undefined;
        if (oldestKey !== undefined) this.cache.delete(oldestKey);
      }
    }
    const key = this.buildKey(userId, scopes);
    this.cache.set(key, { token, expiresAt });
  }

  /**
   * Clear cached tokens. If userId is provided, clear only that user's entries.
   * Otherwise clear the entire cache.
   */
  clear(userId?: string): void {
    if (!userId) {
      this.cache.clear();
      return;
    }

    const prefix = `${userId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Stop the background sweep timer and clear the cache.
   * Call on server shutdown or in test teardown.
   */
  destroy(): void {
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    this.cache.clear();
  }

  /** Number of entries currently in the cache (useful for diagnostics). */
  get size(): number {
    return this.cache.size;
  }
}

export const tokenCache = new TokenCacheService();
