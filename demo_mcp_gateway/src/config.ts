'use strict';

import dotenv from 'dotenv';
dotenv.config();

import * as crypto from 'node:crypto';

export interface GatewayConfig {
  port: number;
  host: string;
  // Gateway's own OAuth client (for acquiring actor token in re-exchange)
  clientId: string;
  clientSecret: string;
  // Token endpoint auth method: 'basic' (client_secret_basic) or 'post' (client_secret_post)
  tokenEndpointAuthMethod: 'basic' | 'post';
  // PingOne token endpoint
  tokenEndpoint: string;
  // Inbound aud — tokens sent to the GW must carry this audience
  gatewayResourceUri: string;
  // Backend MCP servers
  mcpOlbWsUrl: string;
  mcpInvestWsUrl: string;
  // Backend resource URIs (used as `audience` in the re-exchange)
  mcpOlbResourceUri: string;
  mcpInvestResourceUri: string;
  // Optional PingAuthorize endpoint for tools/list guard
  pingAuthorizeEndpoint: string;
  pingAuthorizeWorkerId: string;
  // Optional mock base URL — when set and different from pingAuthorizeEndpoint,
  // evaluate() fails over to this base if the primary endpoint errors/5xx.
  pingAuthorizeMockBase?: string;
  // Feature flag — when false, P1AZ is never called regardless of endpoint config.
  // Set MCP_GW_P1AZ_ENABLED=true to activate live P1AZ policy decisions.
  // Defaults to false so credentials can be configured without activating the feature.
  p1azEnabled: boolean;
  // Optional HITL service URL — when set, INDETERMINATE decisions trigger a challenge
  hitlServiceUrl: string;
  // Optional RFC 7662 introspection endpoint
  // Set GW_INTROSPECTION_ENDPOINT to enable active-token validation at the gateway.
  // Falls back to PINGONE_INTROSPECTION_ENDPOINT if unset.
  introspectionEndpoint: string;
  // Credentials used for RFC 7662 introspection requests.
  // PingOne only returns active:true for a token when the introspecting client
  // is the token's issuing client or a resource server that owns the audience.
  // Set GW_INTROSPECTION_CLIENT_ID + GW_INTROSPECTION_CLIENT_SECRET to use a
  // dedicated introspection principal (e.g. the MCP exchanger client) rather
  // than the gateway's own client credentials.  Falls back to clientId/Secret.
  introspectionClientId: string;
  introspectionClientSecret: string;
  // Token introspection provider: 'pinggateway' (default) or 'p1az'.
  // 'pinggateway' = PingGateway (ForgeRock IG) performs introspection (default).
  // 'p1az' = PingOne Authorize receives introspection result for policy evaluation (optional).
  // Set INTROSPECTION_PROVIDER=p1az to enable. Defaults to 'pinggateway'.
  introspectionProvider: 'pinggateway' | 'p1az';
  // Dev/mock bypass — when true, skip required-var guards and make auth pipeline passthrough.
  devBypass: boolean;
  // When true, skip RFC 8693 re-exchange on olb/invest WebSocket legs.
  // The inbound token (aud=gatewayResourceUri) is forwarded unchanged.
  // MCP_SERVER_RESOURCE_URI on the MCP server must equal MCP_GW_RESOURCE_URI.
  mcpServerPassthrough: boolean;
  // Phase 266: Path A — service API key for the api_key credential disposition (demo only)
  demoApiKeyServiceKey: string;
  // Phase 267: Path A backend — base URL of banking_mortgage_service (e.g. http://localhost:8082)
  mortgageServiceBaseUrl: string;
  // Phase 267: Path A backend — X-API-Key the gateway presents to banking_mortgage_service.
  // MUST match MORTGAGE_SERVICE_API_KEY on the mortgage service side. Demo-grade shared
  // secret; the full value never crosses the browser (only _meta.maskedApiKey last-4).
  mortgageServiceApiKey: string;
  // Phase 266: Path B — BFF-internal id_token retrieval endpoint (server-to-server)
  bffInternalIdTokenUrl: string;
  // Phase 266: shared secret for BFF /internal/id-token requests
  bffInternalSecret: string;
  // Phase 266: base URL of banking_resource_server (e.g. http://localhost:3001)
  bankingResourceServerBaseUrl: string;
  // Phase 266: OAuth audience for banking_resource_server — MUST match BANKING_API_RESOURCE_URI
  // on the backend; used as the `audience` parameter in RFC 8693 token exchange.
  // Per RFC 8707 + RFC 9068: audience values are logical URIs, not network addresses.
  bankingResourceServerResourceUri: string;
  mtlsEnabled: boolean;
  mtlsCertPath: string;
  /**
   * Client ID that is authorized to appear in the `act.sub` claim of delegated
   * tokens (the MCP Token Exchanger / AI Agent that performs RFC 8693 Exchange #2).
   * Used by the local/mock authorization path (P1AZ off) to validate that the
   * inbound token's actor is the expected, authorized service — mirrors what a
   * live PingOne Authorize policy would check via ActClientId.
   * Optional: when empty, act-claim validation is skipped (dev / no-actor mode).
   */
  authorizedActorClientId: string;
  /**
   * UC16 — Impersonation block: when true, tool calls to agent-mediated operations
   * (tools flagged requiresAgentMediation in scope-topology.json) are DENIED if the
   * bearer token carries no `act` claim. An act-less token erases the agent identity.
   * Default OFF (false) — set REQUIRE_ACT_FOR_AGENT_TOOLS=true to activate.
   * Only breaks ff_skip_token_exchange=true flows (intentional — that flag is warn-only).
   */
  requireActForAgentTools: boolean;
  /**
   * UC18 rate-limiting. When true, the gateway enforces per-agent/per-tool
   * sliding-window limits and returns 429 on burst exceedance.
   * Controlled by GATEWAY_RATE_LIMIT_ENABLED env var (default false).
   */
  rateLimitEnabled: boolean;
  /**
   * Web Bot Auth (RFC 9421 HTTP Message Signatures, draft-meunier profile).
   * 'off'     — never checked.
   * 'monitor' — verify + audit/log every outcome, never block (default).
   * 'enforce' — 401 on missing/invalid signature.
   * Controlled by MCP_GW_WBA_MODE.
   */
  wbaMode: 'off' | 'monitor' | 'enforce';
  /** Max calls per windowMs per (agentSub, toolName) key. Default 20. */
  rateLimitMaxRequests: number;
  /** Sliding window duration in ms. Default 60000. */
  rateLimitWindowMs: number;
}

const DEV_BYPASS = process.env.MCP_GW_DEV_BYPASS === 'true';

// Phase 266 — must match the literal used as the optional() fallback for BFF_INTERNAL_SECRET below.
// Production startup refuses this exact value to prevent shipping the dev fallback.
const DEFAULT_BFF_INTERNAL_SECRET = 'dev-shared-secret-change-me';

// WR-07: minimum acceptable length for the internal shared secret at the
// admin-surface gate. Below this, an empty/whitespace secret makes
// timingSafeEqual(Buffer.alloc(0), ...) accept a header-less request,
// turning /admin/config into an unauthenticated control plane. Exported
// pure predicate so the gate and its test share one definition (the
// index.ts IIFE is not directly unit-testable).
export const MIN_INTERNAL_SECRET_LEN = 16;

export function isInternalSecretUsable(secret: string | undefined | null): boolean {
  return (secret ?? '').trim().length >= MIN_INTERNAL_SECRET_LEN;
}

/**
 * Timing-safe comparison of a presented secret against the configured BFF internal secret.
 * Returns true only when the secret is usable (>= MIN_INTERNAL_SECRET_LEN) AND the
 * presented value matches byte-for-byte. Returns false (never throws) when the secret is
 * not usable or the presented value is absent — callers decide how to react.
 */
export function checkInternalSecret(presented: string | undefined, secret: string | undefined | null): boolean {
  if (!isInternalSecretUsable(secret) || !presented) return false;
  const eb = Buffer.from(secret as string);
  const pb = Buffer.from(presented);
  return pb.length === eb.length && crypto.timingSafeEqual(pb, eb);
}

/**
 * Returns true when P1AZ live policy decisions are active:
 * the feature flag is on AND both endpoint vars are present.
 * All three sites that gate P1AZ calls (PingOneAuthorizeClient,
 * guardToolsList, guardToolCall) use this predicate so the condition
 * stays in one place.
 */
export function isP1AZActive(config: GatewayConfig): boolean {
  return config.p1azEnabled && !!config.pingAuthorizeEndpoint && !!config.pingAuthorizeWorkerId;
}

function required(name: string, stub = 'dev-bypass-placeholder'): string {
  const v = process.env[name];
  if (!v) {
    if (DEV_BYPASS) {
      console.warn(`[GW] Dev bypass: using stub for ${name}`);
      return stub;
    }
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

// Derive the PingOne token endpoint from envId + region when an explicit
// PINGONE_TOKEN_ENDPOINT isn't set. This matches the BFF's
// oauthEndpointResolver — every install has PINGONE_ENVIRONMENT_ID +
// PINGONE_REGION in .env after setup:fresh, so we should never actually
// require the user to set PINGONE_TOKEN_ENDPOINT by hand.
function resolveTokenEndpoint(): string {
  const explicit = process.env.PINGONE_TOKEN_ENDPOINT;
  if (explicit) return explicit;
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  if (envId) return `https://auth.pingone.${region}/${envId}/as/token`;
  return required('PINGONE_TOKEN_ENDPOINT'); // surfaces a clear error
}

export function loadConfig(): GatewayConfig {
  // The gateway's OAuth client is a PingOne WEB_APP, which uses CLIENT_SECRET_POST.
  // Default to 'post' so a fresh deploy works without an explicit override; a
  // WORKER-type client can still set 'basic' via MCP_GW_TOKEN_ENDPOINT_AUTH_METHOD.
  const authMethod = (process.env.MCP_GW_TOKEN_ENDPOINT_AUTH_METHOD || 'post').toLowerCase();
  return {
    port: parseInt(process.env.PORT || '3005', 10),
    host: process.env.HOST || '0.0.0.0',
    clientId: optional('PINGONE_MCP_GATEWAY_CLIENT_ID', '') || required('MCP_GW_CLIENT_ID'),
    clientSecret: optional('PINGONE_MCP_GATEWAY_CLIENT_SECRET', '') || required('MCP_GW_CLIENT_SECRET'),
    tokenEndpointAuthMethod: authMethod === 'post' ? 'post' : 'basic',
    tokenEndpoint: resolveTokenEndpoint(),
    gatewayResourceUri: required('MCP_GW_RESOURCE_URI'),
    // MCP_GW_*-prefixed names match the rest of the gateway's env (MCP_GW_RESOURCE_URI,
    // MCP_GW_P1AZ_ENABLED, …) and are what docker-compose sets. Fall back to the legacy
    // unprefixed names, then the localhost default. Without the GW-prefixed read the
    // compose value (ws://mcp-server:8080) was silently ignored and WS proxying dialed
    // the gateway's own localhost — breaking tools/list discovery through the gateway.
    mcpOlbWsUrl: optional('MCP_GW_OLB_WS_URL', optional('MCP_OLB_WS_URL', 'ws://localhost:8080')),
    mcpInvestWsUrl: optional('MCP_GW_INVEST_WS_URL', optional('MCP_INVEST_WS_URL', 'ws://localhost:8081')),
    // Resource URIs default to the audiences bootstrap provisions. Setup
    // writes ENDUSER_AUDIENCE and MCP_RESOURCE_URI; we accept either the
    // service-specific var or those fallbacks.
    mcpOlbResourceUri: optional('MCP_OLB_RESOURCE_URI',
      optional('MCP_RESOURCE_URI', 'mcpserver.ping.demo')),
    mcpInvestResourceUri: optional('MCP_INVEST_RESOURCE_URI',
      optional('MCP_INVEST_AUDIENCE', 'mcp-invest.ping.demo')),
    pingAuthorizeEndpoint: optional('PINGAUTHORIZE_ENDPOINT', ''),
    pingAuthorizeWorkerId: optional('PINGAUTHORIZE_WORKER_ID', ''),
    pingAuthorizeMockBase: optional('PINGAUTHORIZE_MOCK_BASE', '') || undefined,
    p1azEnabled: process.env.MCP_GW_P1AZ_ENABLED === 'true',
    hitlServiceUrl: optional('HITL_SERVICE_URL', ''),
    introspectionEndpoint: optional('GW_INTROSPECTION_ENDPOINT',
      optional('PINGONE_INTROSPECTION_ENDPOINT', '')),
    introspectionClientId: optional('GW_INTROSPECTION_CLIENT_ID', ''),
    introspectionClientSecret: optional('GW_INTROSPECTION_CLIENT_SECRET', ''),
    introspectionProvider: (process.env.INTROSPECTION_PROVIDER === 'p1az' ? 'p1az' : 'pinggateway') as 'pinggateway' | 'p1az',
    devBypass: DEV_BYPASS,
    mcpServerPassthrough: process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER === 'true',
    // Phase 266 fields
    demoApiKeyServiceKey: optional('DEMO_APIKEY_SERVICE_KEY', 'demo-api-key-0000'),
    // Phase 267 fields — dedicated mortgage backend (kept separate from the
    // Phase 266 marker key so the Gateway-only apikey tools are unaffected)
    mortgageServiceBaseUrl: optional('MORTGAGE_SERVICE_URL', 'http://localhost:8082'),
    // No committed demo default — must match mortgage-service MORTGAGE_SERVICE_API_KEY.
    // Empty when unset so Path A calls fail closed rather than using a rejected key.
    mortgageServiceApiKey: optional('DEMO_MORTGAGE_SERVICE_KEY', ''),
    bffInternalIdTokenUrl: optional('BFF_INTERNAL_ID_TOKEN_URL', 'http://localhost:3001/internal/id-token'),
    bffInternalSecret: optional('BFF_INTERNAL_SECRET', DEFAULT_BFF_INTERNAL_SECRET),
    bankingResourceServerBaseUrl: optional('BANKING_RESOURCE_SERVER_BASE_URL', 'http://localhost:3001'),
    bankingResourceServerResourceUri: optional('BANKING_RESOURCE_SERVER_RESOURCE_URI', 'https://banking-resource-server.ping.demo'),
    mtlsEnabled: process.env.MCP_MTLS_ENABLED === 'true',
    mtlsCertPath: process.env.MCP_MTLS_GATEWAY_CERT_PATH ?? '/tmp/gw-client.crt',
    // The authorized actor for inbound delegated tokens: the client that performed
    // RFC 8693 Exchange #2 (the MCP Token Exchanger). Checked in mock auth mode
    // (P1AZ off) to mirror what a PingOne Authorize policy enforces via ActClientId.
    authorizedActorClientId: optional('PINGONE_TOKEN_EXCHANGER_CLIENT_ID',
      optional('PINGONE_MCP_EXCHANGER_CLIENT_ID',
        optional('AGENT_OAUTH_CLIENT_ID', ''))),
    requireActForAgentTools: process.env.REQUIRE_ACT_FOR_AGENT_TOOLS === 'true',
    // UC18 rate-limiting (default OFF — must also set GATEWAY_RATE_LIMIT_ENABLED=true)
    rateLimitEnabled: process.env.GATEWAY_RATE_LIMIT_ENABLED === 'true',
    // Web Bot Auth mode (default 'monitor' — verify + audit, never block)
    wbaMode: (['off', 'monitor', 'enforce'] as const).find((m) => m === process.env.MCP_GW_WBA_MODE) ?? 'monitor',
    rateLimitMaxRequests: parseInt(process.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS ?? '20', 10) || 20,
    rateLimitWindowMs: parseInt(process.env.GATEWAY_RATE_LIMIT_WINDOW_MS ?? '60000', 10) || 60000,
  };
}

/**
 * BL-03 startup assertion: refuse the committed dev-fallback BFF_INTERNAL_SECRET
 * when running in production. The same default literal lives on the BFF side
 * (banking_api_server/routes/agentIdToken.js); both processes must reject it
 * symmetrically so a misconfigured deploy fails closed instead of silently
 * exposing /internal/id-token to anyone who guesses the public default.
 *
 * Pure assertion — call from process entry (index.ts) so the gateway exits
 * non-zero before binding any port.
 */
export function assertProductionSecrets(cfg: GatewayConfig): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (cfg.bffInternalSecret === DEFAULT_BFF_INTERNAL_SECRET) {
    // eslint-disable-next-line no-console
    console.error(
      '[GW] FATAL: BFF_INTERNAL_SECRET is set to the committed dev default ' +
      `('${DEFAULT_BFF_INTERNAL_SECRET}') and NODE_ENV=production. ` +
      'Refusing to start. Set BFF_INTERNAL_SECRET to a unique 32+ byte secret.',
    );
    process.exit(1);
  }
  // WR-07: a whitespace / too-short BFF_INTERNAL_SECRET is NOT the default
  // literal and is NOT empty-falsy, so it slips past the check above and
  // optional()'s `||` fallback. A 1-byte secret is trivially brute-forced
  // and an empty one defeats the timing-safe compare entirely. Refuse to
  // start unless the secret is at least 32 bytes in production.
  if (cfg.bffInternalSecret.trim().length < 32) {
    // eslint-disable-next-line no-console
    console.error(
      '[GW] FATAL: BFF_INTERNAL_SECRET is too short (< 32 bytes after trim) ' +
      'and NODE_ENV=production. Refusing to start. Set BFF_INTERNAL_SECRET ' +
      'to a unique 32+ byte secret.',
    );
    process.exit(1);
  }
  // HI-08: dev bypass forwards the inbound user token unchanged. This is
  // a localhost-only debugging affordance and must never run on a
  // production deploy. The /admin/config route already refuses to flip
  // devBypass=true (BL-01); this catches the env-var startup path so the
  // gateway exits non-zero rather than silently shipping in bypass mode.
  if (cfg.devBypass) {
    // eslint-disable-next-line no-console
    console.error(
      '[GW] FATAL: MCP_GW_DEV_BYPASS=true and NODE_ENV=production. ' +
      'Dev bypass forwards inbound bearer tokens with zero policy evaluation. ' +
      'Refusing to start.',
    );
    process.exit(1);
  }
  // Signature verification: without PINGONE_JWKS_ENDPOINT the token validator falls
  // back to jwt.decode (no signature check), so a forged JWT with the right aud/exp is
  // accepted. Gated behind the explicit STRICT_AUTH=true opt-in — NOT NODE_ENV — because
  // the local demo runs NODE_ENV=production yet deliberately validates via introspection
  // without JWKS. Real deployments set STRICT_AUTH=true to require signature checks.
  if (process.env.STRICT_AUTH === 'true' && !process.env.PINGONE_JWKS_ENDPOINT) {
    // eslint-disable-next-line no-console
    console.error(
      '[GW] FATAL: STRICT_AUTH=true but PINGONE_JWKS_ENDPOINT is not set. ' +
      'JWT signatures cannot be verified (decode-only accepts forged tokens). ' +
      'Refusing to start. Set PINGONE_JWKS_ENDPOINT.',
    );
    process.exit(1);
  }
}
