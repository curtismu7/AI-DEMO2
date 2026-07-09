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

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as crypto from 'node:crypto';
import WebSocket from 'ws';
import { loadConfig, GatewayConfig, assertProductionSecrets, isInternalSecretUsable, checkInternalSecret } from './config';
import { validateInboundToken, extractBearerToken, TokenValidationError } from './tokenValidator';
import { routeTool, backendWsUrl } from './router';
import { buildApiKeyToolResult } from './apiKeyDispatch';
import { buildDualTokenToolResult } from './dualTokenDispatch';
import { buildBankingDataToolResult } from './bankingDataDispatch';
import { McpTokenExchangeClient } from './auth/McpTokenExchangeClient';
import { proxyJsonRpc, JsonRpcRequest, JsonRpcResponse } from './proxy';
import { guardToolsList, guardToolCall, warmupAuthz } from './pingAuthorizeGuard';
import { createHitlChallenge, getHitlChallengeStatus, verifyHitlReceipt, ReceiptVerification } from './hitlClient';
import { GatewayServer } from './server/GatewayServer';
import { buildAuthorizeMcpRequest } from './middleware/authorizeMcpRequest';
import { getScopesForGatewayTool, getChallengeTypeForTool } from './auth/toolScopes';
import { GatewayIntrospectionClient } from './auth/GatewayIntrospectionClient';
import { runMcpAuthorizationPipeline } from './auth/authorizeMcpRequestCore';
import { loadVaultIntoEnv } from './vault';
import {
  applyAdminConfigUpdate,
  ADMIN_CONFIG_ALLOWED_KEYS,
  adminConfigSafeView,
} from './adminConfig';
import { extractCorrelationId } from './correlationId';
import { runWithCorrelation } from './correlationContext';
import { generateGatewayCerts, GatewayCerts } from './mtls';
import type { MtlsOptions } from './proxy';
import { recordGatewayAudit, auditOutcomeFromResponse, scopeAlertDetails } from './gatewayAudit';
import { GATEWAY_TOOLS } from './gatewayTools';
import { validateMethodAndShape, validateToolArgs } from './validation/mcpRequestValidation';
import { buildEnterpriseExtensionBlock, isEnterpriseManagedMcpAuthEnabled } from './enterpriseMcpAuth';

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

// BL-02: single introspection client shared between the HTTP middleware
// (built later via buildAuthorizeMcpRequest) and the WebSocket handler.
// The WS path now runs the same RFC 7662 + GatewayTokenPolicy pre-checks
// the HTTP path has always run — including the D-05 anti-bypass invariant
// (rejects tokens whose aud is an upstream MCP-server URI).
const wsIntrospectionClient = new GatewayIntrospectionClient(config);

// ---------------------------------------------------------------------------
// BL-01: timing-safe internal-secret check. Mirrors the BFF pattern in
// banking_api_server/routes/agentIdToken.js — both processes use
// crypto.timingSafeEqual on Buffers of equal length. Mismatched lengths
// must still consume constant time, so we pad the shorter buffer to the
// length of the configured secret before comparing.
// ---------------------------------------------------------------------------

function requireInternalSecret(req: IncomingMessage, res: ServerResponse, cfg: GatewayConfig): boolean {
  // WR-07: an empty (or near-empty) secret makes timingSafeEqual on two
  // zero-length buffers return true for a header-less request — turning the
  // admin surface into an unauthenticated control plane. Refuse to compare
  // against a weak/empty secret; never treat that as a valid authorization.
  // This must be explicit at the gate, not an emergent property of
  // optional()'s `||` fallback (see isInternalSecretUsable in config.ts).
  if (!isInternalSecretUsable(cfg.bffInternalSecret)) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'misconfigured' }));
    return false;
  }

  const presented = req.headers['x-internal-gateway-secret'];
  const expectedBuf = Buffer.from(cfg.bffInternalSecret);
  const presentedStr = typeof presented === 'string' ? presented : '';
  const presentedBuf = Buffer.from(presentedStr);

  // Always compare against an equal-length buffer so timingSafeEqual never
  // short-circuits on length mismatch. Pad/truncate presented to expected length.
  const padded = Buffer.alloc(expectedBuf.length);
  presentedBuf.copy(padded, 0, 0, Math.min(presentedBuf.length, expectedBuf.length));
  const equalContent = crypto.timingSafeEqual(padded, expectedBuf);
  const equalLength = presentedBuf.length === expectedBuf.length;

  if (!equalContent || !equalLength) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// HTTP server (metadata + health)
// ---------------------------------------------------------------------------

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url || '/';

  if (url === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
    const pingOneEnvId = process.env.PINGONE_ENVIRONMENT_ID || '';
    const pingOneRegion = process.env.PINGONE_REGION || 'com';
    const asList = pingOneEnvId
      ? [`https://auth.pingone.${pingOneRegion}/${pingOneEnvId}/as`]
      : [];

    const metadata: Record<string, unknown> = {
      resource: config.gatewayResourceUri,
      bearer_methods_supported: ['header'],
      scopes_supported: [
        'read',
        'write',
        'admin',
        'mortgage:read',  // Phase 267 — Path A api_key disposition
        'ai_agent',
      ],
      resource_name: 'Demo MCP Gateway',
      resource_documentation: 'https://datatracker.ietf.org/doc/html/rfc9728',
    };
    if (asList.length) metadata.authorization_servers = asList;
    if (isEnterpriseManagedMcpAuthEnabled()) {
      metadata.extensions = buildEnterpriseExtensionBlock();
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
    res.end(JSON.stringify(metadata, null, 2));
    return;
  }

  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'banking-mcp-gateway', ts: new Date().toISOString() }));
    return;
  }

  // Serve OpenAPI specs for PingAuthorize per-tool scope policy
  // GET /openapi/mcp-olb  → demo_mcp_server OpenAPI spec
  // GET /openapi/mcp-invest → demo_mcp_invest OpenAPI spec
  const openApiMatch = url.match(/^\/openapi\/(mcp-olb|mcp-invest)$/);
  if (openApiMatch && req.method === 'GET') {
    const server = openApiMatch[1];
    const specPaths: Record<string, string> = {
      'mcp-olb':    join(__dirname, '../../demo_mcp_server/openapi/mcp-olb.openapi.json'),
      'mcp-invest': join(__dirname, '../../demo_mcp_invest/openapi/mcp-invest.openapi.json'),
    };
    const specPath = specPaths[server];
    if (specPath && existsSync(specPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
      res.end(readFileSync(specPath, 'utf8'));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `OpenAPI spec not found for ${server}` }));
    }
    return;
  }

  // ---------------------------------------------------------------------------
  // POST /admin/config — push dynamic config updates without restart.
  // Only non-sensitive, non-binding fields are accepted.
  //
  // BL-01: REQUIRES x-internal-gateway-secret header (timing-safe compare).
  // Without auth, anyone on 0.0.0.0:3005 could flip devBypass:true and redirect
  // upstream WebSocket URLs — a full auth-bypass primitive.
  //
  // BL-01: even with the secret, `devBypass: true` is REFUSED when NODE_ENV
  // is 'production'. Dev bypass is a localhost-only debugging affordance and
  // must never be flippable on a production deploy.
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // POST /admin/clear-token-cache — flush the gateway's in-memory token caches.
  // Called fire-and-forget by the BFF on user logout so a "start demo over"
  // cannot replay a previously-exchanged backend token within its TTL window.
  // The BFF already revokes the subject token at PingOne (RFC 7009); this
  // closes the gap where the *exchanged* token stayed cached here.
  //
  // Gated behind the same internal secret as /admin/config — the caches are
  // not user-keyed, so a clear is global; that is acceptable for a single-user
  // demo and the worst case is a few extra token exchanges after a logout.
  // ---------------------------------------------------------------------------
  if (url === '/admin/clear-token-cache' && req.method === 'POST') {
    if (!requireInternalSecret(req, res, config)) return;
    McpTokenExchangeClient.clearCache();
    GatewayIntrospectionClient.clearCache();
    console.log('[GW] token caches cleared (logout)');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url === '/admin/config' && req.method === 'POST') {
    if (!requireInternalSecret(req, res, config)) return;

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const updates: Partial<Record<string, unknown>> = JSON.parse(body || '{}');

        // Phase 3 CR-02: devBypass anti-bypass hardening (A + D + belt) lives
        // in applyAdminConfigUpdate so it is unit-testable. A rejects non-boolean
        // devBypass (400); D hard-refuses any truthy devBypass in production
        // (403); the assignment loop coerces devBypass to a strict boolean.
        const result = applyAdminConfigUpdate(config, updates, process.env.NODE_ENV);
        if (result.mutated) {
          console.log(
            '[GW] /admin/config updated:',
            Object.keys(updates).filter((k) =>
              ADMIN_CONFIG_ALLOWED_KEYS.includes(k as keyof typeof config),
            ),
          );
        }
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // GET /admin/config — read current live config (no secrets).
  // BL-01: also gated behind the internal secret — the response leaks live
  // routing URLs (mcpOlbWsUrl etc.) and the devBypass flag, both of which
  // are useful reconnaissance for an attacker.
  if (url === '/admin/config' && req.method === 'GET') {
    if (!requireInternalSecret(req, res, config)) return;
    // IN-01: reuse the single safe-config projection from adminConfig.ts
    // (also used by the POST echo) so the two views cannot drift and a
    // future allowed-key addition cannot leak a secret here independently.
    const safe = adminConfigSafeView(config);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(safe));
    return;
  }

  res.writeHead(404);
  res.end();
}

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

    // Proxy tools/list to both backends, merge results
    const backendLabels = ['olb', 'invest'] as const;
    const results = await Promise.allSettled([
      proxyToolsList('olb', token),
      proxyToolsList('invest', token),
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

    const msgParams = msg.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
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
    // Phase 2 CR-01 — `_hitl_challenge_id` is a gateway-internal field that
    // gates the retry. Strip it from toolArgs before forwarding to the
    // downstream MCP server: the backend has no use for it and may reject
    // unrecognized arguments under strict input-schema validation.
    const rawToolArgs: Record<string, unknown> = msgParams?.arguments || {};
    const hitlChallengeId = rawToolArgs._hitl_challenge_id as string | undefined;
    const toolArgs: Record<string, unknown> = { ...rawToolArgs };
    delete toolArgs._hitl_challenge_id;
    if (msgParams) {
      msgParams.arguments = toolArgs;
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

    // WR-02: forward the same transaction params the HTTP path sends so an
    // amount-conditioned PingAuthorize policy fires identically on WS.
    // Intent token: parity with HTTP authorizeMcpRequest — validate X-Intent-Token
    // when present (or when INTENT_TOKEN_REQUIRED=true) before PingAuthorize.
    const intentValidation = xIntentToken || process.env.INTENT_TOKEN_REQUIRED === 'true'
      ? validateIntentToken(xIntentToken, toolName)
      : null;
    if (intentValidation && !intentValidation.valid && process.env.INTENT_TOKEN_REQUIRED === 'true') {
      send(jsonRpcError(id, -32001, intentValidation.error || 'intent token invalid', {
        error: 'intent_token_invalid',
        login_required: false,
      }));
      return;
    }
    // Vertical precedence (same as tools/list): token `vertical` claim wins, else header.
    const callVertical = (decoded as { vertical?: string }).vertical || activeVertical;
    const authz = await guardToolCall(
      toolName,
      decoded,
      config,
      toolArgs,
      xTratContext,
      hitlApproved,
      callVertical,
      hitlChallengeId,
      intentValidation,
    );
    if (!authz.permitted) {
      if (authz.reason === 'HITL_REQUIRED') {
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
        // banking_mortgage_service via X-API-Key); else Phase 266 marker.
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
      console.error(`[GW] Token exchange failed for ${toolName}:`, err instanceof Error ? err.message : err);
      send(jsonRpcError(id, -32500, 'Token exchange failed', { error: 'token_exchange_failed' }));
      return;
    }

    const tlsOpts: MtlsOptions | undefined = gatewayCerts
      ? { cert: gatewayCerts.clientCert, key: gatewayCerts.clientKey }
      : undefined;

    let result: JsonRpcResponse;
    try {
      result = await proxyJsonRpc(wsUrl, backendToken, msg, undefined, tlsOpts);
    } catch (err) {
      const msg2 = err instanceof Error ? err.message : String(err);
      console.error(`[GW] Proxy error for ${toolName}:`, msg2);
      send(jsonRpcError(id, -32500, 'Backend error'));
      return;
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
        tokenEvents: gwTokenEvents,
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
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'banking-mcp-gateway', version: '1.0.0' },
      },
    }));
    return;
  }

  if (method === 'notifications/initialized') {
    return; // no response required
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
  const { token: backendToken } = await mcpExchangeClient.exchangeForBackend(inboundToken, target);
  return proxyJsonRpc(wsUrl, backendToken, {
    jsonrpc: '2.0',
    id: `gw-list-${target}`,
    method: 'tools/list',
    params: {},
  }, undefined, tlsOpts);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const gatewayServer = new GatewayServer({
  config,
  requestMiddleware: buildAuthorizeMcpRequest(config),
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

  // Active vertical for per-vertical tools/list filtering (spec §8). Sourced
  // server-to-server from the BFF on the WS upgrade — NOT user-controlled (the
  // SPA never opens this socket). Single value; trimmed.
  const rawVertical = req.headers['x-active-vertical'];
  const activeVertical = (Array.isArray(rawVertical) ? rawVertical[0] : rawVertical || '').trim() || undefined;

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
      }, activeVertical, bffActClientId, bffMayActSub, wsXTratContext, wsIntentToken).catch((err) => {
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
  console.log(`[GW] mcp-invest backend: ${config.mcpInvestWsUrl} (aud: ${config.mcpInvestResourceUri})`);
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
