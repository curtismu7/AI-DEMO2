'use strict';

/**
 * Shared MCP tool-definition shape for every namespace this resource server
 * hosts (invest, airlines, …).
 *
 *   name           — JSON-RPC tool name (must match router.ts in mcp-gateway)
 *   description    — shown to the LLM
 *   inputSchema    — JSON Schema for arguments
 *   requiredScopes — scopes the inbound token must carry
 */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScopes: string[];
  readOnly: boolean;
  intentHints?: string[];
}

export function filterByScopes(tools: McpToolDef[], tokenScopes: string[]): McpToolDef[] {
  // Empty scope list → only tools that require no scopes (parity with
  // demo_mcp_server toolScopeMap.filterToolsByScope). Advertising the full
  // catalog to zero-scope tokens violates least-privilege.
  if (tokenScopes.length === 0) {
    return tools.filter((t) => t.requiredScopes.length === 0);
  }
  const has = (s: string) => tokenScopes.includes(s) || tokenScopes.includes('*');
  return tools.filter((t) => t.requiredScopes.length === 0 || t.requiredScopes.every(has));
}
