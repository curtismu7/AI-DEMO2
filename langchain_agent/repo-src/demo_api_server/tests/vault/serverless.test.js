'use strict';

/**
 * Plan 269-03 Task 1 — serverless.test.js
 *
 * Asserts the Vercel-bypass contract on vaultLoader:
 *   When `process.env.VERCEL === '1'`, the loader is skipped regardless of
 *   file presence or password.  Vercel uses Encrypted Environment Variables
 *   per RESEARCH.md "Serverless treatment" (REQ-VAULT-11).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vaultLib = require('../../lib/vault');
const { loadVaultIntoConfigStore } = require('../../services/vaultLoader');

jest.setTimeout(60000);

async function buildVault(entries, password) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultLoader-vc-'));
  const p = path.join(dir, 'secrets.vault');
  const v = await vaultLib.createVault(p, password);
  for (const [name, value] of Object.entries(entries)) v.set(name, value);
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

describe('vaultLoader Vercel bypass (REQ-VAULT-11)', () => {
  const ORIG_VERCEL = process.env.VERCEL;
  // WR-02: defense vs VAULT_PASSWORD leaking in from a parallel test file.
  beforeEach(() => {
    delete process.env.VAULT_PASSWORD;
  });
  afterEach(() => {
    if (ORIG_VERCEL === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = ORIG_VERCEL;
    delete process.env.VAULT_PASSWORD;
  });

  test('VERCEL=1 + vault file present + password set → loader bypassed; configStore untouched', async () => {
    let p;
    try {
      p = await buildVault({ HELIX_API_KEY: 'sk-xxx' }, 'pw');
      process.env.VERCEL = '1';
      const cfg = { setRaw: jest.fn(), ensureInitialized: jest.fn().mockResolvedValue(undefined) };
      const result = await loadVaultIntoConfigStore({
        vaultPath: p,
        password: 'pw',
        configStore: cfg,
        vaultLib,
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        // intentionally NOT passing isVercel — proves it reads from env
      });
      expect(result).toEqual({ loaded: false, entries: 0, reason: 'vercel' });
      expect(cfg.setRaw).not.toHaveBeenCalled();
    } finally {
      cleanupVault(p);
    }
  });

  test('VERCEL unset + vault file present + password → loads normally', async () => {
    let p;
    try {
      p = await buildVault({ KEY_A: 'v1' }, 'pw');
      delete process.env.VERCEL;
      const cfg = { setRaw: jest.fn().mockResolvedValue(), ensureInitialized: jest.fn().mockResolvedValue(undefined) };
      const result = await loadVaultIntoConfigStore({
        vaultPath: p,
        password: 'pw',
        configStore: cfg,
        vaultLib,
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      expect(result).toEqual({ loaded: true, entries: 1 });
      expect(cfg.setRaw).toHaveBeenCalledWith({ key_a: 'v1' }, { persist: false });
    } finally {
      cleanupVault(p);
    }
  });

  test('explicit isVercel:false overrides VERCEL=1 env var (DI wins)', async () => {
    let p;
    try {
      p = await buildVault({ KEY_A: 'v1' }, 'pw');
      process.env.VERCEL = '1';
      const cfg = { setRaw: jest.fn().mockResolvedValue(), ensureInitialized: jest.fn().mockResolvedValue(undefined) };
      const result = await loadVaultIntoConfigStore({
        isVercel: false,
        vaultPath: p,
        password: 'pw',
        configStore: cfg,
        vaultLib,
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      });
      expect(result.loaded).toBe(true);
      expect(cfg.setRaw).toHaveBeenCalledTimes(1);
    } finally {
      cleanupVault(p);
    }
  });
});
