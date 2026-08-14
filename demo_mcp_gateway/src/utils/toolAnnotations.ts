'use strict';

/**
 * toolAnnotations.ts — derives tool metadata (readOnly, destructive, idempotent)
 * from the gateway's scope-topology.json SSOT.
 *
 * Used to annotate tools for UI/agent use and for Privilege MCP guide
 * generation.
 */

import { toolRequiredScopes } from '../auth/scopeTopology';

/**
 * Annotation metadata for a tool, derived from its required scopes.
 */
export interface ToolAnnotation {
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
}

/**
 * Derives tool annotations from required scopes:
 *   - readOnly: true if the tool requires only 'read'-like scopes
 *   - destructive: true if the tool requires 'write', 'transfer', or any admin scopes
 *   - idempotent: true if the tool is read-only (no state mutation)
 *
 * For unknown tools, returns all false (fail-safe: unknown tools are assumed unsafe).
 *
 * @param toolName the tool name (e.g., 'get_my_accounts', 'create_withdrawal')
 * @returns ToolAnnotation metadata
 */
export function getToolAnnotations(toolName: string): ToolAnnotation {
  const scopes = toolRequiredScopes(toolName);

  // Unknown tool: fail-safe, return all false
  if (!scopes) {
    return { readOnly: false, destructive: false, idempotent: false };
  }

  // Check for destructive scopes (write/transfer/admin actions)
  const requiresWrite = scopes.some(
    (s) => s === 'write' || s === 'transfer' || s.startsWith('admin:'),
  );

  const readOnly = !requiresWrite;

  return {
    readOnly,
    destructive: requiresWrite,
    idempotent: readOnly,
  };
}
