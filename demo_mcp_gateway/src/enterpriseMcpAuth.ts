'use strict';

/**
 * Enterprise-managed MCP auth flag — mirrors BFF ff_enterprise_managed_mcp_auth.
 *
 * Reads the LIVE gateway config, not process.env: the BFF pushes the UI
 * toggle's value to /admin/config, so the env var is only the pre-sync seed
 * (see GatewayConfig.enterpriseManagedMcpAuth). Reading env here is what let
 * the gateway sit at OFF while the BFF reported ON.
 *
 * The optional argument keeps the env-only reading available for callers with
 * no config to hand (tests, and the seed path in config.ts).
 */
export function isEnterpriseManagedMcpAuthEnabled(
  config?: { enterpriseManagedMcpAuth?: boolean },
): boolean {
  if (config && typeof config.enterpriseManagedMcpAuth === 'boolean') {
    return config.enterpriseManagedMcpAuth;
  }
  const v = process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH || process.env.ff_enterprise_managed_mcp_auth || '';
  return v === 'true' || v === '1';
}

export const ENTERPRISE_MCP_EXT_ID = 'io.modelcontextprotocol/enterprise-managed-authorization';

export function buildEnterpriseExtensionBlock(): Record<string, unknown> {
  return { [ENTERPRISE_MCP_EXT_ID]: {} };
}

/** Append enterprise-managed hint to RFC 9728 WWW-Authenticate (no auth-code challenge). */
export function appendEnterpriseWwwAuthHint(
  wwwAuth: string,
  config?: { enterpriseManagedMcpAuth?: boolean },
): string {
  if (!isEnterpriseManagedMcpAuthEnabled(config)) return wwwAuth;
  if (wwwAuth.includes('authorization_type=')) return wwwAuth;
  return `${wwwAuth}, authorization_type="enterprise-managed"`;
}
