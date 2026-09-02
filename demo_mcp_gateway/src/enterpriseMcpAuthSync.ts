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
 * So the gateway asks once on boot. Best-effort by design: if the BFF is not
 * reachable yet the gateway keeps its env seed and the next toggle-save pushes
 * the right value anyway.
 */
import axios from 'axios';
import type { GatewayConfig } from './config';

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

/**
 * Fetch the flag and write it into the live config. Resolves to the value that
 * ended up in config — the fetched one on success, the untouched seed on any
 * failure — so callers and tests can assert without reaching into config.
 */
export async function syncEnterpriseMcpAuthFromBff(config: GatewayConfig): Promise<boolean> {
  const url = bffEnterpriseMcpAuthUrl(config);
  if (!url) return config.enterpriseManagedMcpAuth;

  try {
    const res = await axios.get(url, {
      headers: { 'x-internal-gateway-secret': config.bffInternalSecret },
      timeout: 3000,
      validateStatus: () => true,
    });
    // Only a 200 with a real boolean may move the flag. A 403 (secret mismatch)
    // or a 404 (BFF too old to serve this route) must leave the seed alone
    // rather than coercing an error body to false and silently disabling ID-JAG.
    if (res.status === 200 && typeof res.data?.enabled === 'boolean') {
      const previous = config.enterpriseManagedMcpAuth;
      config.enterpriseManagedMcpAuth = res.data.enabled;
      if (previous !== res.data.enabled) {
        console.log(
          `[GW] ID-JAG synced from BFF: ${previous} -> ${res.data.enabled} (UI toggle is authoritative)`,
        );
      }
    } else {
      console.warn(
        `[GW] ID-JAG sync skipped — BFF returned HTTP ${res.status}; keeping seed ${config.enterpriseManagedMcpAuth}`,
      );
    }
  } catch (err) {
    console.warn(
      `[GW] ID-JAG sync failed (${(err as Error).message}); keeping seed ${config.enterpriseManagedMcpAuth}`,
    );
  }
  return config.enterpriseManagedMcpAuth;
}
