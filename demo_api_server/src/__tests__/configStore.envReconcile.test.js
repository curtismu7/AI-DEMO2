'use strict';

// In-memory fake of services/lmdb/configStore.lmdb so the reconcile logic is
// tested without touching disk. Keys are stored verbatim (UPPERCASE by caller).
// Variable must be prefixed with "mock" so babel-jest hoisting does not error.
const mockStore = new Map();
jest.mock('../../services/lmdb/configStore.lmdb', () => ({
  loadAll: () => [...mockStore.entries()].map(([key, value]) => ({ key, value, updated_at: 0 })),
  upsert: (k, v) => { mockStore.set(k, v); },
  remove: (k) => { mockStore.delete(k); },
}));

const { ENV_STAMP_KEY } = require('../../services/envReconcile');

describe('configStore env-id reconcile', () => {
  const origEnvId = process.env.PINGONE_ENVIRONMENT_ID;
  const origExchanger = process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID;

  beforeEach(() => { mockStore.clear(); jest.resetModules(); });

  afterEach(() => {
    // Restore env vars so other test suites are not polluted.
    if (origEnvId === undefined) delete process.env.PINGONE_ENVIRONMENT_ID;
    else process.env.PINGONE_ENVIRONMENT_ID = origEnvId;
    if (origExchanger === undefined) delete process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID;
    else process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID = origExchanger;
  });

  test('stale env-scoped LMDB row is purged on env change; .env wins; flag survives', async () => {
    // Seed an OLD-env exchanger id + stamp, plus an env-agnostic flag.
    mockStore.set('PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID', 'OLD-EXCHANGER');
    mockStore.set('FF_HITL_ENABLED', 'false');
    mockStore.set(ENV_STAMP_KEY, 'old-env');
    process.env.PINGONE_ENVIRONMENT_ID = 'new-env';
    process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID = 'NEW-EXCHANGER';

    await new Promise((resolve, reject) => jest.isolateModules(() => {
      const cs = require('../../services/configStore');
      cs.ensureInitialized().then(() => {
        expect(cs.getEnvReconcileVerdict()).toBe('reconcile');
        expect(cs.getEffective('pingone_mcp_token_exchanger_client_id')).toBe('NEW-EXCHANGER');
        expect(cs.getEffective('ff_hitl_enabled')).toBe('false'); // agnostic survives
        expect(mockStore.get(ENV_STAMP_KEY)).toBe('new-env');     // re-stamped
        expect(cs.lastEnvReconcile.purgedKeys).toContain('pingone_mcp_token_exchanger_client_id');
        resolve();
      }).catch(reject);
    }));
  });

  test('matching stamp is a no-op (no purge)', async () => {
    mockStore.set('PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID', 'KEEP');
    mockStore.set(ENV_STAMP_KEY, 'env-A');
    process.env.PINGONE_ENVIRONMENT_ID = 'env-A';
    await new Promise((r) => jest.isolateModules(() => {
      const cs = require('../../services/configStore');
      cs.ensureInitialized().then(() => {
        expect(cs.getEnvReconcileVerdict()).toBe('noop');
        expect(mockStore.get('PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID')).toBe('KEEP');
        r();
      });
    }));
  });
});
