'use strict';

/**
 * MCP Server secret loader (dotenvx).
 *
 * Loads the MCP server's secrets from its OWN `.env` via `@dotenvx/dotenvx`
 * .config(), then copies ONLY allowlisted names into process.env BEFORE the
 * server's existing loadConfiguration() runs. This REPLACES the former loader
 * that reached into `demo_api_server/lib/vault` at `secrets.vault` — that
 * cross-package coupling (and the argon2/KEK/DEK vault machinery) is gone.
 *
 * Backward compatible with a PLAINTEXT `.env`: dotenvx.config() reads a plain
 * `.env` exactly like dotenv.config(), and decrypts encrypted values only when
 * they are present AND a decryption key (DOTENV_PRIVATE_KEY env / `.env.keys`)
 * is available. Encrypting `.env` is a later migration step — today the MCP
 * server still boots with its secrets from the current plaintext `.env`, so this
 * loader neither requires an encrypted `.env` nor a DOTENV_PRIVATE_KEY to exist
 * yet.
 *
 * Why MCP_GW_* / PINGONE_MCP_GATEWAY_* stay in the allowlist (REGRESSION_PLAN.md
 * §4 2026-05-18): PingOne binds token introspection to the REQUESTING client.
 * The gateway performs the downstream RFC 8693 exchange as
 * PINGONE_MCP_GATEWAY_CLIENT_ID (formerly MCP_GW_CLIENT_ID), so the MCP server
 * MUST introspect as that same app or PingOne returns active:false. The
 * PINGONE_ prefix is LOAD-BEARING: a prior review found the gateway allowlist
 * had dropped it, so a stored PINGONE_MCP_GATEWAY_CLIENT_ID/SECRET silently fell
 * back to a stale value and RFC 8693 exchange client ≠ RFC 7662 introspection
 * client (every tool call 401'd). environments.ts resolves the introspection
 * client from these names, which makes the "MCP introspection client == gateway
 * exchange client" invariant structural.
 *
 * Allowlist (unchanged from the vault loader): only names matching
 *   /^(MCP_GW_|PINGONE_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/
 * are copied into process.env. dotenvx parses `.env` into a PRIVATE throwaway
 * object (the `processEnv` option), never the real process.env, so this loader
 * itself can only ever write allowlisted names — a non-allowlisted name in
 * `.env` (e.g. an injected LD_PRELOAD) is never written to process.env BY THIS
 * LOADER. Non-secret config (GW_INTROSPECTION_CLIENT_ID, MCP_SERVER_*, LOG_*, …)
 * is NOT this loader's job: it reaches process.env through the top-of-module
 * dotenvx.config() in index.ts, exactly as before. Non-allowlisted names are
 * skipped silently here (in the merged-`.env` model they are legitimate config,
 * not suspicious vault entries — warning on each would flood boot logs).
 *
 * Vercel: bypassed when VERCEL=1 (consistent with the BFF and the gateway).
 *
 * Secret hygiene: DOTENV_PRIVATE_KEY (the decrypt key, if supplied via env) is
 * deleted from process.env after a successful load — same intent as the old
 * `delete process.env.VAULT_PASSWORD`: shrink the /proc/<pid>/environ leak
 * window. This loader no longer depends on VAULT_PASSWORD at all.
 *
 * Error logging discipline: logger.error receives only the error message, never
 * a stack trace.
 */

import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as dotenvx from '@dotenvx/dotenvx';

// The service's own `.env`. Resolves the same for both layouts:
//   compiled: oauth-mcp/dist/vault.js → ../ → oauth-mcp
//   source:   oauth-mcp/src/vault.ts  → ../ → oauth-mcp
const SERVICE_ROOT = resolve(__dirname, '..');
const DEFAULT_ENV_PATH = join(SERVICE_ROOT, '.env');
const DEFAULT_ALLOWED = /^(MCP_GW_|PINGONE_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/;

export interface VaultLoadResult {
  loaded: boolean;
  entries: number;
  reason?: 'vercel' | 'no_env_file' | 'dotenv_error';
}

export interface VaultLoadOpts {
  envPath?: string;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  allowedPrefixes?: RegExp;
  isVercel?: boolean;
}

/**
 * Load allowlisted secrets from the service's dotenvx `.env` into process.env.
 * Exported name + return shape are preserved so src/index.ts's call site is
 * unchanged. Kept async (dotenvx.config is synchronous, but callers `await`
 * this) to preserve that contract.
 */
export async function loadVaultIntoEnv(opts: VaultLoadOpts = {}): Promise<VaultLoadResult> {
  const envPath = opts.envPath ?? DEFAULT_ENV_PATH;
  const logger = opts.logger ?? console;
  const allowed = opts.allowedPrefixes ?? DEFAULT_ALLOWED;
  const isVercel = opts.isVercel ?? (process.env.VERCEL === '1');

  if (isVercel) {
    logger.log(
      '[MCP secrets] Vercel detected — skipping .env load (use Encrypted Environment Variables)',
    );
    return { loaded: false, entries: 0, reason: 'vercel' };
  }

  // Missing `.env` and dotenvx-config failure share ONE loud-vs-warn handler,
  // mirroring the old vault loader's "library unavailable" branch:
  //   - SECRETS_REQUIRED (or legacy VAULT_REQUIRED) = true → fatal (fail-closed).
  //     REGRESSION_PLAN §4 2026-05-18: this MCP server booting fail-OPEN on a
  //     secret-load failure introspected as the WRONG PingOne client. In the
  //     encrypted-`.env` deployment (a later task) SECRETS_REQUIRED=true keeps
  //     that fail-closed; today's plaintext `.env` decrypts cleanly, so this
  //     branch does not fire.
  //   - otherwise, if secrets were plainly expected (a `.env` is present, or a
  //     DOTENV_PRIVATE_KEY was supplied) → error level, non-fatal fallback.
  //   - otherwise → warn; the process runs on process.env only.
  const unavailable = (
    reason: 'no_env_file' | 'dotenv_error',
    detail: string,
  ): VaultLoadResult => {
    const secretsExpected = existsSync(envPath) || Boolean(process.env.DOTENV_PRIVATE_KEY);
    const required =
      String(process.env.SECRETS_REQUIRED).toLowerCase() === 'true' ||
      String(process.env.VAULT_REQUIRED).toLowerCase() === 'true';
    if (required) {
      const m = detail + ' and SECRETS_REQUIRED=true — refusing to start';
      logger.error(m);
      throw new Error(m);
    }
    if (secretsExpected) {
      logger.error(
        detail + ' — falling back to process.env (set SECRETS_REQUIRED=true to make this fatal)',
      );
    } else {
      logger.warn(detail + ' — using process.env only');
    }
    return { loaded: false, entries: 0, reason };
  };

  if (!existsSync(envPath)) {
    return unavailable('no_env_file', '[MCP secrets] no .env at ' + envPath);
  }

  // dotenvx parses into a PRIVATE object, never the real process.env — we
  // allowlist-copy below. quiet: suppress dotenvx's own banner. strict defaults
  // to false, so a decrypt/parse error is returned in `error`, not thrown.
  const parsedEnv: Record<string, string> = {};
  let result: dotenvx.DotenvConfigOutput;
  try {
    result = dotenvx.config({ path: envPath, processEnv: parsedEnv, quiet: true });
  } catch (err) {
    // strict is off so this should not fire, but never let a stack trace leak.
    return unavailable(
      'dotenv_error',
      '[MCP secrets] dotenvx config failed: ' + (err as Error).message,
    );
  }
  if (result.error) {
    return unavailable(
      'dotenv_error',
      '[MCP secrets] dotenvx config failed: ' + result.error.message,
    );
  }

  // The decrypt key has served its purpose; shrink its env-leak window.
  if (process.env.DOTENV_PRIVATE_KEY) delete process.env.DOTENV_PRIVATE_KEY;

  let entryCount = 0;
  for (const [name, value] of Object.entries(result.parsed ?? parsedEnv)) {
    if (!allowed.test(name)) continue; // non-secret config — not this loader's job
    process.env[name] = value;
    entryCount++;
  }

  logger.log('[MCP secrets] loaded ' + entryCount + ' allowlisted entries from ' + envPath);
  return { loaded: true, entries: entryCount };
}
