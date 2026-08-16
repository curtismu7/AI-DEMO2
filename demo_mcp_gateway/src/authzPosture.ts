'use strict';

/**
 * authzPosture — contract C3, the single "is the gate actually armed" signal.
 *
 * The gateway accumulated a set of individually-defensible bypasses (dev bypass,
 * unset HITL URL, unverified-token mode) and a set of security controls that
 * default to advisory (DPoP, intent token, RAR, require-act, Web Bot Auth).
 * Each is reasonable on its own. Nothing reported the AGGREGATE, so the running
 * posture could not be read from outside the process — "we implement RFC 9449"
 * was true of the code and false of the deployment.
 *
 * `failOpen` names every currently-active bypass. An empty array means fully
 * armed. This is the signal F5/F6 were missing.
 */

import { isP1AZActive, usingRealPdpEndpoint, type GatewayConfig } from './config';
import { policySourceForEngine, type PolicySource } from './auth/PingOneAuthorizeClient';

/**
 * Binding evidence the gateway can receive. A control being OFF is only a
 * *bypass* if the matching evidence is actually being presented — a gateway
 * nobody sends DPoP proofs to is not failing open on DPoP, but one that
 * receives proofs and ignores them is.
 */
export type BindingHeader = 'dpop' | 'intent' | 'rar' | 'act';

const _seen = new Set<BindingHeader>();

/** Record that the gateway received this class of binding evidence. */
export function noteBindingHeaderSeen(header: BindingHeader): void {
  _seen.add(header);
}

/** Which classes of binding evidence this process has seen. */
export function seenBindingHeaders(): BindingHeader[] {
  return [..._seen];
}

/** Test seam — clears the observed-header set. */
export function resetAuthzPosture(): void {
  _seen.clear();
}

export interface AuthzHealth {
  policySource: PolicySource;
  enforcing: {
    dpop: boolean;
    intent: boolean;
    rar: boolean;
    act: boolean;
    webBotAuth: 'off' | 'monitor' | 'enforce';
  };
  failOpen: string[];
}

/**
 * True when the gateway is accepting tokens it has not signature-verified.
 * Post-F5 this requires an explicit opt-in AND an absent JWKS AND non-strict
 * auth — all three, or the token is refused instead.
 */
function unverifiedTokensAccepted(): boolean {
  // PINGONE_JWKS_URI is the name this stack actually SETS; nothing sets
  // PINGONE_JWKS_ENDPOINT (#1012 taught tokenValidator to accept both). Reading
  // only the unset name made this term permanently true, so /health reported
  // MCP_GW_ALLOW_UNVERIFIED_TOKENS as fail-open while the gateway was genuinely
  // verifying signatures — a forged token 401s with "no kid header and the JWKS
  // exposes 4 keys".
  //
  // That is a lie in the SAFE direction, which is still a lie: an operator
  // reading failOpen cannot tell a real bypass from a phantom one, so the whole
  // list stops being actionable. Must resolve JWKS identically to the validator.
  const jwksConfigured = !!(process.env.PINGONE_JWKS_ENDPOINT || process.env.PINGONE_JWKS_URI);
  return !jwksConfigured
    && process.env.STRICT_AUTH !== 'true'
    && process.env.MCP_GW_ALLOW_UNVERIFIED_TOKENS === 'true';
}

export function buildAuthzHealth(config: GatewayConfig): AuthzHealth {
  const p1azActive = isP1AZActive(config);
  const usingRealEndpoint = usingRealPdpEndpoint(config);

  const enforcing = {
    dpop: process.env.REQUIRE_DPOP_PROOF === 'true',
    intent: config.intentTokenRequired === true,
    rar: config.requireRarIntent === true,
    act: config.requireActForAgentTools === true,
    webBotAuth: config.wbaMode,
  };

  const failOpen: string[] = [];

  // Unconditional bypasses — active purely by configuration.
  if (config.devBypass) failOpen.push('MCP_GW_DEV_BYPASS');
  if (unverifiedTokensAccepted()) failOpen.push('MCP_GW_ALLOW_UNVERIFIED_TOKENS');
  // An unset HITL service URL makes the gateway ignore consent receipts
  // silently — the obligation loop is open, not merely unconfigured.
  if (!config.hitlServiceUrl) failOpen.push('HITL_SERVICE_URL');
  // The gateway deciding for itself instead of the PDP is a bypass of the PDP.
  if (!p1azActive && config.allowLocalScopeFallback) {
    failOpen.push('MCP_GW_ALLOW_LOCAL_SCOPE_FALLBACK');
  }
  // A check configured out of existence is the quietest bypass there is: the
  // code runs, the tests pass, and it returns "valid" for every input.
  // validateActClaim() short-circuits to {valid:true} when the allow-list is
  // empty (toolScopes.ts), so an unset actor client id means ANY act.sub is
  // accepted — the delegation actor is not checked at all.
  // Mirror GatewayTokenPolicy.validate's precedence: the plural, multi-actor
  // list (config.ts) is preferred and only falls back to the singular legacy
  // field when empty. Checking only the singular here reports a fully-armed
  // actor allow-list (e.g. PINGONE_AI_AGENT_ACTOR_CLIENT_ID set alone) as a
  // bypass — the same class of orphan-field lie #1012 fixed for JWKS above.
  const authorizedActors = config.authorizedActorClientIds?.length
    ? config.authorizedActorClientIds
    : config.authorizedActorClientId;
  if (!authorizedActors?.length) failOpen.push('PINGONE_TOKEN_EXCHANGER_CLIENT_ID');
  // The gateway accepts purp / reqctx / azd from an unsigned, caller-supplied
  // header and feeds them to the PDP and to RAR subset enforcement. Those checks
  // still run — against evidence the caller wrote for itself.
  if (process.env.ALLOW_UNSIGNED_TRAT_CONTEXT === 'true') failOpen.push('ALLOW_UNSIGNED_TRAT_CONTEXT');

  // Evidence-conditional bypasses: the control is off AND the corresponding
  // evidence is being presented, so the gateway is actively discarding proof
  // it is being handed.
  if (!enforcing.dpop && _seen.has('dpop')) failOpen.push('REQUIRE_DPOP_PROOF');
  if (!enforcing.intent && _seen.has('intent')) failOpen.push('INTENT_TOKEN_REQUIRED');
  if (!enforcing.rar && _seen.has('rar')) failOpen.push('REQUIRE_RAR_INTENT');
  if (!enforcing.act && _seen.has('act')) failOpen.push('REQUIRE_ACT_FOR_AGENT_TOOLS');

  return {
    policySource: p1azActive
      ? policySourceForEngine(usingRealEndpoint ? 'real' : 'mock')
      : 'local-fallback',
    enforcing,
    failOpen,
  };
}
