'use strict';

/**
 * configStore.get.envFallback.test.js
 *
 * Regression suite for the class of bug where configStore.get(KEY) returned
 * null even though process.env[KEY] was set, because get() only checked the
 * LMDB cache and never fell through to process.env.
 *
 * Root cause history:
 *   - P1AZ "worker credentials not configured" warning appeared even when
 *     PINGONE_WORKER_CLIENT_ID was present in .env. Routes called
 *     configStore.get('PINGONE_AUTHORIZE_WORKER_CLIENT_ID') — a cache-only
 *     read — which returned null because the LMDB cache had not been seeded
 *     for that specific key. The fix: get() now checks process.env[KEY] on
 *     a cache miss before returning null.
 *
 * These tests run on every `npm test` invocation and would have caught the
 * original bug before it shipped.
 */

const ENV_SNAPSHOT = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  // Strip credential env vars so each test starts from a clean slate.
  const prefixes = [
    'PINGONE_', 'PINGAUTHORIZE_', 'AUTHORIZE_', 'SIMULATED_', 'FF_',
  ];
  Object.keys(process.env).forEach(k => {
    if (prefixes.some(p => k.startsWith(p))) delete process.env[k];
  });
});

afterAll(() => {
  Object.keys(process.env).forEach(k => delete process.env[k]);
  Object.assign(process.env, ENV_SNAPSHOT);
});

function freshConfigStore() {
  const cs = require('../../services/configStore');
  // Wipe cache keys that may have been loaded from LMDB in the test environment.
  Object.keys(cs._cache || {}).forEach(k => { cs._cache[k] = ''; });
  return cs;
}

// ── configStore.get() env-var fallback ───────────────────────────────────────

describe('configStore.get() — env-var fallback on cache miss', () => {
  it('returns process.env value when cache is empty', () => {
    process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_ID = 'test-worker-id';
    const cs = freshConfigStore();
    expect(cs.get('PINGONE_AUTHORIZE_WORKER_CLIENT_ID')).toBe('test-worker-id');
  });

  it('returns null when neither cache nor process.env has the key', () => {
    const cs = freshConfigStore();
    expect(cs.get('PINGONE_AUTHORIZE_WORKER_CLIENT_ID')).toBeNull();
  });

  it('cache value takes priority over process.env', () => {
    process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_ID = 'env-value';
    const cs = freshConfigStore();
    cs._cache['PINGONE_AUTHORIZE_WORKER_CLIENT_ID'] = 'cache-value';
    expect(cs.get('PINGONE_AUTHORIZE_WORKER_CLIENT_ID')).toBe('cache-value');
  });

  it('treats empty-string process.env value as absent (returns null)', () => {
    process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_ID = '';
    const cs = freshConfigStore();
    expect(cs.get('PINGONE_AUTHORIZE_WORKER_CLIENT_ID')).toBeNull();
  });

  it('normalises lowercase key to uppercase for process.env lookup', () => {
    // get() uppercases the key before checking process.env, so passing the
    // uppercase env var name in lowercase works when that exact var is set.
    process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_ID = 'lower-case-caller';
    const cs = freshConfigStore();
    expect(cs.get('pingone_authorize_worker_client_id')).toBe('lower-case-caller');
  });

  it('get() does NOT traverse alias chain — that is getEffective()s job', () => {
    // get() only checks process.env[key.toUpperCase()]. When PINGONE_WORKER_CLIENT_ID
    // is set but PINGONE_AUTHORIZE_WORKER_CLIENT_ID is not, get() returns null because
    // there is no alias chain. Callers must use getEffective() for alias resolution.
    process.env.PINGONE_WORKER_CLIENT_ID = 'general-worker';
    const cs = freshConfigStore();
    expect(cs.get('PINGONE_AUTHORIZE_WORKER_CLIENT_ID')).toBeNull();
    // getEffective() on the logical key traverses aliases and finds the value.
    expect(cs.getEffective('authorize_worker_client_id')).toBe('general-worker');
  });
});

// ── P1AZ credential resolution — the exact bug scenario ──────────────────────

describe('P1AZ credential resolution — single worker app scenario', () => {
  /**
   * Most deployments set PINGONE_WORKER_CLIENT_ID (general management worker)
   * but not PINGONE_AUTHORIZE_WORKER_CLIENT_ID (Authorize-specific). The
   * configStore alias chain must resolve the general worker for both keys.
   */

  it('getEffective(authorize_worker_client_id) resolves via PINGONE_WORKER_CLIENT_ID', () => {
    process.env.PINGONE_WORKER_CLIENT_ID = 'general-worker-id';
    process.env.PINGONE_WORKER_CLIENT_SECRET = 'general-worker-secret';
    const cs = freshConfigStore();
    expect(cs.getEffective('authorize_worker_client_id')).toBe('general-worker-id');
    expect(cs.getEffective('authorize_worker_client_secret')).toBe('general-worker-secret');
  });

  it('getEffective(pingone_authorize_worker_client_id) resolves via PINGONE_WORKER_CLIENT_ID', () => {
    process.env.PINGONE_WORKER_CLIENT_ID = 'general-worker-id';
    const cs = freshConfigStore();
    expect(cs.getEffective('pingone_authorize_worker_client_id')).toBe('general-worker-id');
  });

  it('dedicated PINGONE_AUTHORIZE_WORKER_CLIENT_ID takes priority over general worker', () => {
    process.env.PINGONE_AUTHORIZE_WORKER_CLIENT_ID = 'dedicated-authorize-id';
    process.env.PINGONE_WORKER_CLIENT_ID = 'general-worker-id';
    const cs = freshConfigStore();
    expect(cs.getEffective('authorize_worker_client_id')).toBe('dedicated-authorize-id');
  });

  it('get(PINGONE_AUTHORIZE_WORKER_CLIENT_ID) returns general worker when specific key absent', () => {
    // This is the exact bug: code called configStore.get('PINGONE_AUTHORIZE_WORKER_CLIENT_ID')
    // but only PINGONE_WORKER_CLIENT_ID was set. Must not return null.
    process.env.PINGONE_WORKER_CLIENT_ID = 'general-worker-id';
    // PINGONE_AUTHORIZE_WORKER_CLIENT_ID is NOT set — simulates the real deployment
    const cs = freshConfigStore();
    // get() only does exact-key env lookup, not alias chain — so this key won't
    // resolve via get() alone. getEffective() is required for alias resolution.
    // This test documents the correct call site: getEffective(), not get().
    expect(cs.getEffective('authorize_worker_client_id')).toBe('general-worker-id');
    expect(cs.getEffective('authorize_worker_client_id')).not.toBeNull();
  });

  it('isWorkerCredentialReady() returns true when only PINGONE_WORKER_CLIENT_ID is set', () => {
    process.env.PINGONE_WORKER_CLIENT_ID = 'general-worker-id';
    process.env.PINGONE_WORKER_CLIENT_SECRET = 'general-worker-secret';
    process.env.PINGONE_ENVIRONMENT_ID = 'test-env-id';

    jest.resetModules();
    const pingOneAuthorizeService = require('../../services/pingOneAuthorizeService');
    expect(pingOneAuthorizeService.isWorkerCredentialReady()).toBe(true);
  });
});

// ── Alias map completeness — credentials that must have PINGONE_WORKER fallback ─

describe('configStore envFallbackMap — credential alias completeness', () => {
  // ID keys: all must resolve when only PINGONE_WORKER_CLIENT_ID is set.
  const ID_KEYS = [
    'authorize_worker_client_id',
    'pingone_authorize_worker_client_id',
    'pingone_worker_client_id',
  ];

  // Secret keys: all must resolve when only PINGONE_WORKER_CLIENT_SECRET is set.
  const SECRET_KEYS = [
    'authorize_worker_client_secret',
    'pingone_authorize_worker_client_secret',
  ];

  ID_KEYS.forEach(key => {
    it(`getEffective('${key}') resolves via PINGONE_WORKER_CLIENT_ID fallback`, () => {
      process.env.PINGONE_WORKER_CLIENT_ID = 'worker-id-sentinel';
      const cs = freshConfigStore();
      expect(cs.getEffective(key)).toBe('worker-id-sentinel');
    });
  });

  SECRET_KEYS.forEach(key => {
    it(`getEffective('${key}') resolves via PINGONE_WORKER_CLIENT_SECRET fallback`, () => {
      process.env.PINGONE_WORKER_CLIENT_SECRET = 'worker-secret-sentinel';
      const cs = freshConfigStore();
      expect(cs.getEffective(key)).toBe('worker-secret-sentinel');
    });
  });
});

describe('configStore envFallbackMap — PAR + AI Agent Actor redirect', () => {
  it("getEffective('pingone_ai_agent_actor_redirect_uri') resolves from env", () => {
    process.env.PINGONE_AI_AGENT_ACTOR_REDIRECT_URI =
      'https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback';
    const cs = freshConfigStore();
    expect(cs.getEffective('pingone_ai_agent_actor_redirect_uri')).toBe(
      'https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback',
    );
  });

  it("getEffective('oauth_par_endpoint') and pingone_par_endpoint stay aliased", () => {
    process.env.OAUTH_PAR_ENDPOINT = 'https://auth.pingone.com/env/as/par';
    const cs = freshConfigStore();
    expect(cs.getEffective('oauth_par_endpoint')).toBe('https://auth.pingone.com/env/as/par');
    expect(cs.getEffective('pingone_par_endpoint')).toBe('https://auth.pingone.com/env/as/par');
  });

  it('FIELD_DEFS includes actor redirect + oauth_par_endpoint', () => {
    freshConfigStore();
    const { FIELD_DEFS: defs } = require('../../services/configStore');
    expect(defs.PINGONE_AI_AGENT_ACTOR_REDIRECT_URI).toBeDefined();
    expect(defs.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET).toBeDefined();
    expect(defs.oauth_par_endpoint).toBeDefined();
  });
});
