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
interface ToolEntry {
  requiredScopes: string[];
  surface: Surface;
  challengeType?: 'step_up' | 'consent';
  requiresAgentMediation?: boolean;
  a2aDelegated?: boolean;
  a2aDelegatedScope?: string;
}
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

interface ResourceEntry { uri: string; scopes?: string[]; mirroredScopes?: string[]; }
interface ManifestWithResources { resources: Record<string, ResourceEntry>; }

const BACKEND_RESOURCE_NAME: Record<'olb' | 'invest' | 'jwtverifier', string> = {
  olb: 'Super Banking MCP Server',
  invest: 'Super Banking MCP Invest',
  // scope-topology.json now declares this resource (jwt:verify scope). The live
  // PingOne resource server self-provisions via twoExchangeReconciler.js on the
  // next demo_api_server boot — same mechanism as MCP Invest.
  jwtverifier: 'Super Banking MCP JWT Verifier',
};

/**
 * All scopes (native + mirrored) registered on a backend's resource server.
 * Used by McpTokenExchangeClient to build the RFC 8693 `scope=` request —
 * i.e. this is what gets REQUESTED on an exchange (e.g. `invest:read` is
 * requested on olb exchanges too, since it's a mirrored scope there).
 *
 * NOTE: this is intentionally broader than what the gateway app is actually
 * GRANTED. demo_api_server/services/twoExchangeReconciler.js partitions the
 * MCP Gateway app's grants per-backend to avoid a PingOne scope-name
 * collision (a scope name can't be granted on two resources for the same
 * app) — e.g. `invest:read` is granted ONLY on the invest resource, not olb.
 * The request-vs-grant mismatch this creates is silently resolved by PingOne
 * dropping any requested scope name the app isn't granted on that resource,
 * rather than erroring. If that silent-drop behavior ever changes, both
 * sites need to be revisited together.
 */
export function resourceScopesForBackend(backend: 'olb' | 'invest' | 'jwtverifier'): string[] {
  const r = (manifest as unknown as ManifestWithResources).resources[BACKEND_RESOURCE_NAME[backend]];
  return r ? [...(r.scopes || []), ...(r.mirroredScopes || [])] : [];
}

interface ScopesManifest { scopes?: Record<string, unknown>; }

/** All scope names declared in the SoT — mirrors demo_authz_server/scopeTopology.js:135-137. */
export function allowedScopes(): string[] {
  return Object.keys((manifest as unknown as ScopesManifest).scopes || {});
}

/**
 * True when the tool is reachable ONLY via A2A specialist delegation (act chain
 * depth >= 2). Mirrors demo_authz_server/scopeTopology.js:65-70.
 */
export function isA2aDelegatedTool(name: string): boolean {
  const t = M.tools[name];
  return t?.a2aDelegated === true;
}

/**
 * The tool's least-privilege A2A scope (e.g. 'records:read' instead of 'read'),
 * when the SoT declares one. Mirrors demo_authz_server/scopeTopology.js:86-91.
 */
export function a2aDelegatedScope(name: string): string | null {
  const t = M.tools[name];
  const scope = t?.a2aDelegatedScope;
  return typeof scope === 'string' && scope ? scope : null;
}
