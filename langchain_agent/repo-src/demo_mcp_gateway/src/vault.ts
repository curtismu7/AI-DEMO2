'use strict';

/**
 * MCP Gateway vault loader (Phase 269 Plan 04).
 *
 * Reads selected entries from the BFF-side encrypted vault at `secrets.vault`
 * and copies them into `process.env` BEFORE the gateway's existing
 * loadConfig() runs. This lets operators store the gateway's OAuth client
 * secret (MCP_GW_CLIENT_SECRET) and future AI provider keys
 * (PROVIDER_OPENAI_KEY, HELIX_API_KEY, ...) in the vault instead of .env.
 *
 * Allowlist: only entries whose NAME matches
 *   /^(MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_|DEMO_)[A-Z0-9_]+$/
 * are copied. Non-matching entries are logged via logger.warn and skipped.
 * This is critical: a stolen vault file with an entry like
 *   LD_PRELOAD=/evil.so
 * MUST NOT set process.env.LD_PRELOAD (T-269-17).
 *
 * Vercel: bypassed when VERCEL=1 — consistent with the BFF (Plan 03).
 *
 * Error logging discipline (T-269-20): logger.error receives only the error
 * message, never the underlying stack trace. Stack traces would leak Argon2
 * / KEK / DEK internal names.
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
//
// IN-02: this hard relative path couples the gateway's dist/ depth to the
// BFF source layout. A containerized deploy that does NOT co-locate both
// services would otherwise fail startup with a bare MODULE_NOT_FOUND. Wrap
// the require so the failure is self-describing instead of opaque.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vaultLib: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vaultLib = require('../../demo_api_server/lib/vault');
} catch {
  // Not co-located with demo_api_server (e.g. standalone container deploy).
  // Vault loading will be skipped — all credentials must be in process.env.
  vaultLib = null;
}

// REPO_ROOT resolves up from this file:
//   compiled: demo_mcp_gateway/dist/vault.js  → ../.. → repo root
//   source:   demo_mcp_gateway/src/vault.ts   → ../.. → repo root
// Both layouts land on the same repo root.
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_VAULT_PATH = join(REPO_ROOT, 'secrets.vault');
const DEFAULT_ALLOWED = /^(MCP_GW_|PROVIDER_|HELIX_|BFF_INTERNAL_|DEMO_)[A-Z0-9_]+$/;

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
 * Callers (demo_mcp_gateway/src/index.ts) MUST await loadVaultIntoEnv
 * before invoking loadConfig().
 */
export async function loadVaultIntoEnv(opts: VaultLoadOpts = {}): Promise<VaultLoadResult> {
  const vaultPath = opts.vaultPath ?? process.env.VAULT_PATH ?? DEFAULT_VAULT_PATH;
  const password = opts.password ?? process.env.VAULT_PASSWORD;
  const logger = opts.logger ?? console;
  const allowed = opts.allowedPrefixes ?? DEFAULT_ALLOWED;
  const isVercel = opts.isVercel ?? (process.env.VERCEL === '1');

  if (!vaultLib) {
    logger.log('[GW vault] vault library not available (standalone container) — using process.env only');
    return { loaded: false, entries: 0, reason: 'no_vault_file' };
  }

  if (isVercel) {
    logger.log(
      '[GW vault] Vercel detected — skipping vault load (use Encrypted Environment Variables)',
    );
    return { loaded: false, entries: 0, reason: 'vercel' };
  }

  if (!existsSync(vaultPath)) {
    logger.log('[GW vault] no vault file at ' + vaultPath + ' — using process.env only');
    return { loaded: false, entries: 0, reason: 'no_vault_file' };
  }

  if (!password) {
    const msg = '[GW vault] secrets.vault exists but VAULT_PASSWORD not set — refusing to start';
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
    logger.error('[GW vault] open failed:', e.message);
    throw err;
  }

  let entryCount = 0;
  try {
    for (const name of vault.list() as string[]) {
      if (!allowed.test(name)) {
        logger.warn('[GW vault] skipping non-allowlisted entry: ' + name);
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

  logger.log('[GW vault] loaded ' + entryCount + ' entries from ' + vaultPath);
  return { loaded: true, entries: entryCount };
}
