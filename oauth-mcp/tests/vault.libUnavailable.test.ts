'use strict';

/**
 * vault.libUnavailable.test.ts — the "secrets source unavailable" branch.
 *
 * Under the old vault loader this covered the case where
 * `require('../../demo_api_server/lib/vault')` failed (the branch Compose always
 * took). That cross-package require is GONE. The dotenvx analog is: the service
 * `.env` is absent, or `dotenvx.config()` returns an error (e.g. an encrypted
 * value with no decryption key). Both share ONE loud-vs-warn handler that must:
 *
 *   - refuse to start when SECRETS_REQUIRED (or legacy VAULT_REQUIRED) = true.
 *     REGRESSION_PLAN §4 2026-05-18: this MCP server must fail CLOSED on a
 *     secret-load failure — a fail-OPEN boot introspected as the WRONG PingOne
 *     client. In the encrypted-`.env` deployment SECRETS_REQUIRED=true enforces
 *     that; today's plaintext `.env` decrypts cleanly so the branch never fires.
 *   - escalate to error level (non-fatal) when secrets were plainly expected
 *     (a `.env` is present, or a DOTENV_PRIVATE_KEY was supplied);
 *   - otherwise warn and run on process.env only (the zero-regression path);
 *   - always let the Vercel bypass win.
 *
 * No module-registry rigging is needed anymore: the failure is driven by the
 * filesystem / .env contents, not by a require throwing at module load.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadVaultIntoEnv } from '../src/vault';

const ENV_KEYS_TO_GUARD = [
  'PINGONE_MCP_GATEWAY_CLIENT_SECRET',
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'mcp-secrets-unavail-'));
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

function mockLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

const joined = (calls: unknown[][]) =>
  calls.map((c) => c.map((p) => (typeof p === 'string' ? p : '')).join(' ')).join(' ');

const MISSING = () => join(tmpRoot, 'nonexistent.env');

/** A `.env` whose only value is encrypted, with no key available to decrypt it. */
function writeUndecryptableEnv(): string {
  const envPath = join(tmpRoot, '.env');
  writeFileSync(
    envPath,
    'PINGONE_MCP_GATEWAY_CLIENT_SECRET="encrypted:BM3oYPVXWZeo+F4b6v2V8YqAlAuUawxaS9RnmTuEO2k1wbnlQmEFsUQ45BVCxfZYv5wa8XukjRYG6+d7dcjDO6LA2s765TSSztE2YFIoCkpxBbuT49ph8QZ0qp/6btpBti3bSOwymvwVOPRh5hjpfRlt"\n',
  );
  return envPath;
}

// ---------------------------------------------------------------------------
// Missing .env
// ---------------------------------------------------------------------------
describe('secrets source unavailable (missing .env)', () => {
  test('reports no_env_file, not a throw, when nothing signals secrets are expected', async () => {
    const logger = mockLogger();
    const result = await loadVaultIntoEnv({ envPath: MISSING(), logger });
    expect(result).toEqual({ loaded: false, entries: 0, reason: 'no_env_file' });
  });

  test('says so in the log (warn) instead of returning silently', async () => {
    const logger = mockLogger();
    await loadVaultIntoEnv({ envPath: MISSING(), logger });
    const all = joined([
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
      ...logger.log.mock.calls,
    ]);
    expect(all).toMatch(/no \.env/);
    expect(all).toMatch(/using process\.env only/);
  });

  test('escalates to error level when a DOTENV_PRIVATE_KEY says secrets were expected', async () => {
    const logger = mockLogger();
    process.env.DOTENV_PRIVATE_KEY = 'operator-supplied-key';
    await loadVaultIntoEnv({ envPath: MISSING(), logger });
    expect(logger.error).toHaveBeenCalled();
    expect(joined(logger.error.mock.calls)).toMatch(/falling back to process\.env/);
  });

  test('SECRETS_REQUIRED=true refuses to start (fail-closed, §4)', async () => {
    const logger = mockLogger();
    process.env.SECRETS_REQUIRED = 'true';
    await expect(loadVaultIntoEnv({ envPath: MISSING(), logger })).rejects.toThrow(
      /refusing to start/,
    );
  });

  test('legacy VAULT_REQUIRED=true still refuses to start', async () => {
    const logger = mockLogger();
    process.env.VAULT_REQUIRED = 'true';
    await expect(loadVaultIntoEnv({ envPath: MISSING(), logger })).rejects.toThrow(
      /refusing to start/,
    );
  });

  test('Vercel still wins — no .env is expected there at all', async () => {
    const logger = mockLogger();
    const result = await loadVaultIntoEnv({ envPath: MISSING(), isVercel: true, logger });
    expect(result).toEqual({ loaded: false, entries: 0, reason: 'vercel' });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dotenvx config error (present .env that cannot be decrypted)
// ---------------------------------------------------------------------------
describe('secrets source unavailable (dotenvx config error)', () => {
  test('reports dotenv_error and injects nothing when an encrypted value cannot be decrypted', async () => {
    const logger = mockLogger();
    const result = await loadVaultIntoEnv({ envPath: writeUndecryptableEnv(), logger });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('dotenv_error');
    expect(process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET).toBeUndefined();
    // A present `.env` means secrets were expected → error-level, non-fatal.
    expect(logger.error).toHaveBeenCalled();
  });

  test('SECRETS_REQUIRED=true turns a config error into a refuse-to-start (fail-closed, §4)', async () => {
    const logger = mockLogger();
    process.env.SECRETS_REQUIRED = 'true';
    await expect(
      loadVaultIntoEnv({ envPath: writeUndecryptableEnv(), logger }),
    ).rejects.toThrow(/refusing to start/);
  });
});
