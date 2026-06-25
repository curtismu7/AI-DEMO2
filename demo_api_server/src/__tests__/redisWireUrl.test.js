// banking_api_server/src/__tests__/redisWireUrl.test.js
const { resolveRedisWireUrl, isRedisWireUrl } = require('../../services/redisWireUrl');

describe('redisWireUrl', () => {
  const base = {
    REDIS_URL: undefined,
    KV_URL: undefined,
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
    KV_REST_API_URL: undefined,
    KV_REST_API_TOKEN: undefined,
  };

  describe('isRedisWireUrl', () => {
    it('accepts redis and rediss schemes', () => {
      expect(isRedisWireUrl('redis://localhost:6379')).toBe(true);
      expect(isRedisWireUrl('rediss://default:tok@host:6379')).toBe(true);
    });
    it('rejects https REST URLs', () => {
      expect(isRedisWireUrl('https://eu1-xx.upstash.io')).toBe(false);
    });
  });

  describe('resolveRedisWireUrl', () => {
    it('uses REDIS_URL when it is wire format', () => {
      const env = {
        ...base,
        REDIS_URL: 'rediss://default:secret@redis.example.com:6379',
      };
      const r = resolveRedisWireUrl(env);
      expect(r.url).toBe(env.REDIS_URL);
      expect(r.envHint).toBe('REDIS_URL');
      expect(r.invalidRedisUrlIgnored).toBe(false);
    });

    it('ignores invalid REDIS_URL and uses KV_URL', () => {
      const env = {
        ...base,
        REDIS_URL: 'https://wrong-rest-url.upstash.io',
        KV_URL: 'rediss://default:good@redis-123.upstash.io:6379',
      };
      const r = resolveRedisWireUrl(env);
      expect(r.url).toBe(env.KV_URL);
      expect(r.envHint).toBe('KV_URL');
      expect(r.invalidRedisUrlIgnored).toBe(true);
    });

    it('ignores invalid REDIS_URL and derives from KV_REST_API_*', () => {
      const env = {
        ...base,
        REDIS_URL: 'https://oops.upstash.io',
        KV_REST_API_URL: 'https://steady-yeti-84614.upstash.io',
        KV_REST_API_TOKEN: 'AbC_token_',
      };
      const r = resolveRedisWireUrl(env);
      expect(r.envHint).toBe('KV_REST_API_*');
      expect(r.invalidRedisUrlIgnored).toBe(true);
      expect(r.url).toBe('rediss://default:AbC_token_@steady-yeti-84614.upstash.io:6379');
    });

    it('prefers UPSTASH_REDIS_REST_* hint when both REST names could apply', () => {
      const env = {
        ...base,
        UPSTASH_REDIS_REST_URL: 'https://a.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'tok',
        KV_REST_API_URL: 'https://b.upstash.io',
        KV_REST_API_TOKEN: 'ignored',
      };
      const r = resolveRedisWireUrl(env);
      expect(r.envHint).toBe('UPSTASH_REDIS_REST_*');
      expect(r.url).toContain('a.upstash.io');
    });

    it('returns null when nothing usable is set', () => {
      expect(resolveRedisWireUrl({ ...base })).toEqual({
        url: null,
        envHint: null,
        invalidRedisUrlIgnored: false,
      });
    });
  });
});
