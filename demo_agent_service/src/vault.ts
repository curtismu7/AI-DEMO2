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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vaultLib: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  vaultLib = require('../../demo_api_server/lib/vault');
} catch {
  // Not co-located with demo_api_server (e.g. standalone container deploy).
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
  reason?: 'vercel' | 'no_vault_file';
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

  if (vaultLib === null) {
    return { loaded: false, entries: 0, reason: 'no_vault_file' };
  }

  if (isVercel) {
    logger.log(
      '[Agent vault] Vercel detected — skipping vault load (use Encrypted Environment Variables)',
    );
    return { loaded: false, entries: 0, reason: 'vercel' };
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
    vault = await vaultLib.openVault(vaultPath, password);
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
