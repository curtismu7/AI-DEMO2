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
import { type GatewayConfig, isP1AZActive, usingRealPdpEndpoint } from '../config';
import type { IntentValidationResult } from '../intentTokenValidator';
import { type DecodedGatewayToken, isJwksVerificationEnabled } from '../tokenValidator';
import { evaluateScopeDecisionLocally, validateActClaim } from './toolScopes'; // evaluateScopeDecisionLocally kept for tests that import it directly
import { classifyStatements, type ObligationKind } from './authorizeObligations';

export type AuthzDecisionOutcome = 'PERMIT' | 'DENY' | 'INDETERMINATE';

/**
 * Contract C2 — decision provenance. WHICH engine produced this verdict:
 *   'p1az'           real PingOne Authorize
 *   'p1az-mock'      the mock PDP (either configured directly, or reached via failover)
 *   'local-fallback' the gateway's OWN scope engine — degraded, never authoritative
 *
 * The contract's fourth value, 'simulated' (replayed/synthetic decisions on
 * tester surfaces), is deliberately absent: no path in this service replays or
 * synthesises a decision, so declaring it here advertised a provenance the
 * gateway cannot produce. Runtime tuple, not a bare type alias, so the set the
 * gateway claims to speak is assertable rather than a compile-time-only promise.
 */
export const POLICY_SOURCES = ['p1az', 'p1az-mock', 'local-fallback'] as const;

export type PolicySource = typeof POLICY_SOURCES[number];

/**
 * Map the transport-level `engine` label onto the contract's policy source.
 * 'mock-failover' is an availability detail; for provenance both mock shapes are
 * the same authority, so they normalise to 'p1az-mock'.
 */
export function policySourceForEngine(engine: AuthzDecision['engine']): PolicySource {
  return engine === 'real' ? 'p1az' : 'p1az-mock';
}

export interface AuthzDecision {
  decision: AuthzDecisionOutcome;
  reason?: string;
  // Which gate the PDP attached, when it attached one. Read from `statements[]`,
  // NOT from the decision label: live PingOne Authorize returns PERMIT + a
  // statement for an obligation, and only the mock says INDETERMINATE. Callers
  // must branch on this to tell a step-up (needs MFA) from a consent hold (needs
  // a human) — the two drive completely different flows.
  obligation?: ObligationKind;
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
  // C2: which policy authority produced this decision. Always set.
  policySource?: PolicySource;
  // C2: true whenever the decision did NOT come from a policy engine — i.e. the
  // gateway decided locally. A degraded PERMIT must never read as a PDP PERMIT.
  degraded?: boolean;
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

/**
 * Upstream actor in a nested RFC 8693 chain: act.act.client_id || act.act.sub.
 * Matches BFF nestedActIdFromClaim — PingOne may stamp either field.
 */
export function nestedActClientId(act: unknown): string {
  if (!act || typeof act !== 'object') return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = (act as any).act;
  if (!inner || typeof inner !== 'object') return '';
  return String(inner.client_id || inner.sub || '');
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
  // C1: the token's ACTUAL audience. Array ⇒ first entry.
  const tokenAud = Array.isArray(decoded.aud) ? (decoded.aud[0] ?? '') : (decoded.aud ?? '');
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
    // A2A HasValidA2aGeneralist (mock Rule 1c / cloud) requires this; omitting it
    // made every depth-2 specialist call DENY as invalid_a2a_generalist.
    NestedActClientId: nestedActClientId(decoded.act),
    MayActSub: decoded.may_act?.sub ?? '',
    TokenScopes: tokenScopes.join(' '),
    // McpResourceUri is the EXPECTED audience — the gateway's own identity. It is
    // deliberately still a constant; TokenAudience below is the observed one, and
    // the policy's job is to compare the two.
    McpResourceUri: gatewayResourceUri,
    TokenExp: decoded.exp ? String(decoded.exp) : '',
    TokenIat: decoded.iat ? String(decoded.iat) : '',
    TokenNbf: decoded.nbf ? String(decoded.nbf) : '',
    TokenIss: decoded.iss ?? '',
    TransactionType: toolArgs?.transaction_type ?? toolName ?? '',
    ToAccountId: toolArgs?.to_account_id ?? '',
    Vertical: vertical ?? '',
    // C1: every decision is evaluated at a point in time; the cloud Trust
    // Framework defines Timestamp but nothing was sending it.
    Timestamp: new Date().toISOString(),
  };

  // C1 rule 1 — TokenAudience is the token's REAL aud, never the expected URI.
  // Both keys used to be hardcoded to gatewayResourceUri, which made the cloud
  // rule HasValidMcpAudience (TokenAudience == McpResourceUri) and mock Rule 0c
  // compare a value to itself: the audience check could not fail. When the token
  // carries no aud at all we OMIT rather than fabricate — omission means
  // "unknown", and a fabricated match would silently re-create the tautology.
  if (tokenAud) {
    base.TokenAudience = tokenAud;
    base.TokenAudActual = tokenAud; // retained for mock back-compat
  }

  // C1 rule 2 — Amount and TransactionAmount always move together. The cloud
  // Trust Framework only defines `Amount`, so the gateways' amount was being
  // silently dropped by the real policy; the mock only reads TransactionAmount.
  // Send both, or neither.
  if (toolArgs?.amount !== undefined) {
    base.Amount = String(toolArgs.amount);
    base.TransactionAmount = String(toolArgs.amount);
  }

  // C1 parity — signing-key identity. The BFF's McpFirstTool gate sends this;
  // without it the two gates evaluate the SAME call on different inputs, the
  // divergence class that caused F3.
  //
  // Only 'true' or omitted is honest here, and 'false' is unreachable by
  // construction: in JWKS mode _decodeAndVerify THROWS on an unmatched kid, so
  // a token that reached this function demonstrably names a published key.
  // Without JWKS the gateway is decode-only and knows nothing — omit, because
  // omission means "unknown" and the cloud attribute defaults true (C1 rule 3).
  //
  // String 'true', not a boolean: this builder is Record<string,string> and the
  // mock parses the same way it parses HitlApproved.
  //
  // TokenKid itself is deliberately not sent — it is reportable-only (no rule
  // reads it) and the raw token is not in scope here, only the decoded payload.
  if (isJwksVerificationEnabled()) {
    base.TokenKidKnown = 'true';
  }

  // Authentication strength. Without this, the cloud rule RequiresMcpStepUp
  // reduces to a pure tool-name test — NOT (Acr == Multi_Factor) is always true
  // when Acr is absent, so a completed MFA could never discharge step-up on a
  // gateway-originated call. Omitted when the token does not assert one.
  if (decoded.acr) {
    base.Acr = decoded.acr;
  }

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
      // Also surface the numeric granted ceiling as its own parameter so the
      // PingOne Authorize policy's RarMaxAmount rule (Amount > RarMaxAmount ->
      // DENY) can enforce the cap — comparisons cannot parse the JSON string
      // above. Only emitted when the grant caps an amount; absent otherwise so
      // non-RAR calls never trip the rule.
      const grant0 = tratClaims.azd.authorization_details[0] as { amount?: unknown } | undefined;
      const rarMax = Number(grant0?.amount);
      if (Number.isFinite(rarMax) && rarMax > 0) {
        base['RarMaxAmount'] = String(rarMax);
      }
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
      // F1 — the local scope engine is a SHADOW PDP. It only runs when an operator
      // has asked for it by name; otherwise an unconfigured gateway fails closed
      // rather than quietly promoting itself to policy authority.
      if (!this.config.allowLocalScopeFallback) {
        console.error(
          '[P1AZ] Authorization Server not configured and local scope fallback is off — failing closed. ' +
          'Set PINGAUTHORIZE_ENDPOINT + PINGAUTHORIZE_WORKER_ID (MCP_GW_P1AZ_ENABLED defaults true), ' +
          'or set MCP_GW_ALLOW_LOCAL_SCOPE_FALLBACK=true to accept degraded local decisions.',
        );
        return {
          decision: 'DENY',
          reason: 'authz_unavailable: Authorization Server not configured and local scope fallback is disabled',
          engine: 'mock',
          policySource: 'local-fallback',
          degraded: true,
        };
      }

      // Degraded mode. Both branches below are labelled identically so tools/call
      // and every other method report the SAME posture — previously tools/call
      // degraded to a local PERMIT while other methods hard-denied, which made the
      // deny posture depend on the method rather than on the configuration.
      if (method === 'tools/call' && toolName) {
        const decision = evaluateScopeDecisionLocally(toolName, decoded.scope);
        const reason = decision.decision === 'DENY'
          ? `local-fallback: ${decision.reason}`
          : 'local-fallback: local scope engine (degraded — not a PDP decision)';
        return {
          decision: decision.decision,
          reason,
          engine: 'mock',
          policySource: 'local-fallback',
          degraded: true,
        };
      }
      // Non-tool methods (tools/list, session lifecycle): the local engine has no
      // rule to apply, so it cannot deny on policy grounds. Degrade WITH A LABEL
      // instead of manufacturing a verdict either way.
      return {
        decision: 'PERMIT',
        reason: `local-fallback: no local rule for method "${method}" (degraded — not a PDP decision)`,
        engine: 'mock',
        policySource: 'local-fallback',
        degraded: true,
      };
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
        {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' },
          // Accept all HTTP statuses so 4xx (bad request / auth / not found) are
          // handled as decisions, not thrown as network errors. Only true network
          // errors and timeouts should trigger failover.
          validateStatus: () => true,
        },
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
        policySource: policySourceForEngine(engine),
      };
      // Real-first: a live PERMIT can still carry a gate in `statements[]`.
      // Reading only the label forwarded exactly the calls the PDP held.
      const obligation = classifyStatements(data?.statements);
      if (outcome === 'PERMIT') {
        if (obligation) {
          return {
            decision: 'INDETERMINATE',
            reason: obligation === 'stepUp' ? 'STEP_UP_REQUIRED' : 'HITL_REQUIRED',
            obligation,
            ...meta,
          };
        }
        return { decision: 'PERMIT', ...meta };
      }
      if (outcome === 'INDETERMINATE') {
        // The mock's shape. Trust its statements when present so step-up and
        // consent stay distinguishable on this path too; fall back to HITL,
        // which is what this branch has always meant.
        return {
          decision: 'INDETERMINATE',
          reason: obligation === 'stepUp' ? 'STEP_UP_REQUIRED' : 'HITL_REQUIRED',
          ...(obligation ? { obligation } : {}),
          ...meta,
        };
      }
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
    // Two distinct questions that used to share one predicate. `canFailover` asks
    // whether there is a DIFFERENT mock base to dial on error; `primaryEngine`
    // (the provenance label) asks which authority the primary endpoint IS. They
    // diverge in the real-cloud-only case — a real PDP with nothing to fail over
    // to — where failover is impossible but the engine is unambiguously 'real'.
    const canFailover = !!mockBase && mockBase !== primary;
    const primaryEngine: AuthzDecision['engine'] = usingRealPdpEndpoint(this.config) ? 'real' : 'mock';

    try {
      const response = await postDecision(primary);
      // 4xx: config/request error — fail closed with a specific reason. Do NOT
      // failover (the mock would get the same bad parameters). Log for operator.
      if (response.status >= 400 && response.status < 500) {
        const errBody = response.data;
        const reason = typeof errBody?.message === 'string' ? errBody.message
          : typeof errBody?.error === 'string' ? errBody.error
          : `PingOne Authorize returned HTTP ${response.status}`;
        console.error(`[PingOneAuthorizeClient] P1AZ ${response.status}: ${reason} (endpoint: ${primary})`);
        // C2: the PDP was reached and rejected the request — that is still a
        // decision with an author. The WS sibling (pingAuthorizeGuard.guardToolCall)
        // has always labelled this path; without it here the same failure was
        // attributable on one transport and anonymous on the other.
        return {
          decision: 'DENY',
          reason: `authorize_config_error: ${reason}`,
          engine: primaryEngine,
          policySource: policySourceForEngine(primaryEngine),
          sentParameters: params,
        };
      }
      // 5xx (axios won't throw now): trigger failover
      if (response.status >= 500) {
        throw new Error(`PingOne Authorize returned ${response.status}`);
      }
      // A 200 + DENY is a valid decision and must NOT trigger failover.
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
          return { decision: 'DENY', reason: 'Authorization service unavailable', engine: 'mock-failover', policySource: 'p1az-mock', sentParameters: params };
        }
      }
      console.warn('[PingOneAuthorizeClient] Authorize endpoint unavailable — failing closed:', msg);
      return { decision: 'DENY', reason: 'Authorization service unavailable', engine: primaryEngine, policySource: policySourceForEngine(primaryEngine), sentParameters: params };
    }
  }
}
