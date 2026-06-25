'use strict';

/**
 * Phase 269 Task 3 — configStore.setRaw({persist:false}) extension.
 *
 * Verifies:
 *   - existing setRaw(data) callers still persist (back-compat)
 *   - setRaw(data, {persist:false}) updates cache but does NOT write to storage
 *   - setRaw(data, {persist:true}) is equivalent to no opts (writes storage)
 *   - non-boolean opts.persist throws (strict type validation)
 *
 * Storage backend: LMDB (migrated from SQLite).
 */

const path = require('node:path');
const fs   = require('node:fs');

// Reset module cache so we get a fresh configStore each test.
function freshConfigStore() {
  const id = require.resolve('../../services/configStore');
  delete require.cache[id];
  // also clear the lmdb adapter cache
  const lmdbId = require.resolve('../../services/lmdb/configStore.lmdb');
  delete require.cache[lmdbId];
  const envId = require.resolve('../../services/lmdb/openEnv');
  delete require.cache[envId];
  // eslint-disable-next-line global-require
  return require('../../services/configStore');
}

function readLmdb(key) {
  const { open } = require('lmdb');
  // Honor the test-isolated LMDB path (setup.js) so this helper reads the same
  // store configStore writes to — not the operator's data/persistent/lmdb/.
  const lmdbPath = process.env.LMDB_PATH || path.join(__dirname, '..', '..', 'data', 'persistent', 'lmdb');
  if (!fs.existsSync(lmdbPath)) return undefined;
  const env = open({ path: lmdbPath, maxDbs: 16, encoding: 'json', readOnly: true });
  const db = env.openDB('config', { encoding: 'json' });
  const row = db.get(key.toUpperCase());
  env.close();
  return row;
}

describe('configStore.setRaw — persist option', () => {
  test('setRaw({k:v}) with no opts persists to LMDB (existing behavior)', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    const key = 'task3_test_key_default_' + Date.now();
    await c.setRaw({ [key]: 'value-default' });
    expect(c.getEffective(key)).toBe('value-default');
    const row = readLmdb(key);
    expect(row).toBeDefined();
    expect(row.value).toBe('value-default');
  });

  test('setRaw({k:v}, {persist:false}) updates cache but does NOT call LMDB upsert', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    const key = 'task3_test_key_no_persist_' + Date.now();
    await c.setRaw({ [key]: 'value-cache-only' }, { persist: false });
    expect(c.getEffective(key)).toBe('value-cache-only');
    const row = readLmdb(key);
    expect(row).toBeUndefined();
  });

  test('setRaw({k:v}, {persist:true}) is equivalent to no opts arg (writes LMDB)', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    const key = 'task3_test_key_explicit_true_' + Date.now();
    await c.setRaw({ [key]: 'value-explicit-true' }, { persist: true });
    expect(c.getEffective(key)).toBe('value-explicit-true');
    const row = readLmdb(key);
    expect(row).toBeDefined();
    expect(row.value).toBe('value-explicit-true');
  });

  test('setRaw({k:v}, {persist:"no"}) THROWS (strict type-check)', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    await expect(c.setRaw({ k: 'v' }, { persist: 'no' })).rejects.toThrow(
      /opts\.persist must be boolean, got string/,
    );
  });

  test('setRaw({k:v}, {persist:1}) THROWS (strict type-check)', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    await expect(c.setRaw({ k: 'v' }, { persist: 1 })).rejects.toThrow(
      /opts\.persist must be boolean, got number/,
    );
  });

  test('after setRaw({k:v}, {persist:false}), getEffective(k) returns "v"', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    const key = 'task3_get_effective_check_' + Date.now();
    await c.setRaw({ [key]: 'live-from-cache' }, { persist: false });
    expect(c.getEffective(key)).toBe('live-from-cache');
  });

  test('after setRaw({k:v}, {persist:false}), LMDB has no row for k', async () => {
    const c = freshConfigStore();
    await c.ensureInitialized();
    const key = 'task3_no_lmdb_row_' + Date.now();
    await c.setRaw({ [key]: 'cache-only' }, { persist: false });
    const row = readLmdb(key);
    expect(row).toBeUndefined();
  });
});
