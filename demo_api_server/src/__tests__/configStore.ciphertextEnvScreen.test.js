'use strict';

/**
 * "encrypted:..." is configStore's OWN ciphertext format. It belongs in LMDB
 * rows, never in .env — the 2026-08-21 invalid_client incident was an
 * export/import round-trip writing it there literally, where it shadowed a
 * correct vault-held secret and got sent to PingOne AS the client_secret.
 *
 * getEffective()'s readEnv() was hardened for that. get() was not, and get() has
 * its own independent process.env fallback — so getEffective() rejected the
 * value in readEnv() and then handed it straight back through
 * readStored() -> get(). These tests pin BOTH readers.
 */

jest.mock('../../services/lmdb/configStore.lmdb', () => ({
  loadAll: jest.fn(() => []),
  upsert: jest.fn(),
  get: jest.fn(() => null),
  remove: jest.fn(),
}));

// A key with an ENV_FALLBACK_MAP alias, so getEffective() exercises readEnv()
// AND the readStored() alias loop.
const KEY = 'gw_introspection_client_secret';
const ENV_VAR = 'GW_INTROSPECTION_CLIENT_SECRET';
const CIPHERTEXT = 'encrypted:t8Jq2mVn0Zx1QpLd';

const ENV_SNAPSHOT = { ...process.env };

describe('configStore — internal ciphertext in .env is refused by BOTH env readers', () => {
  let warnSpy;

  beforeEach(() => {
    jest.resetModules();
    delete process.env[ENV_VAR];
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    Object.keys(process.env).forEach((k) => delete process.env[k]);
    Object.assign(process.env, ENV_SNAPSHOT);
  });

  it('get() does not return an "encrypted:..." env value', () => {
    process.env[ENV_VAR] = CIPHERTEXT;
    const configStore = require('../../services/configStore');
    // Before the shared screen this returned the ciphertext verbatim.
    expect(configStore.get(ENV_VAR)).toBeNull();
  });

  it('getEffective() does not leak it through readStored() -> get()', () => {
    process.env[ENV_VAR] = CIPHERTEXT;
    const configStore = require('../../services/configStore');
    const v = configStore.getEffective(KEY);
    expect(v).not.toBe(CIPHERTEXT);
    expect(String(v || '')).not.toContain('encrypted:');
  });

  it('warns once per key, not once per call — get() is on hot paths', () => {
    process.env[ENV_VAR] = CIPHERTEXT;
    const configStore = require('../../services/configStore');
    configStore.get(ENV_VAR);
    configStore.get(ENV_VAR);
    configStore.get(ENV_VAR);
    const hits = warnSpy.mock.calls
      .map((c) => c.join(' '))
      .filter((m) => m.includes(ENV_VAR) && m.includes('internal ciphertext'));
    expect(hits).toHaveLength(1);
  });

  it('a normal env value still resolves through both readers', () => {
    process.env[ENV_VAR] = '  a-real-secret  ';
    const configStore = require('../../services/configStore');
    expect(configStore.get(ENV_VAR)).toBe('  a-real-secret  ');
    expect(configStore.getEffective(KEY)).toBe('a-real-secret');
  });

  it('a value merely CONTAINING "encrypted:" is untouched — only the prefix is the signal', () => {
    process.env[ENV_VAR] = 'pw-not-encrypted:really';
    const configStore = require('../../services/configStore');
    expect(configStore.get(ENV_VAR)).toBe('pw-not-encrypted:really');
  });
});
