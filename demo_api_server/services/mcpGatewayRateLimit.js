'use strict';

/**
 * mcpGatewayRateLimit.js — UC18 rate-limit helpers for the PingOne Agent Gateway (IG) path.
 *
 * Throttling runs in PingGateway (uc18-rate-limit.groovy) before P1AZ. The BFF arms it by
 * sending X-UC18-Rate-Limit: true when ff_mcp_rate_limit + ff_mcp_gateway_pinggateway are ON
 * (requires x-internal-gateway-secret). Legacy BFF-edge limiting is disabled.
 *
 * Env (demo defaults match UC18_DEMO_RATE_LIMIT in mcpGatewayConfig.js):
 *   MCP_BFF_RATE_LIMIT_MAX_REQUESTS — reported in status APIs; IG uses PG_RATE_LIMIT_* (default 3)
 *   MCP_BFF_RATE_LIMIT_WINDOW_MS    — reported in status APIs; IG uses PG_RATE_LIMIT_* (default 10000)
 */

const configStore = require('./configStore');
const { decodeJwt } = require('../utils/tokenUtils');

class SlidingWindowLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this._windows = new Map();
    // Periodically evict stale keys to prevent unbounded Map growth
    this._evictionInterval = setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.windowMs;
      for (const [k, timestamps] of this._windows.entries()) {
        if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
          this._windows.delete(k);
        }
      }
    }, Math.max(60_000, this.windowMs)).unref();
  }

  /** Check whether key is within limit; records the call when allowed. */
  check(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this._windows.get(key) || []).filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      const retryAfterMs = Math.max(1, timestamps[0] + this.windowMs - now);
      this._windows.set(key, timestamps);
      return { allowed: false, retryAfterMs };
    }

    timestamps.push(now);
    this._windows.set(key, timestamps);
    return { allowed: true, retryAfterMs: 0 };
  }
}

let _limiter = null;

/** Build or return the module singleton limiter. */
function getLimiter() {
  if (!_limiter) {
    const maxRequests = parseInt(process.env.MCP_BFF_RATE_LIMIT_MAX_REQUESTS || '3', 10) || 3;
    const windowMs = parseInt(process.env.MCP_BFF_RATE_LIMIT_WINDOW_MS || '10000', 10) || 10000;
    _limiter = new SlidingWindowLimiter(windowMs, maxRequests);
  }
  return _limiter;
}

/** Reset singleton — for tests only. */
function _resetLimiterForTest() {
  _limiter = null;
}

/** True when BFF should stamp X-UC18-Rate-Limit on PingOne Agent Gateway (IG) requests. */
function shouldStampIgRateLimitHeader() {
  if (configStore.getEffective('ff_mcp_rate_limit') !== 'true') return false;
  return configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';
}

/** @deprecated BFF edge limiting removed — IG uc18-rate-limit.groovy handles UC18 on Ping path. */
function shouldApplyBffRateLimit() {
  return false;
}

/** Current BFF limiter config for status APIs. */
function getBffRateLimitConfig() {
  const maxRequests = parseInt(process.env.MCP_BFF_RATE_LIMIT_MAX_REQUESTS || '3', 10) || 3;
  const windowMs = parseInt(process.env.MCP_BFF_RATE_LIMIT_WINDOW_MS || '10000', 10) || 10000;
  return { maxRequests, windowMs };
}

/**
 * Check per-(sub, tool) rate limit at the BFF edge (PingOne IG path only).
 * @param {string} bearerToken
 * @param {string} toolName
 * @returns {{ allowed: boolean, retryAfterMs: number }}
 */
function checkMcpGatewayRateLimit(bearerToken, toolName) {
  if (!shouldApplyBffRateLimit()) {
    return { allowed: true, retryAfterMs: 0 };
  }

  let sub = 'unknown';
  try {
    const claims = decodeJwt(bearerToken)?.claims;
    if (claims?.sub) sub = String(claims.sub);
  } catch {
    /* use unknown sub */
  }

  const key = `${sub}:${toolName || 'unknown_tool'}`;
  return getLimiter().check(key);
}

module.exports = {
  checkMcpGatewayRateLimit,
  shouldApplyBffRateLimit,
  shouldStampIgRateLimitHeader,
  getBffRateLimitConfig,
  _resetLimiterForTest,
};
