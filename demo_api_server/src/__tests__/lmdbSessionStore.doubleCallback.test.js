'use strict';

/**
 * Regression test for the 2026-06-12 login self-destruct.
 *
 * LmdbSessionStore methods used to invoke their SUCCESS callback inside the
 * try block. The express-session save callback runs app code (the OAuth
 * callback's posthog.identify, redirect, etc). When that code threw
 * synchronously, the throw re-entered catch and fired cb(err) a SECOND time —
 * express-session then treated the just-saved session as a failed save and
 * destroyed it. The fix: the success callback must run OUTSIDE the try so a
 * throwing consumer callback can never be misreported as an LMDB error.
 */

const { LmdbSessionStore } = require('../../services/lmdb/sessionStore');

// Build a store without opening LMDB (skip the constructor) and inject a fake db.
function makeStore(db) {
  const store = Object.create(LmdbSessionStore.prototype);
  store.ttl = 24 * 60 * 60 * 1000;
  store._db = db;
  return store;
}

const okDb = {
  get: () => undefined,
  putSync: () => {},
  removeSync: () => {},
};

describe('LmdbSessionStore — success callback runs outside try (no double-callback)', () => {
  test('set: a throwing success callback is NOT re-invoked with an error', () => {
    const store = makeStore(okDb);
    let calls = 0;
    const cb = () => {
      calls += 1;
      throw new Error('consumer boom');
    };
    // The consumer's throw must propagate, not be swallowed and re-reported.
    expect(() => store.set('sid', { cookie: { maxAge: 1000 } }, cb)).toThrow('consumer boom');
    expect(calls).toBe(1); // exactly once — never cb(err) a second time
  });

  test('set: a real LMDB write error is reported once via cb(err)', () => {
    const store = makeStore({ putSync: () => { throw new Error('lmdb down'); } });
    const errs = [];
    store.set('sid', { cookie: { maxAge: 1000 } }, (e) => errs.push(e));
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toBe('lmdb down');
  });

  test('destroy: a throwing success callback is NOT re-invoked with an error', () => {
    const store = makeStore(okDb);
    let calls = 0;
    const cb = () => {
      calls += 1;
      throw new Error('consumer boom');
    };
    expect(() => store.destroy('sid', cb)).toThrow('consumer boom');
    expect(calls).toBe(1);
  });

  test('get: a throwing success callback is NOT re-invoked with an error', () => {
    const store = makeStore({ get: () => ({ sess: { foo: 1 }, expire: Date.now() + 10000 }) });
    let calls = 0;
    const cb = () => {
      calls += 1;
      throw new Error('consumer boom');
    };
    expect(() => store.get('sid', cb)).toThrow('consumer boom');
    expect(calls).toBe(1);
  });
});
