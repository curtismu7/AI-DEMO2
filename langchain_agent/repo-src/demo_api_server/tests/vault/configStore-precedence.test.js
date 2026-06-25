'use strict';

/**
 * Config precedence — Vault > LMDB > .env with a bootstrap allowlist.
 *
 * Pattern mirrors tests/vault/configStore-persistFalse.test.js: fresh
 * configStore singleton per test via require-cache reset. We simulate the
 * three tiers with the public API:
 *   - vault tier   → setRaw(data, {persist:false})  (in-memory, provenance=vault)
 *   - lmdb tier   → setRaw(data, {persist:true})   (provenance=sqlite/lmdb)
 *   - env tier     → process.env[ENV_NAME]
 */

const path = require('node:path');
const fs   = require('node:fs');

function freshConfigStore() {
  const id = require.resolve('../../services/configStore');
  delete require.cache[id];
  // eslint-disable-next-line global-require
  return require('../../services/configStore');
}

function removeFromLmdb(...keys) {
  try {
    const { open } = require('lmdb');
    // Honor the test-isolated LMDB path (setup.js) so cleanup hits the same
    // store configStore writes to — not the operator's data/persistent/lmdb/.
    const lmdbPath = process.env.LMDB_PATH || path.join(__dirname, '..', '..', 'data', 'persistent', 'lmdb');
    if (!fs.existsSync(lmdbPath)) return;
    const env = open({ path: lmdbPath, maxDbs: 16, encoding: 'json' });
    const db = env.openDB('config', { encoding: 'json' });
    for (const key of keys) db.removeSync(key.toUpperCase());
    env.close();
  } catch (_) { /* best-effort cleanup */ }
}

describe('configStore provenance — vault is not clobbered by LMDB', () => {
  test('LMDB write of a vault-owned key does NOT overwrite the vault value', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    const key = 'helix_model';

    await c.setRaw({ [key]: 'VAULT-VALUE' }, { persist: false });
    expect(c.getEffective(key)).toBe('VAULT-VALUE');

    await c.setRaw({ [key]: 'LMDB-VALUE' }, { persist: true });
    expect(c.getEffective(key)).toBe('VAULT-VALUE');
  });

  test('LMDB value is used when the vault did NOT supply that key', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    const key = 'helix_base_url';
    await c.setRaw({ [key]: 'http://lmdb-helix.example.com' }, { persist: true });
    expect(c.getEffective(key)).toBe('http://lmdb-helix.example.com');
  });
});

describe('configStore key casing — UPPER-canonical regardless of caller/storage case', () => {
  test('setConfig with an UPPER FIELD_DEFS key is readable via getEffective (both cases)', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    delete process.env.PINGONE_ENVIRONMENT_ID;
    await c.setConfig({ PINGONE_ENVIRONMENT_ID: 'cfg-env-id' });
    expect(c.getEffective('PINGONE_ENVIRONMENT_ID')).toBe('cfg-env-id');
    expect(c.getEffective('pingone_environment_id')).toBe('cfg-env-id');
  });

  test('get() resolves regardless of the case the caller passes', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    await c.setRaw({ ff_authorize_fail_open: 'true' }, { persist: false });
    expect(c.get('ff_authorize_fail_open')).toBe('true');
    expect(c.get('FF_AUTHORIZE_FAIL_OPEN')).toBe('true');
  });

  test('vault value still outranks a later LMDB write (provenance preserved) with UPPER keys', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    await c.setRaw({ Pingone_Region: 'vault-region' }, { persist: false });
    await c.setRaw({ pingone_region: 'lmdb-region' }, { persist: true });
    expect(c.get('PINGONE_REGION')).toBe('vault-region');
  });
});

describe('configStore secret encrypt/decrypt round-trips regardless of key casing', () => {
  const SECRET_CASES = [
    'mcp_gw_client_secret',
    'demo_password',
    'PINGONE_ADMIN_CLIENT_SECRET',
  ];

  beforeEach(() => {
    removeFromLmdb(...SECRET_CASES);
  });

  function reloadedConfigStore() {
    let mod;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      mod = require('../../services/configStore');
    });
    return mod;
  }

  for (const key of SECRET_CASES) {
    test(`${key}: set via setConfig, survives a reload as plaintext (not ciphertext)`, async () => {
      const c = reloadedConfigStore();
      await c.ensureInitialized();
      const plaintext = `RT-${key}-VALUE`;
      await c.setConfig({ [key]: plaintext });
      const c2 = reloadedConfigStore();
      await c2.ensureInitialized();
      expect(c2.getEffective(key)).toBe(plaintext);
    });
  }
});

describe('getEffective precedence — Vault > LMDB > .env with bootstrap allowlist', () => {
  const SAVED = {};
  const ENVV = ['HELIX_MODEL', 'HELIX_BASE_URL', 'PINGONE_REGION', 'PINGONE_ENVIRONMENT_ID'];
  beforeEach(() => { for (const k of ENVV) SAVED[k] = process.env[k]; });
  afterEach(() => {
    for (const k of ENVV) {
      if (SAVED[k] === undefined) delete process.env[k];
      else process.env[k] = SAVED[k];
    }
  });

  function reloadedConfigStore() {
    let mod;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      mod = require('../../services/configStore');
    });
    return mod;
  }

  test('non-bootstrap key: vault (persist:false) beats a conflicting .env value', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    process.env.HELIX_MODEL = 'env-model';
    await c.setRaw({ helix_model: 'vault-model' }, { persist: false });
    expect(c.getEffective('helix_model')).toBe('vault-model');
  });

  test('non-bootstrap key: LMDB (persist:true) beats a conflicting .env value', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    process.env.HELIX_BASE_URL = 'http://env-helix.example.com';
    await c.setRaw({ helix_base_url: 'http://lmdb-helix.example.com' }, { persist: true });
    expect(c.getEffective('helix_base_url')).toBe('http://lmdb-helix.example.com');
  });

  test('non-bootstrap key: .env used when neither vault nor LMDB set it', async () => {
    removeFromLmdb('DEMO_APIKEY_BACKEND_SERVICE_KEY');
    const saved = process.env.DEMO_APIKEY_SERVICE_KEY;
    const sentinel = `env-fallback-proof-${Date.now()}`;
    process.env.DEMO_APIKEY_SERVICE_KEY = sentinel;
    try {
      const c = reloadedConfigStore();
      await c.ensureInitialized();
      expect(c.getEffective('demo_apikey_backend_service_key')).toBe(sentinel);
    } finally {
      if (saved === undefined) delete process.env.DEMO_APIKEY_SERVICE_KEY;
      else process.env.DEMO_APIKEY_SERVICE_KEY = saved;
    }
  });

  test('BOOTSTRAP key (pingone_region): .env wins even over a cache value', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    process.env.PINGONE_REGION = 'env-region';
    await c.setRaw({ pingone_region: 'vault-region' }, { persist: false });
    expect(c.getEffective('pingone_region')).toBe('env-region');
  });

  test('BOOTSTRAP key (pingone_environment_id): .env wins over a LMDB value', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    process.env.PINGONE_ENVIRONMENT_ID = 'env-eid';
    await c.setRaw({ pingone_environment_id: 'lmdb-eid' }, { persist: true });
    expect(c.getEffective('pingone_environment_id')).toBe('env-eid');
  });

  test('BOOTSTRAP key falls back to cache when .env is unset', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    delete process.env.PINGONE_REGION;
    await c.setRaw({ pingone_region: 'cache-region-fallback' }, { persist: false });
    expect(c.getEffective('pingone_region')).toBe('cache-region-fallback');
  });
});

describe('configStore FIELD_DEFS defaults reachable for UPPER keys', () => {
  test('getEffective(UPPER key) returns FIELD_DEFS default when nothing else set', async () => {
    removeFromLmdb('PINGONE_REGION');
    const saved = process.env.PINGONE_REGION;
    delete process.env.PINGONE_REGION;
    try {
      const c2 = freshConfigStore();
      await c2.ensureInitialized();
      expect(c2.getEffective('PINGONE_REGION')).toBe('com');
      expect(c2.getEffective('pingone_region')).toBe('com');
    } finally {
      if (saved === undefined) delete process.env.PINGONE_REGION;
      else process.env.PINGONE_REGION = saved;
    }
  });
});
