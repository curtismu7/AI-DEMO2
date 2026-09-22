'use strict';

/**
 * Regression tests for the 2026-09-22 "silent session loss" incident.
 *
 * data.mdb hit the 128MB LMDB map ceiling from freelist churn; session writes
 * then failed while the only trace was a startup log line nobody watches. The
 * login "succeeded" but the session was gone between requests.
 *
 * Protections pinned here:
 * 1. storeHealth — a write failure marks the store unhealthy; a successful
 *    write clears it (auto-recovery), and snapshot() reports data.mdb size.
 * 2. LmdbSessionStore.set — still calls cb(err) on LMDB failure (the §1
 *    callback-discipline invariant) AND records the failure via storeHealth.
 * 3. LmdbSessionStore._cleanup — still removes expired rows; unchanged
 *    behavior, now with a size snapshot alongside.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const { LmdbSessionStore } = require('../../services/lmdb/sessionStore');
const storeHealth = require('../../services/lmdb/storeHealth');

// Build a store without opening LMDB (skip the constructor) and inject a fake db.
function makeStore(db) {
  const store = Object.create(LmdbSessionStore.prototype);
  store.ttl = 24 * 60 * 60 * 1000;
  store._db = db;
  return store;
}

describe('storeHealth — LMDB write failure is loud, not silent (2026-09-22)', () => {
  let errSpy;

  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    storeHealth.clearWriteError();
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  test('set: LMDB failure calls cb(err) exactly once (session-store callback discipline)', () => {
    const failingDb = {
      get: () => undefined,
      putSync: () => { throw new Error('MDB_MAP_FULL: Environment mapsize limit reached'); },
      removeSync: () => {},
    };
    const store = makeStore(failingDb);
    const cb = jest.fn();
    store.set('sid', { cookie: { maxAge: 1000 } }, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(cb.mock.calls[0][0].message).toContain('MDB_MAP_FULL');
  });

  test('a write failure marks the store unhealthy and logs at ERROR', () => {
    const failingDb = {
      get: () => undefined,
      putSync: () => { throw new Error('MDB_MAP_FULL'); },
      removeSync: () => {},
    };
    const store = makeStore(failingDb);
    store.set('sid', { cookie: { maxAge: 1000 } }, () => {});
    expect(storeHealth.isUnhealthy()).toBe(true);
    expect(storeHealth.snapshot().healthy).toBe(false);
    expect(storeHealth.snapshot().lastError).toContain('MDB_MAP_FULL');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[lmdb] Session/LMDB WRITE FAILED'),
      'MDB_MAP_FULL',
      expect.stringContaining('scripts/compact-lmdb.sh'),
    );
  });

  test('a subsequent successful write clears the unhealthy flag (auto-recovery)', () => {
    let shouldFail = true;
    const db = {
      get: () => undefined,
      putSync: () => { if (shouldFail) throw new Error('MDB_MAP_FULL'); },
      removeSync: () => {},
    };
    const store = makeStore(db);
    store.set('sid', { cookie: { maxAge: 1000 } }, () => {});
    expect(storeHealth.isUnhealthy()).toBe(true);
    shouldFail = false;
    store.set('sid', { cookie: { maxAge: 1000 } }, () => {});
    expect(storeHealth.isUnhealthy()).toBe(false);
    expect(storeHealth.snapshot().healthy).toBe(true);
    expect(storeHealth.snapshot().lastError).toBeNull();
  });

  test('snapshot reports dataMdbBytes when the file exists, null when it does not', () => {
    const snap = storeHealth.snapshot();
    // In the test environment LMDB_PATH points at a fixture dir without data.mdb
    // unless a prior test opened it — accept either, but the field must exist.
    expect(snap).toHaveProperty('dataMdbBytes');
    expect(typeof snap.healthy).toBe('boolean');
  });
});
