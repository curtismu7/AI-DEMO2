'use strict';

/**
 * vault.test.ts — Phase 269 Plan 04 TDD tests for demo_mcp_gateway/src/vault.ts.
 *
 * Covers the seven behavior bullets from 269-04-PLAN.md:
 *   1. Vercel bypass — does NOT touch process.env, returns {loaded:false, reason:'vercel'}
 *   2. No-vault-file — returns {loaded:false, reason:'no_vault_file'}
 *   3. Vault present + password missing — throws with message containing
 *      "secrets.vault exists but VAULT_PASSWORD not set"
 *   4. Real vault with mixed entries — allowlisted entries copied to process.env;
 *      LD_PRELOAD (denied by allowlist) is SKIPPED and logger.warn invoked;
 *      VAULT_PASSWORD deleted from process.env after open
 *   5. Wrong-password (VaultAuthError) — rethrows; logger.error logged err.message
 *      ONLY (no err.stack — no argon/kek/dek leak)
 *   6. Lowercase entry name (`mcp_gw_client_secret`) — skipped by allowlist regex
 *   7. (Implicit in 4) Bypass restores process.env state after each test
 *
 * Uses the real Plan 01 vault library via `../../demo_api_server/lib/vault`.
 * argon2 native module resolution: walks up from demo_api_server/lib/vault →
 * demo_api_server/node_modules/argon2. No argon2 install needed in this package.
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const vaultLib = require('../../demo_api_server/lib/vault');

import { loadVaultIntoEnv } from '../src/vault';

// Argon2id KDF on a fresh KEK takes ~60ms; tests that open vaults
// should comfortably fit in 30s even on a slow CI runner.
jest.setTimeout(30_000);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * env-restore guard. Every test snapshots+restores ONLY the keys we mutate so
 * that any prior `process.env.MCP_GW_CLIENT_SECRET` set on the test runner host
 * (or set by a previous test) does not leak into or out of this suite.
 */
const ENV_KEYS_TO_GUARD = [
  'MCP_GW_CLIENT_SECRET',
  'MCP_GW_CLIENT_ID',
  'PROVIDER_OPENAI_KEY',
  'HELIX_API_KEY',
  'BFF_INTERNAL_SECRET',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'RANDOM_KEY',
  'VAULT_PATH',
  'VAULT_PASSWORD',
  'VERCEL',
  'DEMO_MORTGAGE_SERVICE_KEY',
];

let savedEnv: Record<string, string | undefined> = {};
let tmpRoot: string;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS_TO_GUARD) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  tmpRoot = mkdtempSync(join(tmpdir(), 'gw-vault-test-'));
});

afterEach(() => {
  for (const k of ENV_KEYS_TO_GUARD) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

async function buildVaultWithEntries(entries: Record<string, string>): Promise<string> {
  const vaultPath = join(tmpRoot, 'secrets.vault');
  const password = 'test-password-269-04';
  const vault = await vaultLib.createVault(vaultPath, password);
  try {
    for (const [name, value] of Object.entries(entries)) {
      vault.set(name, value);
    }
    await vault.save();
  } finally {
    vault.close();
  }
  return vaultPath;
}

function mockLogger() {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadVaultIntoEnv (demo_mcp_gateway)', () => {
  test('Vercel bypass — returns vercel reason, never touches process.env', async () => {
    const logger = mockLogger();
    // Build a real vault file so that ONLY the Vercel short-circuit prevents reading it.
    const vaultPath = await buildVaultWithEntries({ MCP_GW_CLIENT_SECRET: 'should-not-load' });

    expect(process.env.MCP_GW_CLIENT_SECRET).toBeUndefined();

    const result = await loadVaultIntoEnv({
      vaultPath,
      password: 'test-password-269-04',
      isVercel: true,
      logger,
    });

    expect(result).toEqual({ loaded: false, entries: 0, reason: 'vercel' });
    expect(process.env.MCP_GW_CLIENT_SECRET).toBeUndefined();
  });

  test('No vault file — returns no_vault_file reason, no throw', async () => {
    const logger = mockLogger();
    const result = await loadVaultIntoEnv({
      vaultPath: join(tmpRoot, 'does-not-exist.vault'),
      password: 'anything',
      logger,
    });
    expect(result).toEqual({ loaded: false, entries: 0, reason: 'no_vault_file' });
  });

  test('Vault present + password missing — throws fail-fast error', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({ MCP_GW_CLIENT_SECRET: 'irrelevant' });

    await expect(
      loadVaultIntoEnv({ vaultPath, password: undefined, logger }),
    ).rejects.toThrow(/secrets\.vault exists but VAULT_PASSWORD not set/);

    // logger.error MUST be called with the same fail-fast message
    expect(logger.error).toHaveBeenCalled();
    const errorArgs = logger.error.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(errorArgs).toMatch(/refusing to start/);
  });

  test('Real vault — allowlisted entries land in process.env; LD_PRELOAD skipped + logged.warn', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({
      MCP_GW_CLIENT_SECRET: 'secret-1',
      PROVIDER_OPENAI_KEY: 'sk-test',
      HELIX_API_KEY: 'helix-xyz',
      LD_PRELOAD: '/evil.so',
    });

    const result = await loadVaultIntoEnv({
      vaultPath,
      password: 'test-password-269-04',
      logger,
    });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(3); // 3 allowlisted; LD_PRELOAD skipped
    expect(process.env.MCP_GW_CLIENT_SECRET).toBe('secret-1');
    expect(process.env.PROVIDER_OPENAI_KEY).toBe('sk-test');
    expect(process.env.HELIX_API_KEY).toBe('helix-xyz');
    // CRITICAL: allowlist must block LD_PRELOAD injection (T-269-17)
    expect(process.env.LD_PRELOAD).toBeUndefined();

    const warnArgs = logger.warn.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(warnArgs).toMatch(/LD_PRELOAD/);
    expect(warnArgs).toMatch(/skipping non-allowlisted entry/);

    // VAULT_PASSWORD must NOT be reachable via process.env after open (T-269-06)
    expect(process.env.VAULT_PASSWORD).toBeUndefined();
  });

  test('Wrong password — rethrows error; logger.error logs err.message only (no argon/kek/dek leak)', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({ MCP_GW_CLIENT_SECRET: 'secret-x' });

    await expect(
      loadVaultIntoEnv({ vaultPath, password: 'WRONG-PASSWORD', logger }),
    ).rejects.toThrow();

    // T-269-20: err.stack must NOT be logged — no "argon"/"kek"/"dek" leak via stack-traces
    const allLogs = [
      ...logger.error.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.log.mock.calls,
    ]
      .map((c: unknown[]) => c.map((p) => (typeof p === 'string' ? p : '')).join(' '))
      .join(' ');
    expect(allLogs).not.toMatch(/argon|\bkek\b|\bdek\b/i);
  });

  test('Lowercase entry name is SKIPPED by allowlist (regex requires uppercase prefix)', async () => {
    // The vault library NAME_RE requires uppercase, so we cannot create a
    // lowercase entry inside the vault. We test the regex directly to verify
    // that even if some future API somehow allowed it, lowercase prefixes
    // would still be blocked.
    const ALLOW = /^(MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_|DEMO_)[A-Z0-9_]+$/;
    expect(ALLOW.test('mcp_gw_client_secret')).toBe(false);
    expect(ALLOW.test('MCP_GW_CLIENT_SECRET')).toBe(true);
    expect(ALLOW.test('PROVIDER_OPENAI_KEY')).toBe(true);
    expect(ALLOW.test('HELIX_API_KEY')).toBe(true);
    expect(ALLOW.test('BFF_INTERNAL_SECRET')).toBe(true);
    expect(ALLOW.test('LD_PRELOAD')).toBe(false);
    expect(ALLOW.test('NODE_OPTIONS')).toBe(false);
    expect(ALLOW.test('RANDOM_KEY')).toBe(false);
    expect(ALLOW.test('DEMO_MORTGAGE_SERVICE_KEY')).toBe(true);
  });

  test('Non-allowlisted entry RANDOM_KEY is skipped at vault load time', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({
      MCP_GW_CLIENT_SECRET: 'kept',
      RANDOM_KEY: 'tossed',
    });

    const result = await loadVaultIntoEnv({
      vaultPath,
      password: 'test-password-269-04',
      logger,
    });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(1);
    expect(process.env.MCP_GW_CLIENT_SECRET).toBe('kept');
    expect(process.env.RANDOM_KEY).toBeUndefined();

    const warnArgs = logger.warn.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(warnArgs).toMatch(/RANDOM_KEY/);
  });

  test('VAULT_PASSWORD env-var path — deletes process.env.VAULT_PASSWORD on success', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({ MCP_GW_CLIENT_SECRET: 'ok' });

    process.env.VAULT_PASSWORD = 'test-password-269-04';
    process.env.VAULT_PATH = vaultPath;

    const result = await loadVaultIntoEnv({ logger });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(1);
    expect(process.env.VAULT_PASSWORD).toBeUndefined();
    expect(existsSync(vaultPath)).toBe(true);
  });

  test('DEMO_ prefixed entry (DEMO_MORTGAGE_SERVICE_KEY) is loaded into process.env', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({
      MCP_GW_CLIENT_SECRET: 'gw-secret',
      DEMO_MORTGAGE_SERVICE_KEY: 'vault-mortgage-key-xyz',
    });

    const result = await loadVaultIntoEnv({
      vaultPath,
      password: 'test-password-269-04',
      logger,
    });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(2);
    expect(process.env.DEMO_MORTGAGE_SERVICE_KEY).toBe('vault-mortgage-key-xyz');
    // No warn for DEMO_ — it IS allowlisted
    const warnArgs = logger.warn.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(warnArgs).not.toMatch(/DEMO_MORTGAGE_SERVICE_KEY/);
  });
});
