'use strict';

/**
 * demo-agent-service secret loader (dotenvx).
 *
 * Loads the agent's secrets from its OWN `.env` via `@dotenvx/dotenvx`.config(),
 * then copies ONLY allowlisted names into process.env. This REPLACES the former
 * loader that reached into `demo_api_server/lib/vault` — that cross-package
 * coupling (and the argon2/KEK/DEK vault machinery) is gone.
 *
 * Backward compatible with a PLAINTEXT `.env`: dotenvx.config() reads a plain
 * `.env` exactly like dotenv.config(), and decrypts encrypted values only when
 * they are present AND a decryption key (DOTENV_PRIVATE_KEY env / `.env.keys`)
 * is available. Encrypting `.env` is a later migration step — today the agent
 * still boots with its secrets from the current plaintext `.env`, so this loader
 * neither requires an encrypted `.env` nor a DOTENV_PRIVATE_KEY to exist yet.
 *
 * Allowlist (unchanged from the vault loader): only names matching
 *   /^(AGENT_|MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/
 * are copied into process.env. dotenvx parses `.env` into a PRIVATE throwaway
 * object (the `processEnv` option), never the real process.env, so this loader
 * itself can only ever write allowlisted names — a non-allowlisted name in
 * `.env` (e.g. an injected LD_PRELOAD) is never written to process.env BY THIS
 * LOADER. Non-secret config (PINGONE_*, LLM_*, …) is NOT this loader's job: it
 * reaches process.env through the top-of-module dotenv.config() in
 * index.ts/config.ts, exactly as before. Non-allowlisted names are skipped
 * silently here (in the merged-`.env` model they are legitimate config, not
 * suspicious vault entries — warning on each would flood boot logs).
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
//   compiled: demo_agent_service/dist/vault.js → ../ → demo_agent_service
//   source:   demo_agent_service/src/vault.ts  → ../ → demo_agent_service
const SERVICE_ROOT = resolve(__dirname, '..');
const DEFAULT_ENV_PATH = join(SERVICE_ROOT, '.env');
const DEFAULT_ALLOWED = /^(AGENT_|MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/;

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
      '[Agent secrets] Vercel detected — skipping .env load (use Encrypted Environment Variables)',
    );
    return { loaded: false, entries: 0, reason: 'vercel' };
  }

  // Missing `.env` and dotenvx-config failure share ONE loud-vs-warn handler,
  // mirroring the old vault loader's "library unavailable" branch:
  //   - SECRETS_REQUIRED (or legacy VAULT_REQUIRED) = true → fatal.
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
    return unavailable('no_env_file', '[Agent secrets] no .env at ' + envPath);
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
      '[Agent secrets] dotenvx config failed: ' + (err as Error).message,
    );
  }
  if (result.error) {
    return unavailable(
      'dotenv_error',
      '[Agent secrets] dotenvx config failed: ' + result.error.message,
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

  logger.log('[Agent secrets] loaded ' + entryCount + ' allowlisted entries from ' + envPath);
  return { loaded: true, entries: entryCount };
}
