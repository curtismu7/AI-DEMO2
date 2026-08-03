'use strict';

/**
 * Tool registry for this resource server.
 *
 * index.ts used to hardcode INVEST_TOOLS/dispatchTool in six places; adding a
 * second namespace made that untenable. Everything the transport needs — the
 * catalog, the advertised scopes, and the dispatch — comes from here.
 */

import { McpToolDef } from './toolTypes';
import { INVEST_TOOLS } from './investTools';
import { AIRLINES_TOOLS } from './airlinesTools';
import { dispatchTool as dispatchInvestTool } from './investToolHandler';
import { AIRLINES_TOOL_NAMES, dispatchAirlinesTool } from './airlinesToolHandler';

export const ALL_TOOLS: McpToolDef[] = [...INVEST_TOOLS, ...AIRLINES_TOOLS];

/**
 * Scopes advertised in the RFC 9728 metadata — derived from the catalog so a
 * client that reads it always requests a scope that actually unlocks a tool.
 */
export const SUPPORTED_SCOPES: string[] = [
  ...new Set(ALL_TOOLS.flatMap((t) => t.requiredScopes)),
];

export function findTool(toolName: string): McpToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === toolName);
}

export function dispatch(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
  subject: string,
): Promise<unknown> {
  if (AIRLINES_TOOL_NAMES.has(toolName)) {
    return dispatchAirlinesTool(toolName, args, subject);
  }
  return dispatchInvestTool(toolName, args, token);
}
