'use strict';

/**
 * banking-mcp-gateway — entry point
 *
 * Accepts JSON-RPC over WebSocket from agent1 (token aud: MCP_GW_RESOURCE_URI).
 * Forwards original TX token per target MCP server and proxies requests.
 *
 * HTTP surfaces (same port):
 *   GET  /.well-known/oauth-protected-resource  — RFC 9728 metadata for the gateway
 *   GET  /health                                — liveness probe
 *
 * Start: MCP_GW_CLIENT_ID=... MCP_GW_CLIENT_SECRET=... node dist/index.js
 */

import dotenv from 'dotenv';
dotenv.config();

import { readFileSync, existsSync } from 'node:fs';
import * as crypto from 'node:crypto';
import WebSocket from 'ws';
import { loadConfig, GatewayConfig, assertProductionSecrets, checkInternalSecret } from './config';
import { validateInboundToken, extractBearerToken, TokenValidationError } from './tokenValidator';
import { validateIntentToken } from './intentTokenValidator';
import { routeTool, backendWsUrl, backendHttpMcpUrl } from './router';
import { buildApiKeyToolResult } from './apiKeyDispatch';
import { buildDualTokenToolResult } from './dualTokenDispatch';
import { buildBankingDataToolResult } from './bankingDataDispatch';
import { McpTokenExchangeClient } from './auth/McpTokenExchangeClient';
import { proxyJsonRpc, proxyJsonRpcHttp, JsonRpcRequest, JsonRpcResponse, MCP_PROTOCOL_VERSION } from './proxy';
import { guardToolsList, guardToolCall, warmupAuthz } from './pingAuthorizeGuard';
import { classifyWsDeny } from './wsDenyClassifier';
import { createHitlChallenge, getHitlChallengeStatus, verifyHitlReceipt, ReceiptVerification } from './hitlClient';
import { GatewayServer } from './server/GatewayServer';
import { buildAuthorizeMcpRequest, getRateLimiter } from './middleware/authorizeMcpRequest';
import { getScopesForGatewayTool, getChallengeTypeForTool } from './auth/toolScopes';
import { createPendingElicitation, consumePendingElicitation } from './elicitationStore';
import { buildDiscoverResult, SUPPORTED_PROTOCOL_VERSIONS } from './serverDiscover';
import { extractRequestedProtocolVersion, buildUnsupportedProtocolVersionError } from './modernNegotiation';
import { GatewayIntrospectionClient } from './auth/GatewayIntrospectionClient';
import { runMcpAuthorizationPipeline } from './auth/authorizeMcpRequestCore';
import { wsTransportBindingGuard } from './wsBindingGuard';
import { noteBindingHeaderSeen } from './authzPosture';
import { loadVaultIntoEnv } from './vault';
import { extractCorrelationId } from './correlationId';
import { runWithCorrelation } from './correlationContext';
import { generateGatewayCerts, GatewayCerts } from './mtls';
import type { MtlsOptions } from './proxy';
import { recordGatewayAudit, auditOutcomeFromResponse, scopeAlertDetails } from './gatewayAudit';
import { GATEWAY_TOOLS } from './gatewayTools';
import { recordToolsListBackendOutage, clearToolsListBackendOutage } from './toolsListHealth';
import { validateMethodAndShape, validateToolArgs } from './validation/mcpRequestValidation';
import { isValidLogLevel, emitLogMessage, LoggingState } from './mcpLogging';

// Phase 269 Plan 04: load encrypted vault entries into process.env BEFORE
// loadConfig() runs. The vault populates MCP_GW_*, PROVIDER_*, HELIX_*, and
// BFF_INTERNAL_* env vars; loadConfig() then reads process.env as usual —
// zero new code paths in config.ts. Skips silently when no secrets.vault
// exists; fails fast if a vault is present but VAULT_PASSWORD is missing.
//
// Because vault load is async and the rest of the module's top-level code
// (loadConfig, assertProductionSecrets, GatewayServer construction, .listen)
// is synchronous, we wrap the entire module body in a single async IIFE.
// The diff is the import line above + the IIFE opener here + the IIFE
// closer at the bottom of the file. All existing logic is byte-for-byte
// preserved inside.
let config: GatewayConfig;
(async () => {
try {
  const vaultResult = await loadVaultIntoEnv();
  if (vaultResult.loaded) {
    console.log('[GW vault] loaded ' + vaultResult.entries + ' entries into process.env');
  }
} catch (err) {
  console.error(
    '[GW vault] startup load failed; refusing to start.',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}

try {
  config = loadConfig();
} catch (err) {
  console.error('[GW] Configuration error:', err instanceof Error ? err.message : err);
  process.exit(1);
}

// BL-03: refuse the committed dev fallback secret in production.
assertProductionSecrets(config);

// Spec §4 (WR-02): shared RFC 8693 exchange client for the WS proxy path
// (olb/invest tools/call + tools/list) — replaces raw token passthrough.
const mcpExchangeClient = new McpTokenExchangeClient(config);

let gatewayCerts: GatewayCerts | null = null;
if (config.mtlsEnabled) {
  gatewayCerts = await generateGatewayCerts({ writeCertTo: config.mtlsCertPath });
  console.log(`[GW] mTLS enabled — client cert written to ${config.mtlsCertPath}`);
} else {
  console.log('[GW] mTLS disabled (set MCP_MTLS_ENABLED=true to enforce)');
}
// The client half of #906 for THIS gateway: mcp-server with MCP_MTLS_ENABLED=true
// serves :8080 over TLS and pins ONE client cert (certs/gw-mtls/gw-client.crt,
// generated by scripts/ensure-gateway-mtls-certs.sh; PingGateway presents the
// same pair via its p12). Load that shared PEM pair so the WS proxy and the
// HTTP forwardToUpstream hop present it too — without it every olb-routed
// tools/call (all A2A sensitive_* tools) dies as ECONNRESET/403 → 502.
const upstreamClientCertPath = process.env.MCP_GW_UPSTREAM_CLIENT_CERT_PATH;
const upstreamClientKeyPath = process.env.MCP_GW_UPSTREAM_CLIENT_KEY_PATH;
if (!gatewayCerts && upstreamClientCertPath && upstreamClientKeyPath) {
  if (existsSync(upstreamClientCertPath) && existsSync(upstreamClientKeyPath)) {
    gatewayCerts = {
      clientCert: readFileSync(upstreamClientCertPath, 'utf-8'),
      clientKey: readFileSync(upstreamClientKeyPath, 'utf-8'),
    };
    console.log(`[GW] upstream mTLS client cert loaded from ${upstreamClientCertPath}`);
  } else {
    console.warn(
      `[GW] WARN: MCP_GW_UPSTREAM_CLIENT_CERT_PATH/KEY_PATH set but not readable ` +
      `(${upstreamClientCertPath}, ${upstreamClientKeyPath}) — upstream mTLS hop will fail if mcp-server enforces it`,
    );
  }
}

// BL-02: single introspection client shared between the HTTP middleware
// (built later via buildAuthorizeMcpRequest) and the WebSocket handler.
// The WS path now runs the same RFC 7662 + GatewayTokenPolicy pre-checks
// the HTTP path has always run — including the D-05 anti-bypass invariant
// (rejects tokens whose aud is an upstream MCP-server URI).
const wsIntrospectionClient = new GatewayIntrospectionClient(config);

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });
}

/**
 * BL-02: run the transport-agnostic introspection + GatewayTokenPolicy pipeline
 * on the WS path. The HTTP middleware (authorizeMcpRequest.ts) runs the same
 * core; pulling it out into authorizeMcpRequestCore means BOTH transports
 * enforce:
 *   - RFC 7662 active-token introspection
 *   - sub / act.sub identity invariants
 *   - D-05 anti-bypass — token aud cannot equal an upstream MCP-server URI
 *
 * Returns true on PERMIT, or false after writing a JSON-RPC error envelope.
 * The caller MUST return immediately on false.
 */
async function runWsAuthorizationPipeline(
  token: string,
  id: unknown,
  send: (s: string) => void,
): Promise<boolean> {
  const result = await runMcpAuthorizationPipeline(token, wsIntrospectionClient, config);
  if (result.kind === 'authorized') return true;

  if (result.kind === 'introspection_unavailable') {
    // Introspection itself could not be completed (transport error, or the
    // gateway's own introspection-client credentials/auth-method were
    // rejected) — NOT a confirmed-revoked token. Don't tell the user to log
    // back in for a gateway-side problem.
    send(jsonRpcError(id, -32003, 'Gateway is temporarily unable to validate tokens (introspection unavailable)', {
      error: 'gateway_misconfigured',
    }));
    return false;
  }

  if (result.kind === 'introspection_failed') {
    send(jsonRpcError(id, -32001, 'Token is revoked or no longer active (RFC 7662)', {
      error: 'login_required',
      required_scopes: ['read'],
      login_required: true,
    }));
    return false;
  }

  // policy_violation — includes the D-05 anti-bypass case
  send(jsonRpcError(id, -32001, result.message, {
    error: result.code,
    required_scopes: ['read'],
    login_required: true,
  }));
  return false;
}

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

async function handleMessage(
  rawMsg: string,
  token: string,
  send: (s: string) => void,
  activeVertical?: string,
  bffActClientId?: string,
  bffMayActSub?: string,
  xTratContext?: string,
  xIntentToken?: string,
  tierMaxAmountUsd?: string,
  tierRestrictedTools?: string,
  mcpSessionId?: string,
  // MCP spec: notifications/cancelled. Connection-scoped registry (see
  // wss.on('connection')) of in-flight calls this connection can abort.
  inFlightCalls?: Map<string | number, AbortController>,
  // MCP spec: logging capability. Connection-scoped — the client sets its
  // desired minimum level once via logging/setLevel; every notifications/message
  // this connection emits after that is gated against it (see mcpLogging.ts).
  loggingState?: LoggingState,
): Promise<void> {
  let msg: JsonRpcRequest;
  try {
    msg = JSON.parse(rawMsg);
  } catch {
    send(jsonRpcError(null, -32700, 'Parse error'));
    return;
  }

  const { method, id } = msg;

  // Spec §2 — formal method allow-list + tools/call shape check (both transports).
  const shapeFailure = validateMethodAndShape(method, msg.params);
  if (shapeFailure) {
    send(jsonRpcError(id, shapeFailure.code, shapeFailure.message, shapeFailure.data));
    return;
  }

  // MCP spec 2026-07-28: per-request version negotiation. A Modern request
  // declares its version in params._meta instead of an initialize handshake.
  // This gateway doesn't implement Modern behavior yet — reject cleanly
  // rather than silently running Legacy semantics a Modern caller never
  // agreed to. server/discover is exempt: its whole purpose is answering
  // regardless of what version the caller claims.
  if (method !== 'server/discover') {
    const requestedVersion = extractRequestedProtocolVersion(msg.params);
    if (requestedVersion !== undefined && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requestedVersion)) {
      send(JSON.stringify(buildUnsupportedProtocolVersionError(id, requestedVersion, SUPPORTED_PROTOCOL_VERSIONS)));
      return;
    }
  }

  // MCP spec: notifications/cancelled — a notification (no response sent
  // either way). Look up the target request id and abort it if still in
  // flight; an unknown or already-settled id is a silent no-op, matching
  // spec guidance that a cancellation racing a response is not an error.
  if (method === 'notifications/cancelled') {
    const requestId = (msg.params as { requestId?: string | number } | undefined)?.requestId;
    if (requestId !== undefined) inFlightCalls?.get(requestId)?.abort();
    return;
  }

  // MCP spec: logging/setLevel — sets the minimum level this connection
  // wants notifications/message for. No level set at all = no notifications,
  // matching spec guidance that a client opts in explicitly.
  if (method === 'logging/setLevel') {
    const level = (msg.params as { level?: unknown } | undefined)?.level;
    if (!isValidLogLevel(level)) {
      send(jsonRpcError(id, -32602, `Invalid params: level must be one of the RFC 5424 severities`));
      return;
    }
    if (loggingState) loggingState.level = level;
    send(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
    return;
  }

  // tools/list — validate agent can discover tools, then aggregate from all backends
  if (method === 'tools/list') {
    let decoded;
    try {
      decoded = await validateInboundToken(token, config.gatewayResourceUri);
    } catch (err) {
      const ve = err as TokenValidationError;
      send(jsonRpcError(id, -32001, ve.message));
      return;
    }

    // BL-02: run the shared introspection + policy pipeline. Closes the WS
    // bypass for tokens whose aud is an upstream MCP-server URI.
    if (!(await runWsAuthorizationPipeline(token, id, send))) return;

    // Vertical precedence: token `vertical` claim wins (self-describing, real-PingOne
    // path), else the BFF-supplied X-Active-Vertical header. Computed once and reused
    // by both the pre-proxy gate and the post-merge per-tool decision.
    const effectiveVertical = (decoded as { vertical?: string }).vertical || activeVertical;

    // Pre-proxy gate: an overall permit/deny decision (no CandidateTools) fails
    // closed BEFORE we open two backend connections — so a disabled/discovery-denied
    // user never triggers upstream round-trips. The per-tool refinement (greying)
    // runs after the merge, where the merged tool names are available.
    const gate = await guardToolsList(decoded, config, effectiveVertical);
    if (!gate.permitted) {
      send(jsonRpcError(id, -32403, gate.reason || 'Forbidden', {
        error: 'insufficient_scope',
        required_scopes: getScopesForGatewayTool(''),
        login_required: false,
      }));
      return;
    }

    // Proxy tools/list to all backends, merge results
    const backendLabels = ['olb', 'invest', 'jwtverifier'] as const;
    const results = await Promise.allSettled([
      proxyToolsList('olb', token),
      proxyToolsList('invest', token),
      proxyToolsListJwtVerifier(token),
    ]);

    const allTools: unknown[] = [];
    // HI-04: surface backend failures in _meta. Previously a partial outage
    // returned a shorter tools list with zero signal, and callers might
    // conclude they had the full menu. The _meta block reports which
    // backends failed so the agent (and the Token Chain UI) can show that.
    const failedBackends: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        const tools = (r.value as any)?.result?.tools;
        if (Array.isArray(tools)) allTools.push(...tools);
      } else {
        failedBackends.push(backendLabels[i]);
        console.warn(`[GW] tools/list failed for backend=${backendLabels[i]}:`, r.reason instanceof Error ? r.reason.message : r.reason);
      }
    }
    // A TOTAL backend failure is not a partial outage: every live catalog entry
    // is gone and what ships is the gateway-owned static list alone, which looks
    // like a healthy tools/list to the UI. Record it for /health and say so once
    // per window — the per-backend warns above scroll past unnoticed at this rate.
    if (failedBackends.length === results.length) {
      recordToolsListBackendOutage([...failedBackends]);
    } else {
      clearToolsListBackendOutage();
    }

    // Phase 266: append Gateway-owned tools (dispatched BY NAME in tools/call).
    // These two tools are exclusively defined here; downstream plans (266-04) depend
    // on their presence. Strategy 1: inject descriptors directly into the merged list.
    // Phase 267+: per-vertical api_key-path feature tools are also gateway-owned —
    // they must appear here so their chips are not hidden by the tool-permission check.
    const gatewayTools = GATEWAY_TOOLS;
    allTools.push(...gatewayTools);

    // Authorize per-tool decision: pass the merged tool names so the policy can
    // return AllowedVertical + PermittedTools/DeniedTools for the token's scopes.
    // Exempt gateway-owned tools (special_offers/user_profile_card) — they are
    // dispatched by the gateway itself (api_key / dual_token credential paths),
    // have no scope-topology entry, and would otherwise be reported as
    // `unknown_tool` denials on every tools/list.
    const gatewayOwnedNames = new Set(gatewayTools.map((t) => t.name));
    const candidateNames = allTools
      .map((t) => (t as { name?: string } | null)?.name)
      .filter((n): n is string => !!n && !gatewayOwnedNames.has(n));
    // Per-tool refinement using the merged tool names (effectiveVertical computed
    // pre-proxy above). Returns AllowedVertical + DeniedTools advice for greying.
    const authz = await guardToolsList(decoded, config, effectiveVertical, candidateNames);
    if (!authz.permitted) {
      send(jsonRpcError(id, -32403, authz.reason || 'Forbidden', {
        error: 'insufficient_scope',
        required_scopes: getScopesForGatewayTool(''),
        login_required: false,
      }));
      return;
    }

    // 1) AllowedVertical (spec §8): banking never sees healthcare, etc. Tools
    // without a `vertical` tag (banking baseline, show_* feature, admin) are
    // cross-vertical and always pass. Vertical-foreign tools are dropped entirely.
    let scoped = allTools;
    if (authz.allowedVertical) {
      const before = allTools.length;
      scoped = allTools.filter((t) => {
        const v = (t as { vertical?: string } | null)?.vertical;
        return !v || v === authz.allowedVertical;
      });
      console.log(`[GW] tools/list vertical='${authz.allowedVertical}': ${scoped.length}/${before} after vertical filter`);
    }

    // 2) Scope-denied split: scope-denied tools stay VISIBLE (greyed in the UI)
    // via _meta.deniedTools — only permitted tools go in the spec-compliant
    // tools[] array. With no DeniedTools advice, everything is permitted.
    const deniedByName = new Map((authz.deniedTools || []).map((d) => [d.name, d.reason]));
    const permittedOut: unknown[] = [];
    const deniedOut: unknown[] = [];
    for (const t of scoped) {
      const name = (t as { name?: string } | null)?.name || '';
      if (deniedByName.has(name)) {
        deniedOut.push({ ...(t as object), permitted: false, deniedReason: deniedByName.get(name) });
      } else {
        permittedOut.push(t);
      }
    }

    const responseResult: { tools: unknown[]; _meta?: Record<string, unknown> } = { tools: permittedOut };
    const meta: Record<string, unknown> = {};
    if (deniedOut.length > 0) meta.deniedTools = deniedOut;
    // Surface which authorization backend produced the per-tool decision so the
    // BFF/UI can show real vs. mock mode without polling a separate endpoint.
    if (authz.engine) meta.authzEngine = authz.engine;
    // C2 — a permitted tools/list is a decision, and when P1AZ is off it is a
    // decision the GATEWAY made about itself. Without provenance the degraded
    // discovery result looked identical to a PDP-approved one.
    if (authz.policySource) meta.policySource = authz.policySource;
    if (authz.degraded) meta.degraded = true;
    // HI-04: when any backend rejected, mark the response so the caller can
    // render a partial-results warning. Gateway-owned tools are always present.
    if (failedBackends.length > 0) {
      meta.partialResults = true;
      meta.failedBackends = failedBackends;
      meta.warning = `Backend(s) unreachable: ${failedBackends.join(', ')}. The tool list is incomplete.`;
    }
    if (Object.keys(meta).length > 0) responseResult._meta = meta;
    send(JSON.stringify({ jsonrpc: '2.0', id, result: responseResult }));
    return;
  }

  // MCP Resources + Prompts capabilities — both proxied to
  // demo_mcp_resource_server (the 'invest' backend target), the only backend
  // that implements either. No per-call policy dimension here: the resource
  // server enforces its own requiredScope per catalog entry (Resources) and
  // has no scope gate on Prompts (matches its own design — see its
  // prompts/list handler), same as it does for tools.
  const RESOURCE_SERVER_ONLY_METHODS = new Set([
    'resources/list', 'resources/read', 'resources/templates/list',
    'prompts/list', 'prompts/get', 'completion/complete',
  ]);
  if (RESOURCE_SERVER_ONLY_METHODS.has(method)) {
    try {
      await validateInboundToken(token, config.gatewayResourceUri);
    } catch (err) {
      const ve = err as TokenValidationError;
      send(jsonRpcError(id, -32001, ve.message));
      return;
    }
    if (!(await runWsAuthorizationPipeline(token, id, send))) return;

    const wsUrl = backendWsUrl('invest', config);
    const tlsOpts: MtlsOptions | undefined = gatewayCerts
      ? { cert: gatewayCerts.clientCert, key: gatewayCerts.clientKey }
      : undefined;
    try {
      const { token: backendToken } = await mcpExchangeClient.exchangeForBackend(token, 'invest', {
        allowDiscoveryScopeFallback: true,
      });
      const result = await proxyJsonRpc(wsUrl, backendToken, msg, undefined, tlsOpts);
      send(JSON.stringify(result));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[GW] Resource-server proxy error for ${method}:`, errMsg);
      if (loggingState) emitLogMessage(send, loggingState, 'error', { method, message: errMsg }, 'gateway.resource-server-proxy');
      send(jsonRpcError(id, -32500, 'Backend error'));
    }
    return;
  }

  // tools/call — validate, guard, re-exchange, proxy
  if (method === 'tools/call') {
    // Audit hook — wrap `send` so the FIRST JSON-RPC response this tool call
    // emits (success, denial, or HITL-pending) is recorded to the BFF's durable
    // audit store. `_audCtx` is populated below once the tool name / identity /
    // vertical are known; any send that fires before then (token-validation
    // failure) carries no operation and is skipped. Fire-and-forget — never
    // blocks the response. The tools/call branch always returns, so reassigning
    // `send` here does not leak into other message handlers.
    const _audStartedAt = Date.now();
    const _audCtx: { operation?: string; userId?: string; agentId?: string; vertical?: string; scope?: string; acr?: string } = {};
    let _audDone = false;
    const _origSend = send;
    send = (s: string) => {
      if (!_audDone && _audCtx.operation) {
        _audDone = true;
        const { outcome, code, data } = auditOutcomeFromResponse(s);
        const scopeAlert = scopeAlertDetails(code, data);
        recordGatewayAudit(
          {
            operation: _audCtx.operation,
            outcome,
            userId: _audCtx.userId,
            agentId: _audCtx.agentId,
            vertical: _audCtx.vertical,
            duration: Date.now() - _audStartedAt,
            details: {
              ...(code != null ? { jsonRpcErrorCode: code } : {}),
              ...(scopeAlert || {}),
              // Compliance report (Scenario 5): token scope + auth strength.
              ...(_audCtx.scope ? { tokenScopes: _audCtx.scope } : {}),
              ...(_audCtx.acr ? { acr: _audCtx.acr } : {}),
            },
          },
          config,
        );
      }
      _origSend(s);
    };

    // UC18: per-agent/per-tool rate limiting — WS parity with the HTTP path
    // (authorizeMcpRequest.ts). Runs before token validation/introspection so a
    // throttled burst never burns a validation or P1AZ round trip. No signature
    // verification here — full validation happens in validateInboundToken below;
    // a forged sub only wastes a slot in the attacker's own bucket, not a
    // legitimate user's. Shares the HTTP path's limiter singleton (getRateLimiter)
    // so the same agent/tool pair is throttled identically regardless of transport.
    if (config.rateLimitEnabled) {
      let _rlSub = 'unknown';
      try {
        const _rawPayload = token.split('.')[1];
        if (_rawPayload) {
          const _claims = JSON.parse(Buffer.from(_rawPayload, 'base64url').toString('utf-8'));
          if (_claims?.sub) _rlSub = String(_claims.sub);
        }
      } catch { /* use 'unknown' sub */ }
      const _rlTool = (msg.params as { name?: string } | undefined)?.name ?? 'unknown_tool';
      const _rlKey = `${_rlSub}:${_rlTool}`;
      const _rlResult = getRateLimiter(config).check(_rlKey);
      if (!_rlResult.allowed) {
        console.warn(`[GW] UC18 rate_limited key=${_rlKey} retryAfterMs=${_rlResult.retryAfterMs}`);
        // Audit hook above is already installed — set operation/userId so the
        // wrapped `send` records this denial (mirrors the HTTP path's own
        // self-contained audit record, made unnecessary here by reusing it).
        _audCtx.operation = _rlTool;
        _audCtx.userId = _rlSub;
        send(jsonRpcError(id, -32429, 'Tool call rate limit exceeded. Retry after the indicated interval.', {
          error: 'rate_limited',
          retryAfterMs: _rlResult.retryAfterMs,
        }));
        return;
      }
    }

    let decoded;
    try {
      decoded = await validateInboundToken(token, config.gatewayResourceUri);
    } catch (err) {
      const ve = err as TokenValidationError;
      send(jsonRpcError(id, -32001, ve.message, {
        error: 'login_required',
        required_scopes: ['read'],
        login_required: true,
      }));
      return;
    }

    // PingOne does not emit `act` in token-exchange-issued tokens — it is a
    // reserved claim that cannot be set via resource attribute mappings.
    // The BFF bridges this by sending X-Act-Client-Id on the WS upgrade request.
    // Apply it as a fallback when the token carries no act chain.
    if (!decoded.act?.sub && bffActClientId) {
      decoded = { ...decoded, act: { sub: bffActClientId } };
    }
    // may_act.sub: the actor the USER authorized. Not present on exchanged tokens, so the
    // BFF bridges it via X-May-Act-Sub. Surfaced to the authorization decision as
    // MayActSub for per-user delegation enforcement (ENFORCE_MAY_ACT in the policy).
    if (!decoded.may_act?.sub && bffMayActSub) {
      decoded = { ...decoded, may_act: { sub: bffMayActSub } };
    }

    // BL-02: run the shared introspection + policy pipeline. The D-05
    // anti-bypass check in GatewayTokenPolicy now blocks WS tokens that
    // carry mcpOlbResourceUri (or any upstream MCP-server URI) in aud.
    if (!(await runWsAuthorizationPipeline(token, id, send))) return;

    const msgParams = msg.params as {
      name?: string;
      arguments?: Record<string, unknown>;
      // MCP spec 2026-07-28 MRTR retry fields — top-level params siblings,
      // distinct from the Legacy _elicitation_confirmed/_elicitation_id
      // tool-argument markers below.
      inputResponses?: Record<string, { action?: string }>;
      requestState?: string;
    } | undefined;
    const toolName: string = msgParams?.name || '';
    // Activate the audit hook now that the tool + caller identity are known.
    // Set before any authz/HITL send so denials and approval-pending outcomes
    // are recorded too, not just successful dispatches.
    _audCtx.operation = toolName;
    _audCtx.userId = decoded.sub;
    _audCtx.agentId = decoded.act?.sub;
    // Scope + ACR for the compliance report (Scenario 5).
    _audCtx.scope = decoded.scope;
    _audCtx.acr = decoded.acr;

    // ── BUGS.md #53: DPoP / Web Bot Auth transport-parity guard ──────────────────
    // DPoP (RFC 9449) and Web Bot Auth (RFC 9421) are HTTP-request-bound proofs the
    // HTTP path fail-closes on (authorizeMcpRequest.ts Step 2d/2d'). They cannot be
    // presented per-call over a long-lived WebSocket, so an ENFORCED control must
    // refuse the WS tool call rather than let a caller bypass it by transport choice
    // (same class as the WS rate-limit gap, BUGS.md #13 / PR #1825). No-op when both
    // controls are OFF (defaults: REQUIRE_DPOP_PROOF unset, wbaMode=monitor).
    const _bindingReject = wsTransportBindingGuard({
      requireDpopProof: process.env.REQUIRE_DPOP_PROOF === 'true',
      wbaMode: config.wbaMode,
    });
    if (_bindingReject) {
      console.warn(`[GW] WS ${_bindingReject.data.error}: enforced control cannot be satisfied over WebSocket (tool: ${toolName})`);
      send(jsonRpcError(id, _bindingReject.code, _bindingReject.message, _bindingReject.data));
      return;
    }
    // Posture parity (authzPosture): record the binding evidence this WS call
    // actually carries so seenBindingHeaders()/authzHealth().failOpen reports the
    // same aggregate on WS as on HTTP (Step 522/688/757 of the HTTP path). DPoP is
    // not recorded here — the BFF's WS client never sends a DPoP proof, and the
    // guard above already fail-closes when DPoP is enforced.
    if (xIntentToken) noteBindingHeaderSeen('intent');
    if (xTratContext) noteBindingHeaderSeen('rar');
    if (decoded.act?.sub) noteBindingHeaderSeen('act');
    // Phase 2 CR-01 — gateway-internal fields gate retries and are stripped before
    // forwarding to the downstream MCP server. Backend schemas use
    // additionalProperties:false and would reject unknown fields.
    const rawToolArgs: Record<string, unknown> = msgParams?.arguments || {};
    const hitlChallengeId = rawToolArgs._hitl_challenge_id as string | undefined;
    // Elicitation re-call markers — extracted for session-binding check and P1AZ
    // parameter injection (via toolArgsForAuthz below), then stripped from toolArgs.
    let elicitationConfirmed = rawToolArgs._elicitation_confirmed === true;
    let elicitationId = rawToolArgs._elicitation_id as string | undefined;
    const toolArgs: Record<string, unknown> = { ...rawToolArgs };
    delete toolArgs._hitl_challenge_id;
    delete toolArgs._elicitation_confirmed;
    delete toolArgs._elicitation_id;
    if (msgParams) {
      msgParams.arguments = toolArgs;
    }
    // MCP spec 2026-07-28 MRTR: a Modern retry carries top-level
    // params.inputResponses + params.requestState instead. requestState IS
    // the elicitation_id — reuses the same crypto-random, one-time-use,
    // session+tool-bound record from elicitationStore.ts. Only 'accept'
    // counts as confirmed.
    if (msgParams?.inputResponses?.elicitation?.action === 'accept' && msgParams.requestState) {
      elicitationConfirmed = true;
      elicitationId = msgParams.requestState;
      delete msgParams.inputResponses;
      delete msgParams.requestState;
    }

    // Spec §2 — per-tool argument schema validation. Runs after the auth
    // pipeline (identity known, audit hook set) and before HITL/PingOne
    // Authorize so malformed calls never create challenges or burn a PDP call.
    const argsFailure = validateToolArgs(toolName, toolArgs);
    if (argsFailure) {
      send(jsonRpcError(id, argsFailure.code, argsFailure.message, argsFailure.data));
      return;
    }

    // If agent is retrying with a HITL receipt, verify the challenge is
    // approved AND that it was issued for THIS caller/agent/tool. Without
    // the binding check, an approved receipt from {userA, toolA} can be
    // replayed by {userB, toolB} — the downstream PingAuthorize evaluation
    // is not sufficient because some tools may re-permit on the second pass.
    let verification: ReceiptVerification | null = null;
    if (hitlChallengeId) {
      if (!config.hitlServiceUrl) {
        send(jsonRpcError(id, -32500, 'HITL service not configured'));
        return;
      }
      let status;
      try {
        status = await getHitlChallengeStatus(config.hitlServiceUrl, hitlChallengeId);
      } catch {
        send(jsonRpcError(id, -32500, 'Failed to verify HITL challenge'));
        return;
      }
      const retryArgs = (toolArgs as Record<string, unknown> | undefined) || {};
      verification = verifyHitlReceipt(
        status,
        decoded.sub,
        decoded.act?.sub,
        toolName,
        Date.now(),
        retryArgs.amount as number | string | undefined,
        retryArgs,
      );
      if (!verification.ok) {
        send(jsonRpcError(id, -32002, verification.message || 'HITL challenge invalid', {
          hitl: true,
          challengeId: hitlChallengeId,
        }));
        return;
      }
    }

    // Derive hitlApproved from the verified receipt: pass it into guardToolCall
    // and PingAuthorize so the policy can PERMIT when approval is already recorded.
    const hitlApproved = hitlChallengeId != null && verification?.ok === true;

    // Elicitation re-call validation — if agent retries with _elicitation_confirmed:true,
    // verify the stored record is valid for this session + tool before calling P1AZ.
    // The pending record is consumed here (one-time use); ElicitationConfirmed:'true'
    // is added to the P1AZ call via toolArgsForAuthz so the policy can permit the retry.
    if (elicitationConfirmed) {
      const sessionId = mcpSessionId ?? '';
      const rec = elicitationId ? consumePendingElicitation(elicitationId, toolName, sessionId) : null;
      if (!rec) {
        send(jsonRpcError(id, -32003, 'elicitation_required', {
          reason: 'invalid_or_expired',
        }));
        return;
      }
      // ElicitationConfirmed: 'true' is added to P1AZ via toolArgsForAuthz below.
    }

    // WR-02: forward the same transaction params the HTTP path sends so an
    // amount-conditioned PingAuthorize policy fires identically on WS.
    // Intent token: parity with HTTP authorizeMcpRequest — validate X-Intent-Token
    // when present (or when INTENT_TOKEN_REQUIRED=true) before PingAuthorize.
    const intentValidation = xIntentToken || config.intentTokenRequired === true
      ? validateIntentToken(xIntentToken, toolName)
      : null;
    if (intentValidation && !intentValidation.valid && config.intentTokenRequired === true) {
      send(jsonRpcError(id, -32001, intentValidation.error || 'intent token invalid', {
        error: 'intent_token_invalid',
        login_required: false,
      }));
      return;
    }
    // Vertical precedence (same as tools/list): token `vertical` claim wins, else header.
    const callVertical = (decoded as { vertical?: string }).vertical || activeVertical;
    // toolArgsForAuthz: for confirmed elicitation re-calls, re-add _elicitation_confirmed
    // so buildAuthorizeParameters sends ElicitationConfirmed:'true' to P1AZ. The field
    // was stripped from toolArgs earlier (to pass backend schema validation) so we add
    // it back in a separate object used ONLY for the P1AZ call, not for backend forwarding.
    const toolArgsForAuthz: Record<string, unknown> = elicitationConfirmed
      ? { ...toolArgs, _elicitation_confirmed: true }
      : toolArgs;
    const authz = await guardToolCall(
      toolName,
      decoded,
      config,
      toolArgsForAuthz,
      xTratContext,
      hitlApproved,
      callVertical,
      hitlChallengeId,
      intentValidation,
      tierMaxAmountUsd,
      tierRestrictedTools,
    );
    if (!authz.permitted) {
      // Elicitation obligation: P1AZ requires agent to confirm intent before proceeding.
      // Branch on obligation === 'elicitation' (NOT reason) — reason is 'HITL_REQUIRED'
      // for ALL non-stepUp obligations (pre-existing behaviour), so branching on reason
      // here would misclassify an elicitation obligation as HITL.
      if (authz.obligation === 'elicitation') {
        const sessionId = mcpSessionId ?? '';
        const prompt = authz.advice?.find(
          (a: { id: string }) => a.id === 'elicitation-prompt',
        )?.value ?? `Confirm ${toolName}?`;
        const rec = createPendingElicitation(toolName, sessionId, prompt);
        // MCP spec 2026-07-28 MRTR: a Modern caller gets the server-initiated
        // input request embedded in an InputRequiredResult (HTTP-transport
        // counterpart in authorizeMcpRequest.ts) instead of the Legacy
        // elicitation_required error.
        if (extractRequestedProtocolVersion(msg.params) !== undefined) {
          send(JSON.stringify({
            jsonrpc: '2.0',
            id,
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
        send(jsonRpcError(id, -32003, 'elicitation_required', {
          elicitation_id: rec.elicitation_id,
          prompt,
          tool_name: toolName,
          expires_in: 120,
        }));
        return;
      }
      // Ordering of the remaining (non-elicitation) deny dispositions is the exact
      // thing bug #66 got wrong; it lives in classifyWsDeny() as a pure, tested
      // function so a step-up decision can never silently collapse to insufficient_scope.
      const denyDisposition = classifyWsDeny(authz, !!hitlApproved);
      // Step-up obligation: P1AZ requires MFA re-authentication (not a human/consent).
      // Distinct signal so the agent drives step-up instead of chasing token scopes
      // forever. Without this branch a stepUp decision fell through to the generic
      // insufficient_scope error below. HTTP-transport counterpart: authorizeMcpRequest.ts
      // step_up_required (403 + WWW-Authenticate); JSON-RPC carries the same
      // error='step_up_required' discriminator in data so the client can branch on it.
      if (denyDisposition === 'stepup') {
        send(jsonRpcError(id, -32403, 'Step-up authentication required', {
          error: 'step_up_required',
          tool: toolName,
          required_scopes: getScopesForGatewayTool(toolName),
          policy_source: authz.policySource,
          ...(authz.degraded ? { degraded: true } : {}),
          login_required: false,
        }));
        return;
      }
      if (denyDisposition === 'hitl') {
        // Anti-loop: if a receipt was verified OK but the policy still returned
        // INDETERMINATE, fail with a distinct error instead of re-issuing a
        // challenge. This prevents an infinite loop if the policy is misconfigured.
        if (hitlApproved) {
          send(jsonRpcError(id, -32002, 'HITL receipt accepted but policy still requires approval', {
            hitl: true,
            error: 'mcp_hitl_receipt_rejected',
            tool: toolName,
            challengeId: hitlChallengeId,
          }));
          return;
        }

        // Create a challenge in HITL service and return the challengeId to the agent
        if (config.hitlServiceUrl) {
          try {
            const challenge = await createHitlChallenge(config.hitlServiceUrl, {
              tool: toolName,
              userId: decoded.sub,
              agentId: decoded.act?.sub,
              context: { ...(toolArgs as Record<string, unknown>) },
            });
            send(jsonRpcError(id, -32002, 'Human approval required', {
              hitl: true,
              tool: toolName,
              challengeId: challenge.challengeId,
              expiresAt: challenge.expiresAt,
              challenge_type: getChallengeTypeForTool(toolName),
              instructions: 'Approve at dashboard, then retry with _hitl_challenge_id in arguments',
            }));
          } catch (hitlErr) {
            console.error('[GW] Failed to create HITL challenge:', hitlErr);
            send(jsonRpcError(id, -32002, 'Human approval required — HITL service unavailable', { hitl: true, tool: toolName, challenge_type: getChallengeTypeForTool(toolName) }));
          }
        } else {
          send(jsonRpcError(id, -32002, 'Human approval required', { hitl: true, tool: toolName, challenge_type: getChallengeTypeForTool(toolName) }));
        }
      } else if (denyDisposition === 'policy_not_found') {
        // Policy drift: the tool has no matching policy (mock 'unknown_tool' /
        // NOT_APPLICABLE). Surface it as policy_not_found — same operator vocabulary
        // as the BFF — instead of insufficient_scope, so nobody is sent to chase
        // token scopes for a missing-policy problem.
        send(jsonRpcError(id, -32403, 'Policy not found, please contact administrator.', {
          error: 'policy_not_found',
          tool: toolName,
          detail: authz.reason,
          login_required: false,
        }));
      } else {
        send(jsonRpcError(id, -32403, authz.reason || 'Forbidden', {
          error: 'insufficient_scope',
          required_scopes: getScopesForGatewayTool(toolName),
          login_required: false,
        }));
      }
      return;
    }

    const target = routeTool(toolName);
    _audCtx.vertical = target;

    // Phase 266: 3-disposition dispatch
    // 'apikey'     → Path A: Gateway-only marker (special_offers, user_profile_card dispatched BY NAME)
    // 'dualtoken'  → Path B: RFC 8693 exchange + id_token in JSON-RPC body → /api/resource-server/identity
    // 'bankingdata'→ Path C: RFC 8693 exchange → /api/resource-server/accounts or /transactions
    // 'olb'/'invest' → existing WebSocket proxy path (unchanged)
    if (target === 'apikey' || target === 'dualtoken' || target === 'bankingdata') {
      // Derive the API-key last4 inline (no credentialSwap needed for apikey path).
      const apiKeyLast4 = (() => {
        const k = config.demoApiKeyServiceKey || '';
        return k.length >= 4 ? k.slice(-4) : 'XXXX';
      })();

      // ----- api_key (Path A) -----
      if (target === 'apikey') {
        // Scope enforcement is an Authorize-layer decision, NOT a dispatch
        // concern — it already ran (guardToolCall) before we got here.
        //
        // Shared with the HTTP path via apiKeyDispatch.buildApiKeyToolResult
        // (BL-02 transport parity — one source of the Phase 267 api_key
        // dispatch). Phase 267: real backend (show_mortgage →
        // banking_api_resource_server via X-API-Key); else Phase 266 marker.
        const outcome = await buildApiKeyToolResult(
          toolName,
          decoded.sub,
          apiKeyLast4,
          config,
        );
        if (outcome.ok) {
          send(JSON.stringify({ jsonrpc: '2.0', id, result: outcome.result }));
        } else {
          send(jsonRpcError(id, outcome.code, outcome.message, outcome.data));
        }
        return;
      }

      // ----- dual_token (Path B) — shared with HTTP via dualTokenDispatch -----
      if (target === 'dualtoken') {
        const outcome = await buildDualTokenToolResult(toolName, token, decoded.sub, config);
        if (outcome.ok) {
          send(JSON.stringify({ jsonrpc: '2.0', id, result: outcome.result }));
        } else {
          send(jsonRpcError(id, outcome.code, outcome.message, outcome.data));
        }
        return;
      }

      // ----- oauth_bearer / bankingdata (Path C) — shared with HTTP via bankingDataDispatch -----
      if (target === 'bankingdata') {
        const outcome = await buildBankingDataToolResult(toolName, token, config);
        if (outcome.ok) {
          send(JSON.stringify({ jsonrpc: '2.0', id, result: outcome.result }));
        } else {
          send(jsonRpcError(id, outcome.code, outcome.message, outcome.data));
        }
        return;
      }
    }

    // ----- Existing olb/invest path — WebSocket proxy -----
    const wsUrl = backendWsUrl(target, config);

    // Spec §4 (closes WR-02): RFC 8693 exchange to the backend audience.
    // Fail closed — the inbound gateway-audience token is never forwarded.
    let backendToken: string;
    let exchangeCached = false;
    let exchangeTargetAud = '';
    try {
      const ex = await mcpExchangeClient.exchange(token, toolName);
      backendToken = ex.token;
      exchangeCached = ex.cached;
      exchangeTargetAud = ex.targetAud;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const axiosData = (err as any)?.response?.data;
      const detail = axiosData?.error_description || axiosData?.error || errMsg;
      console.error(`[GW] Token exchange failed for ${toolName}:`, detail);
      send(jsonRpcError(id, -32500, `Token exchange failed: ${detail}`, { error: 'token_exchange_failed', detail }));
      return;
    }

    const tlsOpts: MtlsOptions | undefined = gatewayCerts
      ? { cert: gatewayCerts.clientCert, key: gatewayCerts.clientKey }
      : undefined;

    // MCP spec: notifications/cancelled — register this call so a later
    // cancel notification on the same connection can find and abort it.
    const cancelController = new AbortController();
    if (id !== undefined) inFlightCalls?.set(id, cancelController);

    let result: JsonRpcResponse;
    try {
      // MCP spec: relay any interim notifications/progress frame the backend
      // emits (opted into by the caller via params._meta.progressToken, sent
      // through unchanged in `msg`) straight back onto this client-facing
      // connection — the caller is the only one who can act on it, the
      // gateway just forwards.
      result = await proxyJsonRpc(wsUrl, backendToken, msg, undefined, tlsOpts, (params) => {
        send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params }));
      }, cancelController.signal);
    } catch (err) {
      // Cancelled: the client sent notifications/cancelled and is not
      // expecting a response for this id — sending one anyway (an error or
      // otherwise) is what the spec's cancellation flow explicitly avoids.
      if ((err as { code?: string })?.code === 'cancelled') return;
      const msg2 = err instanceof Error ? err.message : String(err);
      console.error(`[GW] Proxy error for ${toolName}:`, msg2);
      if (loggingState) emitLogMessage(send, loggingState, 'error', { tool: toolName, message: msg2 }, 'gateway.proxy');
      send(jsonRpcError(id, -32500, 'Backend error'));
      return;
    } finally {
      if (id !== undefined) inFlightCalls?.delete(id);
    }

    // C3 + H1: synthesize tokenEvents for the Token Chain UI showing that the
    // gateway exchanged the TX token (RFC 8693) for a backend-audience token
    // before forwarding to the backend MCP server.
    const gwExchangeEvent = {
      id: 'gw-exchange',
      label: `Gateway RFC 8693 exchange: TX token (aud=${config.gatewayResourceUri}) → backend token (aud=${exchangeTargetAud})${exchangeCached ? ' [cache hit]' : ''}.`,
      tokenType: 'access_token',
      credentialPath: 'oauth_bearer',
      status: 'ok',
      specRef: 'RFC 8693 §2.1 + RFC 8707 resource parameter',
    };

    const gwTokenEvents = [
      {
        id: 'gw-inbound',
        label: 'Gateway received delegated user bearer (aud=mcp-gw, sub=user, act=upstream-agent)',
        tokenType: 'access_token',
        credentialPath: 'oauth_bearer',
        status: 'ok',
        specRef: 'RFC 6750 §3',
      },
      gwExchangeEvent,
      {
        id: 'gw-proxy',
        label: `Gateway proxied JSON-RPC over WebSocket to backend MCP (${target}) with the backend-scoped token`,
        tokenType: 'access_token',
        credentialPath: 'oauth_bearer',
        status: 'ok',
        specRef: 'JSON-RPC 2.0 + RFC 6750 §3.1',
      },
    ];

    // Merge into result.result._meta without disturbing the backend payload.
    if (result && typeof result.result === 'object' && result.result !== null) {
      const r = result.result as Record<string, unknown>;
      const existingMeta = (typeof r._meta === 'object' && r._meta !== null)
        ? (r._meta as Record<string, unknown>)
        : {};
      r._meta = {
        ...existingMeta,
        credentialPath: 'oauth_bearer',
        backendTransport: 'websocket',
        tokenExchangeCached: exchangeCached,
        resourceRequest: {
          method: 'JSON-RPC',
          transport: 'websocket',
          url: wsUrl,
          tool: toolName,
          target,
          note: 'Gateway exchanged to backend audience, then proxied JSON-RPC over WebSocket.',
        },
        tokenEvents: gwTokenEvents,
        // C2 — same reason as tools/list: a permitted tool call must say which
        // authority permitted it, or a degraded local PERMIT reads as a PDP one.
        ...(authz.policySource ? { policySource: authz.policySource } : {}),
        ...(authz.degraded ? { degraded: true } : {}),
      };
    }

    send(JSON.stringify(result));
    return;
  }

  // initialize — return gateway server info (agent1 must still handshake)
  if (method === 'initialize') {
    send(JSON.stringify({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          logging: {},
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
          completions: {},
        },
        serverInfo: { name: 'banking-mcp-gateway', version: '1.0.0' },
      },
    }));
    return;
  }

  if (method === 'notifications/initialized') {
    return; // no response required
  }

  // MCP spec 2026-07-28: server/discover — servers MUST implement it. Same
  // identity/capabilities as the initialize handler above.
  if (method === 'server/discover') {
    const result = buildDiscoverResult(
      {
        tools: {},
        logging: {},
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
        completions: {},
      },
      { name: 'banking-mcp-gateway', version: '1.0.0' },
    );
    send(JSON.stringify({ jsonrpc: '2.0', id, result }));
    return;
  }

  send(jsonRpcError(id, -32601, `Method not found: ${method}`));
}

async function proxyToolsList(target: 'olb' | 'invest', inboundToken: string): Promise<JsonRpcResponse> {
  const wsUrl = backendWsUrl(target, config);
  const tlsOpts: MtlsOptions | undefined = gatewayCerts
    ? { cert: gatewayCerts.clientCert, key: gatewayCerts.clientKey }
    : undefined;
  // Spec §4: tools/list also crosses the trust boundary with a backend-audience token.
  // Caveat: a subject token lacking invest:read will be silently retargeted by
  // PingOne to the olb audience when exchanging for invest; the invest backend
  // then rejects it and the existing failedBackends/_meta partial-results path
  // (Promise.allSettled below) reports it — acceptable by design.
  const { token: backendToken } = await mcpExchangeClient.exchangeForBackend(inboundToken, target, {
    allowDiscoveryScopeFallback: true,
  });
  return proxyJsonRpc(wsUrl, backendToken, {
    jsonrpc: '2.0',
    id: `gw-list-${target}`,
    method: 'tools/list',
    params: {},
  }, undefined, tlsOpts);
}

// demo_mcp_jwt_verifier (FastMCP/Python) speaks Streamable HTTP, not WebSocket
// — same merge role as proxyToolsList('invest', ...) above, but over HTTP via
// proxyJsonRpcHttp. See GatewayServer.forwardToUpstream() for the tools/call
// side of this same HTTP backend.
async function proxyToolsListJwtVerifier(inboundToken: string): Promise<JsonRpcResponse> {
  const httpUrl = backendHttpMcpUrl('jwtverifier', config);
  const { token: backendToken } = await mcpExchangeClient.exchangeForBackend(inboundToken, 'jwtverifier', {
    allowDiscoveryScopeFallback: true,
  });
  return proxyJsonRpcHttp(httpUrl, backendToken, {
    jsonrpc: '2.0',
    id: 'gw-list-jwtverifier',
    method: 'tools/list',
    params: {},
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const gatewayServer = new GatewayServer({
  config,
  requestMiddleware: buildAuthorizeMcpRequest(config),
  mtlsCerts: gatewayCerts ?? undefined,
});
const httpServer = gatewayServer.httpServer;

// HI-07: cap WS payload size and gate on Origin so the WS transport has
// the same defenses the HTTP transport has via GatewayServer.validateCors.
// Without these, a 100 MB JSON-RPC frame can hang Node parsing it and
// any cross-origin browser can open the WS.
// IN-05: anchored with ^(?:...)$ so a tightened MCP_ACCEPTED_ORIGINS matches
// the full Origin, not a substring (parity with GatewayServer.validateCors).
const _wsAcceptedOriginsRe = new RegExp(`^(?:${process.env.MCP_ACCEPTED_ORIGINS ?? '.*'})$`);
const WS_MAX_PAYLOAD_BYTES = Number(process.env.MCP_WS_MAX_PAYLOAD_BYTES ?? 1024 * 1024); // 1 MB default

const wss = new WebSocket.Server({
  server: httpServer,
  maxPayload: WS_MAX_PAYLOAD_BYTES,
  verifyClient: ({ origin, req }, cb) => {
    // Permit no-origin clients (server-to-server WebSockets, including
    // banking_agent_service and other internal callers that don't set
    // Origin). Browser-origin clients must match the configured regex.
    if (!origin) return cb(true);
    if (_wsAcceptedOriginsRe.test(origin)) return cb(true);
    console.warn(`[GW] WS upgrade rejected — origin ${origin} not in MCP_ACCEPTED_ORIGINS`);
    cb(false, 403, 'Origin not permitted');
  },
});

wss.on('connection', (ws, req) => {
  const authHeader = req.headers['authorization'];
  const token = extractBearerToken(authHeader) || '';

  // MCP spec: notifications/cancelled. One registry per connection — request
  // ids are only unique within a connection, not globally. Populated around
  // each proxyJsonRpc call below; notifications/cancelled looks a request id
  // up here and aborts it if still in flight (already-settled calls are a
  // no-op, per proxyJsonRpc's own settled guard).
  const inFlightCalls = new Map<string | number, AbortController>();

  // MCP spec: logging capability. One state box per connection, mutated by
  // the logging/setLevel handler in handleMessage.
  const loggingState: LoggingState = {};

  // Active vertical for per-vertical tools/list filtering (spec §8). Sourced
  // server-to-server from the BFF on the WS upgrade — NOT user-controlled (the
  // SPA never opens this socket). Single value; trimmed.
  const rawVertical = req.headers['x-active-vertical'];
  const activeVertical = (Array.isArray(rawVertical) ? rawVertical[0] : rawVertical || '').trim() || undefined;

  // Tier (groupToTier) — BFF pre-resolves group->tier and forwards the
  // resolved definition as headers (parity with the HTTP path in
  // authorizeMcpRequest.ts). Read once at upgrade time, same as activeVertical.
  const wsHdr = (n: string): string | undefined => {
    const v = req.headers[n];
    return (Array.isArray(v) ? v[0] : v || '').toString().trim() || undefined;
  };
  const tierMaxAmountUsd = wsHdr('x-tier-max-amount-usd');
  const tierRestrictedTools = wsHdr('x-tier-restricted-tools');

  // X-Act-Client-Id / X-May-Act-Sub: BFF-provided actor identity headers.
  // Gate behind the internal gateway secret (parity with HTTP path in
  // authorizeMcpRequest.ts — same checkInternalSecret helper). Ignored when
  // the secret is absent or wrong; the WS connection is not rejected.
  const rawWsSecret = req.headers['x-internal-gateway-secret'];
  const wsSecretStr = (Array.isArray(rawWsSecret) ? rawWsSecret[0] : rawWsSecret || '').trim();
  const _wsActOk = checkInternalSecret(wsSecretStr, config.bffInternalSecret);
  const rawActClientId = req.headers['x-act-client-id'];
  const bffActClientId = _wsActOk
    ? (Array.isArray(rawActClientId) ? rawActClientId[0] : rawActClientId || '').trim() || undefined
    : undefined;
  const rawMayActSub = req.headers['x-may-act-sub'];
  const bffMayActSub = _wsActOk
    ? (Array.isArray(rawMayActSub) ? rawMayActSub[0] : rawMayActSub || '').trim() || undefined
    : undefined;

  // X-TraT-Context: TraT envelope forwarded by the BFF on the WS upgrade request.
  // Mirrors how the HTTP middleware (authorizeMcpRequest.ts) reads x-trat-context
  // and passes it into guardToolCall / RAR enforcement. Captured at handshake time
  // so every message on this connection carries the same TraT context.
  const rawTratContext = req.headers['x-trat-context'];
  const wsXTratContext = (Array.isArray(rawTratContext) ? rawTratContext[0] : rawTratContext || '').trim() || undefined;

  // X-Intent-Token: BFF-minted intent binding (parity with HTTP path).
  const rawIntentToken = req.headers['x-intent-token'];
  const wsIntentToken = (Array.isArray(rawIntentToken) ? rawIntentToken[0] : rawIntentToken || '').trim() || undefined;

  // MCP-Session-Id: used as the session-binding key for pending elicitations.
  // Captured at upgrade time and passed to handleMessage so re-call validation
  // can verify the elicitation was issued for the same session.
  const wsMcpSessionId = wsHdr('mcp-session-id');

  if (!token) {
    ws.close(4001, 'Bearer token required');
    return;
  }

  ws.on('message', (raw) => {
    const rawStr = raw.toString();
    let parsedForCid: { id?: unknown; params?: { correlationId?: unknown } } = {};
    try { parsedForCid = JSON.parse(rawStr); } catch { /* parse error handled inside handleMessage */ }
    const wsCid = extractCorrelationId(req.headers as Record<string, unknown>, parsedForCid);
    runWithCorrelation(wsCid, () => {
      handleMessage(rawStr, token, (s) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(s);
      }, activeVertical, bffActClientId, bffMayActSub, wsXTratContext, wsIntentToken, tierMaxAmountUsd, tierRestrictedTools, wsMcpSessionId, inFlightCalls, loggingState).catch((err) => {
        console.error('[GW] Unhandled message error:', err);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(jsonRpcError(null, -32603, 'Internal error'));
        }
      });
    });
  });

  ws.on('error', (err) => console.error('[GW] WebSocket error:', err.message));
});

httpServer.listen(config.port, config.host, () => {
  console.log(`[GW] banking-mcp-gateway running on ${config.host}:${config.port}`);
  console.log(`[GW] Gateway resource URI: ${config.gatewayResourceUri}`);
  console.log(`[GW] mcp-olb backend: ${config.mcpOlbWsUrl} (aud: ${config.mcpOlbResourceUri})`);
  console.log(`[GW] mcp-resource-server backend: ${config.mcpResourceServerWsUrl} (aud: ${config.mcpResourceServerResourceUri})`);
  console.log(`[GW] RFC 9728 + HTTP MCP ingress — POST /mcp  http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/.well-known/oauth-protected-resource`);
  // Best-effort: warm the Authorization Server connection so the first
  // tools/list decision after this (re)start doesn't pay the cold connect.
  void warmupAuthz(config);
});

// WR-05: graceful drain. httpServer.close() is async — exiting on the next
// line killed in-flight tool calls (a create_transfer mid-flight is an
// ambiguous financial outcome). Exit from the close callback, with an
// unref'd hard-kill safety timer so a stalled drain still terminates.
function shutdown(): void {
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
})();
