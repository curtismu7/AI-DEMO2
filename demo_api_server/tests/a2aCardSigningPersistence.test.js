'use strict';

// TECH_DEBT.md 2026-09-11 "Agent Card signing key is process-ephemeral":
// getCardSigningKey() used to generate a fresh Ed25519 keypair on every
// process start, so a restart silently rotated it. ensureCardSigningKeyPersisted()
// (boot-time only, per server.js) closes that by reading/writing the key
// through the vault. These tests exercise that function directly against a
// fake vaultLib (the DI seam it already exposes), never the real vault file.

const crypto = require('node:crypto');
const {
  ensureCardSigningKeyPersisted,
  getCardSigningKey,
  _resetCardSigningKey,
  CARD_SIGNING_VAULT_KEY,
} = require('../services/a2aCardSigningService');

/** In-memory fake standing in for lib/vault's real openVault() handle. */
function fakeVaultLib(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries));
  const saveCalls = [];
  const setCalls = [];
  const openVault = jest.fn(async () => ({
    list: () => Array.from(store.keys()),
    read: (name) => {
      if (!store.has(name)) throw new Error(`vault: entry not found: ${name}`);
      return store.get(name);
    },
    set: (name, value) => { setCalls.push([name, value]); store.set(name, value); },
    save: jest.fn(async () => { saveCalls.push(true); }),
    close: jest.fn(),
  }));
  return { openVault, store, saveCalls, setCalls };
}

const REAL_ENV_KEY = process.env[CARD_SIGNING_VAULT_KEY];

describe('ensureCardSigningKeyPersisted', () => {
  afterEach(() => {
    _resetCardSigningKey();
    if (REAL_ENV_KEY === undefined) delete process.env[CARD_SIGNING_VAULT_KEY];
    else process.env[CARD_SIGNING_VAULT_KEY] = REAL_ENV_KEY;
  });

  test('no vaultPassword: no-ops without touching any vault, reports why', async () => {
    const vaultLib = fakeVaultLib();
    const result = await ensureCardSigningKeyPersisted({ vaultPath: '/x', vaultLib });
    expect(result).toEqual({ persisted: false, reason: 'no_vault_password' });
    expect(vaultLib.openVault).not.toHaveBeenCalled();
  });

  test('no vaultPath: no-ops the same way', async () => {
    const vaultLib = fakeVaultLib();
    const result = await ensureCardSigningKeyPersisted({ vaultPassword: 'pw', vaultLib });
    expect(result).toEqual({ persisted: false, reason: 'no_vault_password' });
    expect(vaultLib.openVault).not.toHaveBeenCalled();
  });

  test('first boot, empty vault: generates a key, persists it, and reports generated:true', async () => {
    const vaultLib = fakeVaultLib();
    const result = await ensureCardSigningKeyPersisted({ vaultPath: '/x', vaultPassword: 'pw', vaultLib });

    expect(result).toEqual({ persisted: true, generated: true });
    expect(vaultLib.setCalls).toHaveLength(1);
    expect(vaultLib.setCalls[0][0]).toBe(CARD_SIGNING_VAULT_KEY);
    // Never assert the literal key bytes — only that it's really a PKCS#8 PEM
    // (crypto.createPrivateKey either parses it or throws) and that saving it
    // actually happened.
    expect(() => crypto.createPrivateKey(vaultLib.setCalls[0][1])).not.toThrow();
    expect(vaultLib.saveCalls).toHaveLength(1);
    expect(process.env[CARD_SIGNING_VAULT_KEY]).toBe(vaultLib.setCalls[0][1]);
  });

  test('a persisted key already in the vault is read, not regenerated', async () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const existingPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
    const vaultLib = fakeVaultLib({ [CARD_SIGNING_VAULT_KEY]: existingPem });

    const result = await ensureCardSigningKeyPersisted({ vaultPath: '/x', vaultPassword: 'pw', vaultLib });

    expect(result).toEqual({ persisted: true, generated: false });
    expect(vaultLib.setCalls).toHaveLength(0); // never re-wrote an existing entry
    expect(vaultLib.saveCalls).toHaveLength(0); // never called save() for a read-only pass
    expect(process.env[CARD_SIGNING_VAULT_KEY]).toBe(existingPem);
  });

  test('"restart" continuity: the same persisted key survives across two calls, proving getCardSigningKey() does not silently rotate it', async () => {
    const vaultLib = fakeVaultLib();

    // "Process 1" boots, generates+persists a key, and derives its kid.
    await ensureCardSigningKeyPersisted({ vaultPath: '/x', vaultPassword: 'pw', vaultLib });
    const kidBeforeRestart = getCardSigningKey().kid;

    // Simulate a restart: drop the in-memory key AND the env bridge exactly as
    // a fresh process would start with neither set, then run the boot step
    // again against the SAME vault store (persisted across "restarts").
    _resetCardSigningKey();
    delete process.env[CARD_SIGNING_VAULT_KEY];

    await ensureCardSigningKeyPersisted({ vaultPath: '/x', vaultPassword: 'pw', vaultLib });
    const kidAfterRestart = getCardSigningKey().kid;

    expect(kidAfterRestart).toBe(kidBeforeRestart);
    // Only ever wrote once — the first boot's generation, never a second one.
    expect(vaultLib.setCalls).toHaveLength(1);
  });

  test('a vault error is non-fatal, never leaks key material, and getCardSigningKey() still falls back to an ephemeral key', async () => {
    const vaultLib = fakeVaultLib();
    vaultLib.openVault.mockRejectedValue(new Error('vault: incorrect password or corrupted file'));
    const warn = jest.fn();

    const result = await ensureCardSigningKeyPersisted({
      vaultPath: '/x', vaultPassword: 'wrong', vaultLib, logger: { warn },
    });

    expect(result).toEqual({ persisted: false, reason: 'vault_error' });
    expect(warn).toHaveBeenCalledTimes(1);
    const loggedArgs = warn.mock.calls[0].join(' ');
    expect(loggedArgs).toMatch(/incorrect password or corrupted file/);
    expect(loggedArgs).not.toMatch(/-----BEGIN/); // no PEM ever reached the logger
    // Falls all the way through to the pre-existing ephemeral-key behavior —
    // this call must still resolve to SOME usable key, not throw.
    expect(getCardSigningKey().privateKey).toBeDefined();
  });

  test('a key sourced from the vault produces the same public-JWK shape the JWKS endpoint already serves', async () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const existingPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
    const vaultLib = fakeVaultLib({ [CARD_SIGNING_VAULT_KEY]: existingPem });

    await ensureCardSigningKeyPersisted({ vaultPath: '/x', vaultPassword: 'pw', vaultLib });
    const key = getCardSigningKey();

    expect(key.publicJwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
    expect(typeof key.kid).toBe('string');
    expect(key.kid.length).toBeGreaterThan(0);
  });
});
