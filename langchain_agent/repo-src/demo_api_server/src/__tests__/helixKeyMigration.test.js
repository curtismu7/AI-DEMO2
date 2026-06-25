// banking_api_server/src/__tests__/helixKeyMigration.test.js
'use strict';
const { migrateHelixKey } = require('../../services/helixKeyMigration');

function mkVault() {
  const store = {};
  const vault = {
    set: jest.fn((n, v) => { store[n] = v; }),
    save: jest.fn(() => Promise.resolve()),
    close: jest.fn(),
    list: () => Object.keys(store),
    read: (n) => store[n],
    _store: store,
  };
  return { vault, vaultLib: { openVault: jest.fn(() => Promise.resolve(vault)) } };
}

describe('migrateHelixKey', () => {
  test('no keyfile → migrated:false reason no_keyfile', async () => {
    const cfg = { get: () => '', setConfig: jest.fn() };
    const r = await migrateHelixKey({
      agentName: 'LLM2', vaultPath: '/x/secrets.vault', vaultPassword: 'pw',
      configStore: cfg, vaultLib: mkVault().vaultLib,
      keyLoader: { loadAgentKey: () => null }, logger: { log() {}, error() {} },
    });
    expect(r).toEqual({ migrated: false, reason: 'no_keyfile' });
    expect(cfg.setConfig).not.toHaveBeenCalled();
  });

  test('existing key in configStore → idempotent no-op', async () => {
    const cfg = { get: () => 'already-set-key', setConfig: jest.fn() };
    const r = await migrateHelixKey({
      agentName: 'LLM2', vaultPath: '/x/secrets.vault', vaultPassword: 'pw',
      configStore: cfg, vaultLib: mkVault().vaultLib,
      keyLoader: { loadAgentKey: () => 'KEYFILE' }, logger: { log() {}, error() {} },
    });
    expect(r).toEqual({ migrated: false, reason: 'already_present' });
    expect(cfg.setConfig).not.toHaveBeenCalled();
  });

  test('keyfile present + vault password → writes vault AND sqlite', async () => {
    const cfg = { get: () => '', setConfig: jest.fn(() => Promise.resolve()) };
    const { vault, vaultLib } = mkVault();
    const r = await migrateHelixKey({
      agentName: 'LLM2', vaultPath: '/x/secrets.vault', vaultPassword: 'pw',
      configStore: cfg, vaultLib,
      keyLoader: { loadAgentKey: () => 'KEYFILE_SECRET' }, logger: { log() {}, error() {} },
    });
    expect(r.migrated).toBe(true);
    expect(r.vaultWritten).toBe(true);
    expect(r.sqliteWritten).toBe(true);
    expect(vault.set).toHaveBeenCalledWith('HELIX_API_KEY', 'KEYFILE_SECRET');
    expect(vault.save).toHaveBeenCalled();
    expect(vault.close).toHaveBeenCalled();
    expect(cfg.setConfig).toHaveBeenCalledWith({ helix_api_key: 'KEYFILE_SECRET' });
  });

  test('no vault password → sqlite only, vault skipped', async () => {
    const cfg = { get: () => '', setConfig: jest.fn(() => Promise.resolve()) };
    const { vaultLib } = mkVault();
    const r = await migrateHelixKey({
      agentName: 'LLM2', vaultPath: '/x/secrets.vault', vaultPassword: '',
      configStore: cfg, vaultLib,
      keyLoader: { loadAgentKey: () => 'KEYFILE_SECRET' }, logger: { log() {}, error() {} },
    });
    expect(r.migrated).toBe(true);
    expect(r.vaultWritten).toBe(false);
    expect(r.sqliteWritten).toBe(true);
    expect(vaultLib.openVault).not.toHaveBeenCalled();
  });

  test('vault.close() runs even if vault.set throws', async () => {
    const cfg = { get: () => '', setConfig: jest.fn(() => Promise.resolve()) };
    const { vault, vaultLib } = mkVault();
    vault.set = jest.fn(() => { throw new Error('boom'); });
    await expect(migrateHelixKey({
      agentName: 'LLM2', vaultPath: '/x/secrets.vault', vaultPassword: 'pw',
      configStore: cfg, vaultLib,
      keyLoader: { loadAgentKey: () => 'K' }, logger: { log() {}, error() {} },
    })).rejects.toThrow('boom');
    expect(vault.close).toHaveBeenCalled();
  });
});
