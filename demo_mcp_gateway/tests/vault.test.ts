'use strict';

/**
 * vault.test.ts — tests for demo_mcp_gateway/src/vault.ts (dotenvx loader).
 *
 * This suite has NO dependency on demo_api_server: the loader now reads the
 * gateway's own `.env` via `@dotenvx/dotenvx`.config() and no longer requires
 * `../../demo_api_server/lib/vault` (so it also no longer needs the native
 * argon2 module — the CI argon2 install hack was removed with this change).
 * Fixtures are plaintext `.env` files written to a tmp dir (dotenvx.config()
 * reads a plaintext `.env` exactly like dotenv.config() — the backward-compat
 * property this migration relies on).
 *
 * Covered behaviors:
 *   1. Vercel bypass — does NOT touch process.env, returns {loaded:false, reason:'vercel'}
 *   2. Missing `.env`, nothing expected — {loaded:false, reason:'no_env_file'} + warn
 *   3. Plaintext `.env` with mixed keys — allowlisted (incl. PINGONE_/DEMO_) copied to
 *      process.env; non-allowlisted (LD_PRELOAD, RANDOM_KEY) NOT injected by the loader
 *   4. §4 INVARIANT — after load the gateway still receives byte-identical
 *      PINGONE_MCP_GATEWAY_CLIENT_ID / PINGONE_MCP_GATEWAY_CLIENT_SECRET (these must
 *      stay identical to what oauth-mcp gets — REGRESSION_PLAN §4)
 *   5. Allowlist regex — PINGONE_ / DEMO_ matched; lowercase / injection rejected
 *   6. DOTENV_PRIVATE_KEY hygiene — deleted from process.env after a successful load
 *   7. dotenvx config error (encrypted value, no key) — {loaded:false,
 *      reason:'dotenv_error'}, error-level log, NOTHING injected
 *   8. libUnavailable semantics — SECRETS_REQUIRED / legacy VAULT_REQUIRED refuse to start
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
  'PINGONE_MCP_GATEWAY_CLIENT_ID',
  'PINGONE_MCP_GATEWAY_CLIENT_SECRET',
  'MCP_GW_CLIENT_ID',
  'MCP_GW_CLIENT_SECRET',
  'MCP_GW_RESOURCE_URI',
  'PROVIDER_OPENAI_KEY',
  'HELIX_API_KEY',
  'BFF_INTERNAL_SECRET',
  'DEMO_API_RESOURCE_SERVER_KEY',
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'gw-secrets-test-'));
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

/** A `.env` whose only value is encrypted, with no key available to decrypt it. */
function writeUndecryptableEnv(): string {
  const envPath = join(tmpRoot, '.env');
  writeFileSync(
    envPath,
    'MCP_GW_CLIENT_SECRET="encrypted:BM3oYPVXWZeo+F4b6v2V8YqAlAuUawxaS9RnmTuEO2k1wbnlQmEFsUQ45BVCxfZYv5wa8XukjRYG6+d7dcjDO6LA2s765TSSztE2YFIoCkpxBbuT49ph8QZ0qp/6btpBti3bSOwymvwVOPRh5hjpfRlt"\n',
  );
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

describe('loadVaultIntoEnv (demo_mcp_gateway, dotenvx)', () => {
  test('Vercel bypass — returns vercel reason, never touches process.env', async () => {
    const logger = mockLogger();
    const envPath = writeEnvFixture({ MCP_GW_CLIENT_SECRET: 'should-not-load' });

    expect(process.env.MCP_GW_CLIENT_SECRET).toBeUndefined();

    const result = await loadVaultIntoEnv({ envPath, isVercel: true, logger });

    expect(result).toEqual({ loaded: false, entries: 0, reason: 'vercel' });
    expect(process.env.MCP_GW_CLIENT_SECRET).toBeUndefined();
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

  test('Plaintext .env — allowlisted (incl. PINGONE_/DEMO_) land in env; LD_PRELOAD/RANDOM_KEY NOT injected', async () => {
    const logger = mockLogger();
    const envPath = writeEnvFixture({
      MCP_GW_CLIENT_SECRET: 'secret-1',
      PROVIDER_OPENAI_KEY: 'sk-test',
      HELIX_API_KEY: 'helix-xyz',
      DEMO_API_RESOURCE_SERVER_KEY: 'mortgage-key-xyz',
      LD_PRELOAD: '/evil.so',
      RANDOM_KEY: 'tossed',
    });

    const result = await loadVaultIntoEnv({ envPath, logger });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(4); // 4 allowlisted; LD_PRELOAD + RANDOM_KEY skipped
    expect(process.env.MCP_GW_CLIENT_SECRET).toBe('secret-1');
    expect(process.env.PROVIDER_OPENAI_KEY).toBe('sk-test');
    expect(process.env.HELIX_API_KEY).toBe('helix-xyz');
    expect(process.env.DEMO_API_RESOURCE_SERVER_KEY).toBe('mortgage-key-xyz');
    // CRITICAL: this loader must never inject a non-allowlisted name (T-269-17).
    expect(process.env.LD_PRELOAD).toBeUndefined();
    expect(process.env.RANDOM_KEY).toBeUndefined();
  });

  test('§4 INVARIANT — PINGONE_MCP_GATEWAY_CLIENT_ID/SECRET reach process.env byte-identical', async () => {
    // REGRESSION_PLAN §4: the gateway (RFC 8693 exchange) and oauth-mcp (RFC 7662
    // introspection) must present the SAME PingOne client. config.ts PREFERS the
    // PINGONE_MCP_GATEWAY_* names, so they MUST survive the allowlist unchanged.
    const logger = mockLogger();
    const CLIENT_ID = 'a1b2c3d4-1111-2222-3333-444455556666';
    const CLIENT_SECRET = 'p1ng0ne~SecretValue_with.special-CHARS/AND+digits9876';
    const envPath = writeEnvFixture({
      PINGONE_MCP_GATEWAY_CLIENT_ID: CLIENT_ID,
      PINGONE_MCP_GATEWAY_CLIENT_SECRET: CLIENT_SECRET,
    });

    const result = await loadVaultIntoEnv({ envPath, logger });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(2);
    // Byte-identical — no trimming, no re-encoding, no prefix loss.
    expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_ID).toBe(CLIENT_ID);
    expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET).toBe(CLIENT_SECRET);
  });

  test('Allowlist regex — PINGONE_/DEMO_ matched; lowercase / injection rejected', async () => {
    // Mirrors demo_mcp_gateway/src/vault.ts DEFAULT_ALLOWED exactly.
    const ALLOW = /^(MCP_GW_|PINGONE_|PROVIDER_|HELIX_|BFF_INTERNAL_|DEMO_)[A-Z0-9_]+$/;
    // The §4 identity keys and the load-bearing prefixes:
    expect(ALLOW.test('PINGONE_MCP_GATEWAY_CLIENT_ID')).toBe(true);
    expect(ALLOW.test('PINGONE_MCP_GATEWAY_CLIENT_SECRET')).toBe(true);
    expect(ALLOW.test('MCP_GW_CLIENT_SECRET')).toBe(true);
    expect(ALLOW.test('MCP_GW_RESOURCE_URI')).toBe(true);
    expect(ALLOW.test('PROVIDER_OPENAI_KEY')).toBe(true);
    expect(ALLOW.test('HELIX_API_KEY')).toBe(true);
    expect(ALLOW.test('BFF_INTERNAL_SECRET')).toBe(true);
    expect(ALLOW.test('DEMO_API_RESOURCE_SERVER_KEY')).toBe(true);
    // Injection / malformed must STILL be rejected (T-269-17):
    expect(ALLOW.test('mcp_gw_client_secret')).toBe(false);
    expect(ALLOW.test('LD_PRELOAD')).toBe(false);
    expect(ALLOW.test('NODE_OPTIONS')).toBe(false);
    expect(ALLOW.test('RANDOM_KEY')).toBe(false);
    // Non-secret gateway config names are also (correctly) not copied by the loader:
    expect(ALLOW.test('GW_INTROSPECTION_CLIENT_ID')).toBe(false);
    expect(ALLOW.test('INTENT_TOKEN_SECRET')).toBe(false);
    // Bare prefix with no suffix must be rejected ([A-Z0-9_]+ requires ≥1 char):
    expect(ALLOW.test('MCP_GW_')).toBe(false);
    expect(ALLOW.test('PINGONE_')).toBe(false);
    expect(ALLOW.test('DEMO_')).toBe(false);
  });

  test('DOTENV_PRIVATE_KEY hygiene — deleted from process.env after a successful load', async () => {
    const logger = mockLogger();
    const envPath = writeEnvFixture({ MCP_GW_CLIENT_SECRET: 'ok' });

    process.env.DOTENV_PRIVATE_KEY = 'deadbeef-private-key';

    const result = await loadVaultIntoEnv({ envPath, logger });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(1);
    expect(process.env.MCP_GW_CLIENT_SECRET).toBe('ok');
    // The decrypt key must NOT survive in process.env after load (secret hygiene).
    expect(process.env.DOTENV_PRIVATE_KEY).toBeUndefined();
  });

  test('dotenvx config error (encrypted value, no key) — dotenv_error, nothing injected', async () => {
    const logger = mockLogger();
    // A value dotenvx recognizes as encrypted, with NO DOTENV_PRIVATE_KEY /
    // .env.keys available → config() returns a DECRYPTION_FAILED error rather
    // than injecting the ciphertext. The loader must treat this as unavailable.
    const result = await loadVaultIntoEnv({ envPath: writeUndecryptableEnv(), logger });

    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('dotenv_error');
    // The ciphertext must NOT be injected as if it were the secret.
    expect(process.env.MCP_GW_CLIENT_SECRET).toBeUndefined();
    // A present `.env` means secrets were expected → error-level, non-fatal.
    expect(logger.error).toHaveBeenCalled();
    expect(joined(logger.error.mock.calls)).toMatch(/falling back to process\.env/);
  });
});

// ---------------------------------------------------------------------------
// libUnavailable semantics — the old "vault library unavailable" branch, now
// "secrets source unavailable" (missing .env / undecryptable .env).
// ---------------------------------------------------------------------------
describe('secrets source unavailable (SECRETS_REQUIRED / VAULT_REQUIRED)', () => {
  const MISSING = () => join(tmpRoot, 'nonexistent.env');

  test('SECRETS_REQUIRED=true refuses to start on missing .env', async () => {
    const logger = mockLogger();
    process.env.SECRETS_REQUIRED = 'true';
    await expect(loadVaultIntoEnv({ envPath: MISSING(), logger })).rejects.toThrow(
      /refusing to start/,
    );
    expect(logger.error).toHaveBeenCalled();
  });

  test('legacy VAULT_REQUIRED=true still refuses to start on missing .env', async () => {
    const logger = mockLogger();
    process.env.VAULT_REQUIRED = 'true';
    await expect(loadVaultIntoEnv({ envPath: MISSING(), logger })).rejects.toThrow(
      /refusing to start/,
    );
  });

  test('escalates to error level when a DOTENV_PRIVATE_KEY says secrets were expected', async () => {
    const logger = mockLogger();
    process.env.DOTENV_PRIVATE_KEY = 'operator-supplied-key';
    const result = await loadVaultIntoEnv({ envPath: MISSING(), logger });
    expect(result).toEqual({ loaded: false, entries: 0, reason: 'no_env_file' });
    expect(logger.error).toHaveBeenCalled();
    expect(joined(logger.error.mock.calls)).toMatch(/falling back to process\.env/);
  });

  test('SECRETS_REQUIRED=true turns a config (decrypt) error into a refuse-to-start', async () => {
    const logger = mockLogger();
    process.env.SECRETS_REQUIRED = 'true';
    await expect(
      loadVaultIntoEnv({ envPath: writeUndecryptableEnv(), logger }),
    ).rejects.toThrow(/refusing to start/);
  });

  test('Vercel still wins even when SECRETS_REQUIRED=true', async () => {
    const logger = mockLogger();
    process.env.SECRETS_REQUIRED = 'true';
    const result = await loadVaultIntoEnv({ envPath: MISSING(), isVercel: true, logger });
    expect(result).toEqual({ loaded: false, entries: 0, reason: 'vercel' });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
