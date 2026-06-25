'use strict';

/**
 * Plan 269.1-01 Task 1 — vaultLoader-runtime.test.js (RED)
 *
 * Unit tests for the NEW exports added in Phase 269.1 to
 * `banking_api_server/services/vaultLoader.js`:
 *
 *   - unlockVaultAtRuntime({password, vaultPath, configStore, vaultLib, logger})
 *       Sibling to loadVaultIntoConfigStore — for admin-route runtime unlock.
 *       Does NOT touch process.env.VAULT_PASSWORD. Does NOT short-circuit on VERCEL.
 *       Always calls vault.close() in finally. Always uses setRaw(data, {persist:false}).
 *
 *   - isVaultUnlockedThisProcess() → boolean
 *   - vaultEntryCountThisProcess() → number
 *
 * Tests 11 and 12 also exercise the 2-line state mirror that Task 2 inserts
 * into the existing loadVaultIntoConfigStore success path. The flag must flip
 * true on a successful startup load and stay false on the no-vault-file branch.
 *
 * DI shape — every test passes mock vaultLib + mock configStore directly to
 * the function under test (no jest.mock of the module).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

jest.setTimeout(60000);

// Save + restore env between tests (process-wide state mirror means resetModules
// is required for the helper-flag tests to start from a clean slate).
const ORIG_ENV = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  delete process.env.VAULT_PASSWORD;
  delete process.env.VAULT_PATH;
  delete process.env.VERCEL;
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
  jest.restoreAllMocks();
});

function fakeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function fakeConfigStore() {
  return { setRaw: jest.fn().mockResolvedValue(undefined), ensureInitialized: jest.fn().mockResolvedValue(undefined) };
}

/**
 * Build a vaultLib mock where openVault returns a handle whose list() reports
 * Object.keys(entries) and read(name) returns entries[name]. close() is a jest spy.
 */
function makeVaultLibMock(entries, opts = {}) {
  const closeSpy = jest.fn();
  const handle = {
    list: () => Object.keys(entries),
    read: (k) => entries[k],
    close: closeSpy,
  };
  const openVault = opts.openVaultThrows
    ? jest.fn().mockRejectedValue(opts.openVaultThrows)
    : jest.fn().mockResolvedValue(handle);
  return { openVault, closeSpy, handle };
}

/** Create a touched empty file at a unique tmp path. Caller is responsible for cleanup. */
function touchTmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultRuntime-'));
  const p = path.join(dir, 'secrets.vault');
  fs.writeFileSync(p, '');
  return p;
}

function rmTmpFile(p) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch { /* ignore */ }
  try { fs.rmdirSync(path.dirname(p)); } catch { /* ignore */ }
}

describe('vaultLoader.unlockVaultAtRuntime (runtime unlock — Phase 269.1)', () => {
  test('Test 1 — throws VAULT_PASSWORD_MISSING when password is missing', async () => {
    const { unlockVaultAtRuntime } = require('../../services/vaultLoader');
    await expect(unlockVaultAtRuntime({})).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_MISSING',
    });
  });

  test('Test 2 — throws VAULT_PASSWORD_MISSING when password is empty string', async () => {
    const { unlockVaultAtRuntime } = require('../../services/vaultLoader');
    await expect(unlockVaultAtRuntime({ password: '' })).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_MISSING',
    });
  });

  test('Test 3 — throws VAULT_FILE_NOT_FOUND when vault file does not exist', async () => {
    const { unlockVaultAtRuntime } = require('../../services/vaultLoader');
    const missing = path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '.vault');
    await expect(unlockVaultAtRuntime({
      password: 'pw',
      vaultPath: missing,
      configStore: fakeConfigStore(),
      vaultLib: makeVaultLibMock({}),
      logger: fakeLogger(),
    })).rejects.toMatchObject({ code: 'VAULT_FILE_NOT_FOUND' });
  });

  test('Test 4 — does NOT touch process.env.VAULT_PASSWORD (success + failure paths)', async () => {
    const { unlockVaultAtRuntime } = require('../../services/vaultLoader');
    let p;
    try {
      p = touchTmpFile();
      process.env.VAULT_PASSWORD = 'sentinel-do-not-delete';

      // Success path
      const mock = makeVaultLibMock({ KEY_A: 'val-a' });
      await unlockVaultAtRuntime({
        password: 'caller-pw',
        vaultPath: p,
        configStore: fakeConfigStore(),
        vaultLib: mock,
        logger: fakeLogger(),
      });
      expect(process.env.VAULT_PASSWORD).toBe('sentinel-do-not-delete');

      // Failure path — openVault throws (wrong password)
      const errMock = makeVaultLibMock({}, {
        openVaultThrows: Object.assign(new Error('vault: open failed (bad password or tampered file)'), {
          name: 'VaultAuthError',
        }),
      });
      await expect(unlockVaultAtRuntime({
        password: 'caller-pw',
        vaultPath: p,
        configStore: fakeConfigStore(),
        vaultLib: errMock,
        logger: fakeLogger(),
      })).rejects.toThrow();
      expect(process.env.VAULT_PASSWORD).toBe('sentinel-do-not-delete');

      // Defense-in-depth: no password material in logger output either
      const log = fakeLogger();
      const errMock2 = makeVaultLibMock({}, {
        openVaultThrows: Object.assign(new Error('vault: open failed (bad password or tampered file)'), {
          name: 'VaultAuthError',
        }),
      });
      await expect(unlockVaultAtRuntime({
        password: 'caller-pw-secret',
        vaultPath: p,
        configStore: fakeConfigStore(),
        vaultLib: errMock2,
        logger: log,
      })).rejects.toThrow();
      const joined = log.error.mock.calls.map((a) => a.join(' ')).join('\n');
      expect(joined).not.toMatch(/caller-pw-secret/);
      expect(joined).not.toMatch(/argon|kek|dek/i);
    } finally {
      rmTmpFile(p);
    }
  });

  test('Test 5 — calls vault.close() in finally on success', async () => {
    const { unlockVaultAtRuntime } = require('../../services/vaultLoader');
    let p;
    try {
      p = touchTmpFile();
      const mock = makeVaultLibMock({ KEY_A: 'val-a' });
      await unlockVaultAtRuntime({
        password: 'pw',
        vaultPath: p,
        configStore: fakeConfigStore(),
        vaultLib: mock,
        logger: fakeLogger(),
      });
      expect(mock.closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      rmTmpFile(p);
    }
  });

  test('Test 6 — calls vault.close() in finally on configStore.setRaw error; original error propagates', async () => {
    const { unlockVaultAtRuntime } = require('../../services/vaultLoader');
    let p;
    try {
      p = touchTmpFile();
      const mock = makeVaultLibMock({ KEY_A: 'val-a' });
      const cfg = { setRaw: jest.fn().mockRejectedValue(new Error('cfg-store-boom')), ensureInitialized: jest.fn().mockResolvedValue(undefined) };
      await expect(unlockVaultAtRuntime({
        password: 'pw',
        vaultPath: p,
        configStore: cfg,
        vaultLib: mock,
        logger: fakeLogger(),
      })).rejects.toThrow(/cfg-store-boom/);
      expect(mock.closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      rmTmpFile(p);
    }
  });

  test('Test 7 — calls configStore.setRaw with batched lowercased data + {persist:false}', async () => {
    const { unlockVaultAtRuntime } = require('../../services/vaultLoader');
    let p;
    try {
      p = touchTmpFile();
      const mock = makeVaultLibMock({ KEY_A: 'a', KEY_B: 'b', KEY_C: 'c' });
      const cfg = fakeConfigStore();
      await unlockVaultAtRuntime({
        password: 'pw',
        vaultPath: p,
        configStore: cfg,
        vaultLib: mock,
        logger: fakeLogger(),
      });
      expect(cfg.setRaw).toHaveBeenCalledTimes(1);
      const [data, opts] = cfg.setRaw.mock.calls[0];
      expect(data).toEqual({ key_a: 'a', key_b: 'b', key_c: 'c' });
      expect(opts).toEqual({ persist: false });
    } finally {
      rmTmpFile(p);
    }
  });

  test('Test 8 — does NOT short-circuit on VERCEL=1 (caller decides 503, not this function)', async () => {
    const { unlockVaultAtRuntime } = require('../../services/vaultLoader');
    let p;
    try {
      p = touchTmpFile();
      process.env.VERCEL = '1';
      const mock = makeVaultLibMock({ KEY_A: 'a' });
      await unlockVaultAtRuntime({
        password: 'pw',
        vaultPath: p,
        configStore: fakeConfigStore(),
        vaultLib: mock,
        logger: fakeLogger(),
      });
      expect(mock.openVault).toHaveBeenCalledTimes(1);
    } finally {
      rmTmpFile(p);
    }
  });

  test('Test 9 — isVaultUnlockedThisProcess returns false before any successful unlock', () => {
    const {
      isVaultUnlockedThisProcess,
      vaultEntryCountThisProcess,
    } = require('../../services/vaultLoader');
    expect(isVaultUnlockedThisProcess()).toBe(false);
    expect(vaultEntryCountThisProcess()).toBe(0);
  });

  test('Test 10 — isVaultUnlockedThisProcess flips true + entry count reflects N after runtime unlock', async () => {
    const {
      unlockVaultAtRuntime,
      isVaultUnlockedThisProcess,
      vaultEntryCountThisProcess,
    } = require('../../services/vaultLoader');
    let p;
    try {
      p = touchTmpFile();
      const mock = makeVaultLibMock({ KEY_A: 'a', KEY_B: 'b', KEY_C: 'c' });
      expect(isVaultUnlockedThisProcess()).toBe(false);
      await unlockVaultAtRuntime({
        password: 'pw',
        vaultPath: p,
        configStore: fakeConfigStore(),
        vaultLib: mock,
        logger: fakeLogger(),
      });
      expect(isVaultUnlockedThisProcess()).toBe(true);
      expect(vaultEntryCountThisProcess()).toBe(3);
    } finally {
      rmTmpFile(p);
    }
  });

  test('Test 11 — isVaultUnlockedThisProcess flips true after loadVaultIntoConfigStore success (state mirror)', async () => {
    const {
      loadVaultIntoConfigStore,
      isVaultUnlockedThisProcess,
      vaultEntryCountThisProcess,
    } = require('../../services/vaultLoader');
    let p;
    try {
      p = touchTmpFile();
      const mock = makeVaultLibMock({ KEY_A: 'a', KEY_B: 'b' });
      expect(isVaultUnlockedThisProcess()).toBe(false);
      await loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        password: 'pw',
        configStore: fakeConfigStore(),
        vaultLib: mock,
        logger: fakeLogger(),
      });
      expect(isVaultUnlockedThisProcess()).toBe(true);
      expect(vaultEntryCountThisProcess()).toBe(2);
    } finally {
      rmTmpFile(p);
    }
  });

  test('Test 12 — isVaultUnlockedThisProcess stays false when loadVaultIntoConfigStore hits no_vault_file branch', async () => {
    const {
      loadVaultIntoConfigStore,
      isVaultUnlockedThisProcess,
      vaultEntryCountThisProcess,
    } = require('../../services/vaultLoader');
    const missing = path.join(os.tmpdir(), 'definitely-not-there-' + Date.now() + '.vault');
    const result = await loadVaultIntoConfigStore({
      isVercel: false,
      vaultPath: missing,
      password: 'pw',
      configStore: fakeConfigStore(),
      vaultLib: makeVaultLibMock({}),
      logger: fakeLogger(),
    });
    expect(result).toEqual({ loaded: false, entries: 0, reason: 'no_vault_file' });
    expect(isVaultUnlockedThisProcess()).toBe(false);
    expect(vaultEntryCountThisProcess()).toBe(0);
  });
});
