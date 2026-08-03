'use strict';

/**
 * demo-agent-service vault loader (architectural parity with
 * demo_mcp_gateway/src/vault.ts, Phase 269 Plan 04).
 *
 * Reads selected entries from the BFF-side encrypted vault at `secrets.vault`
 * and copies them into `process.env` BEFORE the agent's existing loadConfig()
 * runs. This lets operators store the agent's OAuth client secret
 * (AGENT_CLIENT_SECRET) and the shared MCP gateway resource URI in the vault
 * instead of .env, the same way the gateway already does for MCP_GW_*.
 *
 * Allowlist: only entries whose NAME matches
 *   /^(AGENT_|MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/
 * are copied. Non-matching entries are logged via logger.warn and skipped.
 * This is critical: a stolen vault file with an entry like
 *   LD_PRELOAD=/evil.so
 * MUST NOT set process.env.LD_PRELOAD (T-269-17). The only delta from the
 * gateway allowlist is the added `AGENT_` prefix (covers AGENT_CLIENT_ID,
 * AGENT_CLIENT_SECRET); MCP_GW_RESOURCE_URI is already matched by MCP_GW_.
 *
 * Vercel: bypassed when VERCEL=1 — consistent with the BFF (Plan 03) and the
 * gateway (Plan 04).
 *
 * Error logging discipline (T-269-20): logger.error receives only the error
 * message, never the underlying stack trace. Stack traces would leak Argon2
 * / KEK / DEK internal symbol names from the vault library.
 *
 * VAULT_PASSWORD lifecycle (T-269-06): immediately after vault.close(), we
 * `delete process.env.VAULT_PASSWORD` to shrink the /proc/<pid>/environ leak
 * window from "process lifetime" to "first ~10ms of startup".
 */

import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// The vault library is CommonJS over in demo_api_server. We require it via
// a relative path. No TS types exist for it. Using `require()` with an
// eslint disable + cast keeps the diff small and avoids a .d.ts file.
// demo_agent_service is a sibling of demo_api_server under the repo
// root, identical to the gateway, so the relative path is the same.
const VAULT_LIB_PATH = '../../demo_api_server/lib/vault';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vaultLib: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  vaultLib = require(VAULT_LIB_PATH);
} catch (err) {
  // ONLY "the module isn't here" is expected — the agent image genuinely ships
  // without demo_api_server. A bare `catch {}` also swallowed every other
  // require-time failure: a broken argon2 native build, a syntax error in the
  // vault library, a partially-installed dependency. Each of those left
  // vaultLib null and the service reporting reason 'no_vault_file' — a wrong
  // answer that reads as normal. Anything that is not this exact module going
  // missing is a real defect and must surface.
  const e = err as NodeJS.ErrnoException & { message: string };
  const isMissingVaultLib =
    e.code === 'MODULE_NOT_FOUND' && e.message.includes(VAULT_LIB_PATH);
  if (!isMissingVaultLib) throw err;
}

// REPO_ROOT resolves up from this file:
//   compiled: demo_agent_service/dist/vault.js  → ../.. → repo root
//   source:   demo_agent_service/src/vault.ts   → ../.. → repo root
// Both layouts land on the same repo root (tsconfig outDir ./dist,
// rootDir ./src — identical to the gateway).
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_VAULT_PATH = join(REPO_ROOT, 'secrets.vault');
const DEFAULT_ALLOWED = /^(AGENT_|MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_)[A-Z0-9_]+$/;

export interface VaultLoadResult {
  loaded: boolean;
  entries: number;
  reason?: 'vercel' | 'no_vault_file' | 'vault_lib_unavailable';
}

export interface VaultLoadOpts {
  vaultPath?: string;
  password?: string;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  allowedPrefixes?: RegExp;
  isVercel?: boolean;
}

/**
 * Load allowlisted vault entries into process.env. See module docstring above
 * for the allowlist, Vercel bypass, and VAULT_PASSWORD lifecycle rules.
 * Callers (demo_agent_service/src/index.ts) MUST await loadVaultIntoEnv
 * before invoking loadConfig().
 */
export async function loadVaultIntoEnv(opts: VaultLoadOpts = {}): Promise<VaultLoadResult> {
  const vaultPath = opts.vaultPath ?? process.env.VAULT_PATH ?? DEFAULT_VAULT_PATH;
  const password = opts.password ?? process.env.VAULT_PASSWORD;
  const logger = opts.logger ?? console;
  const allowed = opts.allowedPrefixes ?? DEFAULT_ALLOWED;
  const isVercel = opts.isVercel ?? (process.env.VERCEL === '1');

  if (isVercel) {
    logger.log(
      '[Agent vault] Vercel detected — skipping vault load (use Encrypted Environment Variables)',
    );
    return { loaded: false, entries: 0, reason: 'vercel' };
  }

  // The vault library is absent whenever the agent runs from its own image:
  // docker-compose builds agent-service with `context: ./demo_agent_service`,
  // so demo_api_server is not in the build context and the require above always
  // fails. This branch is therefore the ONLY branch that runs under Compose.
  //
  // It used to return silently, and with reason 'no_vault_file' — claiming a
  // missing file when the file may be mounted and readable. Result: every
  // AGENT_/MCP_GW_/BFF_INTERNAL_ secret quietly came from .env instead of the
  // vault, the `!password` fail-fast below was unreachable, and nothing in the
  // logs said so. Say it out loud, and honour VAULT_REQUIRED the way the BFF's
  // loader does so a deployment that depends on the vault fails instead of
  // degrading.
  if (vaultLib === null) {
    const vaultIntended = existsSync(vaultPath) || Boolean(password);
    const msg =
      '[Agent vault] vault library not available in this image (' +
      VAULT_LIB_PATH +
      ') — vault entries will NOT be loaded';
    if (String(process.env.VAULT_REQUIRED).toLowerCase() === 'true') {
      logger.error(msg + ' and VAULT_REQUIRED=true — refusing to start');
      throw new Error(msg + ' and VAULT_REQUIRED=true — refusing to start');
    }
    if (vaultIntended) {
      // A vault file or a password is present, so somebody expected this to
      // work. Loudest non-fatal signal available.
      logger.error(msg + ' — falling back to process.env (set VAULT_REQUIRED=true to make this fatal)');
    } else {
      logger.warn(msg + ' — no vault file and no VAULT_PASSWORD, using process.env only');
    }
    return { loaded: false, entries: 0, reason: 'vault_lib_unavailable' };
  }

  if (!existsSync(vaultPath)) {
    logger.log('[Agent vault] no vault file at ' + vaultPath + ' — using process.env only');
    return { loaded: false, entries: 0, reason: 'no_vault_file' };
  }

  if (!password) {
    const msg = '[Agent vault] secrets.vault exists but VAULT_PASSWORD not set — refusing to start';
    logger.error(msg);
    throw new Error(msg);
  }

  let vault;
  try {
    vault = await vaultLib.openVault(vaultPath, password, { caller: 'agent-service' });
  } catch (err) {
    // Log error message ONLY — never the stack trace (T-269-20: stack-traces
    // leak argon2 / kek / dek internal symbol names from the vault library).
    const e = err as Error;
    logger.error('[Agent vault] open failed:', e.message);
    throw err;
  }

  let entryCount = 0;
  try {
    for (const name of vault.list() as string[]) {
      if (!allowed.test(name)) {
        logger.warn('[Agent vault] skipping non-allowlisted entry: ' + name);
        continue;
      }
      process.env[name] = vault.read(name);
      entryCount++;
    }
  } finally {
    try {
      vault.close();
    } catch {
      /* close is best-effort; KEK already zeroed in error paths */
    }
    delete process.env.VAULT_PASSWORD;
  }

  logger.log('[Agent vault] loaded ' + entryCount + ' entries from ' + vaultPath);
  return { loaded: true, entries: entryCount };
}
