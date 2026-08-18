'use strict';

/**
 * vault.test.ts — tests for oauth-mcp/src/vault.ts (dotenvx loader).
 *
 * This suite has NO dependency on demo_api_server: the loader now reads the MCP
 * server's own `.env` via `@dotenvx/dotenvx`.config() and no longer requires
 * `../../demo_api_server/lib/vault`. Fixtures are plaintext `.env` files written
 * to a tmp dir (dotenvx.config() reads a plaintext `.env` exactly like
 * dotenv.config() — the backward-compat property this migration relies on).
 *
 * Covered behaviors:
 *   1. Vercel bypass — does NOT touch process.env, returns {loaded:false, reason:'vercel'}
 *   2. Missing `.env`, nothing expected — {loaded:false, reason:'no_env_file'} + warn
 *      (transparent process.env-only fallback: the zero-regression path)
 *   3. Plaintext `.env` with mixed keys — allowlisted (incl. PINGONE_*) copied to
 *      process.env; non-allowlisted (GW_INTROSPECTION_CLIENT_ID, LD_PRELOAD,
 *      RANDOM_KEY) NOT injected by the loader; entries counts only the allowlisted
 *   4. Allowlist regex — MCP_GW_/PINGONE_ prefixes matched; GW_ / lowercase /
 *      injection rejected
 *   5. DOTENV_PRIVATE_KEY hygiene — deleted from process.env after a successful load
 *   6. dotenvx config error (encrypted value, no key) — {loaded:false,
 *      reason:'dotenv_error'}, error-level log, NOTHING injected
 *   7. REGRESSION_PLAN §4 invariant — the gateway/introspection client id+secret
 *      survive the allowlist so oauth-mcp introspects as the gateway's exchange
 *      client (the PINGONE_ prefix is load-bearing)
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
  'PINGONE_CLIENT_ID',
  'MCP_GW_CLIENT_ID',
  'MCP_GW_CLIENT_SECRET',
  'MCP_GW_RESOURCE_URI',
  'PROVIDER_OPENAI_KEY',
  'HELIX_API_KEY',
  'BFF_INTERNAL_SECRET',
  'GW_INTROSPECTION_CLIENT_ID',
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'mcp-secrets-test-'));
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

describe('loadVaultIntoEnv (oauth-mcp, dotenvx)', () => {
  test('Vercel bypass — returns vercel reason, never touches process.env', async () => {
    const logger = mockLogger();
    const envPath = writeEnvFixture({ PINGONE_CLIENT_ID: 'should-not-load' });

    expect(process.env.PINGONE_CLIENT_ID).toBeUndefined();

    const result = await loadVaultIntoEnv({ envPath, isVercel: true, logger });

    expect(result).toEqual({ loaded: false, entries: 0, reason: 'vercel' });
    expect(process.env.PINGONE_CLIENT_ID).toBeUndefined();
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

  test('Plaintext .env — PINGONE_*/MCP_GW_* + allowlisted land in env; GW_/LD_PRELOAD/RANDOM_KEY NOT injected', async () => {
    const logger = mockLogger();
    const envPath = writeEnvFixture({
      PINGONE_MCP_GATEWAY_CLIENT_ID: 'gw-id-1',
      PINGONE_MCP_GATEWAY_CLIENT_SECRET: 'gw-secret-1',
      MCP_GW_RESOURCE_URI: 'https://gw.example',
      HELIX_API_KEY: 'helix-xyz',
      BFF_INTERNAL_SECRET: 'bff-shared',
      // GW_INTROSPECTION_CLIENT_ID is real config the MCP server DOES read, but it
      // reaches process.env via the top-of-module dotenvx.config() in index.ts,
      // NOT via this allowlist loader (GW_ is not an allowlisted prefix).
      GW_INTROSPECTION_CLIENT_ID: 'gw-introspection',
      LD_PRELOAD: '/evil.so',
      RANDOM_KEY: 'tossed',
    });

    const result = await loadVaultIntoEnv({ envPath, logger });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(5); // 5 allowlisted; GW_/LD_PRELOAD/RANDOM_KEY skipped
    expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_ID).toBe('gw-id-1');
    expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET).toBe('gw-secret-1');
    expect(process.env.MCP_GW_RESOURCE_URI).toBe('https://gw.example');
    expect(process.env.HELIX_API_KEY).toBe('helix-xyz');
    expect(process.env.BFF_INTERNAL_SECRET).toBe('bff-shared');
    // CRITICAL: this loader must never inject a non-allowlisted name.
    expect(process.env.GW_INTROSPECTION_CLIENT_ID).toBeUndefined();
    expect(process.env.LD_PRELOAD).toBeUndefined();
    expect(process.env.RANDOM_KEY).toBeUndefined();
  });

  test('Allowlist regex — MCP_GW_/PINGONE_ matched; GW_ / lowercase / injection rejected', async () => {
    // Mirrors oauth-mcp/src/vault.ts DEFAULT_ALLOWED exactly.
    const ALLOW = /^(MCP_GW_|PINGONE_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/;
    // The §4 load-bearing names:
    expect(ALLOW.test('PINGONE_MCP_GATEWAY_CLIENT_ID')).toBe(true);
    expect(ALLOW.test('PINGONE_MCP_GATEWAY_CLIENT_SECRET')).toBe(true);
    // Legacy gateway-client names environments.ts also accepts:
    expect(ALLOW.test('MCP_GW_CLIENT_ID')).toBe(true);
    expect(ALLOW.test('MCP_GW_CLIENT_SECRET')).toBe(true);
    // Other allowlisted prefixes:
    expect(ALLOW.test('PINGONE_CLIENT_ID')).toBe(true);
    expect(ALLOW.test('MCP_GW_RESOURCE_URI')).toBe(true);
    expect(ALLOW.test('PROVIDER_OPENAI_KEY')).toBe(true);
    expect(ALLOW.test('HELIX_API_KEY')).toBe(true);
    expect(ALLOW.test('BFF_INTERNAL_SECRET')).toBe(true);
    // GW_ is NOT an allowlisted prefix — GW_INTROSPECTION_CLIENT_ID arrives via
    // the top-level dotenvx.config(), never this loader:
    expect(ALLOW.test('GW_INTROSPECTION_CLIENT_ID')).toBe(false);
    // Injection / malformed must STILL be rejected:
    expect(ALLOW.test('pingone_client_id')).toBe(false);
    expect(ALLOW.test('LD_PRELOAD')).toBe(false);
    expect(ALLOW.test('NODE_OPTIONS')).toBe(false);
    expect(ALLOW.test('RANDOM_KEY')).toBe(false);
    // Bare prefix with no suffix must be rejected ([A-Z0-9_]+ requires ≥1 char):
    expect(ALLOW.test('PINGONE_')).toBe(false);
    expect(ALLOW.test('MCP_GW_')).toBe(false);
  });

  test('DOTENV_PRIVATE_KEY hygiene — deleted from process.env after a successful load', async () => {
    const logger = mockLogger();
    const envPath = writeEnvFixture({ PINGONE_CLIENT_SECRET: 'ok' });

    process.env.DOTENV_PRIVATE_KEY = 'deadbeef-private-key';

    const result = await loadVaultIntoEnv({ envPath, logger });

    expect(result.loaded).toBe(true);
    expect(result.entries).toBe(1);
    expect(process.env.PINGONE_CLIENT_SECRET).toBe('ok');
    // The decrypt key must NOT survive in process.env after load (secret hygiene).
    expect(process.env.DOTENV_PRIVATE_KEY).toBeUndefined();
  });

  test('dotenvx config error (encrypted value, no key) — dotenv_error, nothing injected', async () => {
    const logger = mockLogger();
    // A value that dotenvx recognizes as encrypted, with NO DOTENV_PRIVATE_KEY /
    // .env.keys available → config() returns a DECRYPTION_FAILED error rather
    // than injecting the ciphertext. The loader must treat this as unavailable.
    const envPath = writeEnvFixture({
      PINGONE_MCP_GATEWAY_CLIENT_SECRET:
        '"encrypted:BM3oYPVXWZeo+F4b6v2V8YqAlAuUawxaS9RnmTuEO2k1wbnlQmEFsUQ45BVCxfZYv5wa8XukjRYG6+d7dcjDO6LA2s765TSSztE2YFIoCkpxBbuT49ph8QZ0qp/6btpBti3bSOwymvwVOPRh5hjpfRlt"',
    });

    const result = await loadVaultIntoEnv({ envPath, logger });

    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('dotenv_error');
    // The ciphertext must NOT be injected as if it were the secret.
    expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET).toBeUndefined();
    // A present `.env` means secrets were expected → error-level, non-fatal.
    expect(logger.error).toHaveBeenCalled();
    expect(joined(logger.error.mock.calls)).toMatch(/falling back to process\.env/);
  });

  // -------------------------------------------------------------------------
  // REGRESSION_PLAN.md §4 (2026-05-18) identity invariant.
  //
  // PingOne binds RFC 7662 introspection to the REQUESTING client. oauth-mcp
  // MUST introspect as the SAME app the gateway performs its RFC 8693 exchange
  // as, or PingOne returns active:false on every token. The review that produced
  // §4 found the gateway allowlist had DROPPED the PINGONE_ prefix, so a stored
  // PINGONE_MCP_GATEWAY_CLIENT_ID/SECRET silently fell back to a stale value.
  // These tests pin the load-bearing property: the gateway client id+secret
  // survive the allowlist and reach process.env verbatim.
  // -------------------------------------------------------------------------
  describe('REGRESSION_PLAN §4 — gateway/introspection client survives the allowlist', () => {
    test('PINGONE_MCP_GATEWAY_CLIENT_ID/SECRET reach process.env byte-identical', async () => {
      const logger = mockLogger();
      const envPath = writeEnvFixture({
        PINGONE_MCP_GATEWAY_CLIENT_ID: 'd3f8fead-gateway-app',
        PINGONE_MCP_GATEWAY_CLIENT_SECRET: 'gateway-app-secret-verbatim',
      });

      const result = await loadVaultIntoEnv({ envPath, logger });

      expect(result.loaded).toBe(true);
      // The PINGONE_ prefix is load-bearing — both must be present after load.
      expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_ID).toBe('d3f8fead-gateway-app');
      expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET).toBe('gateway-app-secret-verbatim');
    });

    test('legacy MCP_GW_CLIENT_ID/SECRET (the other names environments.ts accepts) also survive', async () => {
      const logger = mockLogger();
      const envPath = writeEnvFixture({
        MCP_GW_CLIENT_ID: 'legacy-gateway-id',
        MCP_GW_CLIENT_SECRET: 'legacy-gateway-secret',
      });

      const result = await loadVaultIntoEnv({ envPath, logger });

      expect(result.loaded).toBe(true);
      expect(process.env.MCP_GW_CLIENT_ID).toBe('legacy-gateway-id');
      expect(process.env.MCP_GW_CLIENT_SECRET).toBe('legacy-gateway-secret');
    });

    test('the DEFAULT allowlist still contains PINGONE_ — removing it would drop the gateway client', async () => {
      const logger = mockLogger();
      const envPath = writeEnvFixture({
        PINGONE_MCP_GATEWAY_CLIENT_ID: 'gw-id',
        PINGONE_MCP_GATEWAY_CLIENT_SECRET: 'gw-secret',
      });

      // Prove the negative: an allowlist WITHOUT PINGONE_ drops the gateway
      // client (the exact §4 regression) — so the shipped default MUST keep it.
      const withoutPingone = await loadVaultIntoEnv({
        envPath,
        logger,
        allowedPrefixes: /^(MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/,
      });
      expect(withoutPingone.entries).toBe(0);
      expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_ID).toBeUndefined();

      // The shipped default (PINGONE_ present) keeps them.
      const withDefault = await loadVaultIntoEnv({ envPath, logger });
      expect(withDefault.entries).toBe(2);
      expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_ID).toBe('gw-id');
      expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET).toBe('gw-secret');
    });
  });
});
