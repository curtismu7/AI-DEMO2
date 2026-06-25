'use strict';

/**
 * scopeTopology.ts — gateway accessor for the repo-root scope-topology.json
 * SSOT. resolveJsonModule is enabled in tsconfig, so the manifest is imported
 * natively. Single source shared with the BFF (banking_api_server/services/
 * scopeTopology.js reads the same file).
 */

// Path: banking_mcp_gateway/src/auth -> repo root is ../../../
import manifest from '../../../scope-topology.json';

type Surface = 'gateway' | 'exchange-only' | 'legacy-alias';
interface ToolEntry { requiredScopes: string[]; surface: Surface; challengeType?: 'step_up' | 'consent'; requiresAgentMediation?: boolean; }
interface Manifest { tools: Record<string, ToolEntry>; }

const M = manifest as unknown as Manifest;

/** Tool names whose surface is gateway-enforced. */
export function gatewayToolNames(): string[] {
  return Object.keys(M.tools).filter((n) => M.tools[n].surface === 'gateway');
}

export function toolRequiredScopes(name: string): string[] | undefined {
  const t = M.tools[name];
  return t ? [...t.requiredScopes] : undefined;
}

export function toolChallengeType(name: string): 'step_up' | 'consent' | undefined {
  const t = M.tools[name];
  return t ? t.challengeType : undefined;
}

/**
 * Returns true when the tool requires agent mediation (an `act` claim).
 * Used by the UC16 impersonation-block rule: when REQUIRE_ACT_FOR_AGENT_TOOLS=true,
 * tool calls to these tools are DENIED if the bearer token has no `act` claim.
 * Returns false for unknown tools (fail-open: do not block non-flagged tools).
 */
export function isAgentMediatedTool(name: string): boolean {
  const t = M.tools[name];
  return t?.requiresAgentMediation === true;
}
