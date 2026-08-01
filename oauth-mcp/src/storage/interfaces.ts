/**
 * Interface for encrypted token storage operations
 */
export interface IEncryptedTokenStorage {
  /**
   * Store encrypted token data
   */
  store(key: string, data: any): Promise<void>;

  /**
   * Retrieve and decrypt token data
   */
  retrieve(key: string): Promise<any | null>;

  /**
   * Remove token data
   */
  remove(key: string): Promise<void>;

  /**
   * Check if token data exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Clean up expired tokens
   */
  cleanup(): Promise<void>;

  /**
   * Get all stored keys
   */
  getAllKeys(): Promise<string[]>;
}

/**
 * Interface for in-memory token caching with TTL
 */
export interface ITokenCache {
  /**
   * Set a token in cache with TTL
   */
  set(key: string, value: any, ttlSeconds?: number): void;

  /**
   * Get a token from cache
   */
  get(key: string): any | null;

  /**
   * Remove a token from cache
   */
  delete(key: string): void;

  /**
   * Check if token exists in cache
   */
  has(key: string): boolean;

  /**
   * Clear all cached tokens
   */
  clear(): void;

  /**
   * Clean up expired cache entries
   */
  cleanup(): void;

  /**
   * Get cache statistics
   */
  getStats(): CacheStats;
}

/**
 * Cache statistics interface
 */
export interface CacheStats {
  totalEntries: number;
  expiredEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
}

/**
 * Stored token data structure
 */
export interface StoredTokenData {
  data: any;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Cache entry structure
 */
export interface CacheEntry {
  value: any;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
}