'use strict';

/**
 * vault.test.ts — tests for demo_agent_service/src/vault.ts (dotenvx loader).
 *
 * This suite has NO dependency on demo_api_server: the loader now reads the
 * service's own `.env` via `@dotenvx/dotenvx`.config() and no longer requires
 * `../../demo_api_server/lib/vault`. Fixtures are plaintext `.env` files written
 * to a tmp dir (dotenvx.config() reads a plaintext `.env` exactly like
 * dotenv.config() — the backward-compat property this migration relies on).
 *
 * Covered behaviors:
 *   1. Vercel bypass — does NOT touch process.env, returns {loaded:false, reason:'vercel'}
 *   2. Missing `.env`, nothing expected — {loaded:false, reason:'no_env_file'} + warn
 *      (transparent process.env-only fallback: the zero-regression path)
 *   3. Plaintext `.env` with mixed keys — allowlisted (incl. AGENT_*) copied to
 *      process.env; non-allowlisted (LD_PRELOAD, RANDOM_KEY) NOT injected by the
 *      loader; entries counts only the allowlisted
 *   4. Allowlist regex — AGENT_ prefix matched; lowercase / injection rejected
 *      (documents the T-269-17 secret-name contract)
 *   5. DOTENV_PRIVATE_KEY hygiene — deleted from process.env after a successful load
 *   6. dotenvx config error (encrypted value, no key) — {loaded:false,
 *      reason:'dotenv_error'}, error-level log, NOTHING injected
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadVaultIntoEnv } from '../src/vault';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * env-restore guard. Snapshot+restore ONLY the keys we mutate so a value set on
 * the test-runner host (or a previous test) does not leak in or out.
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
  'DOTENV_PRIVATE_KEY',
  'SECRETS_REQUIRED',
  'VAULT_REQUIRED',
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'agent-secrets-test-'));
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

/** Write a plaintext `.env` fixture and return its path. */
function writeEnvFixture(entries: Record<string, string>): string {
  const envPath = join(tmpRoot, '.env');
  const body = Object.entries(entries)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync(envPath, body + '\n');
  return envPath;
}

function mockLogger() {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const joined = (calls: unknown[][]) =>
  calls.map((c) => c.map((p) => (typeof p === 'string' ? p : '')).join(' ')).join(' ');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadVaultIntoEnv (demo_agent_service, dotenvx)', () => {
  test('Vercel bypass — returns vercel reason, never touches process.env', async () => {
    const logger = mockLogger();
    const envPath = writeEnvFixture({ AGENT_CLIENT_SECRET: 'should-not-load' });

    expect(process.env.AGENT_CLIENT_SECRET).toBeUndefined();

    const result = await loadVaultIntoEnv({ envPath, isVercel: true, logger });

    expect(result).toEqual({ loaded: false, entries: 0, reason: 'vercel' });
    expect(process.env.AGENT_CLIENT_SECRET).toBeUndefined();
  });

  test('Missing .env, nothing expected — no_env_file reason, warns, no throw', async () => {
    const logger = mockLogger();
    const result = await loadVaultIntoEnv({
      envPath: join(tmpRoot, 'does-not-exist.env'),
      logger,
    });
    expect(result).toEqual({ loaded: false, entries: 0, reason: 'no_env_file' });
    const warnArgs = joined(logger.warn.mock.calls);
    expect(warnArgs).toMatch(/no \.env/);
    expect(warnArgs).toMatch(/using process\.env only/);
    // nothing expected → NOT escalated to error level
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('Plaintext .env — AGENT_* + allowlisted land in env; LD_PRELOAD/RANDOM_KEY NOT injected', async () => {
    const logger = mockLogger();
    const envPath = writeEnvFixture({
      AGENT_CLIENT_ID: 'agent-id-1',
      AGENT_CLIENT_SECRET: 'agent-secret-1',
      MCP_GW_RESOURCE_URI: 'https://gw.example',
      HELIX_API_KEY: 'helix-xyz',
      LD_PRELOAD: '/evil.so',
      RANDOM_KEY: 'tossed',
    });

    const result = await loadVaultIntoEnv({ envPath, logger });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(4); // 4 allowlisted; LD_PRELOAD + RANDOM_KEY skipped
    expect(process.env.AGENT_CLIENT_ID).toBe('agent-id-1');
    expect(process.env.AGENT_CLIENT_SECRET).toBe('agent-secret-1');
    expect(process.env.MCP_GW_RESOURCE_URI).toBe('https://gw.example');
    expect(process.env.HELIX_API_KEY).toBe('helix-xyz');
    // CRITICAL: this loader must never inject a non-allowlisted name (T-269-17).
    expect(process.env.LD_PRELOAD).toBeUndefined();
    expect(process.env.RANDOM_KEY).toBeUndefined();
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
    // Non-secret config names in the merged .env are also (correctly) not copied:
    expect(ALLOW.test('PINGONE_TOKEN_ENDPOINT')).toBe(false);
    expect(ALLOW.test('LLM_PROVIDER')).toBe(false);
    // Bare prefix with no suffix must be rejected ([A-Z0-9_]+ requires ≥1 char):
    expect(ALLOW.test('AGENT_')).toBe(false);
    expect(ALLOW.test('MCP_GW_')).toBe(false);
  });

  test('DOTENV_PRIVATE_KEY hygiene — deleted from process.env after a successful load', async () => {
    const logger = mockLogger();
    const envPath = writeEnvFixture({ AGENT_CLIENT_SECRET: 'ok' });

    process.env.DOTENV_PRIVATE_KEY = 'deadbeef-private-key';

    const result = await loadVaultIntoEnv({ envPath, logger });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(1);
    expect(process.env.AGENT_CLIENT_SECRET).toBe('ok');
    // The decrypt key must NOT survive in process.env after load (secret hygiene).
    expect(process.env.DOTENV_PRIVATE_KEY).toBeUndefined();
  });

  test('dotenvx config error (encrypted value, no key) — dotenv_error, nothing injected', async () => {
    const logger = mockLogger();
    // A value that dotenvx recognizes as encrypted, with NO DOTENV_PRIVATE_KEY /
    // .env.keys available → config() returns a DECRYPTION_FAILED error rather
    // than injecting the ciphertext. The loader must treat this as unavailable.
    const envPath = writeEnvFixture({
      AGENT_CLIENT_SECRET:
        '"encrypted:BM3oYPVXWZeo+F4b6v2V8YqAlAuUawxaS9RnmTuEO2k1wbnlQmEFsUQ45BVCxfZYv5wa8XukjRYG6+d7dcjDO6LA2s765TSSztE2YFIoCkpxBbuT49ph8QZ0qp/6btpBti3bSOwymvwVOPRh5hjpfRlt"',
    });

    const result = await loadVaultIntoEnv({ envPath, logger });

    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('dotenv_error');
    // The ciphertext must NOT be injected as if it were the secret.
    expect(process.env.AGENT_CLIENT_SECRET).toBeUndefined();
    // A present `.env` means secrets were expected → error-level, non-fatal.
    expect(logger.error).toHaveBeenCalled();
    expect(joined(logger.error.mock.calls)).toMatch(/falling back to process\.env/);
  });
});
