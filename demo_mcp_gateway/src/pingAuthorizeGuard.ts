'use strict';

/**
 * PingOne Authorization Server guard for tools/list and tools/call.
 *
 * All authorization decisions are delegated to the Authorization Server
 * (demo_authz_server mock or real PingOne Authorize). The gateway never
 * makes inline authorization decisions — it only routes.
 *
 * Requires PINGAUTHORIZE_ENDPOINT + PINGAUTHORIZE_WORKER_ID + MCP_GW_P1AZ_ENABLED=true.
 * If not configured, fails closed (DENY).
 */

import axios from 'axios';
import { GatewayTokenPolicy, GatewayTokenPolicyError } from './auth/GatewayTokenPolicy';
import { buildAuthorizeParameters, ToolArgs, TratClaims } from './auth/PingOneAuthorizeClient';
import { getScopesForGatewayTool, evaluateScopeDecisionLocally } from './auth/toolScopes';
import { GatewayConfig, isP1AZActive } from './config';
import { getCorrelationId } from './correlationContext';
import { enforceRarSubset, rarDetailsFromEnvelope, type RarToolArgs } from './rarEnforce';
import { DecodedGatewayToken } from './tokenValidator';

// Forward the request's correlation id to the Authorization Server so its
// decision logs line up with the gateway + BFF logs for the same request.
// Real PingOne Authorize ignores the unknown header; the mock echoes + logs it.
function authzHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const cid = getCorrelationId();
  if (cid) headers['X-Correlation-ID'] = cid;
  return headers;
}

export interface AuthzDecision {
  permitted: boolean;
  reason?: string;
  /**
   * AllowedVertical advice returned by the Authorization Server policy.
   * Restricts which vertical action tools are shown in tools/list.
   * Undefined = no restriction.
   */
  allowedVertical?: string;
  /**
   * Scope-denied tools for tools/list: name + human-readable reason. Present only
   * when the gateway sent CandidateTools. The tools/list handler keeps these
   * visible (greyed in the UI) rather than dropping them; the permitted set is
   * derived as (candidates − deniedTools), so no separate permitted list is needed.
   */
  deniedTools?: Array<{ name: string; reason: string }>;
  /**
   * Which authorization backend produced this decision. Surfaced in tools/list
   * _meta.authzEngine so the BFF/UI can signal real vs. mock mode.
   */
  engine?: 'real' | 'mock' | 'mock-failover';
}

/**
 * Best-effort cold-start warm of the Authorization Server connection. On gateway
 * (or authz-server) restart the first tools/list decision otherwise pays the
 * connect to the AS; this opens that socket up front via GET /health (the AS's
 * side-effect-free probe — no synthetic decision). Counterpart to the BFF's
 * PingOne warm: each process warms its own authz hop on its own startup. No-op
 * when P1AZ isn't active. Never throws.
 */
export async function warmupAuthz(config: GatewayConfig): Promise<void> {
  if (!isP1AZActive(config)) return;
  const startedAt = Date.now();
  try {
    await axios.get(`${config.pingAuthorizeEndpoint}/health`, { timeout: 5000, headers: authzHeaders() });
    console.log(`[GW] authz warm: ok ${Date.now() - startedAt}ms (${config.pingAuthorizeEndpoint})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A non-2xx still warms the socket — log at info, never fail startup.
    console.log(`[GW] authz warm: completed (non-fatal) — ${msg}`);
  }
}

export async function guardToolsList(
  decoded: DecodedGatewayToken,
  config: GatewayConfig,
  activeVertical?: string,
  candidateTools?: string[],
): Promise<AuthzDecision> {
  if (!isP1AZActive(config)) {
    // Authorization Server not configured — fail closed.
    console.error('[GW] Authorization Server not configured for tools/list — failing closed. Set PINGAUTHORIZE_ENDPOINT.');
    return { permitted: false, reason: 'Authorization Server not configured' };
  }

  try {
    const tokenScopes = (decoded.scope ?? '').split(' ').filter(Boolean).join(' ');
    const body = {
      parameters: {
        DecisionContext: 'McpToolsList',
        ClientId: decoded.sub,
        // UserId + McpResourceUri are required by the cloud P1AZ MCP Delegation
        // policy (HasValidUserId / HasValidMcpAudience) for EVERY decision context,
        // not just tools/call — the BFF and PingGateway groovy send them on
        // McpToolsList too, so the Node discovery path must as well or it fails closed.
        UserId: decoded.sub,
        ActClientId: decoded.act?.sub || '',
        TokenAudience: config.gatewayResourceUri,
        McpResourceUri: config.gatewayResourceUri,
        TokenScopes: tokenScopes,
        ActiveVertical: activeVertical || '',
        Vertical: activeVertical || '',
        CandidateTools: JSON.stringify(candidateTools || []),
      },
    };

    const response = await axios.post(
      `${config.pingAuthorizeEndpoint}/governance/pap/alpha/policy/${config.pingAuthorizeWorkerId}/decision`,
      body,
      { timeout: 5000, headers: authzHeaders() },
    );

    const decision: string = response.data?.decision || 'DENY';
    if (decision !== 'PERMIT') {
      return { permitted: false, reason: `PingAuthorize decision: ${decision}` };
    }
    // Read the policy advice. AllowedVertical restricts which vertical the list is
    // scoped to; DeniedTools carries the per-tool scope denials (the permitted set
    // is derived downstream as candidates − deniedTools).
    const advice = response.data?.advice || response.data?.advices || [];
    const getAdvice = (n: string): string | undefined => Array.isArray(advice)
      ? advice.map((a: { name?: string; code?: string; value?: string; payload?: string }) =>
          (a.name === n || a.code === n) ? (a.value ?? a.payload) : undefined).find((v: string | undefined) => v !== undefined)
      : (advice?.[n]);
    const adviceVertical = getAdvice('AllowedVertical');
    let deniedTools: Array<{ name: string; reason: string }> | undefined;
    try { const d = getAdvice('DeniedTools'); if (d) deniedTools = JSON.parse(d); } catch { /* ignore malformed advice */ }
    const mockBase = config.pingAuthorizeMockBase;
    // Config-shape label ONLY — this discovery (tools/list) path does not perform
    // real->mock failover (that lives in PingOneAuthorizeClient.evaluate(), the
    // tools/call path). So `engine` here is only ever 'real' or 'mock', NEVER
    // 'mock-failover'. Discovery-path resilience is owned by the BFF's degraded
    // fallback (agentToolsResolver retry + local catalog), not by this signal.
    const engine: AuthzDecision['engine'] = (mockBase && mockBase !== config.pingAuthorizeEndpoint) ? 'real' : 'mock';
    return { permitted: true, allowedVertical: adviceVertical || activeVertical, deniedTools, engine };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[GW] PingAuthorize guard failed — failing closed:', msg);
    return { permitted: false, reason: 'Authorization check unavailable' };
  }
}

export async function guardToolCall(
  toolName: string,
  decoded: DecodedGatewayToken,
  config: GatewayConfig,
  toolArgs?: ToolArgs,
  xTratContext?: string,
  hitlApproved?: boolean,
  vertical?: string,
  hitlChallengeId?: string,
  intentValidation?: import('./intentTokenValidator').IntentValidationResult | null,
): Promise<AuthzDecision> {
  // UC16 — Impersonation block: must run BEFORE the Authorization Server call so
  // the check is reachable in production. GatewayTokenPolicy.validate() fires with
  // decisionContext='McpToolCall' so the condition is identical to the static method
  // tests AND to decision.js Rule 2.5 (authz-server-parity). When the flag is OFF
  // or the token carries an act claim the call is a no-op for this check.
  // This is the REAL chokepoint — authorizeMcpRequestCore.ts calls validate() with
  // only 2 args (token validation runs before toolName is known), so the UC16 branch
  // inside GatewayTokenPolicy was unreachable there. Here toolName is always present.
  try {
    GatewayTokenPolicy.validate(decoded, config, toolName, 'McpToolCall');
  } catch (err) {
    if (err instanceof GatewayTokenPolicyError && err.code === 'missing_act') {
      return { permitted: false, reason: `impersonation_blocked: ${err.message}` };
    }
    // Non-UC16 policy errors (missing_sub, invalid_act, bypass_attempt) were already
    // caught upstream in runMcpAuthorizationPipeline before we reach guardToolCall —
    // re-throw as unexpected if they somehow surface here.
    throw err;
  }

  // Extract TraT claims from X-TraT-Context only when the unsigned shim is
  // explicitly allowed (parity with demo_mcp_server TratClaimsExtractor).
  // Otherwise a direct caller can forge purp/reqctx/azd into Authorize/RAR.
  let tratClaims: TratClaims | null = null;
  if (xTratContext && process.env.ALLOW_UNSIGNED_TRAT_CONTEXT === 'true') {
    try {
      const parsed = JSON.parse(xTratContext);
      if (typeof parsed.purp === 'string' && typeof parsed.reqctx?.tool === 'string' && parsed.azd && parsed.rctx) {
        tratClaims = { reqctx: parsed.reqctx, purp: parsed.purp, azd: parsed.azd, rctx: parsed.rctx, trat_sim: parsed.trat_sim ?? true };
      }
    } catch { /* malformed */ }
  }

  // RFC 9396 RAR intent-subset enforcement (parity with the HTTP path). Hard only when
  // REQUIRE_RAR_INTENT=true; fail-closed if intent is required but none was declared.
  if (process.env.REQUIRE_RAR_INTENT === 'true') {
    const rarDetails = rarDetailsFromEnvelope(tratClaims ? { azd: tratClaims.azd } : undefined);
    if (!rarDetails) {
      return { permitted: false, reason: 'rar_intent_required: authorization_details required (RFC 9396)' };
    }
    const r = enforceRarSubset(toolName, toolArgs as RarToolArgs, rarDetails);
    if (!r.ok) {
      console.warn(`[GW-WS] RAR intent violation: ${r.reason} (tool: ${toolName})`);
      return { permitted: false, reason: `rar_intent_violation: ${r.reason}` };
    }
  }

  // When Authorization Server is not configured, fall back to local scope decision
  // for tools/call. This allows development/testing without P1AZ. For tools/list and
  // other methods, fail closed since scope decision doesn't cover them.
  if (!isP1AZActive(config)) {
    if (toolName) {
      const decision = evaluateScopeDecisionLocally(toolName, decoded.scope);
      return {
        permitted: decision.decision === 'PERMIT',
        reason: decision.decision === 'PERMIT' ? undefined : decision.reason,
        engine: 'mock',
      };
    }
    // tools/list and other methods require P1AZ
    console.error('[GW-WS] Authorization Server not configured. Set PINGAUTHORIZE_ENDPOINT.');
    return { permitted: false, reason: 'Authorization Server not configured' };
  }

  try {
    // WR-02: use the shared param-builder so the WS transport sends the SAME
    // PingAuthorize inputs (TransactionAmount/TransactionType/ToAccountId,
    // McpMethod) as the HTTP transport. An amount-conditioned policy now
    // fires identically regardless of transport (T-2 parity).
    const body = {
      parameters: buildAuthorizeParameters(
        decoded,
        'tools/call',
        config.gatewayResourceUri,
        toolName,
        toolArgs,
        tratClaims,
        hitlApproved,
        intentValidation ?? null,
        vertical,
        undefined,
        hitlChallengeId,
      ),
    };

    // Real->mock failover for parity with the HTTP tools/call path
    // (PingOneAuthorizeClient.evaluate). A 200 + DENY is a valid decision and
    // lands below without failover; only a thrown error (5xx / network) on the
    // primary triggers the mock fallback. Discovery (tools/list) deliberately
    // does NOT failover — that resilience is owned by the BFF's degraded path.
    const postDecision = (base: string) => axios.post(
      `${base}/governance/pap/alpha/policy/${config.pingAuthorizeWorkerId}/decision`,
      body,
      { timeout: 5000, headers: authzHeaders() },
    );

    const mockBase = config.pingAuthorizeMockBase;
    const canFailover = !!mockBase && mockBase !== config.pingAuthorizeEndpoint;

    let response;
    try {
      response = await postDecision(config.pingAuthorizeEndpoint);
    } catch (primaryErr) {
      if (!canFailover) throw primaryErr;
      const pmsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      console.warn('[GW] PingAuthorize tool guard: real Authorize unreachable — failing over to mock:', pmsg);
      response = await postDecision(mockBase as string);
    }

    const decision: string = response.data?.decision || 'DENY';
    if (decision === 'PERMIT') return { permitted: true };
    if (decision === 'INDETERMINATE') {
      return { permitted: false, reason: 'HITL_REQUIRED' };
    }

    return { permitted: false, reason: `PingAuthorize decision: ${decision}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[GW] PingAuthorize tool guard failed — failing closed:', msg);
    return { permitted: false, reason: 'Authorization check unavailable' };
  }
}
