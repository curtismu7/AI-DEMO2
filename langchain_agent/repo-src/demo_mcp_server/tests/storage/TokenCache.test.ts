import { TokenCache } from '../../src/storage/TokenCache';

describe('TokenCache', () => {
  let cache: TokenCache;

  beforeEach(() => {
    cache = new TokenCache(60, 10); // 60 second TTL, 10 second cleanup interval
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('test-key', 'test-value');
      expect(cache.get('test-key')).toBe('test-value');
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('non-existent')).toBeNull();
    });

    it('should check if key exists', () => {
      cache.set('test-key', 'test-value');
      expect(cache.has('test-key')).toBe(true);
      expect(cache.has('non-existent')).toBe(false);
    });

    it('should delete values', () => {
      cache.set('test-key', 'test-value');
      cache.delete('test-key');
      expect(cache.get('test-key')).toBeNull();
      expect(cache.has('test-key')).toBe(false);
    });

    it('should clear all values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });
  });

  describe('TTL functionality', () => {
    it('should respect custom TTL', (done) => {
      cache.set('test-key', 'test-value', 0.1); // 0.1 second TTL
      
      setTimeout(() => {
        expect(cache.get('test-key')).toBeNull();
        expect(cache.has('test-key')).toBe(false);
        done();
      }, 150);
    });

    it('should use default TTL when not specified', () => {
      cache.set('test-key', 'test-value');
      expect(cache.has('test-key')).toBe(true);
    });

    it('should handle zero TTL', () => {
      cache.set('test-key', 'test-value', 0);
      // Zero TTL means immediate expiration, but the value is still stored
      // It will be expired on the next get() call
      expect(cache.get('test-key')).toBeNull();
    });
  });

  describe('statistics', () => {
    it('should track hit and miss counts', () => {
      cache.set('key1', 'value1');
      
      // Hit
      cache.get('key1');
      cache.get('key1');
      
      // Miss
      cache.get('non-existent');
      
      const stats = cache.getStats();
      expect(stats.hitCount).toBe(2);
      expect(stats.missCount).toBe(1);
      expect(stats.hitRate).toBe(2/3);
    });

    it('should track total entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(2);
    });

    it('should reset stats on clear', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('non-existent');
      
      cache.clear();
      
      const stats = cache.getStats();
      expect(stats.hitCount).toBe(0);
      expect(stats.missCount).toBe(0);
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries on cleanup', (done) => {
      cache.set('key1', 'value1', 0.1); // Will expire
      cache.set('key2', 'value2', 60); // Won't expire
      
      setTimeout(() => {
        cache.cleanup();
        expect(cache.has('key1')).toBe(false);
        expect(cache.has('key2')).toBe(true);
        done();
      }, 150);
    });
  });

  describe('complex data types', () => {
    it('should handle objects', () => {
      const testObject = { name: 'test', value: 123 };
      cache.set('object-key', testObject);
      expect(cache.get('object-key')).toEqual(testObject);
    });

    it('should handle arrays', () => {
      const testArray = [1, 2, 3, 'test'];
      cache.set('array-key', testArray);
      expect(cache.get('array-key')).toEqual(testArray);
    });

    it('should handle null and undefined', () => {
      cache.set('null-key', null);
      cache.set('undefined-key', undefined);
      expect(cache.get('null-key')).toBeNull();
      expect(cache.get('undefined-key')).toBeUndefined();
    });
  });
});