'use strict';

/**
 * Regression test: loadVaultIntoConfigStore MUST await configStore.ensureInitialized()
 * before consulting filterVaultForReconcile, so the env-id reconcile verdict is computed
 * in time to drop stale env-scoped vault secrets.
 *
 * Without the fix, verdict is null at the point filterVaultForReconcile runs, it
 * short-circuits, and the stale vault secret is cached with 'vault' provenance which
 * outranks .env in getEffective — silently defeating the LMDB purge.
 *
 * Test drives the REAL loadVaultIntoConfigStore + REAL configStore with an in-memory
 * LMDB fake (same pattern as configStore.envReconcile.test.js).
 */

// In-memory LMDB fake. Variable must be prefixed "mock" for babel-jest hoisting.
const mockStore = new Map();
jest.mock('../../services/lmdb/configStore.lmdb', () => ({
  loadAll: () => [...mockStore.entries()].map(([key, value]) => ({ key, value, updated_at: 0 })),
  upsert:  (k, v) => { mockStore.set(k, v); },
  remove:  (k) => { mockStore.delete(k); },
}));

// Mock the vault library so openVault returns a fake vault containing ONE
// env-scoped secret seeded from the old environment.
jest.mock('../../lib/vault', () => ({
  openVault: async (_path, _password) => ({
    list:  () => ['pingone_ai_agent_client_secret'],
    read:  (name) => name === 'pingone_ai_agent_client_secret' ? 'STALE_VAULT_SECRET' : '',
    close: () => {},
  }),
}));

const { ENV_STAMP_KEY } = require('../../services/envReconcile');

describe('vaultLoader.reconcileSequence — stale vault secret is dropped when env changes', () => {
  const origEnvId   = process.env.PINGONE_ENVIRONMENT_ID;
  const origSecret  = process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET;
  const origVaultPw = process.env.VAULT_PASSWORD;

  beforeEach(() => {
    mockStore.clear();
    jest.resetModules();
  });

  afterEach(() => {
    // Restore env vars so other suites are not polluted.
    if (origEnvId === undefined)  delete process.env.PINGONE_ENVIRONMENT_ID;
    else process.env.PINGONE_ENVIRONMENT_ID = origEnvId;

    if (origSecret === undefined) delete process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET;
    else process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET = origSecret;

    if (origVaultPw === undefined) delete process.env.VAULT_PASSWORD;
    else process.env.VAULT_PASSWORD = origVaultPw;
  });

  test('stale vault secret is NOT cached when env changed; .env value wins', async () => {
    // Seed OLD env id stamp so reconcile verdict becomes 'reconcile'.
    mockStore.set(ENV_STAMP_KEY, 'old-env-id');

    // Current .env points to the NEW environment.
    process.env.PINGONE_ENVIRONMENT_ID = 'new-env-id';
    // The correct .env-side secret for the NEW environment.
    process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET = 'FRESH_ENV_SECRET';
    // Vault password (any value; vault is mocked).
    process.env.VAULT_PASSWORD = 'test-password';

    await new Promise((resolve, reject) => jest.isolateModules(async () => {
      try {
        const configStore = require('../../services/configStore');
        const { loadVaultIntoConfigStore } = require('../../services/vaultLoader');

        // Use a fake vault path that "exists" by overriding fs.existsSync via opts.
        // Supply vaultPath as a string that passes existsSync — we override the whole
        // vaultLib via jest.mock above, so path only needs to satisfy the existsSync guard.
        // We use __filename (this test file) as a stand-in — it exists on disk.
        const result = await loadVaultIntoConfigStore({
          vaultPath: __filename,
          password:  'test-password',
          configStore,
        });

        expect(result.loaded).toBe(true);

        // CRITICAL assertion: reconcile verdict was computed; vault secret dropped.
        expect(configStore.getEnvReconcileVerdict()).toBe('reconcile');

        // The stale vault value must NOT win — .env (FRESH_ENV_SECRET) must be the effective value.
        expect(configStore.getEffective('pingone_ai_agent_client_secret')).toBe('FRESH_ENV_SECRET');

        // recordVaultDropped must have been called with the dropped key.
        expect(configStore.lastEnvReconcile.vaultDropped).toContain('pingone_ai_agent_client_secret');

        resolve();
      } catch (err) {
        reject(err);
      }
    }));
  });
});
