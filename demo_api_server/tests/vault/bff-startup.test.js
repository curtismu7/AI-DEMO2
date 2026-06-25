'use strict';

/**
 * Plan 269-03 Task 1 — bff-startup.test.js
 *
 * Tests the orchestration in `services/vaultLoader.js` using a real Plan 01
 * vault library and a fake configStore (DI). Covers the five vaultLoader
 * states: vercel-bypass, no-vault-file, missing-password, integrity/auth
 * errors, and successful-load.
 *
 * Uses real lib/vault to prove the happy path actually decrypts; this catches
 * regressions in either layer.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vaultLib = require('../../lib/vault');
const { loadVaultIntoConfigStore } = require('../../services/vaultLoader');

jest.setTimeout(60000); // Argon2id on slow CI runners

// Small helper: build a real on-disk vault with the given entries, return its path.
async function buildVault(entries, password) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultLoader-'));
  const p = path.join(dir, 'secrets.vault');
  const v = await vaultLib.createVault(p, password);
  for (const [name, value] of Object.entries(entries)) {
    v.set(name, value);
  }
  await v.save();
  v.close();
  return p;
}

function cleanupVault(p) {
  if (!p) return;
  for (const sfx of ['', '.tmp', '.audit.log']) {
    try { fs.unlinkSync(p + sfx); } catch { /* ignore */ }
  }
  try { fs.rmdirSync(path.dirname(p)); } catch { /* ignore */ }
}

function fakeConfigStore() {
  return { setRaw: jest.fn().mockResolvedValue(undefined), ensureInitialized: jest.fn().mockResolvedValue(undefined) };
}

function fakeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('vaultLoader.loadVaultIntoConfigStore', () => {
  // Save + restore process.env across tests so we don't bleed state.
  const ORIG_ENV = { ...process.env };
  // WR-02: defense vs leak from another suite/worker that may have left
  // VAULT_PASSWORD in env. The ORIG_ENV snapshot is taken at module load,
  // BEFORE any test mutation — restoring to it is correct — but an explicit
  // delete before each test makes the contract obvious to future maintainers
  // and prevents a misordered afterEach from breaking a parallel test.
  beforeEach(() => {
    delete process.env.VAULT_PASSWORD;
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
    delete process.env.VAULT_PASSWORD;
    jest.restoreAllMocks();
  });

  test('returns {loaded:false, reason:vercel} when isVercel=true (no configStore call)', async () => {
    const cfg = fakeConfigStore();
    const log = fakeLogger();
    const result = await loadVaultIntoConfigStore({
      isVercel: true,
      vaultPath: '/nonexistent.vault',
      password: 'pw',
      configStore: cfg,
      vaultLib,
      logger: log,
    });
    expect(result).toEqual({ loaded: false, entries: 0, reason: 'vercel' });
    expect(cfg.setRaw).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith(
      expect.stringContaining('[vault]')
    );
  });

  test('returns {loaded:false, reason:no_vault_file} and logs skip msg when path missing', async () => {
    const cfg = fakeConfigStore();
    const log = fakeLogger();
    const missing = path.join(os.tmpdir(), 'definitely-not-there-' + Date.now() + '.vault');
    const result = await loadVaultIntoConfigStore({
      isVercel: false,
      vaultPath: missing,
      password: undefined,
      configStore: cfg,
      vaultLib,
      logger: log,
    });
    expect(result).toEqual({ loaded: false, entries: 0, reason: 'no_vault_file' });
    expect(cfg.setRaw).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith(
      expect.stringContaining('no vault file at')
    );
  });

  test('throws + logs.error when vault file exists but password is undefined', async () => {
    let p;
    try {
      p = await buildVault({ HELIX_API_KEY: 'sk-xxx' }, 'right-pw');
      const cfg = fakeConfigStore();
      const log = fakeLogger();
      await expect(loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        password: undefined,
        configStore: cfg,
        vaultLib,
        logger: log,
      })).rejects.toThrow(/secrets\.vault exists but VAULT_PASSWORD not set/i);
      expect(log.error).toHaveBeenCalledWith(
        expect.stringContaining('VAULT_PASSWORD not set')
      );
      expect(cfg.setRaw).not.toHaveBeenCalled();
    } finally {
      cleanupVault(p);
    }
  });

  test('loads 3 entries into configStore.setRaw with {persist:false} and lowercases names', async () => {
    let p;
    try {
      p = await buildVault({
        HELIX_API_KEY: 'sk-aaa',
        SESSION_SECRET: 'sec-bbb',
        FOO_BAR: 'val-ccc',
      }, 'right-pw');
      const cfg = fakeConfigStore();
      const log = fakeLogger();
      const result = await loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        password: 'right-pw',
        configStore: cfg,
        vaultLib,
        logger: log,
      });
      expect(result.loaded).toBe(true);
      expect(result.entries).toBe(3);
      expect(cfg.setRaw).toHaveBeenCalledTimes(1);
      const [data, opts] = cfg.setRaw.mock.calls[0];
      // Plan contract: lowercased names; values preserved verbatim
      expect(data).toEqual({
        helix_api_key: 'sk-aaa',
        session_secret: 'sec-bbb',
        foo_bar: 'val-ccc',
      });
      expect(opts).toEqual({ persist: false });
    } finally {
      cleanupVault(p);
    }
  });

  test('deletes process.env.VAULT_PASSWORD after successful load', async () => {
    let p;
    try {
      p = await buildVault({ KEY_A: 'v1' }, 'right-pw');
      process.env.VAULT_PASSWORD = 'right-pw';
      const cfg = fakeConfigStore();
      const log = fakeLogger();
      // Note: we deliberately rely on the env-var default (don't pass password)
      await loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        configStore: cfg,
        vaultLib,
        logger: log,
      });
      expect(process.env.VAULT_PASSWORD).toBeUndefined();
    } finally {
      cleanupVault(p);
    }
  });

  test('deletes process.env.VAULT_PASSWORD even when an explicit password param is passed (defense-in-depth)', async () => {
    let p;
    try {
      p = await buildVault({ KEY_A: 'v1' }, 'right-pw');
      process.env.VAULT_PASSWORD = 'right-pw';
      const cfg = fakeConfigStore();
      await loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        password: 'right-pw',
        configStore: cfg,
        vaultLib,
        logger: fakeLogger(),
      });
      expect(process.env.VAULT_PASSWORD).toBeUndefined();
    } finally {
      cleanupVault(p);
    }
  });

  test('calls vault.close() in finally (KEK gets zeroed)', async () => {
    let p;
    try {
      p = await buildVault({ KEY_A: 'v1' }, 'right-pw');
      const cfg = fakeConfigStore();
      // Spy vaultLib.openVault to wrap it and observe close()
      const realOpen = vaultLib.openVault;
      let closeSpy;
      const wrapVaultLib = {
        ...vaultLib,
        openVault: async (...args) => {
          const handle = await realOpen.apply(vaultLib, args);
          closeSpy = jest.spyOn(handle, 'close');
          return handle;
        },
      };
      await loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        password: 'right-pw',
        configStore: cfg,
        vaultLib: wrapVaultLib,
        logger: fakeLogger(),
      });
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanupVault(p);
    }
  });

  test('rethrows VaultAuthError on wrong password; logs generic message (no argon/kek/dek leak)', async () => {
    let p;
    try {
      p = await buildVault({ KEY_A: 'v1' }, 'right-pw');
      const cfg = fakeConfigStore();
      const log = fakeLogger();
      await expect(loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        password: 'wrong-pw',
        configStore: cfg,
        vaultLib,
        logger: log,
      })).rejects.toThrow(); // any error class
      // logger.error called with open-failed line
      const errorCalls = log.error.mock.calls.map((args) => args.join(' '));
      const joined = errorCalls.join('\n');
      expect(joined).toMatch(/\[vault\] open failed/i);
      expect(joined).not.toMatch(/argon|kek|dek/i);
      // configStore must NOT have been called (no partial cache)
      expect(cfg.setRaw).not.toHaveBeenCalled();
    } finally {
      cleanupVault(p);
    }
  });

  test('rethrows VaultIntegrityError when vault file is tampered', async () => {
    let p;
    try {
      p = await buildVault({ KEY_A: 'v1' }, 'right-pw');
      // Tamper one byte in the middle of the file (corrupts canonical JSON or HMAC)
      const buf = fs.readFileSync(p);
      buf[Math.floor(buf.length / 2)] ^= 0xff;
      fs.writeFileSync(p, buf);
      const cfg = fakeConfigStore();
      const log = fakeLogger();
      await expect(loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        password: 'right-pw',
        configStore: cfg,
        vaultLib,
        logger: log,
      })).rejects.toThrow();
      expect(cfg.setRaw).not.toHaveBeenCalled();
    } finally {
      cleanupVault(p);
    }
  });

  test('zero entries → returns {loaded:true, entries:0}; setRaw is NOT called (no empty data write)', async () => {
    let p;
    try {
      p = await buildVault({}, 'right-pw');
      const cfg = fakeConfigStore();
      const result = await loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        password: 'right-pw',
        configStore: cfg,
        vaultLib,
        logger: fakeLogger(),
      });
      expect(result.loaded).toBe(true);
      expect(result.entries).toBe(0);
      expect(cfg.setRaw).not.toHaveBeenCalled();
    } finally {
      cleanupVault(p);
    }
  });

  test('returns success result + logs entry count on happy path', async () => {
    let p;
    try {
      p = await buildVault({ KEY_A: 'v1', KEY_B: 'v2' }, 'right-pw');
      const log = fakeLogger();
      const result = await loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        password: 'right-pw',
        configStore: fakeConfigStore(),
        vaultLib,
        logger: log,
      });
      expect(result).toEqual({ loaded: true, entries: 2 });
      const logged = log.log.mock.calls.map((a) => a.join(' ')).join('\n');
      expect(logged).toMatch(/\[vault\] loaded 2 entries/);
    } finally {
      cleanupVault(p);
    }
  });
});
