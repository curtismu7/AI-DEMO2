/**
 * enterpriseMcpAuthSync — pull ID-JAG's live value from the BFF at startup.
 *
 * ID-JAG (ff_enterprise_managed_mcp_auth) is owned by the UI toggle, which the
 * BFF persists in configStore. The BFF pushes changes here via POST
 * /admin/config, but the gateway's dynamic config is in-memory: a gateway
 * restart drops the pushed value and silently falls back to its env seed. That
 * is how the SE cluster ended up with the BFF reporting the flag ON while the
 * gateway had it unset, disagreeing on the RFC 9728 metadata and the 401
 * challenge with nothing surfacing the split.
 *
 * So the gateway asks on boot — and RETRIES, because a single attempt is not
 * enough in practice. Observed on SE 2026-09-03: every full deploy restarts the
 * gateway and the BFF together, the gateway comes up first, and the one attempt
 * died on `connect ECONNREFUSED ...:3001`. The gateway then kept its env seed
 * until somebody next saved the flag — a quieter version of the exact split
 * this module exists to prevent.
 *
 * Transient failures (connection refused, timeout, 5xx) are retried with
 * backoff. Terminal ones are not: a 403 means the shared secret is wrong and a
 * 404 means the BFF predates the route, and neither improves by asking again.
 */
import axios from 'axios';
import type { GatewayConfig } from './config';

/**
 * Backoff schedule, ~31s total across 5 retries. Sized to outlast a BFF that is
 * still starting after a co-restart, without holding a doomed sync open
 * forever. Boot is not blocked either way — index.ts calls this with `void`.
 */
export const SYNC_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

type Attempt = 'ok' | 'terminal' | 'retry';

export interface SyncOptions {
  retryDelaysMs?: number[];
  /** Injectable so tests do not actually wait out the backoff. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Derived from the configured id-token URL so it follows the BFF base in every
 * environment without a new env var / k8s change — same approach as
 * gatewayAudit.bffAuditUrl(). Returns null when that URL is unset or has an
 * unexpected shape, in which case the sync no-ops rather than throwing.
 */
export function bffEnterpriseMcpAuthUrl(config: GatewayConfig): string | null {
  const idUrl = config.bffInternalIdTokenUrl;
  if (typeof idUrl !== 'string' || !idUrl) return null;
  if (!/\/internal\/id-token$/.test(idUrl)) return null;
  return idUrl.replace(/\/internal\/id-token$/, '/internal/feature-flags/enterprise-managed-mcp-auth');
}

async function attemptSync(config: GatewayConfig, url: string): Promise<Attempt> {
  try {
    const res = await axios.get(url, {
      headers: { 'x-internal-gateway-secret': config.bffInternalSecret },
      timeout: 3000,
      validateStatus: () => true,
    });

    // Only a 200 with a real boolean may move the flag. Coercing an error body
    // would read as "disabled" and switch ID-JAG off gateway-wide.
    if (res.status === 200 && typeof res.data?.enabled === 'boolean') {
      const previous = config.enterpriseManagedMcpAuth;
      config.enterpriseManagedMcpAuth = res.data.enabled;
      if (previous !== res.data.enabled) {
        console.log(
          `[GW] ID-JAG synced from BFF: ${previous} -> ${res.data.enabled} (UI toggle is authoritative)`,
        );
      }
      return 'ok';
    }

    // 5xx is the BFF being unhealthy rather than the request being wrong, so it
    // is worth asking again. 403 (bad shared secret) and 404 (BFF too old to
    // serve the route) are settled answers — retrying only delays the warning.
    if (res.status >= 500) return 'retry';

    console.warn(
      `[GW] ID-JAG sync skipped — BFF returned HTTP ${res.status}; keeping seed ${config.enterpriseManagedMcpAuth}`,
    );
    return 'terminal';
  } catch {
    // Connection refused / DNS / timeout — the BFF is very likely still coming
    // up alongside us.
    return 'retry';
  }
}

/**
 * Fetch the flag and write it into the live config, retrying transient
 * failures. Resolves to the value that ended up in config — the fetched one on
 * success, the untouched seed on any failure — so callers and tests can assert
 * without reaching into config.
 */
export async function syncEnterpriseMcpAuthFromBff(
  config: GatewayConfig,
  opts: SyncOptions = {},
): Promise<boolean> {
  const url = bffEnterpriseMcpAuthUrl(config);
  if (!url) {
    console.warn(
      `[GW] ID-JAG sync skipped — no usable BFF URL (bffInternalIdTokenUrl=${String(config.bffInternalIdTokenUrl)}); keeping seed ${config.enterpriseManagedMcpAuth}`,
    );
    return config.enterpriseManagedMcpAuth;
  }

  const delays = opts.retryDelaysMs ?? SYNC_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => { setTimeout(r, ms).unref?.(); }));

  for (let attempt = 0; ; attempt++) {
    const outcome = await attemptSync(config, url);
    if (outcome !== 'retry') return config.enterpriseManagedMcpAuth;

    if (attempt >= delays.length) {
      console.warn(
        `[GW] ID-JAG sync gave up after ${delays.length + 1} attempts; keeping seed ${config.enterpriseManagedMcpAuth}. `
        + 'The next feature-flag save will push the correct value.',
      );
      return config.enterpriseManagedMcpAuth;
    }
    await sleep(delays[attempt]);
  }
}
