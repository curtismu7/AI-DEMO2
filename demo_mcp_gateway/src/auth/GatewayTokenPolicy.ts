'use strict';

/**
 * GatewayTokenPolicy — additional claim validation beyond aud/exp.
 *
 * `validateInboundToken()` in tokenValidator.ts handles aud + exp.
 * This module enforces identity-layer invariants:
 *   - sub must be non-empty (caller identity required)
 *   - act.sub must be non-empty if act is present (valid delegation chain)
 *   - Upstream MCP-server audiences must NEVER appear in the token's aud
 *     (anti-bypass invariant per D-05 — a per-hop token must not skip hops)
 */

import type { DecodedGatewayToken } from '../tokenValidator';
import type { GatewayConfig } from '../config';
import { isAgentMediatedTool } from './scopeTopology';
import { validateActClaim } from './toolScopes';
import { actChainDepth } from './PingOneAuthorizeClient';

export class GatewayTokenPolicyError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'GatewayTokenPolicyError';
  }
}

export class GatewayTokenPolicy {
  /**
   * Validate identity claims in an already aud/exp-validated token.
   * Throws GatewayTokenPolicyError on any violation.
   *
   * @param decoded        Decoded JWT payload (aud/exp already validated by tokenValidator).
   * @param config         Gateway config — reads requireActForAgentTools for UC16.
   * @param toolName       Optional tool name from the JSON-RPC request body (McpToolCall only).
   * @param decisionContext Optional context string — UC16 check only fires on 'McpToolCall'.
   */
  static validate(
    decoded: DecodedGatewayToken,
    config: GatewayConfig,
    toolName?: string,
    decisionContext?: string,
  ): void {
    // sub must be present — every token must carry an identity.
    // Coerce to string: some issuers mint numeric/UUID-shaped claims that are
    // not JS strings (calling .trim() would throw and become an HTTP 500).
    const subStr = decoded.sub == null ? '' : String(decoded.sub).trim();
    if (!subStr) {
      throw new GatewayTokenPolicyError(
        'Token missing required sub claim',
        'missing_sub',
      );
    }

    // act chain: if present (non-null), act.sub must be non-empty.
    // Explicit `act: null` is treated as "no act" (same as undefined) — not a
    // malformed chain. The nullish check (act != null) correctly skips null.
    // PingOne may mint act.sub as a non-string; coerce before trim.
    if (decoded.act != null) {
      const actSub = decoded.act.sub == null ? '' : String(decoded.act.sub).trim();
      if (!actSub) {
        throw new GatewayTokenPolicyError(
          'Malformed delegation chain: act.sub is empty',
          'invalid_act',
        );
      }

      // Actor allow-list. Until now this check was DEAD CODE: validateActClaim
      // was imported here and in PingOneAuthorizeClient but never invoked, so the
      // only actor requirement was "non-empty" — any client that could obtain a
      // delegated token satisfied the chain. Mirrors what the PDP enforces via
      // the ActClientId parameter (mock Rule 2 / cloud "Deny — Invalid Actor
      // Chain"), so the PEP and the PDP agree on who may act.
      // No-ops when authorizedActorClientId is unset (dev / no-actor mode).
      //
      // A2A nested-act tokens (depth >= 2: act:{specialist, act:{generalist}}) are
      // exempt — same as mock authz Rule 2 skipping a2aDelegated tools. Authorize
      // validates NestedActClientId + depth; the exchanger-only allow-list would
      // otherwise reject every specialist actor and kill UC2 / UC2.5.
      if (actChainDepth(decoded.act) < 2) {
        // Prefer the full registered chain; fall back to the single exchanger id
        // for configs (and fixtures) that predate authorizedActorClientIds.
        const authorizedActors = config.authorizedActorClientIds?.length
          ? config.authorizedActorClientIds
          : (config.authorizedActorClientId ?? '');
        const actorCheck = validateActClaim(actSub, authorizedActors);
        if (!actorCheck.valid) {
          throw new GatewayTokenPolicyError(
            `Unauthorized delegation actor: ${actorCheck.reason}`,
            'unauthorized_actor',
          );
        }
      }
    }

    // UC16 — Impersonation block: agent-mediated tools MUST carry an act claim.
    // A token with sub=user but no act claim is an impersonation token — the agent
    // identity is erased. Only OBO delegation (sub=user, act={agent}) is allowed
    // for tools flagged requiresAgentMediation in scope-topology.json.
    // Flag-gated (default OFF) so existing delegated flows are unaffected.
    // Only fires for McpToolCall context — tools/list and other contexts skip it.
    // `decoded.act == null` covers both undefined and explicit null (treat both as
    // "no act" — a null act claim is not a valid delegation chain).
    if (
      config.requireActForAgentTools &&
      decisionContext === 'McpToolCall' &&
      toolName &&
      isAgentMediatedTool(toolName) &&
      decoded.act == null
    ) {
      throw new GatewayTokenPolicyError(
        `Impersonation blocked: tool "${toolName}" requires agent delegation (act claim) — ` +
        `present a token obtained via RFC 8693 on-behalf-of exchange, not a direct user token.`,
        'missing_act',
      );
    }

    // Anti-bypass (D-05): upstream audiences must NEVER appear in the token's
    // aud. A client must obtain a gateway-targeted token first; only the
    // gateway may then exchange it for the next-hop audience.
    //
    // The blacklist must cover *every* downstream the gateway can route
    // toward, not just the two MCP servers. Phase 266 added
    // `bankingResourceServerResourceUri` (the RS audience used by
    // credentialSwap for the dualtoken/bankingdata dispositions). A
    // multi-aud token [gatewayResourceUri, bankingResourceServerResourceUri]
    // passes the inbound aud check but would be force-forwarded with the RS
    // audience already present — exactly the bypass shape D-05 exists to
    // stop. None of these URIs is ever a valid *inbound* aud, so
    // blacklisting them is safe (the gateway's own URI is excluded).
    const audList = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
    const upstreamAuds = [
      config.mcpOlbResourceUri,
      config.mcpInvestResourceUri,
      config.bankingResourceServerResourceUri,
    ].filter((a) => a && a !== config.gatewayResourceUri);
    for (const ua of upstreamAuds) {
      if (ua && audList.includes(ua)) {
        throw new GatewayTokenPolicyError(
          `Token aud [${audList.join(', ')}] targets an upstream MCP server — cannot bypass gateway (D-05)`,
          'bypass_attempt',
        );
      }
    }
  }
}
