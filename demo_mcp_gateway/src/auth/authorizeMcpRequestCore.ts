'use strict';

/**
 * authorizeMcpRequestCore — transport-agnostic policy pipeline pre-checks.
 *
 * BL-02: extracted from authorizeMcpRequest.ts so both transports (HTTP
 * POST /mcp and WebSocket wss://…) run the same RFC 7662 introspection
 * and GatewayTokenPolicy invariants — including the D-05 anti-bypass
 * check that rejects tokens whose `aud` is an upstream MCP-server URI.
 *
 * Why a separate function and not a method on the middleware:
 *   - The HTTP middleware writes the response itself (writeHead / end)
 *     because it has access to the ServerResponse object. The WS handler
 *     formats a JSON-RPC error envelope and writes it through `send`.
 *     Both need the same authorization decision, but each needs to
 *     render the failure in its native protocol shape.
 *   - This function therefore returns a tagged-union result. Callers
 *     translate the failure into their transport's error format.
 *
 * What lives HERE (transport-agnostic):
 *   1. RFC 7662 introspection — token must be active
 *   2. jwt.decode for claims (no signature recheck — caller already verified aud/exp)
 *   3. GatewayTokenPolicy.validate — sub, act.sub, D-05 anti-bypass
 *
 * What stays at each transport:
 *   - PingOne Authorize policy eval (the WS handler uses guardTool{sList,Call}
 *     which wraps the same client). Splitting that further is out of scope
 *     for this fix.
 *   - RFC 8693 token re-exchange (HTTP uses McpTokenExchangeClient; WS uses
 *     exchangeTokenForBackend). Both already run.
 *   - Forwarding to the upstream MCP server.
 */

import jwt from 'jsonwebtoken';
import { GatewayTokenPolicy, GatewayTokenPolicyError } from './GatewayTokenPolicy';
import { GatewayIntrospectionClient } from './GatewayIntrospectionClient';
import type { DecodedGatewayToken } from '../tokenValidator';
import type { GatewayConfig } from '../config';

export interface AuditTrail {
  introspection: { active: boolean; sub?: string; exp?: number; error?: string } | null;
  policy: { passed: boolean; error?: string } | null;
}

export type AuthorizationResult =
  | {
      kind: 'authorized';
      decoded: DecodedGatewayToken;
      audit: AuditTrail;
    }
  | {
      kind: 'introspection_failed';
      audit: AuditTrail;
    }
  | {
      // Introspection itself could not be completed (transport error, or the
      // gateway's own introspection-client credentials/auth-method were
      // rejected) — distinct from a CONFIRMED inactive/revoked token. Callers
      // must not tell the user to log back in for this; it is a gateway-side
      // problem, not a problem with their credentials.
      kind: 'introspection_unavailable';
      audit: AuditTrail;
    }
  | {
      kind: 'policy_violation';
      code: string;       // GatewayTokenPolicyError.code OR 'invalid_token'
      message: string;
      audit: AuditTrail;
    };

/**
 * Run the transport-agnostic pre-checks. Does NOT throw — returns a
 * tagged result the caller can map to its protocol's failure shape.
 *
 * @param bearerToken  The raw inbound bearer token (already aud/exp-validated)
 * @param introspectionClient  Reusable RFC 7662 client (callers can keep one instance)
 * @param config  Gateway config (used for the D-05 upstream-aud blacklist)
 * @param toolName  Tool name from the JSON-RPC body, when the caller knows it.
 * @param decisionContext  'McpToolCall' for a tool invocation.
 *
 * toolName + decisionContext are REQUIRED for the UC16 require-act branch to be
 * reachable: GatewayTokenPolicy only applies it for a named, agent-mediated tool
 * in the McpToolCall context. Callers that omit them (the WebSocket handler,
 * which authenticates before any tool is named) get identity checks only — the
 * WS transport applies UC16 later in guardToolCall, where the tool IS known.
 */
export async function runMcpAuthorizationPipeline(
  bearerToken: string,
  introspectionClient: GatewayIntrospectionClient,
  config: GatewayConfig,
  toolName?: string,
  decisionContext?: string,
): Promise<AuthorizationResult> {
  const audit: AuditTrail = { introspection: null, policy: null };

  // Step 0 — RFC 7662 active-token introspection
  const introspResult = await introspectionClient.introspect(bearerToken);
  audit.introspection = {
    active: introspResult.active,
    sub: introspResult.sub,
    exp: introspResult.exp,
    error: introspResult.error,
  };
  if (!introspResult.active) {
    // introspResult.error is only set when introspection itself failed
    // (transport error, or the client's own auth was rejected) — a genuinely
    // confirmed-inactive token (200 {active:false}) never carries it.
    if (introspResult.error) {
      return { kind: 'introspection_unavailable', audit };
    }
    return { kind: 'introspection_failed', audit };
  }

  // Step 1 — claims + identity policy
  let decoded: DecodedGatewayToken;
  try {
    const raw = jwt.decode(bearerToken) as DecodedGatewayToken | null;
    if (!raw || !raw.sub) {
      throw new GatewayTokenPolicyError('Empty or missing token payload', 'invalid_token');
    }
    decoded = raw;
    GatewayTokenPolicy.validate(decoded, config, toolName, decisionContext);
  } catch (err) {
    if (err instanceof GatewayTokenPolicyError) {
      audit.policy = { passed: false, error: err.message };
      return {
        kind: 'policy_violation',
        code: err.code,
        message: err.message,
        audit,
      };
    }
    throw err; // unexpected — surface
  }

  audit.policy = { passed: true };
  return { kind: 'authorized', decoded, audit };
}
