'use strict';

/**
 * toolScopes.ts — canonical tool-to-scope map for the MCP gateway.
 *
 * Used by index.ts and authorizeMcpRequest.ts to populate `required_scopes`
 * in denial error responses (D-03 Wave 1).
 *
 * Write/transfer tools also drive `challenge_type: 'step_up'` in HITL errors.
 */

import {
  gatewayToolNames, toolRequiredScopes, toolChallengeType,
  allowedScopes, isA2aDelegatedTool, a2aDelegatedScope,
} from './scopeTopology';

/**
 * Canonical tool→scope map for the MCP gateway, DERIVED from
 * scope-topology.json (the SSOT). Do not hand-edit — edit the manifest.
 * Only gateway-surface tools appear here (exchange-only/legacy tools are
 * BFF-side concerns). scopeTopology.test.ts guards drift.
 */
export const TOOL_SCOPES: Record<string, string[]> = Object.freeze(
  gatewayToolNames().reduce<Record<string, string[]>>((acc, name) => {
    acc[name] = toolRequiredScopes(name) as string[];
    return acc;
  }, {}),
) as Record<string, string[]>;

/** Scopes required by a given tool. Falls back to ['read'] for unknown tools. */
export function getScopesForGatewayTool(toolName: string): string[] {
  return TOOL_SCOPES[toolName] ?? ['read'];
}

/**
 * Pure scope check. Returns the required scopes the caller's bearer does NOT
 * carry. Empty array == all present. `scopeClaim` is the raw space-delimited
 * `scope` claim from the decoded token (may be undefined/empty).
 */
export function missingScopesForTool(toolName: string, scopeClaim?: string): string[] {
  const required = getScopesForGatewayTool(toolName);
  const granted = new Set(String(scopeClaim || '').split(/\s+/).filter(Boolean));
  return required.filter((s) => !granted.has(s));
}

/**
 * Local Authorize decision — the scope rule applied when PingOne Authorize is
 * NOT configured. It MUST mirror the outcome a PingOne Authorize policy would
 * return for the same inputs so the gateway behaves identically with or
 * without PA wired:
 *
 *   - bearer missing a required tool scope → DENY (insufficient_scope)
 *   - otherwise                            → PERMIT
 *
 * Both transports call this from the same no-PA branch (HTTP:
 * PingOneAuthorizeClient.evaluate, WS: pingAuthorizeGuard.guardToolCall) so
 * "Authorize" and "PingOne Authorize" produce the same PERMIT/DENY result.
 */
export function evaluateScopeDecisionLocally(
  toolName: string,
  scopeClaim?: string,
): { decision: 'PERMIT' } | { decision: 'DENY'; reason: string; missingScopes: string[] } {
  const missing = missingScopesForTool(toolName, scopeClaim);
  if (missing.length === 0) return { decision: 'PERMIT' };
  return {
    decision: 'DENY',
    reason: `insufficient_scope: missing ${missing.join(', ')}`,
    missingScopes: missing,
  };
}

/**
 * Validate the `act` claim in an inbound delegated token.
 *
 * Mirrors the check a live PingOne Authorize policy would perform via the
 * `ActClientId` parameter: the actor identified in `act.sub` must be the
 * known, authorized service that performed the final RFC 8693 exchange.
 *
 * Accepts the registered delegation CHAIN, not a single identity. The authored
 * policy (`HasValidActorChain` in the P1AZ snapshot) is a disjunction over the
 * exchanger, the AI Agent actor and each A2A specialist; comparing against the
 * exchanger alone made this PEP stricter than the PDP it exists to mirror, and
 * rejected the AI Agent actor that tool discovery legitimately presents.
 *
 * Rules:
 *   - allow-list empty → skip (dev / no-actor mode) → valid
 *   - actSub is empty/undefined → no delegation chain → valid (simple exchange)
 *   - actSub is in the allow-list → authorized actor → valid
 *   - otherwise → unauthorized actor → invalid
 */
export function validateActClaim(
  actSub: string | undefined,
  authorizedActorClientId: string | readonly string[],
): { valid: boolean; reason?: string } {
  // A bare string is still accepted so existing callers and fixtures keep working.
  const allowed = (Array.isArray(authorizedActorClientId)
    ? authorizedActorClientId
    : [authorizedActorClientId as string]
  ).filter(Boolean);
  if (!allowed.length) return { valid: true };
  if (!actSub) return { valid: true };
  if (allowed.includes(actSub)) return { valid: true };
  return {
    valid: false,
    reason: `act.sub "${actSub}" is not an authorized actor (${allowed.join(', ')})`,
  };
}

/** Mirrors decision.js:181 GATEWAY_HOP_SCOPES — the coarse scopes that admit a
 *  caller past the gateway's own OAuth2ResourceServerFilter but say nothing
 *  about which tool it may invoke. */
const GATEWAY_HOP_SCOPES = ['gateway:mcp:invoke', 'pinggateway:invoke'];

/**
 * Full Rule 3 parity (demo_authz_server/routes/decision.js:660-715) — the
 * per-tool scope backstop. Unlike evaluateScopeDecisionLocally (which only
 * runs when P1AZ is NOT configured), this is the check the gateway runs
 * UNCONDITIONALLY, because real PingOne Authorize's DSL cannot express
 * per-tool set-membership over TokenScopes (snapshots/gen-authorize-snapshot.js:36-39).
 *
 * @param actChainDepth from PingOneAuthorizeClient.actChainDepth(decoded.act) —
 *   depth >= 2 means a specialist delegated by a generalist (A2A).
 */
export function evaluateScopeDecisionUnconditionally(
  toolName: string,
  scopeClaim: string | undefined,
  actChainDepth: number,
): { decision: 'PERMIT' } | { decision: 'DENY'; reason: string; missingScopes: string[] } {
  // Unknown tool — deliberately NOT denied here. Unknown-tool detection is
  // plain set-membership over a static, enumerable tool list, which real P1AZ's
  // DSL CAN express (unlike the 5 gaps this backstop exists for) — the PDP
  // (and this repo's isPolicyNotFoundReason diagnostics) already own that
  // judgment. Duplicating it here would let a generic message from this
  // backstop pre-empt the PDP's more specific policy-drift diagnosis.
  const required = toolRequiredScopes(toolName) ?? [];
  const granted = new Set(String(scopeClaim || '').split(/\s+/).filter(Boolean));

  // Gateway-hop-scope bypass: a bearer carrying ONLY the coarse hop scope (no
  // other topology-known scope) is exempt — it hasn't been given a per-tool
  // grant to check against, so there's nothing to enforce here (the caller
  // relied entirely on the PDP call this backstop supplements).
  const hasGatewayHopScope = GATEWAY_HOP_SCOPES.some((s) => granted.has(s));
  const topologyScopes = new Set(allowedScopes());
  const suppliesPerToolScopes = [...granted].some(
    (s) => topologyScopes.has(s) && !GATEWAY_HOP_SCOPES.includes(s),
  );
  if (hasGatewayHopScope && !suppliesPerToolScopes) {
    return { decision: 'PERMIT' };
  }

  // A2A delegated-scope satisfaction: a specialist (depth >= 2) presenting the
  // tool's declared least-privilege scope satisfies the check even though it
  // differs from requiredScopes by name.
  if (actChainDepth >= 2 && isA2aDelegatedTool(toolName)) {
    const delegated = a2aDelegatedScope(toolName);
    if (delegated && granted.has(delegated)) {
      return { decision: 'PERMIT' };
    }
  }

  const missing = required.filter((s) => !granted.has(s));
  if (missing.length === 0) return { decision: 'PERMIT' };
  return {
    decision: 'DENY',
    reason: `insufficient_scope: missing ${missing.join(', ')}`,
    missingScopes: missing,
  };
}

const STEP_UP_TOOLS = new Set<string>(
  gatewayToolNames().filter((n) => toolChallengeType(n) === 'step_up'),
);

/**
 * Returns 'step_up' for write/transfer tools that carry financial risk.
 * Returns 'consent' for all other tools.
 */
export function getChallengeTypeForTool(toolName: string): 'step_up' | 'consent' {
  return STEP_UP_TOOLS.has(toolName) ? 'step_up' : 'consent';
}
