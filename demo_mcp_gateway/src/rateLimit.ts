'use strict';

import { cacheInsertWithEviction } from './boundedTokenCache';

/**
 * rateLimit.ts -- per-agent/per-tool sliding-window rate limiter.
 *
 * UC18 (rate-limit / resource-overload defense): throttles tool calls at the
 * gateway to prevent agent resource exhaustion and cost-runaway. Each unique
 * (agentSub, toolName) pair gets its own counter. No external dependencies --
 * pure in-memory Map + timestamps. Safe for single-process gateways; for
 * multi-process clusters, replace with a Redis-backed adapter.
 *
 * Flag-gated: GATEWAY_RATE_LIMIT_ENABLED=true (default false). When disabled,
 * every call returns { allowed: true, retryAfterMs: 0 } at zero cost.
 *
 * Env vars:
 *   GATEWAY_RATE_LIMIT_ENABLED      -- 'true' to activate (default: 'false')
 *   GATEWAY_RATE_LIMIT_MAX_REQUESTS -- max calls per window per key (default: 20)
 *   GATEWAY_RATE_LIMIT_WINDOW_MS    -- sliding window length in ms (default: 60000)
 */

export interface RateLimitConfig {
  enabled: boolean;
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number; // 0 when allowed
}

interface WindowEntry {
  timestamps: number[];
  /** when this key's window is fully stale and safe to evict */
  expiresAt: number;
}

// HI-06-style cap, reusing the same sweep-expired-then-FIFO-evict helper as
// this codebase's other per-caller Maps (McpTokenExchangeClient,
// GatewayIntrospectionClient) — without it, a key for every distinct
// (subject, tool) pair ever seen stayed in the Map for the gateway's entire
// process lifetime, since nothing ever deleted an entry once check() stopped
// being called for it.
const RATE_LIMIT_WINDOWS_MAX = 1000;

/**
 * Sliding-window rate limiter. Each call to check() records a timestamp.
 * Timestamps older than windowMs are evicted. When the live count reaches
 * maxRequests the next call returns allowed=false with a retryAfterMs value
 * derived from how long until the oldest timestamp falls out of the window.
 */
export class SlidingWindowLimiter {
  /** key -> timestamps within the current window + this key's own expiry */
  private readonly _windows = new Map<string, WindowEntry>();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
  ) {}

  check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Evict timestamps that have fallen outside the window
    const timestamps = (this._windows.get(key)?.timestamps ?? []).filter(t => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      // Oldest timestamp in the window tells us when the window will clear
      const oldestInWindow = timestamps[0];
      const retryAfterMs = Math.max(1, oldestInWindow + this.windowMs - now);
      cacheInsertWithEviction(this._windows, key, { timestamps, expiresAt: now + this.windowMs }, RATE_LIMIT_WINDOWS_MAX);
      return { allowed: false, retryAfterMs };
    }

    timestamps.push(now);
    cacheInsertWithEviction(this._windows, key, { timestamps, expiresAt: now + this.windowMs }, RATE_LIMIT_WINDOWS_MAX);
    return { allowed: true, retryAfterMs: 0 };
  }
}

// Module-level singleton (one limiter per gateway process). Created lazily on
// first call so tests can set env vars before the singleton is created.
let _limiter: SlidingWindowLimiter | null = null;

function buildLimiterFromEnv(): SlidingWindowLimiter {
  const maxRequests = parseInt(process.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS ?? '20', 10) || 20;
  const windowMs = parseInt(process.env.GATEWAY_RATE_LIMIT_WINDOW_MS ?? '60000', 10) || 60000;
  return new SlidingWindowLimiter(windowMs, maxRequests);
}

/**
 * Check whether the call identified by key is rate-limited.
 * Returns { allowed: true, retryAfterMs: 0 } when GATEWAY_RATE_LIMIT_ENABLED
 * is not 'true'. Creates the module singleton on first call.
 *
 * For tests: use SlidingWindowLimiter instances directly to avoid singleton
 * state bleed across tests, or call _resetLimiterForTest() in afterEach.
 */
export function checkRateLimit(key: string): RateLimitResult {
  if (process.env.GATEWAY_RATE_LIMIT_ENABLED !== 'true') {
    return { allowed: true, retryAfterMs: 0 };
  }
  if (!_limiter) _limiter = buildLimiterFromEnv();
  return _limiter.check(key);
}

/** Reset the module singleton. Call in afterEach to prevent test state bleed. */
export function _resetLimiterForTest(): void {
  _limiter = null;
}
