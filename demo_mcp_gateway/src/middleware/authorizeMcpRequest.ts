'use strict';

/**
 * authorizeMcpRequest — the gateway's McpRequestMiddleware pipeline (D-05, D-06).
 *
 * Composes GatewayTokenPolicy + PingOneAuthorizeClient into the McpRequestMiddleware
 * hook that GatewayServer accepts.
 *
 * This module builds the HTTP-transport pipeline only. GatewayServer's HTTP
 * upstream is fixed to the OLB server, so this pipeline always exchanges for
 * the olb audience — it does not route by tool. The WS transport (index.ts)
 * serves both olb and invest and does its own per-tool exchangeForBackend
 * call; it does not use this middleware's Step 4.
 *
 * Pipeline per request:
 *   1. GatewayTokenPolicy.validate(decoded)             — claim invariants (sub, act, anti-bypass)
 *   2. PingOneAuthorizeClient.evaluate(...)             — PingOne Authorize policy decision (D-06)
 *   3. McpTokenExchangeClient.exchangeForBackend(..., 'olb') — RFC 8693 exchange to the olb audience (D-03/D-05)
 *   4. forward(upstreamToken, body)                     — proxy to the OLB MCP server with the exchanged token
 *
 * Failure modes:
 *   - Policy violation (claim validation)  → 401 via sendUnauthorized (handled upstream)
 *   - Authorize DENY or unavailable        → 403 Forbidden
 *   - Token exchange failure               → 502 fail-closed (nothing forwarded)
 *
 * The inbound TX token (aud: gateway) is never forwarded upstream. After PingOne
 * Authorize permits the request, the gateway performs an RFC 8693 token exchange
 * to mint a next-hop token scoped to the olb MCP-server audience, and forwards
 * that exchanged token instead.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { PingOneAuthorizeClient, policySourceForEngine, actChainDepth } from '../auth/PingOneAuthorizeClient';
import { GatewayIntrospectionClient } from '../auth/GatewayIntrospectionClient';
import { runMcpAuthorizationPipeline } from '../auth/authorizeMcpRequestCore';
import type { McpRequestMiddleware } from '../server/GatewayServer';
import { McpTokenExchangeClient } from '../auth/McpTokenExchangeClient';
import type { GatewayConfig } from '../config';
import { checkInternalSecret, isP1AZActive, usingRealPdpEndpoint } from '../config';
import { getScopesForGatewayTool, getChallengeTypeForTool, evaluateScopeDecisionUnconditionally } from '../auth/toolScopes';
import { evaluateTierDecision, parseRestrictedTools } from '../tierEnforce';
import { teachLog } from '../teachLogger';
import { routeTool } from '../router';
import { selfBaseUrl } from '../selfBaseUrl';
import { buildApiKeyToolResult } from '../apiKeyDispatch';
import { buildDualTokenToolResult } from '../dualTokenDispatch';
import { buildBankingDataToolResult } from '../bankingDataDispatch';
import { checkWeatherScope, checkBraveScope } from '../scopePolicies';
import { validateIntentToken } from '../intentTokenValidator';
import { validateMethodAndShape, validateToolArgs } from '../validation/mcpRequestValidation';
import { createHitlChallenge, verifyAndConsumeHitlReceipt, ReceiptVerification } from '../hitlClient';
import { recordGatewayAudit, auditOutcomeFromHttp, httpScopeAlertDetails } from '../gatewayAudit';
import { verifyDpopProof } from '../dpopVerify';
import { verifyWebBotAuth } from '../webBotAuthVerify';
import { enforceRarSubset, rarDetailsFromEnvelope, type RarDetail, type RarToolArgs } from '../rarEnforce';
import type { TratClaims, PolicySource, AuthzDecision } from '../auth/PingOneAuthorizeClient';
import { noteBindingHeaderSeen } from '../authzPosture';
import { SlidingWindowLimiter, _resetLimiterForTest as _resetRateLimiterForTest } from '../rateLimit';
import { createPendingElicitation, consumePendingElicitation } from '../elicitationStore';
import { extractRequestedProtocolVersion } from '../modernNegotiation';

// ---------------------------------------------------------------------------
// Body parsing helper — extract method and tool name from JSON-RPC body
// ---------------------------------------------------------------------------

interface JsonRpcBody {
  method?: string;
  id?: unknown;
    params?: {
      name?: string;
      arguments?: Record<string, unknown>;
      // MCP spec 2026-07-28 MRTR retry fields — top-level params siblings,
      // distinct from the Legacy _elicitation_confirmed/_elicitation_id
      // tool-argument markers.
      inputResponses?: Record<string, { action?: string }>;
      requestState?: string;
      _meta?: unknown;
    };
}

interface GwAuditTrail {
  introspection: { active: boolean; sub?: string; exp?: number; error?: string } | null;
  policy: { passed: boolean; error?: string } | null;
  authorize: {
    decision: string;
    reason?: string;
    decisionId?: string;
    policyVersion?: string;
    traceId?: string;
    engine?: string;
    // C2 — provenance. A PERMIT is forwarded upstream, so the response BODY is
    // the backend's; this trail (emitted as X-Gw-Audit-Trail and to teachLog) is
    // the gateway's only channel for WHO decided. Without these two fields a
    // degraded local-fallback PERMIT was indistinguishable from a PDP PERMIT in
    // the audit record — the one direction C2 exists to make impossible.
    policySource?: PolicySource;
    degraded?: boolean;
    attributes?: Record<string, string>;
  } | null;
  mtls: { enabled: boolean; subject?: string } | null;
  backend: { target: string; audience: string | null; cached?: boolean; exchanged: boolean; error?: string } | null;
  /** Teaching: ordered gateway stages for Token Chain. */
  filterChain?: Array<{ filter: string; result: string; decision?: string }>;
  /** Teaching: which stage blocked the call (omit on success). */
  denyingFilter?: string;
  /** Teaching: last stage that completed on a forward path. */
  lastFilter?: string;
}

/** Rebuild filterChain / denyingFilter / lastFilter from filled audit stages.
 * Always emits the full teaching chain (skipped when a stage did not run) so
 * success paths show every hop, not only stages that happened to stamp data.
 */
function stampFilterTrail(
  trail: GwAuditTrail,
  opts?: { denyingFilter?: string; lastFilter?: string },
): void {
  const chain: NonNullable<GwAuditTrail['filterChain']> = [
    {
      filter: 'TokenIntrospection',
      result: trail.introspection
        ? (trail.introspection.active ? 'passed' : 'blocked')
        : 'skipped',
    },
    {
      filter: 'GatewayTokenPolicy',
      result: trail.policy
        ? (trail.policy.passed ? 'passed' : 'blocked')
        : 'skipped',
    },
    {
      filter: 'P1AZDecision',
      result: trail.authorize
        ? (trail.authorize.decision === 'PERMIT' ? 'forwarded' : 'blocked')
        : 'skipped',
      ...(trail.authorize?.decision ? { decision: trail.authorize.decision } : {}),
    },
    {
      filter: 'mTLS',
      result: trail.mtls
        ? (trail.mtls.enabled ? 'passed' : 'skipped')
        : 'skipped',
    },
    {
      filter: 'BackendExchange',
      result: trail.backend
        ? (trail.backend.exchanged ? 'forwarded' : (trail.backend.error ? 'blocked' : 'skipped'))
        : 'skipped',
    },
  ];
  trail.filterChain = chain;
  if (opts?.denyingFilter) trail.denyingFilter = opts.denyingFilter;
  if (opts?.lastFilter) {
    trail.lastFilter = opts.lastFilter;
  } else if (!opts?.denyingFilter) {
    if (trail.backend?.exchanged) trail.lastFilter = 'BackendExchange';
    else if (trail.mtls?.enabled) trail.lastFilter = 'mTLS';
    else if (trail.authorize?.decision === 'PERMIT') trail.lastFilter = 'P1AZDecision';
    else if (trail.policy?.passed) trail.lastFilter = 'GatewayTokenPolicy';
    else if (trail.introspection?.active) trail.lastFilter = 'TokenIntrospection';
  }
}
/**
 * Injectable dependencies for `buildAuthorizeMcpRequest`.
 * When provided (e.g. in tests), the production introspection + authorize
 * pipeline is bypassed and these functions are used instead.
 */
export interface AuthorizeMcpRequestDeps {
  introspect: (token: string) => Promise<{ active: boolean; sub?: string; exp?: number; error?: string; scope?: string; act?: { sub?: string } }>;
  authorize: (
    decoded: any,
    method: string,
    toolName?: string,
    toolArgs?: any,
    hitlApproved?: boolean,
    intentValidation?: ReturnType<typeof validateIntentToken> | null,
    hitlChallengeId?: string,
  ) =>
    Promise<{
      decision: 'PERMIT' | 'DENY' | 'INDETERMINATE';
      reason?: string;
      decisionId?: string;
      policyVersion?: string;
      traceId?: string;
      engine?: 'real' | 'mock' | 'mock-failover';
      // Contract C2 — which authority decided, and whether it was a degraded
      // (gateway-local) decision rather than a PDP one.
      policySource?: PolicySource;
      degraded?: boolean;
      sentParameters?: Record<string, string>;
    }>;
  exchange?: (subjectToken: string, toolName?: string) => Promise<{ token: string; targetAud: string; cached: boolean }>;
}

function parseJsonRpcBody(body: Buffer): JsonRpcBody {
  try {
    return JSON.parse(body.toString('utf-8')) as JsonRpcBody;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Factory — returns the McpRequestMiddleware for injection into GatewayServer
// ---------------------------------------------------------------------------

// Module-level rate-limiter singleton — created lazily from config on first request.
// One limiter per gateway process. Reset via _resetRateLimiterForTest in tests.
let _rateLimiter: SlidingWindowLimiter | null = null;
// Thresholds captured when the singleton was built. SlidingWindowLimiter freezes
// windowMs/maxRequests at construction, so a runtime reconfig via POST /admin/config
// (adminConfig.ts mutates config.rateLimit*) would otherwise be a silent no-op until
// restart. We rebuild the singleton when either value changes.
let _rateLimiterWindowMs: number | undefined;
let _rateLimiterMaxRequests: number | undefined;
// Exported so the WS transport (index.ts) shares the SAME limiter instance —
// an agent's bucket must be one shared count across transports, not two.
export function getRateLimiter(config: { rateLimitMaxRequests: number; rateLimitWindowMs: number }): SlidingWindowLimiter {
  if (
    !_rateLimiter ||
    _rateLimiterWindowMs !== config.rateLimitWindowMs ||
    _rateLimiterMaxRequests !== config.rateLimitMaxRequests
  ) {
    _rateLimiter = new SlidingWindowLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests);
    _rateLimiterWindowMs = config.rateLimitWindowMs;
    _rateLimiterMaxRequests = config.rateLimitMaxRequests;
  }
  return _rateLimiter;
}

/** Reset the rate-limiter singleton. Delegates to _resetLimiterForTest in rateLimit.ts. */
export function resetRateLimiterForTest(): void {
  _rateLimiter = null;
  _rateLimiterWindowMs = undefined;
  _rateLimiterMaxRequests = undefined;
  _resetRateLimiterForTest();
}

export function buildAuthorizeMcpRequest(
  config: GatewayConfig,
  deps?: AuthorizeMcpRequestDeps,
): McpRequestMiddleware {
  const introspectionClient = new GatewayIntrospectionClient(config);
  const authorizeClient = new PingOneAuthorizeClient(config);
  const exchangeClient = new McpTokenExchangeClient(config);
  // Exchange per tool: invest tools need the mcp-resource-server audience — a hardcoded
  // 'olb' exchange minted an mcpserver-audience token that the invest backend
  // (and mcp-server, which does not serve invest tools) both reject.
  const doExchange = deps?.exchange ?? ((t: string, tool?: string) => exchangeClient.exchange(t, tool));

  return async (
    bearerToken: string,
    body: Buffer,
    _req: IncomingMessage,
    res: ServerResponse,
    forward: (upstreamToken: string, body: Buffer) => Promise<void>,
  ): Promise<void> => {
    // ── Dev bypass: passthrough mode (MCP_GW_DEV_BYPASS=true) ───────────────────────
    // Skip all validation and policy eval. Forward the original bearer token
    // directly to the upstream MCP server.
    // The gateway still handles routing and observability; auth is bypassed.
    if (config.devBypass) {
      teachLog.info('[GW] Dev bypass: forwarding request without auth pipeline');
      await forward(bearerToken, body);
      return;
    }

    // ── UC18: per-agent/per-tool rate limiting ────────────────────────────────
    // Runs before introspection (no P1AZ quota burned on throttled requests).
    // Only metered for tools/call; tools/list is excluded.
    // Flag-gated: config.rateLimitEnabled (GATEWAY_RATE_LIMIT_ENABLED=true, default false).
    if (config.rateLimitEnabled) {
      const _rlParsedBody = parseJsonRpcBody(body);
      if (_rlParsedBody.method === 'tools/call') {
        // Pre-decode sub for the rate-limit key. No signature verification here —
        // full validation happens in Step 0 (runMcpAuthorizationPipeline). A forged
        // sub wastes a slot in the attacker's own bucket, not a legitimate user's.
        let _rlSub = 'unknown';
        try {
          const _rawPayload = bearerToken.split('.')[1];
          if (_rawPayload) {
            const _claims = JSON.parse(Buffer.from(_rawPayload, 'base64url').toString('utf-8'));
            if (_claims?.sub) _rlSub = String(_claims.sub);
          }
        } catch { /* use 'unknown' sub */ }
        const _rlTool = _rlParsedBody.params?.name ?? 'unknown_tool';
        const _rlKey = `${_rlSub}:${_rlTool}`;
        const _rlResult = getRateLimiter(config).check(_rlKey);
        if (!_rlResult.allowed) {
          teachLog.warn(`[GW] UC18 rate_limited key=${_rlKey} retryAfterMs=${_rlResult.retryAfterMs}`);
          // Minimal, self-contained audit record — the durable audit-hook wrapper
          // below hasn't been installed yet at this point in the pipeline, so a
          // 429 here would otherwise leave no trace in X-Gw-Audit-Trail or
          // /internal/mcp-audit (confirmed by reading the pipeline in full).
          try {
            res.setHeader('X-Gw-Audit-Trail', JSON.stringify({
              introspection: null,
              policy: null,
              authorize: null,
              mtls: null,
              rateLimit: { limited: true, retryAfterMs: _rlResult.retryAfterMs },
            }));
          } catch {
            // headers already sent — ignore
          }
          recordGatewayAudit(
            {
              operation: _rlTool,
              outcome: 'failure',
              userId: _rlSub,
              agentId: _rlSub,
              vertical: routeTool(_rlTool),
              duration: 0,
              details: { httpStatus: 429, rate_limited: true, retryAfterMs: _rlResult.retryAfterMs },
            },
            config,
          );
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil(_rlResult.retryAfterMs / 1000)),
          });
          res.end(JSON.stringify({
            error: 'rate_limited',
            code: 'rate_limited',
            message: 'Tool call rate limit exceeded. Retry after the indicated interval.',
            retryAfterMs: _rlResult.retryAfterMs,
          }));
          return;
        }
      }
    }

    // Durable audit hook (HTTP transport) — wrap res.end so the FIRST response
    // this tool call emits (deny, HITL-pending, or forwarded upstream result)
    // is recorded once to the BFF's audit store, mirroring the WS path in
    // index.ts. `_audCtx` is filled in below once tool/identity are known; auth
    // failures that end the response before then carry no operation and are
    // skipped. Observation-only: does not alter status, headers, or body — so
    // PingOne Authorize mock parity is unaffected. Fire-and-forget.
    const _audStartedAt = Date.now();
    const _audCtx: {
      operation: string; userId?: string; agentId?: string;
      dpopBound?: boolean; dpopVerified?: boolean; rar?: string;
      wbaVerified?: boolean; wbaReason?: string; wbaAgent?: string;
    } = { operation: 'unknown' };
    let _audDone = false;
    const _origEnd = res.end.bind(res);
    (res as unknown as { end: (...a: unknown[]) => unknown }).end = (...endArgs: unknown[]) => {
      if (!_audDone && _audCtx.operation) {
        _audDone = true;
        const chunk = endArgs[0];
        const bodyText = typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : '';
        recordGatewayAudit(
          {
            operation: _audCtx.operation,
            outcome: auditOutcomeFromHttp(res.statusCode, bodyText),
            userId: _audCtx.userId,
            agentId: _audCtx.agentId,
            vertical: routeTool(_audCtx.operation),
            duration: Date.now() - _audStartedAt,
            details: {
              httpStatus: res.statusCode,
              // DPoP (RFC 9449) + RAR (RFC 9396) posture for the evidence trail.
              dpop_bound: _audCtx.dpopBound ?? false,
              dpop_verified: _audCtx.dpopVerified ?? false,
              ...(_audCtx.rar ? { rar: _audCtx.rar } : {}),
              // Web Bot Auth (RFC 9421) posture — recorded for every outcome
              // whenever the feature is on (monitor or enforce).
              ...(config.wbaMode && config.wbaMode !== 'off' ? {
                wba_mode: config.wbaMode,
                wba_verified: _audCtx.wbaVerified ?? false,
                ...(_audCtx.wbaReason ? { wba_reason: _audCtx.wbaReason } : {}),
                ...(_audCtx.wbaAgent ? { wba_agent: _audCtx.wbaAgent } : {}),
              } : {}),
              // Scenario 4 — flag an insufficient-scope 403 as an unauthorized-tool alert.
              ...(httpScopeAlertDetails(res.statusCode, bodyText) || {}),
            },
          },
          config,
        );
      }
      return _origEnd(...(endArgs as Parameters<typeof _origEnd>));
    };

    const auditTrail: GwAuditTrail = {
      introspection: null,
      policy: null,
      authorize: null,
      mtls: null,
      backend: null,
    };
    // Store introspection result to pass to P1AZ when introspectionProvider is 'p1az'
    let introspectionResult: { active: boolean; sub?: string; exp?: number; scope?: string; aud?: string } | undefined;

    // Helper: set the audit trail header on any response path
    const setAuditHeader = (r: ServerResponse, filterOpts?: { denyingFilter?: string; lastFilter?: string }) => {
      try {
        stampFilterTrail(auditTrail, filterOpts);
        r.setHeader('X-Gw-Audit-Trail', JSON.stringify(auditTrail));
      } catch {
        // headers already sent — ignore
      }
    };

    // ── Steps 0 + 1: introspection + policy ─────────────────────────────────────────
    // When injectable deps are provided (tests), use them directly and skip the
    // production pipeline. In production, delegate to authorizeMcpRequestCore so
    // the same checks run on the WS transport path (BL-02).
    let decoded: any;
    if (deps) {
      // Test path: use injected introspect + authorize stubs
      const introspResult = await deps.introspect(bearerToken);
      auditTrail.introspection = {
        active: introspResult.active,
        sub: introspResult.sub,
        exp: introspResult.exp,
      };
      if (!introspResult.active) {
        setAuditHeader(res, { denyingFilter: 'TokenIntrospection' });
        // introspResult.error is only set when introspection itself failed
        // (transport error, or the client's own auth was rejected) — a
        // genuinely confirmed-inactive token never carries it. Don't tell
        // the user to log back in for a gateway-side problem.
        if (introspResult.error) {
          teachLog.warn('gateway audit trail — introspection unavailable', { gw_audit_trail: auditTrail });
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'gateway_misconfigured',
            message: 'The security gateway could not validate this token (introspection unavailable). This is a gateway configuration/connectivity issue, not a problem with your credentials.',
          }));
          return;
        }
        teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer realm="PingOne", resource_metadata="${selfBaseUrl(_req, config.port)}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Token is revoked or no longer active"`,
        });
        res.end(JSON.stringify({
          error: 'login_required',
          message: 'Token is revoked or no longer active (RFC 7662)',
          required_scopes: ['read'],
          login_required: true,
        }));
        return;
      }
      auditTrail.policy = { passed: true };
      decoded = { sub: introspResult.sub, scope: introspResult.scope, act: introspResult.act };
      // Capture introspection result for passing to P1AZ (test path as well)
      introspectionResult = {
        active: introspResult.active,
        sub: introspResult.sub,
        exp: introspResult.exp,
      };
    } else {
      // Production path: transport-agnostic pipeline (introspection + policy)
      // HTTP-specific rendering (writeHead, WWW-Authenticate, JSON body shape)
      // stays here; the core only returns a tagged decision.
      // UC16 needs the tool name at policy time. Peek at the JSON-RPC envelope
      // here (it is re-parsed below for the main flow) so the require-act branch
      // in GatewayTokenPolicy is reachable on HTTP — without these two arguments
      // the check silently never fired.
      const preParsed = parseJsonRpcBody(body);
      const pipelineResult = await runMcpAuthorizationPipeline(
        bearerToken,
        introspectionClient,
        config,
        preParsed.params?.name,
        preParsed.method === 'tools/call' ? 'McpToolCall' : undefined,
      );
      auditTrail.introspection = pipelineResult.audit.introspection;
      auditTrail.policy = pipelineResult.audit.policy;
      // Capture introspection result for passing to P1AZ when introspectionProvider='p1az'.
      // Guaranteed to be active and not null since pipeline returns 'authorized' only when introspection passed.
      if (pipelineResult.kind === 'authorized' && pipelineResult.audit.introspection) {
        introspectionResult = {
          active: pipelineResult.audit.introspection.active,
          sub: pipelineResult.audit.introspection.sub,
          exp: pipelineResult.audit.introspection.exp,
        };
      }

      if (pipelineResult.kind === 'introspection_unavailable') {
        // Introspection itself could not be completed (transport error, or
        // the gateway's own introspection-client credentials/auth-method
        // were rejected) — NOT a confirmed-revoked token. Telling the user
        // to log back in here would be misleading; this is a gateway-side
        // problem an administrator needs to fix.
        setAuditHeader(res);
        teachLog.warn('gateway audit trail — introspection unavailable', { gw_audit_trail: auditTrail });
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'gateway_misconfigured',
          message: 'The security gateway could not validate this token (introspection unavailable). This is a gateway configuration/connectivity issue, not a problem with your credentials.',
        }));
        return;
      }

      if (pipelineResult.kind === 'introspection_failed') {
        setAuditHeader(res, { denyingFilter: 'TokenIntrospection' });
        teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer realm="PingOne", resource_metadata="${selfBaseUrl(_req, config.port)}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Token is revoked or no longer active"`,
        });
        res.end(JSON.stringify({
          error: 'login_required',
          message: 'Token is revoked or no longer active (RFC 7662)',
          required_scopes: ['read'],
          login_required: true,
        }));
        return;
      }

      if (pipelineResult.kind === 'policy_violation') {
        setAuditHeader(res, { denyingFilter: 'GatewayTokenPolicy' });
        teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer realm="PingOne", resource_metadata="${selfBaseUrl(_req, config.port)}/.well-known/oauth-protected-resource", error="${pipelineResult.code}", error_description="${pipelineResult.message}"`,
        });
        res.end(JSON.stringify({
          error: pipelineResult.code,
          message: pipelineResult.message,
          required_scopes: ['read'],
          login_required: true,
        }));
        return;
      }

      decoded = pipelineResult.decoded;
      // C3: an act claim is delegation evidence. If it is present while
      // REQUIRE_ACT_FOR_AGENT_TOOLS is off, /health reports that as a live
      // bypass rather than an untested optional control.
      if (decoded?.act) noteBindingHeaderSeen('act');
    }

    // ── Step 2: Parse JSON-RPC to get method, tool name, and transaction args ──────
    const parsedBody = parseJsonRpcBody(body);
    const { method = 'unknown', params } = parsedBody;
    const toolName = params?.name;
    let toolArgs = params?.arguments as Record<string, unknown> | undefined;

    // Activate the audit hook now that the tool + caller identity are known, so
    // denials and HITL-pending outcomes below are recorded too (the res.end wrap
    // is a no-op until _audCtx.operation is set).
    if (toolName) {
      _audCtx.operation = toolName;
      _audCtx.userId = decoded?.sub;
      _audCtx.agentId = decoded?.act?.sub;
    }

    // Spec §2 — method allow-list + shape + per-tool schema validation, after
    // token introspection but before any PingOne Authorize cost. HTTP transport
    // returns 400 with a JSON-RPC error body (-32601 / -32602 + data).
    const sendRpcError = (status: number, id: unknown, f: { code: number; message: string; data?: Record<string, unknown> }) => {
      setAuditHeader(res);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: f.code, message: f.message, data: f.data } }));
    };
    const shapeFailure = validateMethodAndShape(parsedBody.method, parsedBody.params);
    if (shapeFailure) { sendRpcError(400, parsedBody.id, shapeFailure); return; }
    if (parsedBody.method === 'tools/call') {
      const rawArgs = { ...(parsedBody.params?.arguments || {}) };
      delete (rawArgs as Record<string, unknown>)._hitl_challenge_id;
      delete (rawArgs as Record<string, unknown>)._elicitation_confirmed;
      delete (rawArgs as Record<string, unknown>)._elicitation_id;
      // Shape check above guarantees params.name is a non-empty string here.
      const argsFailure = validateToolArgs(toolName ?? '', rawArgs as Record<string, unknown>);
      if (argsFailure) { sendRpcError(400, parsedBody.id, argsFailure); return; }
    }

    // WR-03: `_hitl_challenge_id` is a gateway-internal control field. The WS
    // path (index.ts) strips it before forwarding (Phase 2 CR-01); the HTTP
    // path forwarded the original body Buffer verbatim, leaking it to the
    // backend (which may reject unrecognized args under strict input-schema
    // validation). Rebuild the body with the field removed before forwarding.
    let outBody = body;
    let hitlChallengeId: string | undefined;
    if (toolArgs && '_hitl_challenge_id' in toolArgs) {
      const { _hitl_challenge_id: _stripped, ...rest } = toolArgs;
      hitlChallengeId = typeof _stripped === 'string' ? _stripped : undefined;
      toolArgs = rest;
      if (parsedBody.params) parsedBody.params.arguments = rest;
      outBody = Buffer.from(JSON.stringify(parsedBody), 'utf-8');
    }

    // Elicitation re-call markers — mirrors the `_hitl_challenge_id` handling
    // above. Stripped from the forwarded body (backend schemas reject unknown
    // fields); re-added to a P1AZ-only args object further down so the policy
    // can permit the retry.
    let elicitationConfirmed = false;
    let elicitationId: string | undefined;
    if (toolArgs && ('_elicitation_confirmed' in toolArgs || '_elicitation_id' in toolArgs)) {
      const { _elicitation_confirmed, _elicitation_id, ...rest } = toolArgs as Record<string, unknown>;
      elicitationConfirmed = _elicitation_confirmed === true;
      elicitationId = typeof _elicitation_id === 'string' ? _elicitation_id : undefined;
      toolArgs = rest;
      if (parsedBody.params) parsedBody.params.arguments = rest;
      outBody = Buffer.from(JSON.stringify(parsedBody), 'utf-8');
    }

    // MCP spec 2026-07-28 MRTR: a Modern retry carries top-level
    // params.inputResponses + params.requestState instead of the Legacy
    // _elicitation_confirmed/_elicitation_id tool-argument markers above.
    // requestState IS the elicitation_id — reusing the same crypto-random,
    // one-time-use, session+tool-bound record from elicitationStore.ts.
    // Only 'accept' counts as confirmed; decline/cancel/missing all fall
    // through to a fresh obligation check, same fail-closed default as an
    // absent Legacy confirmation.
    const modernInputResponses = parsedBody.params?.inputResponses as Record<string, { action?: string }> | undefined;
    const modernRequestState = parsedBody.params?.requestState as string | undefined;
    if (modernInputResponses?.elicitation?.action === 'accept' && modernRequestState) {
      elicitationConfirmed = true;
      elicitationId = modernRequestState;
      if (parsedBody.params) {
        delete parsedBody.params.inputResponses;
        delete parsedBody.params.requestState;
      }
      outBody = Buffer.from(JSON.stringify(parsedBody), 'utf-8');
    }

    // Elicitation re-call validation — verify the pending record is valid for
    // this session + tool BEFORE calling P1AZ. One-time use: consumed here.
    // Mirrors index.ts (WS path) so both transports share the same store.
    if (elicitationConfirmed) {
      // `_hdr` (Step 2c) is not defined yet at this point in the pipeline —
      // read the session-binding header directly, same extraction it uses.
      const _rawSessionId = _req?.headers?.['mcp-session-id'];
      const sessionId = (Array.isArray(_rawSessionId) ? _rawSessionId[0] : _rawSessionId || '').toString().trim();
      const rec = elicitationId ? consumePendingElicitation(elicitationId, toolName ?? '', sessionId) : null;
      if (!rec) {
        setAuditHeader(res);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'elicitation_required',
          message: 'Elicitation confirmation is invalid or has expired',
          reason: 'invalid_or_expired',
          tool: toolName ?? '',
          login_required: false,
        }));
        return;
      }
      // ElicitationConfirmed: 'true' is added to P1AZ via toolArgsForAuthz below.
    }

    // ── Step 2a: HITL receipt verification (transport parity with the WS path) ──
    // If the agent is retrying with a `_hitl_challenge_id`, verify the challenge is
    // approved AND bound to THIS caller/agent/tool before treating it as approved.
    // Mirrors index.ts (WS) so the HTTP agent path gets the same human-approval flow.
    let hitlApproved = false;
    if (hitlChallengeId && config.hitlServiceUrl) {
      let verification: ReceiptVerification | null = null;
      try {
        const retryArgs = (toolArgs as Record<string, unknown> | undefined) || {};
        // Verify AND consume server-side. The previous GET + local
        // verifyHitlReceipt() never mutated challenge state, so the same
        // _hitl_challenge_id discharged retry after retry until its TTL.
        verification = await verifyAndConsumeHitlReceipt(config.hitlServiceUrl, hitlChallengeId, {
          userId: decoded.sub,
          agentId: decoded.act?.sub,
          tool: toolName ?? '',
          amount: retryArgs.amount as number | string | undefined,
          params: retryArgs,
        });
      } catch (verifyErr) {
        // HITL service unreachable or threw — fail closed with 503 rather than
        // silently treating the receipt as missing (which would re-issue a new challenge).
        setAuditHeader(res);
        teachLog.warn('gateway hitl verification error', { error: (verifyErr as Error).message });
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'hitl_service_unavailable',
          message: 'HITL verification service unavailable — retry later',
          hitl: true,
          challengeId: hitlChallengeId,
        }));
        return;
      }
      if (verification && !verification.ok) {
        setAuditHeader(res);
        teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'hitl_receipt_rejected',
          message: verification.message || 'HITL challenge invalid',
          hitl: true,
          challengeId: hitlChallengeId,
          login_required: false,
        }));
        return;
      }
      hitlApproved = verification?.ok === true;
    }

    // ── Step 2b: Intent token validation (parity with WS path in index.ts) ───
    const xIntentToken = _req?.headers?.['x-intent-token'] as string | undefined;
    // C3: record that intent evidence is being presented, so /health can report
    // "intent token received but INTENT_TOKEN_REQUIRED is off" as a live bypass
    // rather than as an unexercised optional control.
    if (xIntentToken) noteBindingHeaderSeen('intent');
    const intentRequired = config.intentTokenRequired === true;
    const intentValidation = xIntentToken || intentRequired
      ? validateIntentToken(xIntentToken, toolName ?? '')
      : null;
    if (intentValidation && !intentValidation.valid && intentRequired) {
      setAuditHeader(res);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'intent_token_invalid',
        message: intentValidation.error || 'intent token invalid',
        login_required: false,
      }));
      return;
    }
    if (!xIntentToken) {
      teachLog.info(`[GW] Intent Token: absent — tool: ${toolName}`);
    } else if (intentValidation && !intentValidation.valid) {
      teachLog.warn(`[GW] Intent Token: INVALID (${intentValidation.error}) — tool: ${toolName}`);
    } else if (intentValidation?.valid) {
      const permitted = intentValidation.toolPermitted ? 'permitted' : 'not in permitted_tools';
      teachLog.info(`[GW] Intent Token: valid=true intent=${intentValidation.payload?.intent} confidence=${intentValidation.payload?.confidence} ${permitted} tool=${toolName}`);
    }

    // ── Step 2c: bridge actor identity from BFF headers (HTTP parity with the WS path) ──
    // On hops where PingOne can't emit a native `act`/`may_act` (resource SpEL has no actor
    // token to reference), the BFF bridges them via trusted server-to-server headers. Where a
    // native claim IS present (e.g. this resource's null-safe act SPEL, rolled out 2026-06-19 —
    // see docs/ACT_CLAIM_VERIFICATION.md), it always wins; the header is a fallback only. The WS
    // path (index.ts) already applies these; mirror it here so the Authorize decision sees
    // ActClientId + MayActSub on the HTTP transport too — required for ENFORCE_MAY_ACT.
    const _hdr = (n: string): string | undefined => {
      const v = _req?.headers?.[n];
      return (Array.isArray(v) ? v[0] : v || '').toString().trim() || undefined;
    };
    // Gate x-act-client-id / x-may-act-sub behind the same internal shared secret used by
    // /admin/config (index.ts requireInternalSecret). An unauthenticated caller must NOT be
    // able to inject an arbitrary act/may_act identity into the Authorize decision.
    // Ignore (do NOT reject) the request when the secret is absent or wrong — backwards
    // compatible for callers that legitimately omit these headers entirely.
    const _wsSecretOk = checkInternalSecret(_hdr('x-internal-gateway-secret'), config.bffInternalSecret);
    const bffActClientId = _wsSecretOk ? _hdr('x-act-client-id') : undefined;
    const bffMayActSub = _wsSecretOk ? _hdr('x-may-act-sub') : undefined;
    // Confused-deputy demo (UC13): X-Demo-Force-Actor, gated by the same trust check, tells
    // us to prefer the bridged header even when a native `act` claim is already present —
    // otherwise the rogue actor the sim injects is silently shadowed by the real native claim
    // and PingOne Authorize sees the real actor instead. Real traffic never sets this header;
    // native act still wins for every normal call. Demo-only escape hatch, not a security change.
    const _forceDemoActor = _wsSecretOk && _hdr('x-demo-force-actor') === 'true';
    if (decoded && (_forceDemoActor || !decoded.act?.sub) && bffActClientId) {
      decoded.act = { sub: bffActClientId };
    }
    if (decoded && !decoded.may_act?.sub && bffMayActSub) {
      decoded.may_act = { sub: bffMayActSub };
    }

    // ── Step 2d: DPoP proof verification (RFC 9449) ──────────────────────────────
    // The BFF binds the delegated token to a per-session key (cnf.jkt, carried in the
    // TraT envelope in simulated mode or the token claim natively) and signs a fresh
    // DPoP proof per hop. Verify the inbound proof with real crypto so a stolen bearer
    // is useless without the private key. Fail-closed only when REQUIRE_DPOP_PROOF=true;
    // otherwise observe + log + bridge so the demo runs with the flag on but enforcement off.
    const _dpopProof = _hdr('dpop');
    if (_dpopProof) noteBindingHeaderSeen('dpop');
    let _cnfJkt: string | undefined;
    let _rarDetails: RarDetail[] | undefined;
    let _tratClaims: TratClaims | null = null;
    try {
      const xt = _hdr('x-trat-context');
      if (xt) noteBindingHeaderSeen('rar');
      // Unsigned X-TraT-Context is demo-only; gate like MCP TratClaimsExtractor.
      if (xt && process.env.ALLOW_UNSIGNED_TRAT_CONTEXT === 'true') {
        const _env = JSON.parse(xt) as {
          cnf?: { jkt?: string };
          reqctx?: { tool?: string }; purp?: string; azd?: unknown; rctx?: unknown; trat_sim?: boolean;
        };
        _cnfJkt = _env?.cnf?.jkt;
        _rarDetails = rarDetailsFromEnvelope(_env);
        // Build full TraT claims so the HTTP path passes the same Authorize decision
        // context as the WS path (previously HTTP passed null — now at parity).
        if (typeof _env.purp === 'string' && typeof _env.reqctx?.tool === 'string' && _env.azd && _env.rctx) {
          _tratClaims = _env as unknown as TratClaims;
        }
      }
    } catch { /* malformed envelope — leave undefined */ }
    if (!_cnfJkt && (decoded as { cnf?: { jkt?: string } })?.cnf?.jkt) {
      _cnfJkt = (decoded as { cnf?: { jkt?: string } }).cnf!.jkt;
    }
    const _requireDpop = process.env.REQUIRE_DPOP_PROOF === 'true';
    let _dpopVerified = false;
    // Fail-closed binding requirement: when enforcement is on, a proof that is not
    // bound to a known key thumbprint (no cnf.jkt from the token or TraT envelope)
    // proves nothing — an attacker with a stolen bearer could mint their own key and
    // a self-consistent proof. Reject rather than accept an unbound proof.
    if (_requireDpop && !_cnfJkt) {
      setAuditHeader(res);
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `DPoP realm="PingOne", resource_metadata="${selfBaseUrl(_req, config.port)}/.well-known/oauth-protected-resource", error="invalid_dpop_proof", error_description="token is not DPoP-bound (no cnf.jkt)"`,
      });
      res.end(JSON.stringify({ error: 'invalid_dpop_proof', message: 'token is not DPoP-bound (no cnf.jkt)' }));
      return;
    }
    if (_dpopProof || _cnfJkt || _requireDpop) {
      const _v = verifyDpopProof({
        proof: _dpopProof || '',
        htu: (_req?.url as string) || '/mcp',
        htm: 'POST',
        accessToken: bearerToken,
        expectedJkt: _cnfJkt,
        maxAgeSecs: parseInt(process.env.DPOP_PROOF_LIFETIME_SECS || '60', 10),
      });
      if (_v.ok) {
        _dpopVerified = true;
        teachLog.info('[GW] DPoP proof verified', { jkt: _v.jkt });
      } else {
        teachLog.warn(`[GW] DPoP proof verification failed: ${_v.reason} (tool: ${toolName})`);
        if (_requireDpop) {
          setAuditHeader(res);
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `DPoP realm="PingOne", resource_metadata="${selfBaseUrl(_req, config.port)}/.well-known/oauth-protected-resource", error="invalid_dpop_proof", error_description="${_v.reason || 'DPoP proof required'}"`,
          });
          res.end(JSON.stringify({ error: 'invalid_dpop_proof', message: _v.reason || 'DPoP proof required' }));
          return;
        }
      }
    }
    // Bridge the verified outcome to the upstream MCP server (trusted internal hop,
    // same pattern as X-Act-Client-Id) so the MCP server can enforce its own cnf gate.
    (_req as unknown as { _dpopVerified?: boolean; _dpopJkt?: string })._dpopVerified = _dpopVerified;
    (_req as unknown as { _dpopVerified?: boolean; _dpopJkt?: string })._dpopJkt = _cnfJkt;
    _audCtx.dpopBound = !!_cnfJkt;
    _audCtx.dpopVerified = _dpopVerified;

    // ── Step 2d': Web Bot Auth (RFC 9421 HTTP Message Signatures) ────────────────
    // draft-meunier-web-bot-auth profile: the calling agent signs @authority +
    // signature-agent with Ed25519; its public JWKS is published at the
    // Signature-Agent origin's /.well-known/http-message-signatures-directory.
    // Mode (config.wbaMode / MCP_GW_WBA_MODE): 'off' skip, 'monitor' verify+audit
    // only (default), 'enforce' 401 on missing/invalid signature. Every outcome
    // is recorded via the gatewayAudit res.end wrapper (wba_* details).
    if (config.wbaMode !== 'off') {
      const _wba = await verifyWebBotAuth({
        headers: (_req?.headers ?? {}) as Record<string, string | string[] | undefined>,
        method: (_req?.method as string) || 'POST',
        path: (((_req?.url as string) || '/mcp').split('?')[0]) || '/mcp',
      });
      _audCtx.wbaVerified = _wba.ok;
      _audCtx.wbaReason = _wba.reason;
      _audCtx.wbaAgent = _wba.signatureAgent;
      if (_wba.ok) {
        teachLog.info('[GW] Web Bot Auth signature verified', { keyid: _wba.keyid, agent: _wba.signatureAgent });
      } else {
        teachLog.warn(`[GW] Web Bot Auth ${config.wbaMode === 'enforce' ? 'DENY' : 'monitor'}: ${_wba.reason} (tool: ${toolName})`);
        if (config.wbaMode === 'enforce') {
          setAuditHeader(res);
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'HTTP-Message-Signatures realm="PingOne", error="invalid_signature"',
          });
          res.end(JSON.stringify({
            error: 'invalid_web_bot_auth',
            message: _wba.reason || 'a valid Web Bot Auth signature (RFC 9421, tag=web-bot-auth) is required',
            login_required: false,
          }));
          return;
        }
      }
    }

    // ── Step 2e: RAR intent-subset enforcement (RFC 9396) ────────────────────────
    // Enforce that the actual tool-call params are a subset of the granted
    // authorization_details (action match, amount <= granted, payee match). Hard only
    // when REQUIRE_RAR_INTENT=true; fail-closed if intent is required but none declared.
    if (config.requireRarIntent === true) {
      // An empty authorization_details ([]) is MISSING intent, not present intent:
      // it carries no amount/payee to constrain, so treating it as present would let
      // a caller-supplied `authorization_details: []` skip the subset checks entirely.
      // Fail closed exactly as for an absent envelope.
      if (!_rarDetails || _rarDetails.length === 0) {
        _audCtx.rar = 'required-missing';
        setAuditHeader(res);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rar_intent_required', message: 'authorization_details required (RFC 9396)' }));
        return;
      }
      const _r = enforceRarSubset(toolName ?? '', toolArgs as RarToolArgs, _rarDetails);
      if (!_r.ok) {
        _audCtx.rar = `violation: ${_r.reason}`;
        teachLog.warn(`[GW] RAR intent violation: ${_r.reason} (tool: ${toolName})`);
        setAuditHeader(res);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rar_intent_violation', message: _r.reason }));
        return;
      }
      _audCtx.rar = 'enforced';
    } else if (_rarDetails) {
      _audCtx.rar = 'observed';
    }

    // ── Step 2f: Per-tool scope backstop (Rule 3 parity) ──────────────────────────
    // Runs REGARDLESS of P1AZ state. Real P1AZ cannot express per-tool set-membership
    // over TokenScopes (snapshots/gen-authorize-snapshot.js:36-39); this is the
    // gateway's own enforcement of that rule, mirroring decision.js Rule 3. Shaped
    // as an AuthzDecision (not a hand-rolled response) so it flows through the SAME
    // C2 provenance-aware rendering (policy_source, degraded, required_scopes) as
    // every other DENY — a raw short-circuit here would silently drop that contract.
    let _localBackstopDenial: AuthzDecision | undefined;
    if (method === 'tools/call' && toolName) {
      const _scopeBackstop = evaluateScopeDecisionUnconditionally(
        toolName, decoded.scope, actChainDepth(decoded.act),
      );
      if (_scopeBackstop.decision === 'DENY') {
        teachLog.warn(`[GW] scope backstop DENY: ${_scopeBackstop.reason} (tool: ${toolName})`);
        _localBackstopDenial = {
          decision: 'DENY',
          reason: `local-fallback: ${_scopeBackstop.reason}`,
          engine: 'mock',
          policySource: 'local-fallback',
          degraded: true,
        };
      } else {
        // ── Tier (groupToTier) local deny — mirrors decision.js Rule 3d ───────────
        // BFF pre-resolves group->tier (neither gateway can do set-membership over a
        // PingOne group array) and forwards the resolved definition as headers.
        // Absent headers = PERMIT (no-op) — this never widens what the token's own
        // scopes already earned, only narrows it further when tier data IS present.
        const _tierMaxAmount = _hdr('x-tier-max-amount-usd');
        const _tierRestricted = parseRestrictedTools(_hdr('x-tier-restricted-tools'));
        const _tierDecision = evaluateTierDecision(
          toolName,
          getScopesForGatewayTool(toolName).includes('write'),
          toolArgs?.amount !== undefined ? Number(toolArgs.amount) : undefined,
          _tierMaxAmount !== undefined ? Number(_tierMaxAmount) : undefined,
          _tierRestricted,
        );
        if (_tierDecision.decision === 'DENY') {
          teachLog.warn(`[GW] tier backstop DENY: ${_tierDecision.reason} (tool: ${toolName})`);
          _localBackstopDenial = {
            decision: 'DENY',
            reason: `local-fallback: ${_tierDecision.reason}`,
            engine: 'mock',
            policySource: 'local-fallback',
            degraded: true,
          };
        }
      }
    }

    // ── Step 3: PingOne Authorize evaluation (D-06) ───────────────────────────────
    // Typed explicitly: inferring from the first assignment dropped `obligation`
    // (only the fail-closed literal below was in the union), so the statement-based
    // gate could not be read here.
    let authzDecision: AuthzDecision | undefined;
    // toolArgsForAuthz: for confirmed elicitation re-calls, re-add _elicitation_confirmed
    // so the PDP call sees it (the field was stripped from toolArgs earlier so it
    // does not reach the backend). Mirrors index.ts (WS path).
    const toolArgsForAuthz: Record<string, unknown> | undefined = elicitationConfirmed
      ? { ...(toolArgs as Record<string, unknown> | undefined), _elicitation_confirmed: true }
      : toolArgs;
    try {
      if (_localBackstopDenial) {
        // Already decided above — do not consult the PDP for a call the backstop
        // already denied (nothing to gain, and it would waste a real PDP round-trip).
        authzDecision = _localBackstopDenial;
      } else if (deps) {
        authzDecision = await deps.authorize(
          decoded,
          method,
          toolName,
          toolArgsForAuthz,
          hitlApproved,
          intentValidation,
          hitlChallengeId,
        );
      } else {
        // Read active vertical from BFF server-to-server header (parity with WS path)
        const _activeVertical = _hdr('x-active-vertical');
        authzDecision = await authorizeClient.evaluate(
          decoded,
          method,
          toolName,
          toolArgsForAuthz as any,
          hitlApproved,
          intentValidation,
          _tratClaims,
          config.introspectionProvider === 'p1az' ? introspectionResult : undefined,
          hitlChallengeId,
          _activeVertical,
        );
      }
    } catch {
      // C2: a DENY the gateway manufactured because the evaluation never
      // completed still has an author. Label it with the authority that WAS
      // meant to decide — matching PingOneAuthorizeClient's own unreachable-PDP
      // DENY — and fall back to 'local-fallback' + degraded when no PDP is
      // configured at all, because then the gateway really did decide alone.
      authzDecision = isP1AZActive(config)
        ? {
            decision: 'DENY' as const,
            reason: 'Authorization service unavailable',
            policySource: policySourceForEngine(usingRealPdpEndpoint(config) ? 'real' : 'mock'),
          }
        : {
            decision: 'DENY' as const,
            reason: 'Authorization service unavailable',
            policySource: 'local-fallback' as const,
            degraded: true,
          };
    }
    auditTrail.authorize = {
      decision: authzDecision.decision,
      reason: authzDecision.reason,
      decisionId: authzDecision.decisionId,
      policyVersion: authzDecision.policyVersion,
      traceId: authzDecision.traceId,
      engine: authzDecision.engine,
      // C2 — recorded for EVERY outcome, PERMIT included.
      policySource: authzDecision.policySource,
      degraded: authzDecision.degraded,
      attributes: authzDecision.sentParameters,
    };

    // A DENY caused by the authz server failing to look up the user in
    // PingOne (worker credentials misconfigured, or PingOne unreachable) is
    // an infrastructure fault, not a policy decision — the reason string is
    // set consistently ('user_lookup_failed: ...') at every such call site
    // in the mock authz server's decision.js. Surface it distinctly instead
    // of a generic 403 policy denial.
    if (authzDecision.decision === 'DENY' && /^user_lookup_failed:/.test(authzDecision.reason || '')) {
      setAuditHeader(res, { denyingFilter: 'P1AZDecision' });
      teachLog.warn('gateway audit trail — user lookup unavailable', { gw_audit_trail: auditTrail });
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'gateway_misconfigured',
        message: 'The security gateway could not verify the user identity (PingOne lookup unavailable). This is a gateway configuration/connectivity issue, not a policy denial.',
      }));
      return;
    }

    if (authzDecision.decision !== 'PERMIT') {
      setAuditHeader(res, { denyingFilter: 'P1AZDecision' });
      teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
      // F8 — `required_scopes` is derived from the LOCAL scope topology, so it
      // only describes the decision when the local scope engine IS what decided.
      // Both non-PERMIT branches below render it, so the gate is computed once
      // here rather than only on the insufficient_scope branch.
      const deniedLocally = authzDecision.policySource === 'local-fallback';
      // An INDETERMINATE is not a refusal — the PDP is asking for a human. It
      // answers 428 Precondition Required (the precondition being an approved
      // consent receipt) so callers can branch on the status alone; a real DENY
      // stays 403.
      //
      // `!hitlApproved` matters: an INDETERMINATE that survives an already-verified
      // receipt is the anti-loop case below (policy misconfiguration), which is
      // terminal — answering 428 there would invite the agent to retry forever.
      // MCP Authorization spec §4.3 — the required scopes for this tool are
      // always published in WWW-Authenticate regardless of WHY the PDP denied
      // (scope gap, tier ceiling, group membership). The `scope=` parameter
      // describes what the resource requires, not the denial reason. The body's
      // `required_scopes` field is separately guarded by `deniedLocally` because
      // that field IS a diagnosis (F8 reasoning below).
      const toolRequiredScopesForHeader = getScopesForGatewayTool(toolName ?? '').join(' ');

      // Step-up is a different precondition from consent: MFA, not a human. It
      // gets its own code so the agent drives the right flow, and no HITL
      // challenge is minted (a receipt cannot satisfy MFA). Parity with
      // PingGateway's p1az-decision.groovy.
      // RFC 6750 §3.1 + MCP Authorization spec §4.3: 403 with
      // error="insufficient_scope" and scope= so the MCP client can trigger
      // step-up re-authentication to obtain the required permissions.
      if (authzDecision.obligation === 'stepUp' && !hitlApproved) {
        res.writeHead(403, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer realm="PingOne", error="insufficient_scope", scope="${toolRequiredScopesForHeader}", resource_metadata="${selfBaseUrl(_req, config.port)}/.well-known/oauth-protected-resource"`,
        });
        res.end(JSON.stringify({
          error: 'step_up_required',
          message: 'Step-up authentication required',
          decision: authzDecision.decision,
          tool: toolName ?? '',
          policy_source: authzDecision.policySource,
          ...(authzDecision.degraded ? { degraded: true } : {}),
          login_required: false,
        }));
        return;
      }

      // Elicitation obligation: P1AZ requires agent confirmation before proceeding.
      // Branch on obligation (NOT reason) — reason is 'HITL_REQUIRED' for ALL
      // non-stepUp obligations, so branching on reason would misclassify this as
      // a HITL consent challenge. HTTP-transport counterpart of index.ts's WS
      // handler; mints into the same shared store (src/elicitationStore.ts).
      if (authzDecision.obligation === 'elicitation') {
        const sessionId = _hdr('mcp-session-id') ?? '';
        const prompt = authzDecision.advice?.find(
          (a: { id: string }) => a.id === 'elicitation-prompt',
        )?.value ?? `Confirm ${toolName}?`;
        const rec = createPendingElicitation(toolName ?? '', sessionId, prompt);
        // MCP spec 2026-07-28 MRTR: a Modern caller gets the server-initiated
        // input request embedded in an InputRequiredResult instead of the
        // Legacy elicitation_required error — MRTR replaced server-initiated
        // requests over an open connection entirely. requestState carries
        // the same elicitation_id the Legacy path uses; requestedSchema is
        // empty because the meaningful signal is the accept/decline action
        // itself, not any collected data (this is a confirm, not a form).
        if (extractRequestedProtocolVersion(parsedBody.params) !== undefined) {
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: parsedBody.id ?? null,
            result: {
              resultType: 'input_required',
              inputRequests: {
                elicitation: {
                  method: 'elicitation/create',
                  params: { mode: 'form', message: prompt, requestedSchema: { type: 'object', properties: {} } },
                },
              },
              requestState: rec.elicitation_id,
            },
          }));
          return;
        }
        // Legacy (2025-11-25 and earlier): unchanged.
        res.end(JSON.stringify({
          error: 'elicitation_required',
          message: prompt,
          elicitation_id: rec.elicitation_id,
          prompt,
          tool_name: toolName ?? '',
          expires_in: 120,
          policy_source: authzDecision.policySource,
          ...(authzDecision.degraded ? { degraded: true } : {}),
        }));
        return;
      }

      if (authzDecision.decision === 'INDETERMINATE') {
        // HITL obligation — consent from a human, not a scope gap. 428 status
        // signals "precondition required" (the precondition being an approved
        // consent receipt). WWW-Authenticate carries realm + resource_metadata
        // but NOT error="insufficient_scope" — the client cannot resolve this
        // by requesting additional scopes.
        // Anti-loop: a verified-approved receipt that still yields INDETERMINATE
        // means misconfigured policy — fail distinctly instead of re-issuing.
        if (hitlApproved) {
          res.writeHead(403, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer realm="PingOne", resource_metadata="${selfBaseUrl(_req, config.port)}/.well-known/oauth-protected-resource"`,
          });
          res.end(JSON.stringify({
            error: 'hitl_receipt_rejected',
            message: 'HITL receipt accepted but policy still requires approval',
            hitl: true,
            challengeId: hitlChallengeId ?? null,
            tool: toolName ?? '',
            login_required: false,
          }));
          return;
        }
        // Create a challenge in the HITL service and return the challengeId so the
        // agent UI shows the consent modal, then retries with _hitl_challenge_id.
        const challengeType = getChallengeTypeForTool(toolName ?? '');
        let challengeId: string | null = null;
        let expiresAt: string | undefined;
        if (config.hitlServiceUrl) {
          try {
            const challenge = await createHitlChallenge(config.hitlServiceUrl, {
              tool: toolName ?? '',
              userId: decoded.sub,
              agentId: decoded.act?.sub,
              context: { ...(toolArgs as Record<string, unknown>) },
            });
            challengeId = challenge.challengeId;
            expiresAt = challenge.expiresAt;
          } catch (hitlErr) {
            teachLog.error('[GW] HTTP path failed to create HITL challenge', hitlErr);
          }
        }
        res.writeHead(428, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer realm="PingOne", resource_metadata="${selfBaseUrl(_req, config.port)}/.well-known/oauth-protected-resource"`,
        });
        res.end(JSON.stringify({
          error: 'hitl_required',
          message: 'Human approval required',
          decision: authzDecision.decision,
          hitl: true,
          tool: toolName ?? '',
          challengeId,
          challenge_type: challengeType,
          expiresAt,
          instructions: 'Approve at dashboard, then retry with _hitl_challenge_id in arguments',
          // C2 — an obligation is a decision; it carries provenance like any other.
          policy_source: authzDecision.policySource,
          ...(authzDecision.degraded ? { degraded: true } : {}),
          // F8, same reasoning as the denial branch below: what a PDP-issued HITL
          // hold needs is a human, not more scopes. Listing scopes here told the
          // operator to re-authenticate for permissions that were never missing.
          ...(deniedLocally ? { required_scopes: getScopesForGatewayTool(toolName ?? '') } : {}),
          login_required: false,
        }));
        return;
      }

      // Generic DENY — RFC 6750 §3.1 + MCP Authorization spec §4.3:
      // 403 with error="insufficient_scope" and scope= so MCP clients can
      // trigger step-up re-authentication to obtain the missing permissions.
      // F8 — `required_scopes` in the body is still guarded by `deniedLocally`
      // because that field is a DIAGNOSIS (scope gap vs policy decision). The
      // header's scope= is informational about what the resource requires and
      // is always correct regardless of the denial reason.
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="PingOne", error="insufficient_scope", scope="${toolRequiredScopesForHeader}", resource_metadata="${selfBaseUrl(_req, config.port)}/.well-known/oauth-protected-resource"`,
      });
      res.end(JSON.stringify({
        error: 'insufficient_scope',
        message: authzDecision.reason ?? 'Request denied by policy',
        decision: authzDecision.decision,
        // C2 — provenance travels with every decision the caller can see.
        policy_source: authzDecision.policySource,
        ...(authzDecision.degraded ? { degraded: true } : {}),
        ...(deniedLocally ? { required_scopes: getScopesForGatewayTool(toolName ?? '') } : {}),
        login_required: false,
      }));
      return;
    }

    // ── Step 3.5: Phase 266/267 disposition dispatch (BL-02 transport parity) ──────
    // tools/call for an api_key-disposition tool bypasses upstream forwarding —
    // the gateway calls the api-key backend directly (Phase 267: show_mortgage →
    // banking_api_resource_server). The WS handler (index.ts) has always done this;
    // the HTTP path used to skip it and raw-proxy to OLB, producing "Unknown tool".
    // Shared logic lives in apiKeyDispatch (one source, both transports).
    // dual_token (Path B) and bankingdata (Path C) are HTTP-parity via their
    // shared dispatch modules (were WS-only before).
    if (method === 'tools/call' && toolName && routeTool(toolName) === 'apikey') {
      const rpcId = parsedBody.id ?? null;
      const outcome = await buildApiKeyToolResult(toolName, decoded.sub, undefined, config);
      setAuditHeader(res);
      teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (outcome.ok) {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpcId, result: outcome.result }));
      } else {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          error: { code: outcome.code, message: outcome.message, data: outcome.data },
        }));
      }
      return;
    }
    if (method === 'tools/call' && toolName && routeTool(toolName) === 'dualtoken') {
      const rpcId = parsedBody.id ?? null;
      const outcome = await buildDualTokenToolResult(toolName, bearerToken, decoded.sub, config);
      setAuditHeader(res);
      teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (outcome.ok) {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpcId, result: outcome.result }));
      } else {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          error: { code: outcome.code, message: outcome.message, data: outcome.data },
        }));
      }
      return;
    }
    if (method === 'tools/call' && toolName && routeTool(toolName) === 'bankingdata') {
      const rpcId = parsedBody.id ?? null;
      const outcome = await buildBankingDataToolResult(toolName, bearerToken, config);
      setAuditHeader(res);
      teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (outcome.ok) {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpcId, result: outcome.result }));
      } else {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          error: { code: outcome.code, message: outcome.message, data: outcome.data },
        }));
      }
      return;
    }

    // ── Step 3.6: weather/brave showcase — mirrors ping-gateway's
    // tx-weather-scope.groovy / tx-brave-scope.groovy ScriptableFilters, which
    // run just before ReverseProxyHandler with NO RFC 8693 exchange (rsFilter
    // only admits; the original bearer token reaches the backend unchanged).
    // Same posture here: skip Step 4's exchange entirely for these two targets
    // and forward the original bearerToken once the scope check permits.
    if (method === 'tools/call' && toolName && (routeTool(toolName) === 'weather' || routeTool(toolName) === 'brave')) {
      const rpcId = parsedBody.id ?? null;
      const scopeCheck = routeTool(toolName) === 'weather'
        ? await checkWeatherScope(toolArgs, config.bffWeatherFlagUrl, config.bffInternalSecret)
        : await checkBraveScope(toolArgs, config.bffBraveFlagUrl, config.bffInternalSecret);
      if (scopeCheck.denied) {
        sendRpcError(403, rpcId, { code: -32000, message: scopeCheck.message || 'Forbidden' });
        return;
      }
      setAuditHeader(res);
      teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
      await forward(bearerToken, outBody);
      return;
    }

    // ── Step 4: RFC 8693 exchange, then forward (spec §4) ──────────────────────────
    // doExchange()/routeTool() route per-tool to the olb, invest, or jwtverifier
    // audience (see demo_mcp_gateway/src/router.ts and PR #654/#674) — this HTTP
    // transport reaches all three backends, not just olb. Fail closed: on
    // exchange failure nothing is forwarded.
    // WR-03: outBody has `_hitl_challenge_id` stripped (or === body if absent).
    auditTrail.mtls = config.mtlsEnabled
      ? { enabled: true, subject: 'banking-mcp-gateway' }
      : { enabled: false };
    setAuditHeader(res);
    teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
    let upstreamToken: string;
    try {
      const ex = await doExchange(bearerToken, toolName);
      upstreamToken = ex.token;
      auditTrail.backend = { target: routeTool(toolName || ''), audience: ex.targetAud, cached: ex.cached, exchanged: true };
      setAuditHeader(res);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const axiosData = (err as any)?.response?.data;
      const detail = axiosData?.error_description || axiosData?.error || errMsg;
      teachLog.error('[GW] HTTP token exchange failed', err instanceof Error ? err : undefined, { tool: toolName });
      auditTrail.backend = { target: routeTool(toolName || ''), audience: null, exchanged: false, error: detail };
      sendRpcError(502, parsedBody.id, {
        code: -32500,
        message: `Token exchange failed: ${detail}`,
        data: { error: 'token_exchange_failed', detail },
      });
      return;
    }
    await forward(upstreamToken, outBody);
  };
}
