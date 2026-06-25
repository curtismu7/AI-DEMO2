// banking_api_server/services/redisWireUrl.js
'use strict';

/**
 * True if the string is a Redis wire-protocol URL (not https REST).
 * @param {unknown} u
 * @returns {boolean}
 */
function isRedisWireUrl(u) {
  return typeof u === 'string' && (u.startsWith('redis://') || u.startsWith('rediss://'));
}

/**
 * Resolves env vars to a single redis:// or rediss:// URL for connect-redis / node-redis.
 * Priority: REDIS_URL (if valid wire URL) → KV_URL (wire) → derive from Upstash/Vercel REST URL + token.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ url: string | null, envHint: string | null, invalidRedisUrlIgnored: boolean }}
 */
function resolveRedisWireUrl(env = process.env) {
  const direct = env.REDIS_URL;
  if (direct && isRedisWireUrl(direct)) {
    return { url: direct, envHint: 'REDIS_URL', invalidRedisUrlIgnored: false };
  }
  const invalidRedisUrlIgnored = Boolean(
    direct && typeof direct === 'string' && direct.trim().length > 0 && !isRedisWireUrl(direct),
  );

  const kvWire = env.KV_URL;
  if (kvWire && isRedisWireUrl(kvWire)) {
    return { url: kvWire, envHint: 'KV_URL', invalidRedisUrlIgnored };
  }

  const restUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const restToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!restUrl || !restToken) {
    return { url: null, envHint: null, invalidRedisUrlIgnored };
  }
  const envHint = env.UPSTASH_REDIS_REST_URL ? 'UPSTASH_REDIS_REST_*' : 'KV_REST_API_*';
  const host = String(restUrl).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const encToken = encodeURIComponent(String(restToken));
  return {
    url: `rediss://default:${encToken}@${host}:6379`,
    envHint,
    invalidRedisUrlIgnored,
  };
}

module.exports = { resolveRedisWireUrl, isRedisWireUrl };
