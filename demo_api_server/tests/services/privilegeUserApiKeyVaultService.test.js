'use strict';

jest.mock('../../services/lmdb/configStore.lmdb', () => ({ loadAll: jest.fn(() => []), upsert: jest.fn() }));
const configStore = require('../../services/configStore');
const KEY = 'PRIVILEGE_USER_API_KEY';
const SECRET = 'PRIVILEGE_USER_API_SECRET';
const keyValue = 'test-key-middle-abcd';
const secretValue = 'test-secret-middle-wxyz';
const baseUrl = 'https://controller.example.test';
let service;
beforeEach(() => {
  configStore._cache = {};
  configStore._provenance = {};
  jest.spyOn(configStore, 'ensureInitialized').mockResolvedValue();
  jest.spyOn(configStore, 'setRaw');
});
afterEach(() => jest.restoreAllMocks());

// Vault I/O is mocked; each handle stages a snapshot until save succeeds.
function fixture() {
  const persisted = { [KEY]: keyValue, [SECRET]: secretValue };
  const staged = { ...persisted };
  const vault = {
    set: jest.fn((name, value) => { staged[name] = value; }),
    save: jest.fn(async () => { Object.assign(persisted, staged); }),
    close: jest.fn(),
  };
  const vaultLib = { openVault: jest.fn(async () => vault) };
  const logger = { error: jest.fn(), log: jest.fn() };
  return { persisted, vault, vaultLib, logger, options: {
    configStore, vaultLib, vaultPath: '/synthetic/credential-vault', logger,
    password: 'synthetic-unlock-password',
  } };
}
function status() { return service.getPrivilegeUserApiKeyStatus({ configStore, baseUrl }); }

describe('strict vault values', () => {
  test('rejects environment fallback even when getEffective resolves it', () => {
    const name = 'TASK_THREE_SYNTHETIC_CREDENTIAL';
    process.env[name] = keyValue;
    try {
      expect(configStore.getEffective(name) === keyValue).toBe(true);
      expect(configStore.getVaultValue(name)).toBeNull();
    } finally { delete process.env[name]; }
  });
  test('rejects LMDB provenance even when getEffective resolves it', () => {
    configStore._setCache({ [KEY]: keyValue }, 'sqlite');
    expect(configStore.getEffective(KEY) === keyValue).toBe(true);
    expect(configStore.getVaultValue(KEY)).toBeNull();
  });
  test('reads only non-empty vault-owned cached values with case normalization', () => {
    configStore._setCache({ [KEY]: keyValue }, 'vault');
    expect(configStore.getVaultValue(KEY.toLowerCase()) === keyValue).toBe(true);
    for (const value of ['', '   ', null, undefined]) {
      configStore._setCache({ [KEY]: value }, 'vault');
      expect(configStore.getVaultValue(KEY)).toBeNull();
    }
  });
});

describe('Privilege user API vault service', () => {
  beforeAll(() => { service = require('../../services/privilegeUserApiKeyVaultService'); });
  test('returns status and masked previews without raw credentials', () => {
    configStore._setCache({ [KEY]: keyValue, [SECRET]: secretValue }, 'vault');
    const result = status();
    expect(result).toEqual({ apiKeySet: true, apiSecretSet: true,
      apiKeyPreview: 'test••••••••abcd', apiSecretPreview: 'test••••••••wxyz',
      missingEntries: [], controllerUrl: baseUrl });
    expect(JSON.stringify(result).includes(keyValue)).toBe(false);
    expect(JSON.stringify(result).includes(secretValue)).toBe(false);
  });
  test('names both missing entries when credentials are from LMDB only', () => {
    configStore._setCache({ [KEY]: keyValue, [SECRET]: secretValue }, 'sqlite');
    expect(status()).toEqual({ apiKeySet: false, apiSecretSet: false,
      apiKeyPreview: '', apiSecretPreview: '', missingEntries: [KEY, SECRET], controllerUrl: baseUrl });
  });
  test('never reveals short values and reports independently missing secret', () => {
    configStore._setCache({ [KEY]: 'tiny' }, 'vault');
    expect(status()).toMatchObject({ apiKeySet: true, apiSecretSet: false,
      apiKeyPreview: '••••••••', missingEntries: [SECRET] });
  });
  test('rejects both empty inputs before opening the vault', async () => {
    const f = fixture();
    await expect(service.savePrivilegeUserApiCredentials({ ...f.options, apiKey: ' ', apiSecret: '' }))
      .rejects.toMatchObject({ code: 'PRIVILEGE_USER_API_CREDENTIALS_REQUIRED' });
    expect(f.vaultLib.openVault).not.toHaveBeenCalled();
    expect(configStore.setRaw).not.toHaveBeenCalled();
  });
  test('requires a password before opening the vault', async () => {
    const f = fixture();
    await expect(service.savePrivilegeUserApiCredentials({ ...f.options, apiKey: keyValue, password: '' }))
      .rejects.toMatchObject({ code: 'VAULT_PASSWORD_REQUIRED' });
    expect(f.vaultLib.openVault).not.toHaveBeenCalled();
  });
  test.each([['apiKey', KEY, SECRET], ['apiSecret', SECRET, KEY]])(
    'replaces %s alone and refreshes only the changed key', async (field, changed, unchanged) => {
      const f = fixture();
      configStore._setCache(f.persisted, 'vault');
      const otherValue = configStore.getVaultValue(unchanged);
      const replacement = 'test-replacement-middle-9876';
      await service.savePrivilegeUserApiCredentials({ ...f.options, [field]: replacement });
      expect(f.persisted[unchanged] === otherValue).toBe(true);
      expect(f.persisted[changed] === replacement).toBe(true);
      expect(configStore.getVaultValue(unchanged) === otherValue).toBe(true);
      expect(configStore.getVaultValue(changed) === replacement).toBe(true);
      expect(configStore.setRaw).toHaveBeenCalledTimes(1);
      expect(configStore.setRaw).toHaveBeenCalledWith({ [changed]: replacement }, { persist: false });
      expect(f.vault.close).toHaveBeenCalledTimes(1);
    });
  test('writes only fixed entries and refreshes cache only after save resolves', async () => {
    const f = fixture();
    let finishSave;
    f.vault.save.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const saving = service.savePrivilegeUserApiCredentials({ ...f.options,
      apiKey: keyValue, apiSecret: secretValue, name: 'OTHER_ENTRY', entries: { OTHER_ENTRY: keyValue } });
    await new Promise(setImmediate);
    expect(configStore.setRaw).not.toHaveBeenCalled();
    expect(status().apiKeySet).toBe(false);
    expect(f.vaultLib.openVault).toHaveBeenCalledWith('/synthetic/credential-vault',
      'synthetic-unlock-password', { caller: 'privilegeUserApiKeyVaultService' });
    expect(f.vault.set.mock.calls.map(([name]) => name)).toEqual([KEY, SECRET]);
    finishSave();
    await saving;
    expect(configStore.setRaw).toHaveBeenCalledWith({ [KEY]: keyValue, [SECRET]: secretValue }, { persist: false });
    expect(status().apiKeySet).toBe(true);
    expect(f.vault.close).toHaveBeenCalledTimes(1);
  });
  test.each(['VaultAuthError', 'VaultIntegrityError'])('sanitizes %s and preserves cache and previews', async (name) => {
    const f = fixture();
    configStore._setCache(f.persisted, 'vault');
    const before = status();
    f.vaultLib.openVault.mockRejectedValue(Object.assign(new Error('synthetic-sensitive-diagnostic'), { name }));
    let failure;
    try { await service.savePrivilegeUserApiCredentials({ ...f.options, apiKey: 'replacement' }); }
    catch (err) { failure = err; }
    expect(failure).toMatchObject({ code: 'VAULT_AUTH_FAILED' });
    expect(failure.message.includes('synthetic-sensitive-diagnostic')).toBe(false);
    expect(status()).toEqual(before);
    expect(configStore.setRaw).not.toHaveBeenCalled();
    expect(f.vault.close).not.toHaveBeenCalled();
    expect(JSON.stringify(f.logger.error.mock.calls).includes('synthetic-sensitive-diagnostic')).toBe(false);
  });
  test.each(['set', 'save'])('%s failure closes the handle and preserves persisted entries, cache and previews', async (operation) => {
    const f = fixture();
    configStore._setCache(f.persisted, 'vault');
    const before = status();
    f.vault[operation].mockImplementation(() => { throw new Error('synthetic-sensitive-diagnostic'); });
    await expect(service.savePrivilegeUserApiCredentials({ ...f.options, apiKey: 'replacement' }))
      .rejects.toMatchObject({ code: 'VAULT_SAVE_FAILED' });
    expect(f.persisted[KEY] === keyValue).toBe(true);
    expect(status()).toEqual(before);
    expect(configStore.setRaw).not.toHaveBeenCalled();
    expect(f.vault.close).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.logger.error.mock.calls).includes('synthetic-sensitive-diagnostic')).toBe(false);
  });
  test('closes the handle when cache refresh fails after disk save', async () => {
    const f = fixture();
    configStore.setRaw.mockRejectedValue(new Error('synthetic-cache-failure'));
    await expect(service.savePrivilegeUserApiCredentials({ ...f.options, apiKey: keyValue })).rejects.toBeDefined();
    expect(f.vault.close).toHaveBeenCalledTimes(1);
  });
});
