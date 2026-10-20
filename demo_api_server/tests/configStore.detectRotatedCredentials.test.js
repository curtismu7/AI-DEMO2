/**
 * detectRotatedCredentials — the boot-time rotation-drift detector.
 *
 * The watchlist is derived from ENV_FALLBACK_MAP × SECRET_KEYS (plus a
 * _secret/_password/_api_key suffix rule) instead of a hand-maintained table.
 * The original table watched 'pingone_admin_client_secret' while the live
 * admin-login key is 'admin_client_secret' (PINGONE_ADMIN_CLIENT_SECRET
 * family) — so a rotated admin secret survived every boot check unnoticed.
 * These specs pin the derivation so a key rename can't silently unwatch again.
 */
'use strict';

describe('detectRotatedCredentials watchlist derivation', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.PINGONE_ADMIN_CLIENT_SECRET;
    delete process.env.DEMO_USER_PASSWORD;
    for (const k of ['PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET', 'AGENT_CLIENT_SECRET', 'PINGONE_AGENT_CLIENT_SECRET']) delete process.env[k];
  });

  async function loadWith(cache) {
    const configStore = require('../services/configStore');
    await configStore.setRaw(cache, { persist: false });
    return configStore.detectRotatedCredentials();
  }

  it('warns when the admin client secret differs between env and cache', async () => {
    process.env.PINGONE_ADMIN_CLIENT_SECRET = 'env-rotated-value';
    const warnings = await loadWith({ admin_client_secret: 'stale-lmdb-value' });
    const hit = warnings.find((w) => w.includes('PINGONE_ADMIN_CLIENT_SECRET'));
    expect(hit).toBeDefined();
    expect(hit).toContain('admin_client_secret');
  });

  it('does not warn when env and cache agree', async () => {
    process.env.PINGONE_ADMIN_CLIENT_SECRET = 'same-value-both-tiers';
    const warnings = await loadWith({ admin_client_secret: 'same-value-both-tiers' });
    expect(warnings.some((w) => w.includes('PINGONE_ADMIN_CLIENT_SECRET'))).toBe(false);
  });

  it('does not warn when the key is absent from the cache (nothing stale possible)', async () => {
    process.env.PINGONE_ADMIN_CLIENT_SECRET = 'only-in-env';
    const warnings = await loadWith({});
    expect(warnings.some((w) => w.includes('PINGONE_ADMIN_CLIENT_SECRET'))).toBe(false);
  });

  it('does not warn when the env var is unset (nothing to compare against)', async () => {
    const warnings = await loadWith({ admin_client_secret: 'lmdb-value-no-env' });
    expect(warnings.some((w) => w.includes('admin_client_secret'))).toBe(false);
  });

  it('watches demo_password via its DEMO_USER_PASSWORD alias', async () => {
    process.env.DEMO_USER_PASSWORD = 'fresh-from-env';
    const warnings = await loadWith({ demo_password: 'stale-in-lmdb' });
    expect(warnings.some((w) => w.includes('DEMO_USER_PASSWORD'))).toBe(true);
  });

  // AGENT_CLIENT_SECRET is an alias of BOTH pingone_ai_agent_client_secret (the
  // actor app) and pingone_agent_client_secret (the main agent app) — different
  // apps. It must only be compared against the key where it is the effective alias.
  it('does not warn on a shadowed alias that belongs to a different app', async () => {
    process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET = 'actor-secret';
    process.env.AGENT_CLIENT_SECRET = 'main-agent-secret';
    const warnings = await loadWith({
      pingone_ai_agent_client_secret: 'actor-secret',
      pingone_agent_client_secret: 'main-agent-secret',
    });
    expect(warnings.filter((w) => w.includes('config-rotation'))).toEqual([]);
  });

  it('still warns when the effective alias really drifted', async () => {
    process.env.AGENT_CLIENT_SECRET = 'rotated-main-agent-secret';
    const warnings = await loadWith({ pingone_agent_client_secret: 'stale-main-agent-secret' });
    expect(warnings.some((w) => w.includes('AGENT_CLIENT_SECRET') && w.includes('pingone_agent_client_secret'))).toBe(true);
  });
});
