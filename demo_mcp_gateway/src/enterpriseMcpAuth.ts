'use strict';

/** Enterprise-managed MCP auth flag — mirrors BFF ff_enterprise_managed_mcp_auth. */
export function isEnterpriseManagedMcpAuthEnabled(): boolean {
  const v = process.env.FF_ENTERPRISE_MANAGED_MCP_AUTH || process.env.ff_enterprise_managed_mcp_auth || '';
  return v === 'true' || v === '1';
}

export const ENTERPRISE_MCP_EXT_ID = 'io.modelcontextprotocol/enterprise-managed-authorization';

export function buildEnterpriseExtensionBlock(): Record<string, unknown> {
  return { [ENTERPRISE_MCP_EXT_ID]: {} };
}

/** Append enterprise-managed hint to RFC 9728 WWW-Authenticate (no auth-code challenge). */
export function appendEnterpriseWwwAuthHint(wwwAuth: string): string {
  if (!isEnterpriseManagedMcpAuthEnabled()) return wwwAuth;
  if (wwwAuth.includes('authorization_type=')) return wwwAuth;
  return `${wwwAuth}, authorization_type="enterprise-managed"`;
}
