'use strict';

/**
 * vault.test.ts — tests for demo_agent_service/src/vault.ts.
 *
 * Ported from demo_mcp_gateway/tests/vault.test.ts (the agent's vault loader
 * is a near-verbatim copy of the gateway's). The ONE behavioral delta is the
 * allowlist regex, which gains the `AGENT_` prefix:
 *   /^(AGENT_|MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/
 * so this suite adds AGENT_CLIENT_ID / AGENT_CLIENT_SECRET coverage on top of
 * the gateway's MCP_GW_ / PROVIDER_ / HELIX_ / BFF_INTERNAL_ cases.
 *
 * Covered behaviors:
 *   1. Vercel bypass — does NOT touch process.env, returns {loaded:false, reason:'vercel'}
 *   2. No-vault-file — returns {loaded:false, reason:'no_vault_file'} (transparent
 *      no-op fallback — the zero-regression path for machines with no vault)
 *   3. Vault present + password missing — throws fail-fast error
 *   4. Real vault with mixed entries — allowlisted (incl. AGENT_*) copied to
 *      process.env; LD_PRELOAD (denied) SKIPPED + logger.warn; VAULT_PASSWORD
 *      deleted from process.env after open
 *   5. Wrong-password — rethrows; logger.error logs err.message ONLY (T-269-20)
 *   6. Allowlist regex — AGENT_ prefix matched; lowercase / injection rejected
 *   7. VAULT_PASSWORD env-var path — deleted on success (T-269-06)
 *
 * Uses the real Plan 01 vault library via `../../demo_api_server/lib/vault`.
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const vaultLib = require('../../demo_api_server/lib/vault');

import { loadVaultIntoEnv } from '../src/vault';

// Argon2id KDF on a fresh KEK takes ~60ms; opening vaults still fits in 30s
// comfortably even on a slow CI runner.
jest.setTimeout(30_000);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * env-restore guard. Snapshot+restore ONLY the keys we mutate so a value set
 * on the test runner host (or by a previous test) does not leak in or out.
 */
const ENV_KEYS_TO_GUARD = [
  'AGENT_CLIENT_ID',
  'AGENT_CLIENT_SECRET',
  'MCP_GW_CLIENT_SECRET',
  'MCP_GW_RESOURCE_URI',
  'PROVIDER_OPENAI_KEY',
  'HELIX_API_KEY',
  'BFF_INTERNAL_SECRET',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'RANDOM_KEY',
  'VAULT_PATH',
  'VAULT_PASSWORD',
  'VERCEL',
];

let savedEnv: Record<string, string | undefined> = {};
let tmpRoot: string;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS_TO_GUARD) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  tmpRoot = mkdtempSync(join(tmpdir(), 'agent-vault-test-'));
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
  const password = 'test-password-agent-vault';
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

describe('loadVaultIntoEnv (demo_agent_service)', () => {
  test('Vercel bypass — returns vercel reason, never touches process.env', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({ AGENT_CLIENT_SECRET: 'should-not-load' });

    expect(process.env.AGENT_CLIENT_SECRET).toBeUndefined();

    const result = await loadVaultIntoEnv({
      vaultPath,
      password: 'test-password-agent-vault',
      isVercel: true,
      logger,
    });

    expect(result).toEqual({ loaded: false, entries: 0, reason: 'vercel' });
    expect(process.env.AGENT_CLIENT_SECRET).toBeUndefined();
  });

  test('No vault file — returns no_vault_file reason, no throw (zero-regression fallback)', async () => {
    const logger = mockLogger();
    const result = await loadVaultIntoEnv({
      vaultPath: join(tmpRoot, 'does-not-exist.vault'),
      password: 'anything',
      logger,
    });
    expect(result).toEqual({ loaded: false, entries: 0, reason: 'no_vault_file' });
    const logArgs = logger.log.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(logArgs).toMatch(/no vault file/);
    expect(logArgs).toMatch(/using process\.env only/);
  });

  test('Vault present + password missing — throws fail-fast error', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({ AGENT_CLIENT_SECRET: 'irrelevant' });

    await expect(
      loadVaultIntoEnv({ vaultPath, password: undefined, logger }),
    ).rejects.toThrow(/secrets\.vault exists but VAULT_PASSWORD not set/);

    expect(logger.error).toHaveBeenCalled();
    const errorArgs = logger.error.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(errorArgs).toMatch(/refusing to start/);
  });

  test('Real vault — AGENT_* + allowlisted entries land in env; LD_PRELOAD skipped + warned', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({
      AGENT_CLIENT_ID: 'agent-id-1',
      AGENT_CLIENT_SECRET: 'agent-secret-1',
      MCP_GW_RESOURCE_URI: 'https://gw.example',
      HELIX_API_KEY: 'helix-xyz',
      LD_PRELOAD: '/evil.so',
    });

    const result = await loadVaultIntoEnv({
      vaultPath,
      password: 'test-password-agent-vault',
      logger,
    });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(4); // 4 allowlisted; LD_PRELOAD skipped
    expect(process.env.AGENT_CLIENT_ID).toBe('agent-id-1');
    expect(process.env.AGENT_CLIENT_SECRET).toBe('agent-secret-1');
    expect(process.env.MCP_GW_RESOURCE_URI).toBe('https://gw.example');
    expect(process.env.HELIX_API_KEY).toBe('helix-xyz');
    // CRITICAL: allowlist must block LD_PRELOAD injection (T-269-17)
    expect(process.env.LD_PRELOAD).toBeUndefined();

    const warnArgs = logger.warn.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(warnArgs).toMatch(/LD_PRELOAD/);
    expect(warnArgs).toMatch(/skipping non-allowlisted entry/);

    // VAULT_PASSWORD must NOT be reachable via process.env after open (T-269-06)
    expect(process.env.VAULT_PASSWORD).toBeUndefined();
  });

  test('Wrong password — rethrows; logger.error logs err.message only (no argon/kek/dek leak)', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({ AGENT_CLIENT_SECRET: 'secret-x' });

    await expect(
      loadVaultIntoEnv({ vaultPath, password: 'WRONG-PASSWORD', logger }),
    ).rejects.toThrow();

    // T-269-20: err.stack must NOT be logged — no argon/kek/dek leak via stack
    const allLogs = [
      ...logger.error.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.log.mock.calls,
    ]
      .map((c: unknown[]) => c.map((p) => (typeof p === 'string' ? p : '')).join(' '))
      .join(' ');
    expect(allLogs).not.toMatch(/argon|\bkek\b|\bdek\b/i);
  });

  test('Allowlist regex — AGENT_ prefix matched; lowercase / injection rejected', async () => {
    // Mirrors demo_agent_service/src/vault.ts DEFAULT_ALLOWED exactly.
    const ALLOW = /^(AGENT_|MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/;
    // The AGENT_ delta vs the gateway:
    expect(ALLOW.test('AGENT_CLIENT_ID')).toBe(true);
    expect(ALLOW.test('AGENT_CLIENT_SECRET')).toBe(true);
    // Inherited from the gateway allowlist:
    expect(ALLOW.test('MCP_GW_RESOURCE_URI')).toBe(true);
    expect(ALLOW.test('MCP_GW_CLIENT_SECRET')).toBe(true);
    expect(ALLOW.test('PROVIDER_OPENAI_KEY')).toBe(true);
    expect(ALLOW.test('HELIX_API_KEY')).toBe(true);
    expect(ALLOW.test('BFF_INTERNAL_SECRET')).toBe(true);
    // Injection / malformed must STILL be rejected (T-269-17):
    expect(ALLOW.test('agent_client_id')).toBe(false);
    expect(ALLOW.test('LD_PRELOAD')).toBe(false);
    expect(ALLOW.test('NODE_OPTIONS')).toBe(false);
    expect(ALLOW.test('RANDOM_KEY')).toBe(false);
    // Bare prefix with no suffix must be rejected ([A-Z0-9_]+ requires ≥1 char):
    expect(ALLOW.test('AGENT_')).toBe(false);
    expect(ALLOW.test('MCP_GW_')).toBe(false);
  });

  test('Non-allowlisted entry RANDOM_KEY is skipped at vault load time', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({
      AGENT_CLIENT_SECRET: 'kept',
      RANDOM_KEY: 'tossed',
    });

    const result = await loadVaultIntoEnv({
      vaultPath,
      password: 'test-password-agent-vault',
      logger,
    });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(1);
    expect(process.env.AGENT_CLIENT_SECRET).toBe('kept');
    expect(process.env.RANDOM_KEY).toBeUndefined();

    const warnArgs = logger.warn.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(warnArgs).toMatch(/RANDOM_KEY/);
  });

  test('VAULT_PASSWORD env-var path — deletes process.env.VAULT_PASSWORD on success', async () => {
    const logger = mockLogger();
    const vaultPath = await buildVaultWithEntries({ AGENT_CLIENT_SECRET: 'ok' });

    process.env.VAULT_PASSWORD = 'test-password-agent-vault';
    process.env.VAULT_PATH = vaultPath;

    const result = await loadVaultIntoEnv({ logger });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(1);
    expect(process.env.VAULT_PASSWORD).toBeUndefined();
    expect(existsSync(vaultPath)).toBe(true);
  });
});
