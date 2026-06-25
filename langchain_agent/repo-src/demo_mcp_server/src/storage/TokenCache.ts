import { ITokenCache, CacheStats, CacheEntry } from './interfaces';

/**
 * In-memory token cache with TTL support
 */
export class TokenCache implements ITokenCache {
  private cache = new Map<string, CacheEntry>();
  private stats = {
    hitCount: 0,
    missCount: 0
  };
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly defaultTTL: number;

  constructor(defaultTTLSeconds: number = 3600, cleanupIntervalSeconds: number = 300) {
    this.defaultTTL = defaultTTLSeconds * 1000; // Convert to milliseconds
    
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalSeconds * 1000);
  }

  /**
   * Set a token in cache with TTL
   */
  set(key: string, value: any, ttlSeconds?: number): void {
    const ttl = ttlSeconds !== undefined ? ttlSeconds * 1000 : this.defaultTTL;
    const expiresAt = ttl <= 0 ? 0 : Date.now() + ttl; // Immediate expiration for zero or negative TTL

    this.cache.set(key, {
      value,
      expiresAt,
      accessCount: 0,
      lastAccessed: Date.now()
    });
  }

  /**
   * Get a token from cache
   */
  get(key: string): any | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.missCount++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.missCount++;
      return null;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this.stats.hitCount++;

    return entry.value;
  }

  /**
   * Remove a token from cache
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Check if token exists in cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear all cached tokens
   */
  clear(): void {
    this.cache.clear();
    this.stats.hitCount = 0;
    this.stats.missCount = 0;
  }

  /**
   * Clean up expired cache entries
   */
  cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hitCount + this.stats.missCount;
    const hitRate = totalRequests > 0 ? this.stats.hitCount / totalRequests : 0;

    let expiredEntries = 0;
    const now = Date.now();
    
    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      expiredEntries,
      hitCount: this.stats.hitCount,
      missCount: this.stats.missCount,
      hitRate
    };
  }

  /**
   * Destroy the cache and cleanup intervals
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}