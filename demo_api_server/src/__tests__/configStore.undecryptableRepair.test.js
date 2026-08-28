'use strict';

/**
 * An LMDB secret row that no longer decrypts (rotated or mismatched
 * CONFIG_ENCRYPTION_KEY) used to be a permanent condition: _decrypt warns and
 * returns '', so the credential reads as "not set" and the same warning repeats
 * on every boot forever, even when a perfectly good raw value sits in .env.
 *
 * _loadFromLmdb now adopts that env fallback and re-encrypts the row under the
 * current key. The guard that matters is the second test: an "encrypted:..."
 * env value is this module's OWN ciphertext leaking back through .env — the
 * 2026-08-21 invalid_client incident — and must never be adopted as plaintext.
 */

const KEY = 'gw_introspection_client_secret';
const ENV_VAR = 'GW_INTROSPECTION_CLIENT_SECRET';

jest.mock('../../services/lmdb/configStore.lmdb', () => ({
  loadAll: jest.fn(() => []),
  upsert: jest.fn(),
  get: jest.fn(() => null),
  remove: jest.fn(),
}));

const ENV_SNAPSHOT = { ...process.env };

describe('configStore._loadFromLmdb — undecryptable secret rows', () => {
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    process.env.CONFIG_ENCRYPTION_KEY = 'test-key-for-repair-suite';
    delete process.env[ENV_VAR];
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    Object.keys(process.env).forEach((k) => delete process.env[k]);
    Object.assign(process.env, ENV_SNAPSHOT);
  });

  // Not real ciphertext, so _decrypt throws and returns '' — the exact state a
  // rotated key leaves behind.
  const UNDECRYPTABLE = Buffer.from('not-really-ciphertext-at-all').toString('base64');

  it('adopts a raw env fallback and re-encrypts the row', () => {
    process.env[ENV_VAR] = '  real-secret-value  ';
    const lmdb = require('../../services/lmdb/configStore.lmdb');
    lmdb.loadAll.mockReturnValue([{ key: KEY, value: UNDECRYPTABLE }]);

    const configStore = require('../../services/configStore');
    configStore._loadFromLmdb();

    // Trimmed, and actually usable rather than ''.
    expect(configStore.get(KEY)).toBe('real-secret-value');
    // Row rewritten under the current key, so the next boot decrypts cleanly.
    const write = lmdb.upsert.mock.calls.find((c) => c[0] === KEY);
    expect(write).toBeDefined();
    expect(write[1]).not.toBe(UNDECRYPTABLE);
  });

  it('never adopts an "encrypted:..." env value as plaintext', () => {
    process.env[ENV_VAR] = 'encrypted:AAAAAAAAAAAAAAAAAAAA';
    const lmdb = require('../../services/lmdb/configStore.lmdb');
    lmdb.loadAll.mockReturnValue([{ key: KEY, value: UNDECRYPTABLE }]);

    const configStore = require('../../services/configStore');
    configStore._loadFromLmdb();

    // The repair must neither cache it nor persist it. (get() separately falls
    // through to process.env on an empty cache value and would hand back the
    // raw "encrypted:..." string — that fallthrough lives in get(), not here,
    // and readEnv() is the layer that screens it. Out of scope for this change.)
    expect(lmdb.upsert.mock.calls.find((c) => c[0] === KEY)).toBeUndefined();
  });

  it('leaves a decryptable row untouched — no repair write', () => {
    const configStore = require('../../services/configStore');
    const lmdb = require('../../services/lmdb/configStore.lmdb');
    // A non-secret key never goes near _decrypt, so nothing should be rewritten.
    lmdb.loadAll.mockReturnValue([{ key: 'some_plain_key', value: 'plain-value' }]);

    configStore._loadFromLmdb();

    expect(configStore.get('some_plain_key')).toBe('plain-value');
    expect(lmdb.upsert).not.toHaveBeenCalled();
  });
});
