'use strict';

/**
 * authorizeMcpRequest — the gateway's McpRequestMiddleware pipeline (D-05, D-06).
 *
 * Composes GatewayTokenPolicy + PingOneAuthorizeClient into the McpRequestMiddleware
 * hook that GatewayServer accepts.
 *
 * Pipeline per request:
 *   1. GatewayTokenPolicy.validate(decoded)             — claim invariants (sub, act, anti-bypass)
 *   2. PingOneAuthorizeClient.evaluate(...)             — PingOne Authorize policy decision (D-06)
 *   3. McpTokenExchangeClient.exchange(...)             — RFC 8693 exchange to the upstream audience (D-03/D-05)
 *   4. forward(upstreamToken, body)                     — proxy to upstream MCP server with the exchanged token
 *
 * Failure modes:
 *   - Policy violation (claim validation)  → 401 via sendUnauthorized (handled upstream)
 *   - Authorize DENY or unavailable        → 403 Forbidden
 *   - Token exchange failure               → 502 fail-closed (nothing forwarded)
 *
 * The inbound TX token (aud: gateway) is never forwarded upstream. After PingOne
 * Authorize permits the request, the gateway performs an RFC 8693 token exchange
 * to mint a next-hop token scoped to the correct upstream MCP-server audience
 * (olb or invest, per D-05), and forwards that exchanged token instead.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { PingOneAuthorizeClient } from '../auth/PingOneAuthorizeClient';
import { GatewayIntrospectionClient } from '../auth/GatewayIntrospectionClient';
import { runMcpAuthorizationPipeline } from '../auth/authorizeMcpRequestCore';
import type { McpRequestMiddleware } from '../server/GatewayServer';
import { McpTokenExchangeClient } from '../auth/McpTokenExchangeClient';
import type { GatewayConfig } from '../config';
import { checkInternalSecret } from '../config';
import { getScopesForGatewayTool, getChallengeTypeForTool } from '../auth/toolScopes';
import { teachLog } from '../teachLogger';
import { routeTool } from '../router';
import { selfBaseUrl } from '../selfBaseUrl';
import { buildApiKeyToolResult } from '../apiKeyDispatch';
import { validateIntentToken } from '../intentTokenValidator';
import { validateMethodAndShape, validateToolArgs } from '../validation/mcpRequestValidation';
import { createHitlChallenge, getHitlChallengeStatus, verifyHitlReceipt, ReceiptVerification } from '../hitlClient';
import { recordGatewayAudit, auditOutcomeFromHttp, httpScopeAlertDetails } from '../gatewayAudit';
import { verifyDpopProof } from '../dpopVerify';
import { enforceRarSubset, rarDetailsFromEnvelope, type RarDetail, type RarToolArgs } from '../rarEnforce';
import type { TratClaims } from '../auth/PingOneAuthorizeClient';
import { SlidingWindowLimiter, _resetLimiterForTest as _resetRateLimiterForTest } from '../rateLimit';

// ---------------------------------------------------------------------------
// Body parsing helper — extract method and tool name from JSON-RPC body
// ---------------------------------------------------------------------------

interface JsonRpcBody {
  method?: string;
  id?: unknown;
    params?: {
      name?: string;
      arguments?: Record<string, unknown>;
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
    attributes?: Record<string, string>;
  } | null;
  mtls: { enabled: boolean; subject?: string } | null;
}

/**
 * Injectable dependencies for `buildAuthorizeMcpRequest`.
 * When provided (e.g. in tests), the production introspection + authorize
 * pipeline is bypassed and these functions are used instead.
 */
export interface AuthorizeMcpRequestDeps {
  introspect: (token: string) => Promise<{ active: boolean; sub?: string; exp?: number }>;
  authorize: (decoded: any, method: string, toolName?: string, toolArgs?: any, hitlApproved?: boolean, intentValidation?: ReturnType<typeof validateIntentToken> | null) =>
    Promise<{
      decision: 'PERMIT' | 'DENY' | 'INDETERMINATE';
      reason?: string;
      decisionId?: string;
      policyVersion?: string;
      traceId?: string;
      engine?: 'real' | 'mock' | 'mock-failover';
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
function getRateLimiter(config: { rateLimitMaxRequests: number; rateLimitWindowMs: number }): SlidingWindowLimiter {
  if (!_rateLimiter) {
    _rateLimiter = new SlidingWindowLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests);
  }
  return _rateLimiter;
}

/** Reset the rate-limiter singleton. Delegates to _resetLimiterForTest in rateLimit.ts. */
export function resetRateLimiterForTest(): void {
  _rateLimiter = null;
  _resetRateLimiterForTest();
}

export function buildAuthorizeMcpRequest(
  config: GatewayConfig,
  deps?: AuthorizeMcpRequestDeps,
): McpRequestMiddleware {
  const introspectionClient = new GatewayIntrospectionClient(config);
  const authorizeClient = new PingOneAuthorizeClient(config);
  const exchangeClient = new McpTokenExchangeClient(config);
  const doExchange = deps?.exchange ?? ((t: string, n?: string) => exchangeClient.exchange(t, n));

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
    };
    // Store introspection result to pass to P1AZ when introspectionProvider is 'p1az'
    let introspectionResult: { active: boolean; sub?: string; exp?: number; scope?: string; aud?: string } | undefined;

    // Helper: set the audit trail header on any response path
    const setAuditHeader = (r: ServerResponse) => {
      try {
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
        setAuditHeader(res);
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
      decoded = { sub: introspResult.sub };
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
      const pipelineResult = await runMcpAuthorizationPipeline(bearerToken, introspectionClient, config);
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

      if (pipelineResult.kind === 'introspection_failed') {
        setAuditHeader(res);
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
        setAuditHeader(res);
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

    // ── Step 2a: HITL receipt verification (transport parity with the WS path) ──
    // If the agent is retrying with a `_hitl_challenge_id`, verify the challenge is
    // approved AND bound to THIS caller/agent/tool before treating it as approved.
    // Mirrors index.ts (WS) so the HTTP agent path gets the same human-approval flow.
    let hitlApproved = false;
    if (hitlChallengeId && config.hitlServiceUrl) {
      let verification: ReceiptVerification | null = null;
      try {
        const status = await getHitlChallengeStatus(config.hitlServiceUrl, hitlChallengeId);
        verification = verifyHitlReceipt(status, decoded.sub, decoded.act?.sub, toolName ?? '');
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

    // ── Step 2b: Intent token validation ─────────────────────────────────────
    const xIntentToken = _req?.headers?.['x-intent-token'] as string | undefined;
    const intentValidation = xIntentToken
      ? validateIntentToken(xIntentToken, toolName ?? '')
      : null;
    if (!xIntentToken) {
      console.log(`[GW] Intent Token: absent — tool: ${toolName}`);
    } else if (intentValidation && !intentValidation.valid) {
      console.warn(`[GW] Intent Token: INVALID (${intentValidation.error}) — tool: ${toolName}`);
    } else if (intentValidation?.valid) {
      const permitted = intentValidation.toolPermitted ? '✅ permitted' : '⚠️ not in permitted_tools';
      console.log(`[GW] Intent Token: valid=true intent=${intentValidation.payload?.intent} confidence=${intentValidation.payload?.confidence} ${permitted} tool=${toolName}`);
    }

    // ── Step 2c: bridge actor identity from BFF headers (HTTP parity with the WS path) ──
    // PingOne can't emit `act`/`may_act` on exchanged tokens (resource SpEL can't reference
    // the actor token), so the BFF bridges them via trusted server-to-server headers. The WS
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
    if (decoded && !decoded.act?.sub && bffActClientId) {
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
    let _cnfJkt: string | undefined;
    let _rarDetails: RarDetail[] | undefined;
    let _tratClaims: TratClaims | null = null;
    try {
      const xt = _hdr('x-trat-context');
      if (xt) {
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
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'DPoP' });
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
        console.warn(`[GW] DPoP proof verification failed: ${_v.reason} (tool: ${toolName})`);
        if (_requireDpop) {
          setAuditHeader(res);
          res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'DPoP' });
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

    // ── Step 2e: RAR intent-subset enforcement (RFC 9396) ────────────────────────
    // Enforce that the actual tool-call params are a subset of the granted
    // authorization_details (action match, amount <= granted, payee match). Hard only
    // when REQUIRE_RAR_INTENT=true; fail-closed if intent is required but none declared.
    if (process.env.REQUIRE_RAR_INTENT === 'true') {
      if (!_rarDetails) {
        _audCtx.rar = 'required-missing';
        setAuditHeader(res);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rar_intent_required', message: 'authorization_details required (RFC 9396)' }));
        return;
      }
      const _r = enforceRarSubset(toolName ?? '', toolArgs as RarToolArgs, _rarDetails);
      if (!_r.ok) {
        _audCtx.rar = `violation: ${_r.reason}`;
        console.warn(`[GW] RAR intent violation: ${_r.reason} (tool: ${toolName})`);
        setAuditHeader(res);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rar_intent_violation', message: _r.reason }));
        return;
      }
      _audCtx.rar = 'enforced';
    } else if (_rarDetails) {
      _audCtx.rar = 'observed';
    }

    // ── Step 3: PingOne Authorize evaluation (D-06) ───────────────────────────────
    let authzDecision;
    try {
      if (deps) {
        authzDecision = await deps.authorize(decoded, method, toolName, toolArgs, hitlApproved, intentValidation);
      } else {
        authzDecision = await authorizeClient.evaluate(
          decoded,
          method,
          toolName,
          toolArgs as any,
          hitlApproved,
          intentValidation,
          _tratClaims,
          config.introspectionProvider === 'p1az' ? introspectionResult : undefined,
        );
      }
    } catch {
      authzDecision = { decision: 'DENY' as const, reason: 'Authorization service unavailable' };
    }
    auditTrail.authorize = {
      decision: authzDecision.decision,
      reason: authzDecision.reason,
      decisionId: authzDecision.decisionId,
      policyVersion: authzDecision.policyVersion,
      traceId: authzDecision.traceId,
      engine: authzDecision.engine,
      attributes: authzDecision.sentParameters,
    };

    if (authzDecision.decision !== 'PERMIT') {
      setAuditHeader(res);
      teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="PingOne", resource_metadata="${selfBaseUrl(_req, config.port)}/.well-known/oauth-protected-resource"`,
      });

      if (authzDecision.decision === 'INDETERMINATE') {
        // HITL obligation. Anti-loop: a verified-approved receipt that still
        // yields INDETERMINATE means a misconfigured policy — fail distinctly
        // instead of re-issuing a challenge (mirrors index.ts WS path).
        if (hitlApproved) {
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
            console.error('[GW] HTTP path failed to create HITL challenge:', hitlErr);
          }
        }
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
          required_scopes: getScopesForGatewayTool(toolName ?? ''),
          login_required: false,
        }));
        return;
      }

      res.end(JSON.stringify({
        error: 'insufficient_scope',
        message: authzDecision.reason ?? 'Request denied by policy',
        decision: authzDecision.decision,
        required_scopes: getScopesForGatewayTool(toolName ?? ''),
        login_required: false,
      }));
      return;
    }

    // ── Step 3.5: Phase 266/267 disposition dispatch (BL-02 transport parity) ──────
    // tools/call for an api_key-disposition tool bypasses upstream forwarding —
    // the gateway calls the api-key backend directly (Phase 267: show_mortgage →
    // banking_mortgage_service). The WS handler (index.ts) has always done this;
    // the HTTP path used to skip it and raw-proxy to OLB, producing "Unknown tool".
    // Shared logic lives in apiKeyDispatch (one source, both transports).
    // dualtoken/bankingdata remain WS-only for now — see REGRESSION_PLAN §4.
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

    // ── Step 4: RFC 8693 exchange, then forward (spec §4) ──────────────────────────
    // The HTTP upstream is the OLB server (GatewayServer.upstreamMcpUrl), so the
    // exchange targets the olb audience via routeTool. Fail closed: on exchange
    // failure nothing is forwarded.
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
    } catch (err) {
      teachLog.error('[GW] HTTP token exchange failed', err instanceof Error ? err : undefined, { tool: toolName });
      sendRpcError(502, parsedBody.id, {
        code: -32500,
        message: 'Token exchange failed',
        data: { error: 'token_exchange_failed' },
      });
      return;
    }
    await forward(upstreamToken, outBody);
  };
}
