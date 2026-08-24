'use strict';

import { SlidingWindowLimiter, checkRateLimit, _resetLimiterForTest } from '../src/rateLimit';
import type { RateLimitConfig } from '../src/rateLimit';

afterEach(() => {
  _resetLimiterForTest();
  delete process.env.GATEWAY_RATE_LIMIT_ENABLED;
  delete process.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS;
  delete process.env.GATEWAY_RATE_LIMIT_WINDOW_MS;
});

describe('SlidingWindowLimiter', () => {
  it('flag disabled: never limited regardless of call count', () => {
    // Construct with windowMs=1000, maxRequests=5 but enabled=false via the
    // config-driven singleton. For the class itself, disabled is via the
    // module-level checkRateLimit wrapper; the class always enforces when called.
    // Test: a limiter constructed with huge maxRequests effectively never blocks.
    const limiter = new SlidingWindowLimiter(1000, 999999);
    for (let i = 0; i < 100; i++) {
      const result = limiter.check('agent:tool');
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
    }
  });

  it('flag enabled: under maxRequests returns allowed=true', () => {
    const limiter = new SlidingWindowLimiter(10000, 5);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('agent:tool').allowed).toBe(true);
    }
  });

  it('flag enabled: at maxRequests+1 returns allowed=false with retryAfterMs > 0', () => {
    const limiter = new SlidingWindowLimiter(10000, 5);
    for (let i = 0; i < 5; i++) limiter.check('agent:tool');
    const result = limiter.check('agent:tool');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('keys are independent: different agent+tool pairs do not share counts', () => {
    const limiter = new SlidingWindowLimiter(10000, 2);
    limiter.check('agent1:tool_a');
    limiter.check('agent1:tool_a');
    expect(limiter.check('agent1:tool_a').allowed).toBe(false);
    // Different keys are not affected
    expect(limiter.check('agent2:tool_a').allowed).toBe(true);
    expect(limiter.check('agent1:tool_b').allowed).toBe(true);
  });

  it('window expiry resets counter and allows calls again', async () => {
    const limiter = new SlidingWindowLimiter(50, 2);
    limiter.check('agent:tool');
    limiter.check('agent:tool');
    expect(limiter.check('agent:tool').allowed).toBe(false);
    await new Promise(r => setTimeout(r, 60)); // wait for window to expire
    expect(limiter.check('agent:tool').allowed).toBe(true);
  });

  // Finding #68 (round-5 audit): _windows previously grew without bound —
  // every distinct key ever seen stayed in the Map for the process lifetime,
  // since nothing ever deleted an entry once check() stopped being called
  // for it.
  it('caps total tracked keys instead of growing unboundedly', () => {
    const limiter = new SlidingWindowLimiter(60000, 20);
    const totalKeys = 1500;
    for (let i = 0; i < totalKeys; i++) {
      limiter.check(`agent-${i}:tool`);
    }
    const windows = (limiter as unknown as { _windows: Map<string, unknown> })._windows;
    expect(windows.size).toBeLessThanOrEqual(1000);
  });

  it('_resetLimiterForTest resets the module singleton, fresh instance has clean state', () => {
    // Module singleton test: fill it, reset, confirm clean slate via checkRateLimit
    process.env.GATEWAY_RATE_LIMIT_ENABLED = 'true';
    process.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS = '1';
    process.env.GATEWAY_RATE_LIMIT_WINDOW_MS = '10000';
    _resetLimiterForTest();
    checkRateLimit('agent:tool');
    expect(checkRateLimit('agent:tool').allowed).toBe(false);
    _resetLimiterForTest();
    // After reset, the singleton is gone — first call recreates it with a fresh window
    expect(checkRateLimit('agent:tool').allowed).toBe(true);
  });
});

describe('checkRateLimit (module-level singleton)', () => {
  it('GATEWAY_RATE_LIMIT_ENABLED unset defaults to not limited', () => {
    delete process.env.GATEWAY_RATE_LIMIT_ENABLED;
    _resetLimiterForTest();
    const result = checkRateLimit('agent:tool');
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('GATEWAY_RATE_LIMIT_ENABLED=false returns allowed=true always', () => {
    process.env.GATEWAY_RATE_LIMIT_ENABLED = 'false';
    _resetLimiterForTest();
    for (let i = 0; i < 50; i++) {
      expect(checkRateLimit('agent:tool').allowed).toBe(true);
    }
  });

  it('GATEWAY_RATE_LIMIT_ENABLED=true enforces the limit', () => {
    process.env.GATEWAY_RATE_LIMIT_ENABLED = 'true';
    process.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS = '2';
    process.env.GATEWAY_RATE_LIMIT_WINDOW_MS = '10000';
    _resetLimiterForTest();
    checkRateLimit('agent:tool');
    checkRateLimit('agent:tool');
    const result = checkRateLimit('agent:tool');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });
});
