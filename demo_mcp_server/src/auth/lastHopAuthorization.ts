/**
 * Last-hop authorization checks, shared by every transport that can establish a
 * session on this server.
 *
 * These lived on HttpMCPTransport, so they covered POST /mcp and nothing else —
 * while docker-compose.yml points the Node gateway at ws://mcp-server:8080. A
 * control that only guards the secondary transport is not a control; it is a
 * detour sign. The checks now live here and both transports call them:
 *
 *   HttpMCPTransport.handlePost          — POST /mcp
 *   DemoMCPServer.handleConnection    — WS connect Authorization header
 *   MCPMessageHandler.handleHandshake    — WS initialize params.agentToken
 *
 * Two checks, in order:
 *   D-05 — the presented token must not be a gateway-audience token (it would
 *          mean the gateway's policy evaluation and RFC 8693 exchange were
 *          skipped), and must carry the upstream audience when one is configured.
 *   F10  — the RFC 8693 `act` delegation chain must name an allow-listed actor.
 *
 * Both read claims exclusively from AgentTokenInfo.verifiedClaims, which exists
 * only when the signature was verified. See actorChain.ts for why.
 */

import { BankingAuthenticationManager } from './BankingAuthenticationManager';
import { AgentTokenInfo } from '../interfaces/auth';
import { verifyActorChain, parseAllowedActors } from './actorChain';

/**
 * Enforce the gateway-first next-hop token contract at the upstream MCP server
 * boundary (D-05).
 *
 * Rules:
 *  1. If gatewayAudience is configured: the token's aud MUST NOT include the
 *     gateway URI — a gateway-aud token cannot bypass the gateway's policy
 *     evaluation and RFC 8693 exchange.
 *  2. If upstreamAudience is configured: the token's aud MUST include the
 *     upstream MCP server URI.
 *
 * When neither constraint is configured, the check is a no-op (dev mode).
 */
export function enforceUpstreamContract(
  claims: Record<string, unknown>,
  options: { upstreamAudience?: string; gatewayAudience?: string },
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Nothing configured ⇒ nothing to enforce. This check runs on every request
  // (it used to sit behind MCP_GATEWAY_MODE), so "unconfigured" must stay a
  // no-op rather than becoming "deny everything". Requiring aud to be PRESENT is
  // TokenIntrospector's job, and it does so fail-closed whenever
  // MCP_SERVER_RESOURCE_URI is set.
  const hasContract = !!(options.gatewayAudience || options.upstreamAudience);

  const aud = claims?.aud;
  if (!aud) {
    if (!hasContract) return { valid: true, errors };
    errors.push('Missing aud claim — cannot enforce upstream contract');
    return { valid: false, errors };
  }

  const audValues: string[] = Array.isArray(aud) ? aud.map(String) : [String(aud)];

  // Rule 1: D-05 anti-bypass — reject gateway-audience tokens at the upstream
  if (options.gatewayAudience && audValues.includes(options.gatewayAudience)) {
    errors.push(
      `D-05 violation: gateway-audience token cannot be used at upstream ` +
      `(aud includes "${options.gatewayAudience}"). ` +
      `The gateway must perform RFC 8693 exchange before forwarding.`,
    );
  }

  // Rule 2: upstream audience must match
  if (options.upstreamAudience && !audValues.includes(options.upstreamAudience)) {
    errors.push(
      `Upstream aud mismatch: expected "${options.upstreamAudience}", ` +
      `got [${audValues.join(', ')}]`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Audience contract from env. Resolved in one place so the transports cannot
 * disagree about which variable wins.
 */
export function resolveUpstreamAudiences(): { upstreamAudience?: string; gatewayAudience?: string } {
  return {
    upstreamAudience:
      process.env.MCP_UPSTREAM_RESOURCE_URI ||
      process.env.MCP_AUDIENCE ||
      process.env.PINGONE_RESOURCE_MCP_URI,
    gatewayAudience: process.env.MCP_GW_RESOURCE_URI,
  };
}

export interface LastHopResult {
  ok: boolean;
  /** Populated when ok === false — safe to log, not to return to the client verbatim. */
  reason?: string;
  /** Populated when ok === true. */
  tokenInfo?: AgentTokenInfo;
}

/**
 * Authenticate a token and run every last-hop authorization check against it.
 *
 * Used by the paths that establish a session outside HttpMCPTransport.handlePost;
 * that method performs the same two checks inline because it interleaves them
 * with TraT binding and its own RFC 9728 error shapes.
 */
export async function authorizeLastHop(
  authManager: BankingAuthenticationManager,
  token: string,
): Promise<LastHopResult> {
  let tokenInfo: AgentTokenInfo;
  try {
    tokenInfo = await authManager.validateAgentToken(token);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'token validation failed' };
  }

  // Claims exist only when the signature was verified — see actorChain.ts.
  const claims = tokenInfo.verifiedClaims ?? {};

  const contractCheck = enforceUpstreamContract(claims, resolveUpstreamAudiences());
  if (!contractCheck.valid) {
    return { ok: false, reason: `D-05: ${contractCheck.errors[0]}` };
  }

  const actorCheck = verifyActorChain(claims, {
    allowedActors: parseAllowedActors(process.env.MCP_ALLOWED_ACTORS),
    signatureVerified: tokenInfo.signatureVerified === true,
  });
  if (!actorCheck.ran) {
    // C4 — "omission is not permission": an unarmed gate is logged explicitly so
    // it can never be mistaken for a PERMIT.
    console.warn(`[lastHopAuthorization][F10] actor chain gate skipped — ran=false skipReason="${actorCheck.skipReason}"`);
  } else if (!actorCheck.valid) {
    return { ok: false, reason: actorCheck.errors[0] };
  }

  return { ok: true, tokenInfo };
}
