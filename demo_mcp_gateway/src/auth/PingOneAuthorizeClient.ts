'use strict';

/**
 * PingOneAuthorizeClient — gateway-side PingOne Authorize integration (D-06).
 *
 * Evaluates per-request MCP policy decisions by calling the PingOne Authorize
 * decision endpoint. Adapts the existing pingAuthorizeGuard patterns for the
 * HTTP MCP transport layer.
 *
 * Decision outcomes:
 *   PERMIT      — allow the request, proceed to token exchange + forwarding
 *   DENY        — block the request, return 403
 *   INDETERMINATE — block and surface as HITL opportunity (treated as DENY here)
 *
 * Fails CLOSED: if PingAuthorize is unavailable, the decision is DENY.
 * If no endpoint is configured, all requests are PERMIT (dev/test mode).
 */

import axios from 'axios';
import { type GatewayConfig, isP1AZActive } from '../config';
import type { IntentValidationResult } from '../intentTokenValidator';
import type { DecodedGatewayToken } from '../tokenValidator';
import { evaluateScopeDecisionLocally, validateActClaim } from './toolScopes'; // evaluateScopeDecisionLocally kept for tests that import it directly

export type AuthzDecisionOutcome = 'PERMIT' | 'DENY' | 'INDETERMINATE';

export interface AuthzDecision {
  decision: AuthzDecisionOutcome;
  reason?: string;
  // HI-09: surface decision metadata for the audit trail. PingAuthorize
  // returns a unique decision_id / policy_version per evaluation — without
  // these, a stale or replayed PERMIT cannot be distinguished from a
  // fresh one. Optional because dev/no-authz mode and PA error paths
  // don't carry them.
  decisionId?: string;
  policyVersion?: string;
  traceId?: string;
  // Which backend produced this decision. 'real' = live PingOne Authorize,
  // 'mock' = primary endpoint IS the mock base, 'mock-failover' = real
  // endpoint failed and the mock base was used as fallback.
  engine?: 'real' | 'mock' | 'mock-failover';
  // The exact `parameters` block POSTed to the P1AZ decision endpoint, surfaced
  // so the Agent Gateway Tester can show WHAT was evaluated. Undefined on the
  // no-P1AZ local-scope fallback path (no decision call is made).
  sentParameters?: Record<string, string>;
}

export interface ToolArgs {
  amount?: number;
  transaction_type?: string;
  to_account_id?: string;
  [key: string]: unknown;
}

export interface TratClaims {
  reqctx: { tool: string; session_id: string; correlation_id: string };
  purp: string;
  azd: { sub: string; act?: string; gateway?: string; authorization_details?: unknown[] };
  rctx: { ip: string; user_agent: string; timestamp: string };
  trat_sim?: boolean;
}


/**
 * Build the PingAuthorize decision `parameters` block.
 *
 * Single source of truth for the policy-input shape so the HTTP transport
 * (PingOneAuthorizeClient.evaluate) and the WS transport
 * (pingAuthorizeGuard.guardToolCall) send IDENTICAL inputs for the same
 * logical tool call. Without this, an amount-conditioned policy
 * (`TransactionAmount > 500`) fired on HTTP but silently not on WS — the
 * path real agents use for create_transfer (T-2 parity gap, WR-02).
 */
/**
 * Depth of the RFC 8693 act delegation chain. A generalist's own token has
 * act:{sub:agent} → depth 1; an A2A specialist token has act:{sub:specialist,
 * act:{sub:generalist}} → depth 2. The Authorize policy DENYs a2aDelegated tools
 * below depth 2 (the generalist cannot call a specialist-only tool directly).
 */
export function actChainDepth(act: unknown): number {
  let depth = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = act;
  while (node && (node.sub || node.client_id)) {
    depth += 1;
    node = node.act;
  }
  return depth;
}

export function buildAuthorizeParameters(
  decoded: DecodedGatewayToken,
  method: string,
  gatewayResourceUri: string,
  toolName?: string,
  toolArgs?: ToolArgs,
  tratClaims?: TratClaims | null,
  hitlApproved?: boolean,
  intentValidation?: IntentValidationResult | null,
  vertical?: string,
  introspectionResult?: { active: boolean; sub?: string; exp?: number; scope?: string; aud?: string } | undefined,
  hitlChallengeId?: string,
): Record<string, string> {
  const decisionContext = method === 'tools/call' ? 'McpToolCall' : 'McpRequest';
  const tokenScopes = (decoded.scope ?? '').split(' ').filter(Boolean);
  const tokenAud = Array.isArray(decoded.aud) ? decoded.aud.join(' ') : (decoded.aud ?? '');
  const base: Record<string, string> = {
    DecisionContext: decisionContext,
    McpMethod: method,
    ToolName: toolName ?? '',
    ClientId: decoded.sub,
    // UserId + McpResourceUri are required by the cloud P1AZ MCP Delegation policy
    // (HasValidUserId checks UserId; HasValidMcpAudience checks TokenAudience ==
    // McpResourceUri). The BFF and the PingGateway groovy filter both send them; the
    // Node gateway must too, or every real-cloud decision fails those conditions.
    UserId: decoded.sub,
    ActClientId: decoded.act?.sub ?? '',
    ActChainDepth: String(actChainDepth(decoded.act)),
    MayActSub: decoded.may_act?.sub ?? '',
    TokenScopes: tokenScopes.join(' '),
    TokenAudience: gatewayResourceUri,
    McpResourceUri: gatewayResourceUri,
    TokenAudActual: tokenAud,
    TokenExp: decoded.exp ? String(decoded.exp) : '',
    TokenIat: decoded.iat ? String(decoded.iat) : '',
    TokenNbf: decoded.nbf ? String(decoded.nbf) : '',
    TokenIss: decoded.iss ?? '',
    TransactionAmount: toolArgs?.amount !== undefined ? String(toolArgs.amount) : '',
    TransactionType: toolArgs?.transaction_type ?? toolName ?? '',
    ToAccountId: toolArgs?.to_account_id ?? '',
    Vertical: vertical ?? '',
  };

  if (tratClaims) {
    base['TratPurp'] = tratClaims.purp;
    base['TratAzdAct'] = tratClaims.azd.act ?? '';
    base['TratSessionId'] = tratClaims.reqctx.session_id;
    base['TratTool'] = tratClaims.reqctx.tool;
    base['TratSim'] = String(tratClaims.trat_sim ?? false);
    // RFC 9396 RAR: surface the granted authorization_details to the policy decision
    // so PingAuthorize (and the mock) can evaluate intent alongside the gateway's own
    // subset enforcement.
    if (Array.isArray(tratClaims.azd.authorization_details) && tratClaims.azd.authorization_details.length) {
      base['RarAuthorizationDetails'] = JSON.stringify(tratClaims.azd.authorization_details);
    }
  }

  if (hitlApproved) {
    base['HitlApproved'] = 'true';
    // Mock authz requires a challenge id alongside HitlApproved so bare
    // HitlApproved=true cannot spoof consent discharge.
    if (hitlChallengeId) {
      base['HitlChallengeId'] = hitlChallengeId;
    }
  }

  if (intentValidation) {
    base.IntentTokenValid  = String(intentValidation.valid);
    base.IntentMatchesTool = String(intentValidation.toolPermitted ?? false);
    // Forward WHY validation failed so the policy can distinguish a TAMPERED
    // intent token (malformed / bad signature — fail closed) from a benign
    // 'expired' one (the 5-min TTL lapsed mid agent-run — allowed through).
    base.IntentTokenError  = intentValidation.error ?? '';
    base.IntentJti         = intentValidation.payload?.jti ?? '';
    base.IntentIntent      = intentValidation.payload?.intent ?? '';
    base.IntentConfidence  = String(intentValidation.payload?.confidence ?? 0);
  }

  if (introspectionResult) {
    base.TokenActive = String(introspectionResult.active ?? false);
    if (introspectionResult.sub) base.TokenIntrospectionSub = introspectionResult.sub;
    if (introspectionResult.exp) base.TokenIntrospectionExp = String(introspectionResult.exp);
  }

  return base;
}

export class PingOneAuthorizeClient {
  constructor(private readonly config: GatewayConfig) {}

  /**
   * Evaluate a request against PingOne Authorize.
   *
   * @param decoded  — validated inbound token (sub, act, scope already extracted)
   * @param method   — MCP JSON-RPC method (e.g. "tools/call", "tools/list")
   * @param toolName — tool name from params.name if method is tools/call
   */
  async evaluate(
    decoded: DecodedGatewayToken,
    method: string,
    toolName?: string,
    toolArgs?: ToolArgs,
    hitlApproved?: boolean,
    intentValidation?: IntentValidationResult | null,
    tratClaims?: TratClaims | null,
    introspectionResult?: { active: boolean; sub?: string; exp?: number; scope?: string; aud?: string } | undefined,
    hitlChallengeId?: string,
    vertical?: string,
  ): Promise<AuthzDecision> {
    // When Authorization Server is not configured, fall back to local scope decision
    // for tools/call. This allows development/testing without P1AZ. For other methods,
    // fail closed since scope decision doesn't cover them.
    if (!isP1AZActive(this.config)) {
      if (method === 'tools/call' && toolName) {
        const decision = evaluateScopeDecisionLocally(toolName, decoded.scope);
        const reason = decision.decision === 'DENY' ? decision.reason : undefined;
        return {
          decision: decision.decision,
          reason,
          engine: 'mock',
        };
      }
      // tools/list and other methods require P1AZ
      console.error(
        '[P1AZ] Authorization Server not configured. ' +
        'Set PINGAUTHORIZE_ENDPOINT + PINGAUTHORIZE_WORKER_ID + MCP_GW_P1AZ_ENABLED=true.',
      );
      return { decision: 'DENY', reason: 'Authorization Server not configured — set PINGAUTHORIZE_ENDPOINT', engine: 'mock' };
    }

    const params = buildAuthorizeParameters(
      decoded,
      method,
      this.config.gatewayResourceUri,
      toolName,
      toolArgs,
      tratClaims ?? null,
      hitlApproved,
      intentValidation,
      vertical,
      introspectionResult,
      hitlChallengeId,
    );
    const body = { parameters: params };

    const postDecision = async (base: string) =>
      axios.post(
        `${base}/governance/pap/alpha/policy/${this.config.pingAuthorizeWorkerId}/decision`,
        body,
        { timeout: 5000, headers: { 'Content-Type': 'application/json' } },
      );

    // HI-09: lift decision_id / policy_version / trace_id off the
    // response so downstream audit logs can attribute the PERMIT to a
    // specific policy evaluation. PingAuthorize naming varies (decision_id
    // vs decisionId; policy_version vs policyVersion); accept either.
    const toDecision = (data: any, engine: AuthzDecision['engine']): AuthzDecision => {
      const outcome: string = data?.decision ?? 'DENY';
      const meta = {
        decisionId: (data?.decision_id ?? data?.decisionId) as string | undefined,
        policyVersion: (data?.policy_version ?? data?.policyVersion) as string | undefined,
        traceId: (data?.trace_id ?? data?.traceId) as string | undefined,
        engine,
      };
      if (outcome === 'PERMIT') return { decision: 'PERMIT', ...meta };
      if (outcome === 'INDETERMINATE') return { decision: 'INDETERMINATE', reason: 'HITL_REQUIRED', ...meta };
      // Preserve the engine's specific DENY reason (e.g. the mock's
      // 'unknown_tool: no policy defined' = policy drift) instead of flattening
      // every DENY to a generic string, so callers can distinguish drift from a
      // genuine denial.
      const denyReason: string =
        typeof data?.reason === 'string' && data.reason ? data.reason : `PingAuthorize decision: ${outcome}`;
      return { decision: 'DENY', reason: denyReason, ...meta };
    };

    const primary = this.config.pingAuthorizeEndpoint;
    const mockBase = this.config.pingAuthorizeMockBase;
    const canFailover = !!mockBase && mockBase !== primary;
    const primaryEngine: AuthzDecision['engine'] = canFailover ? 'real' : 'mock';

    try {
      const response = await postDecision(primary);
      // A 5xx (axios throws by default) lands in catch; a 200 + DENY is a valid
      // decision and must NOT trigger failover.
      return { ...toDecision(response.data, primaryEngine), sentParameters: params };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (canFailover) {
        try {
          const fb = await postDecision(mockBase as string);
          console.warn('[PingOneAuthorizeClient] real Authorize unreachable — failed over to mock:', msg);
          return { ...toDecision(fb.data, 'mock-failover'), sentParameters: params };
        } catch (fbErr) {
          const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
          console.warn('[PingOneAuthorizeClient] mock failover also unreachable — failing closed:', fbMsg);
          return { decision: 'DENY', reason: 'Authorization service unavailable', engine: 'mock-failover', sentParameters: params };
        }
      }
      console.warn('[PingOneAuthorizeClient] Authorize endpoint unavailable — failing closed:', msg);
      return { decision: 'DENY', reason: 'Authorization service unavailable', engine: primaryEngine, sentParameters: params };
    }
  }
}
