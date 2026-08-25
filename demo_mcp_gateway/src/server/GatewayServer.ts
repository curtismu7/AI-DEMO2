'use strict';

/**
 * GatewayServer — HTTP MCP gateway surface (RFC 9728 + Streamable HTTP MCP transport).
 *
 * Owns two client-facing HTTP paths per Plan 243-01:
 *   GET  /.well-known/oauth-protected-resource  — gateway-owned RFC 9728 metadata (D-02)
 *   POST /mcp                                   — client-facing MCP HTTP ingress (D-01)
 *   GET  /health                                — liveness probe
 *
 * The GatewayServer is the ONLY public front door for HTTP-speaking MCP clients.
 * It is NOT a pass-through to the upstream MCP server metadata — the resource claim
 * belongs to the gateway, not the upstream.
 *
 * Auth pipeline (Plans 243-01/02; Phase 3 CR-03 extends to GET + DELETE):
 *   1. Extract bearer token from Authorization header
 *   2. Validate inbound aud = gateway audience (rejects wrong-hop tokens, D-05)
 *   3. (Plan 243-02) PingOne Authorize evaluation via authorizeMcpRequest middleware
 *   4. (Plan 243-02) RFC 8693 exchange → upstream MCP-server audience
 *   5. Forward to upstream with exchanged token + MCP headers
 *
 * Plan 243-01 implemented steps 1-2 and basic forwarding for POST /mcp; step
 * 3-4 were wired in 243-02. Phase 3 CR-03 unified GET /mcp (SSE) and DELETE
 * /mcp through the same middleware() callback so all three verbs now share
 * the introspection + GatewayTokenPolicy + PingAuthorize + RFC 8693 pipeline
 * — they were previously forwarding the inbound bearer verbatim.
 */

import http, { IncomingMessage, ServerResponse } from 'http';
import https from 'https';
import crypto from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import axios, { AxiosError } from 'axios';
import { GatewayConfig, isInternalSecretUsable } from '../config';
import { adminConfigSafeView, applyAdminConfigUpdate, ADMIN_CONFIG_ALLOWED_KEYS } from '../adminConfig';
import { McpTokenExchangeClient } from '../auth/McpTokenExchangeClient';
import { GatewayIntrospectionClient } from '../auth/GatewayIntrospectionClient';
import { extractBearerToken, validateInboundToken, TokenValidationError } from '../tokenValidator';
import { extractCorrelationId } from '../correlationId';
import { routeTool, backendWsUrl, backendHttpMcpUrl } from '../router';
import { proxyJsonRpc, MCP_PROTOCOL_VERSION } from '../proxy';
import { buildDiscoverResult, SUPPORTED_PROTOCOL_VERSIONS } from '../serverDiscover';
import { extractRequestedProtocolVersion, buildUnsupportedProtocolVersionError } from '../modernNegotiation';
import { selfBaseUrl } from '../selfBaseUrl';
import { appendEnterpriseWwwAuthHint, buildEnterpriseExtensionBlock, isEnterpriseManagedMcpAuthEnabled } from '../enterpriseMcpAuth';
import { runWithCorrelation } from '../correlationContext';
import { buildAuthzHealth } from '../authzPosture';
import { toolsListBackendOutage } from '../toolsListHealth';
import { OAuthBrokerRouter } from '../oauth/OAuthBrokerRouter';
import { ClientRegistry } from '../oauth/ClientRegistry';
import { BrokerTokenStore } from '../oauth/BrokerTokenStore';

const MCP_SESSION_HEADER = 'mcp-session-id';
const MCP_PROTO_HEADER = 'mcp-protocol-version';
// MCP spec 2026-07-28 Streamable HTTP §Request Metadata — Modern-only.
const MCP_METHOD_HEADER = 'mcp-method';
const MCP_NAME_HEADER = 'mcp-name';
// Methods whose Mcp-Name must mirror params.name (tools/call) — resources/read
// (params.uri) and prompts/get aren't routed through this gateway's tools/call
// pipeline, so only tools/call is checked here.
const NAME_HEADER_REQUIRED_METHODS = new Set(['tools/call']);

const GATEWAY_SCOPES = [
  'read',
  'write',
  'transfer',
  'mcp:invoke',
  'mortgage:read',  // Phase 267 — Path A api_key disposition
  'ai_agent',
];

// HTTP request-body cap. The WS transport is hardened with maxPayload
// (MCP_WS_MAX_PAYLOAD_BYTES, 1 MB default) precisely because a huge JSON-RPC
// frame can hang Node parsing it; readBody had no equivalent, so an
// authenticated caller could stream an arbitrarily large body into memory on
// POST /mcp or POST /admin/config. Bodies over this size are rejected 413.
const HTTP_MAX_BODY_BYTES = Number(process.env.HTTP_MAX_BODY_BYTES ?? 1024 * 1024); // 1 MB default

/**
 * Middleware hook — injected by Plan 243-02 to add PingOne Authorize + exchange.
 * Defaults to a no-op that falls through to basic forwarding.
 */
export type McpRequestMiddleware = (
  bearerToken: string,
  requestBody: Buffer,
  req: IncomingMessage,
  res: ServerResponse,
  /** call this to proceed with forwarding after middleware is satisfied */
  forward: (upstreamToken: string, body: Buffer) => Promise<void>,
) => Promise<void>;

const defaultMiddleware: McpRequestMiddleware = async (_t, body, _req, _res, forward) => {
  await forward(_t, body);
};

/**
 * Derive the HTTP(S) origin for the MCP upstream from its ws(s):// URL. Every
 * deployment already sets MCP_GW_OLB_WS_URL to the reachable MCP host (docker:
 * ws://mcp-server:8080, k8s: same, local: ws://localhost:8080), so deriving the
 * HTTP upstream from it makes the tool-call proxy correct everywhere without a
 * second var to keep in sync — and never the gateway's own `localhost`, which
 * inside a container resolves to the gateway itself (connection refused → 502).
 * Returns '' if the input isn't a ws(s) URL.
 */
function httpUpstreamFromWsUrl(wsUrl?: string): string {
  if (!wsUrl) return '';
  try {
    const u = new URL(wsUrl);
    if (u.protocol === 'ws:') return `http://${u.host}`;
    if (u.protocol === 'wss:') return `https://${u.host}`;
    return '';
  } catch {
    return '';
  }
}

export interface GatewayServerOptions {
  config: GatewayConfig;
  /** Upstream MCP HTTP base URL — gateway forwards POST /mcp here */
  upstreamMcpUrl?: string;
  /** Injected by Plan 243-02 to add authorize + exchange pipeline */
  requestMiddleware?: McpRequestMiddleware;
  /**
   * Gateway client cert for the mTLS hop to an https upstream (the client
   * half of #906 — mcp-server with MCP_MTLS_ENABLED=true rejects bare
   * connections with 403 mtls_required). Same PEM pair proxy.ts passes to
   * the WS backends via MtlsOptions.
   */
  mtlsCerts?: { clientCert: string; clientKey: string };
}

/**
 * Make a validator message safe to carry in a WWW-Authenticate header value.
 *
 * HTTP header values are ASCII-printable only, but validator messages are not:
 * tokenValidator builds multi-line templates and jose/jsonwebtoken embed
 * newlines in signature errors. Emitting one raw makes res.writeHead throw
 * ERR_INVALID_CHAR, which turned a correct 401 into a 500
 * internal_server_error — the client lost both the status and the
 * resource_metadata hint RFC 9728 discovery relies on. Quotes are also folded
 * so the message cannot break out of the auth-param it sits in.
 */
export function sanitizeHeaderDescription(description: string): string {
  return description
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/"/g, "'")
    .slice(0, 300);
}

export class GatewayServer {
  private readonly server: http.Server | https.Server;
  private readonly config: GatewayConfig;
  private readonly upstreamMcpUrl: string;
  private readonly middleware: McpRequestMiddleware;
  private readonly acceptedOriginsRe: RegExp;
  private readonly upstreamHttpsAgent: https.Agent | undefined;
  // HTTP transport has no persistent connection (unlike WS), so cancellation
  // needs a registry keyed by request id — notifications/cancelled arrives as
  // a separate POST while the original call is still in flight. The key is
  // scoped per authenticated caller (`${callerScope}:${id}`), NOT the bare
  // JSON-RPC id: ids are per-client small ints (1, 2, ...), so a bare-id map
  // shared across every HTTP caller in this process lets one caller's
  // notifications/cancelled {requestId:1} abort a DIFFERENT caller's in-flight
  // id 1 (cross-caller cancellation / DoS). The WS transport avoids this by
  // giving each connection its own inFlightCalls map (index.ts).
  private readonly inFlightCalls = new Map<string, AbortController>();
  private oauthBroker: OAuthBrokerRouter;

  constructor({ config, upstreamMcpUrl, requestMiddleware, mtlsCerts }: GatewayServerOptions) {
    this.config = config;
    this.oauthBroker = new OAuthBrokerRouter(
      new ClientRegistry(),
      new BrokerTokenStore(),
      // MCP_GW_RESOURCE_URI is a comma-list of accepted audiences in compose
      // (tokenValidator splits it); the PingOne `resource` param takes ONE —
      // the first is the gateway's own primary audience (mcpgateway.ping.demo).
      (this.config.gatewayResourceUri || '').split(',')[0].trim(),
      GATEWAY_SCOPES,
    );
    this.upstreamMcpUrl = (
      upstreamMcpUrl ||
      process.env.UPSTREAM_MCP_URL ||
      httpUpstreamFromWsUrl(config.mcpOlbWsUrl) ||
      'http://localhost:8080'
    ).replace(/\/$/, '');
    // axios only consults httpsAgent for https:// URLs, so this is inert for
    // plain-http upstreams (jwtverifier). rejectUnauthorized:false mirrors
    // proxy.ts — the mcp-server cert is self-signed per boot.
    this.upstreamHttpsAgent = mtlsCerts
      ? new https.Agent({
          cert: mtlsCerts.clientCert,
          key: mtlsCerts.clientKey,
          rejectUnauthorized: false,
        })
      : undefined;
    this.middleware = requestMiddleware ?? defaultMiddleware;
    // McpValidationFilter equivalent: accepted origins for CORS (default: allow all)
    // IN-05: anchor with ^(?:...)$ so an operator who tightens the value to
    // e.g. `https://app.example.com` gets exact-origin semantics — an
    // unanchored .test() would also match `https://app.example.com.evil.test`.
    this.acceptedOriginsRe = new RegExp(`^(?:${process.env.MCP_ACCEPTED_ORIGINS ?? '.*'})$`);
    // TLS: use https if cert/key are provided via env or certs/ directory
    const certEnv = process.env.GW_TLS_CERT;
    const keyEnv = process.env.GW_TLS_KEY;
    const defaultCert = resolve(__dirname, '../../../certs/api.ping.demo+2.pem');
    const defaultKey  = resolve(__dirname, '../../../certs/api.ping.demo+2-key.pem');
    const certPath = certEnv || (existsSync(defaultCert) ? defaultCert : null);
    const keyPath  = keyEnv  || (existsSync(defaultKey)  ? defaultKey  : null);
    const reqHandler = (req: IncomingMessage, res: ServerResponse) => {
      this.handleRequest(req, res).catch((err) => {
        console.error('[GatewayServer] Unhandled error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal_server_error' }));
        }
      });
    };
    if (certPath && keyPath) {
      console.log('[GatewayServer] TLS enabled — cert:', certPath);
      this.server = https.createServer(
        { cert: readFileSync(certPath), key: readFileSync(keyPath) },
        reqHandler,
      );
    } else {
      this.server = http.createServer(reqHandler);
    }
  }

  /** Expose the underlying http.Server for WebSocket upgrade attachment or testing. */
  get httpServer(): http.Server {
    return this.server;
  }

  // ---------------------------------------------------------------------------
  // Route dispatch
  // ---------------------------------------------------------------------------

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '/';
    const method = req.method || 'GET';

    if (url === '/.well-known/oauth-protected-resource' && method === 'GET') {
      this.handleMetadata(req, res);
      return;
    }

    if (this.isOAuthBrokerPath(url) ) {
      const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
      const handled = await this.oauthBroker.handle(req, res, parsedUrl);
      if (handled) return;
    }

    if (url === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'banking-mcp-gateway',
        ts: new Date().toISOString(),
        devBypass: this.config.devBypass,
        gatewayResourceUri: this.config.gatewayResourceUri,
        // Contract C3 — the aggregate "is the gate armed" signal. `failOpen`
        // names every currently-active bypass; an empty array means fully armed.
        authz: buildAuthzHealth(this.config),
        // Null unless the last tools/list read NO live backend and shipped the
        // static gateway-owned registry instead — an outage the response itself
        // looks perfectly healthy through.
        toolsListBackendOutage: toolsListBackendOutage(),
      }));
      return;
    }

    // GET /admin/config — read the gateway's live, in-memory config (no secrets).
    // Gated behind the shared internal secret (BL-01): the safe-view leaks live
    // routing URLs + the devBypass flag, useful reconnaissance for an attacker.
    // Powers the BFF's Agent Gateway "Routing Topology" view.
    if (url === '/admin/config' && method === 'GET') {
      if (!this.requireInternalSecret(req, res)) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(adminConfigSafeView(this.config)));
      return;
    }

    // POST /admin/config — dynamic config updates (the BFF's sim arming:
    // requireRarIntent / intentTokenRequired / requireActForAgentTools, and the
    // Setup UI's devBypass toggle). The WS-era listener had this handler in
    // index.ts (handleHttp) but it was never wired to this HTTP ingress, so
    // every pushGatewayAdminConfig call 404'd and demo arming silently failed.
    // Same secret gate as GET; all validation/hardening (strict booleans,
    // production devBypass refusal) lives in applyAdminConfigUpdate.
    if (url === '/admin/config' && method === 'POST') {
      if (!this.requireInternalSecret(req, res)) return;
      let adminBody: Buffer;
      try {
        adminBody = await this.readBody(req);
      } catch (err) {
        if ((err as { statusCode?: number } | undefined)?.statusCode === 413) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'payload_too_large', message: `Request body exceeds ${HTTP_MAX_BODY_BYTES} bytes` }));
          return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_request', message: 'Could not read request body' }));
        return;
      }
      let updates: Partial<Record<string, unknown>>;
      try {
        updates = JSON.parse(adminBody.toString('utf-8') || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }
      const result = applyAdminConfigUpdate(this.config, updates, process.env.NODE_ENV);
      if (result.mutated) {
        console.log(
          '[GW] /admin/config updated:',
          Object.keys(updates).filter((k) =>
            ADMIN_CONFIG_ALLOWED_KEYS.includes(k as keyof typeof this.config),
          ),
        );
      }
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
      return;
    }

    // POST /admin/clear-token-cache — flush the gateway's in-memory token caches
    // (RFC 8693 exchange + RFC 7662 introspection). Called fire-and-forget by the
    // BFF on user logout so a "start demo over" cannot replay a previously-exchanged
    // backend token within its TTL. Same internal-secret gate as /admin/config; the
    // caches are global (not user-keyed) so the clear is global — acceptable for the
    // single-user demo. This handler lived on the dead WS-era listener (index.ts
    // handleHttp) but was never wired to this HTTP ingress, so the BFF's logout POST
    // silently 404'd and the exchanged-token cache was never flushed.
    if (url === '/admin/clear-token-cache' && method === 'POST') {
      if (!this.requireInternalSecret(req, res)) return;
      McpTokenExchangeClient.clearCache();
      GatewayIntrospectionClient.clearCache();
      console.log('[GW] token caches cleared (logout)');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // GET /openapi/mcp-olb | /openapi/mcp-resource-server — serve the sibling
    // OpenAPI specs (Dockerfile copies them to /repo/oauth-mcp/openapi and
    // /repo/demo_mcp_resource_server/openapi) for PingAuthorize per-tool scope
    // policy. Public (no secret), matching the dead WS-era listener this was
    // ported from. __dirname is dist/server, so the repo root is three levels up
    // — same depth as the certs path resolved in the constructor.
    const openApiMatch = url.match(/^\/openapi\/(mcp-olb|mcp-resource-server)$/);
    if (openApiMatch && method === 'GET') {
      const specName = openApiMatch[1];
      const specPaths: Record<string, string> = {
        'mcp-olb': resolve(__dirname, '../../../oauth-mcp/openapi/mcp-olb.openapi.json'),
        'mcp-resource-server': resolve(__dirname, '../../../demo_mcp_resource_server/openapi/mcp-resource-server.openapi.json'),
      };
      const specPath = specPaths[specName];
      if (specPath && existsSync(specPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
        res.end(readFileSync(specPath, 'utf8'));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `OpenAPI spec not found for ${specName}` }));
      }
      return;
    }

    if (url === '/mcp') {
      switch (method) {
        case 'POST':
          await this.handleMcpPost(req, res);
          return;
        case 'GET':
          // SSE passthrough — PingGateway: ReverseProxyHandler with streamingEnabled
          await this.handleMcpGet(req, res);
          return;
        case 'DELETE':
          // Session termination — forward to upstream
          await this.handleMcpDelete(req, res);
          return;
        default:
          res.writeHead(405, { Allow: 'POST, GET, DELETE' });
          res.end();
          return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }

  // Path match for the OAuth broker (RFC 8414 AS metadata + DCR + authorize/
  // callback/token) — dispatched to OAuthBrokerRouter in handleRequest().
  private isOAuthBrokerPath(url: string): boolean {
    const pathname = url.split('?')[0];
    return pathname === '/.well-known/oauth-authorization-server'
      || pathname === '/oauth/register'
      || pathname === '/oauth/authorize'
      || pathname === '/oauth/callback'
      || pathname === '/oauth/token';
  }

  // ---------------------------------------------------------------------------
  // Internal-secret gate for the /admin surface (mirrors index.ts BL-01/WR-07).
  // Refuses to compare against an empty/weak secret (would let a header-less
  // request through), then does a length-safe timing-safe compare.
  // ---------------------------------------------------------------------------
  private requireInternalSecret(req: IncomingMessage, res: ServerResponse): boolean {
    const expected = this.config.bffInternalSecret;
    if (!isInternalSecretUsable(expected)) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'misconfigured' }));
      return false;
    }
    const presented = req.headers['x-internal-gateway-secret'];
    const presentedStr = typeof presented === 'string' ? presented : '';
    const expectedBuf = Buffer.from(expected);
    const presentedBuf = Buffer.from(presentedStr);
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
  // GET /.well-known/oauth-protected-resource  (RFC 9728)
  //
  // This is gateway-owned metadata, NOT a pass-through to the upstream MCP server.
  // The `resource` claim identifies the gateway endpoint as the protected resource
  // clients must authenticate against. (D-02)
  // ---------------------------------------------------------------------------

  private handleMetadata(req: IncomingMessage, res: ServerResponse): void {
    const pingOneEnvId = process.env.PINGONE_ENVIRONMENT_ID || '';

    const metadata: Record<string, unknown> = {
      resource: this.config.gatewayResourceUri,
      bearer_methods_supported: ['header'],
      scopes_supported: GATEWAY_SCOPES,
      resource_name: 'Demo MCP Gateway',
      resource_documentation: 'https://datatracker.ietf.org/doc/html/rfc9728',
    };

    // Points at THIS gateway's own OAuth broker (RFC 8414 AS metadata +
    // DCR), not raw PingOne — PingOne has no open dynamic client
    // registration, so a generic MCP client pointed there would fail before
    // ever reaching a token. The broker relays the real PingOne token.
    // Must be a URL the client can GET (same reasoning as resource_metadata
    // below) — the audience string is not one.
    if (pingOneEnvId) {
      metadata.authorization_servers = [selfBaseUrl(req, this.config.port)];
    }

    if (isEnterpriseManagedMcpAuthEnabled()) {
      metadata.extensions = buildEnterpriseExtensionBlock();
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(metadata, null, 2));
  }

  // ---------------------------------------------------------------------------
  // GET /mcp — SSE passthrough (PingGateway: ReverseProxyHandler + streamingEnabled)
  // Mirror of McpProtectionFilter + McpValidationFilter for GET requests.
  //
  // Phase 3 CR-03 fix: this handler now routes through the SAME middleware()
  // pipeline that POST /mcp uses — RFC 7662 introspection, GatewayTokenPolicy
  // (D-05 anti-bypass), PingAuthorize evaluation, and RFC 8693 re-exchange.
  // Previously the inbound bearer was forwarded verbatim to the upstream MCP
  // server, which (a) bypassed introspection, policy, and exchange entirely,
  // and (b) sent a token whose `aud` is the gateway's audience to a server
  // that expects its own audience — a violation of RFC 8707 / D-05.
  // GET has no JSON-RPC body, so we pass an empty buffer; the middleware's
  // body parser returns `{}` on parse failure, which naturally lands in the
  // `McpRequest` (not `McpToolCall`) branch of PingAuthorize evaluation.
  // ---------------------------------------------------------------------------

  private async handleMcpGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.validateCors(req, res)) return;
    const bearerToken = extractBearerToken(req.headers['authorization'] as string | undefined);
    if (!bearerToken) {
      this.sendUnauthorized(req, res,'invalid_token', 'Bearer token required');
      return;
    }
    // Inbound aud validation runs before the middleware (parity with POST).
    // Dev bypass: skip inbound validation; middleware will also short-circuit.
    if (!this.config.devBypass) {
      try {
        await validateInboundToken(bearerToken, this.config.gatewayResourceUri);
      } catch (err) {
        if (err instanceof TokenValidationError) {
          this.sendUnauthorized(req, res,err.code, err.message);
          return;
        }
        throw err;
      }
    }

    await this.middleware(
      bearerToken,
      Buffer.alloc(0),
      req,
      res,
      async (upstreamToken) => {
        await this.pipeGetToUpstream(req, res, upstreamToken);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // DELETE /mcp — session termination (MCP spec 2025-11-25)
  //
  // Phase 3 CR-03 fix: same middleware routing as GET above. DELETE bypassed
  // the full auth pipeline previously; it now runs introspection + policy +
  // exchange before forwarding the session-termination request upstream with
  // the re-exchanged token.
  // ---------------------------------------------------------------------------

  private async handleMcpDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const bearerToken = extractBearerToken(req.headers['authorization'] as string | undefined);
    if (!bearerToken) {
      this.sendUnauthorized(req, res,'invalid_token', 'Bearer token required');
      return;
    }
    if (!this.config.devBypass) {
      try {
        await validateInboundToken(bearerToken, this.config.gatewayResourceUri);
      } catch (err) {
        if (err instanceof TokenValidationError) {
          this.sendUnauthorized(req, res,err.code, err.message);
          return;
        }
        throw err;
      }
    }

    await this.middleware(
      bearerToken,
      Buffer.alloc(0),
      req,
      res,
      async (upstreamToken) => {
        try {
          const upstream = await axios.delete(`${this.upstreamMcpUrl}/mcp`, {
            headers: { Authorization: `Bearer ${upstreamToken}` },
            validateStatus: () => true,
            timeout: 5000,
          });
          const sessionId = req.headers[MCP_SESSION_HEADER] as string | undefined;
          res.writeHead(upstream.status, sessionId ? { [MCP_SESSION_HEADER]: sessionId } : {});
          res.end();
        } catch {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'upstream_unavailable' }));
        }
      },
    );
  }

  // SSE pipeline — pipe GET /mcp to upstream without buffering (Node http.request)
  // PingGateway equivalent: ReverseProxyHandler with soTimeout: 20 seconds
  private pipeGetToUpstream(req: IncomingMessage, res: ServerResponse, bearerToken: string): Promise<void> {
    return new Promise((resolve) => {
      const upstreamTarget = new URL(`${this.upstreamMcpUrl}/mcp`);
      const outHeaders: Record<string, string> = {
        Authorization: `Bearer ${bearerToken}`,
        Accept: (req.headers['accept'] as string | undefined) ?? 'text/event-stream',
      };
      const sessionId = req.headers[MCP_SESSION_HEADER] as string | undefined;
      if (sessionId) outHeaders[MCP_SESSION_HEADER] = sessionId;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const transport = upstreamTarget.protocol === 'https:' ? require('https') : require('http');
      // Settle-once guard so the teardown paths below (client close / upstream
      // timeout / upstream end) resolve the Promise exactly once and detach the
      // client-close listeners on normal completion.
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        req.removeListener('close', onClientClose);
        res.removeListener('close', onClientClose);
        resolve();
      };
      const onClientClose = (): void => {
        // The SSE consumer went away. pipe() only unpipes — it never destroys the
        // source — so without this the upstream GET (and its socket) leaks for the
        // process lifetime. Destroy it to release the connection, then settle.
        upstreamReq.destroy();
        finish();
      };
      const upstreamReq = transport.request(
        {
          hostname: upstreamTarget.hostname,
          port: upstreamTarget.port || (upstreamTarget.protocol === 'https:' ? 443 : 80),
          path: upstreamTarget.pathname,
          method: 'GET',
          headers: outHeaders,
          timeout: parseInt(process.env.GW_UPSTREAM_TIMEOUT_MS || '30000', 10),
        },
        (upstreamRes: IncomingMessage) => {
          // IN-06: mirror the deliberately-filtered POST allow-list
          // (forwardToUpstream). Do NOT copy upstream headers verbatim —
          // hop-by-hop headers (connection / transfer-encoding / keep-alive)
          // and any upstream set-cookie/server must not cross the proxy.
          const upstreamHeaders = upstreamRes.headers as Record<string, string | string[]>;
          const sseHeaders: Record<string, string> = {
            'Content-Type': String(upstreamHeaders['content-type'] || 'text/event-stream'),
          };
          const sid = upstreamHeaders[MCP_SESSION_HEADER] as string | undefined;
          if (sid) sseHeaders[MCP_SESSION_HEADER] = sid;
          const cacheCtl = upstreamHeaders['cache-control'] as string | undefined;
          if (cacheCtl) sseHeaders['Cache-Control'] = cacheCtl;
          const wwwAuth = upstreamHeaders['www-authenticate'] as string | undefined;
          if (wwwAuth) sseHeaders['WWW-Authenticate'] = wwwAuth;
          res.writeHead(upstreamRes.statusCode ?? 200, sseHeaders);
          upstreamRes.pipe(res, { end: true });
          upstreamRes.on('end', finish);
          upstreamRes.on('error', () => {
            // pipe() only ends the destination on source 'end', never on source
            // 'error' — without this the client-facing SSE response is left open
            // forever when the upstream connection resets mid-stream.
            if (!res.writableEnded) res.end();
            finish();
          });
        },
      );
      // The `timeout` request option only ARMS the socket timer; it fires nothing
      // on its own. Attach a real handler so an idle upstream is actually aborted.
      upstreamReq.on('timeout', () => {
        upstreamReq.destroy(new Error('upstream_timeout'));
      });
      upstreamReq.on('error', () => {
        if (!settled && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'upstream_unavailable' }));
        }
        finish();
      });
      // Tear the upstream down if the client disconnects before the stream ends.
      req.on('close', onClientClose);
      res.on('close', onClientClose);
      upstreamReq.end();
    });
  }

  // ---------------------------------------------------------------------------
  // POST /mcp — client-facing HTTP MCP ingress (D-01, D-03)
  //
  // 1. Require bearer token → 401 + WWW-Authenticate if missing
  // 2. Validate inbound aud = gateway audience → reject wrong-hop tokens (D-05)
  // 3. Hand off to middleware for PingOne Authorize + exchange (Plan 243-02)
  // 4. Forward with the (exchanged) token + MCP headers to upstream
  // ---------------------------------------------------------------------------

  private async handleMcpPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // McpValidationFilter equivalent: CORS origin check
    if (!this.validateCors(req, res)) return;

    // McpValidationFilter equivalent: Accept header (must accept application/json)
    const acceptHeader = (req.headers['accept'] as string | undefined) ?? '';
    if (acceptHeader && !acceptHeader.includes('application/json') && !acceptHeader.includes('*/*')) {
      res.writeHead(406, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_acceptable', message: 'Accept must include application/json' }));
      return;
    }

    const authHeader = req.headers['authorization'] as string | undefined;
    const bearerToken = extractBearerToken(authHeader);

    if (!bearerToken) {
      this.sendUnauthorized(req, res,'invalid_token', 'Bearer token required');
      return;
    }

    // Dev bypass: skip inbound token validation so the gateway works without real PingOne tokens.
    if (!this.config.devBypass) {
      try {
        await validateInboundToken(bearerToken, this.config.gatewayResourceUri);
      } catch (err) {
        if (err instanceof TokenValidationError) {
          this.sendUnauthorized(req, res,err.code, err.message);
          return;
        }
        throw err;
      }
    }

    // Read the request body
    let body: Buffer;
    try {
      body = await this.readBody(req);
    } catch (err) {
      if ((err as { statusCode?: number } | undefined)?.statusCode === 413) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload_too_large', message: `Request body exceeds ${HTTP_MAX_BODY_BYTES} bytes` }));
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad_request', message: 'Could not read request body' }));
      return;
    }

    // Scope the in-flight cancellation registry to THIS caller so a
    // notifications/cancelled from one caller cannot abort another caller's
    // call sharing the same JSON-RPC id (see inFlightCalls declaration).
    const callerScope = this.callerScope(bearerToken);

    // McpValidationFilter equivalent: JSON-RPC 2.0 format validation
    const jsonRpcError = this.validateJsonRpc(body);
    if (jsonRpcError) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: jsonRpcError }, id: null }));
      return;
    }

    // Correlation: extract id from inbound request, bind to ALS for this request.
    let parsedRpc: { id?: unknown; method?: unknown; params?: { correlationId?: unknown; name?: unknown } } = {};
    try { parsedRpc = JSON.parse(body.toString('utf-8')); } catch { /* already validated above */ }
    const correlationId = extractCorrelationId(req.headers as Record<string, unknown>, parsedRpc);

    // MCP spec 2026-07-28: per-request version negotiation. A Modern request
    // declares its version in params._meta instead of an initialize
    // handshake — a fundamentally different era from the legacy
    // MCP-Protocol-Version header check below, so it's checked first and,
    // if the request is Modern-shaped, takes over entirely: this gateway
    // doesn't implement any Modern-era behavior yet, so it rejects cleanly
    // rather than falling through to legacy header semantics a Modern
    // caller never agreed to. server/discover is exempt — its whole purpose
    // is answering regardless of what version the caller claims.
    const requestedModernVersion = extractRequestedProtocolVersion(parsedRpc.params);
    if (requestedModernVersion !== undefined && parsedRpc.method !== 'server/discover') {
      if (!(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requestedModernVersion)) {
        // MCP spec 2026-07-28 Streamable HTTP §Protocol Version Header: this
        // case MUST be 400 Bad Request, not 200 with a JSON-RPC-level error.
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildUnsupportedProtocolVersionError(
          (parsedRpc.id as string | number | null) ?? null,
          requestedModernVersion,
          SUPPORTED_PROTOCOL_VERSIONS,
        )));
        return;
      }
      // MCP spec 2026-07-28 Streamable HTTP §Request Metadata: Modern
      // requests MUST mirror method (and, for tools/call, params.name) into
      // Mcp-Method/Mcp-Name headers. A missing or mismatched header MUST be
      // rejected with 400 + -32020 HeaderMismatch — Legacy-only requests
      // never had this requirement and are unaffected (this whole branch
      // only runs for a request that already declared Modern _meta).
      const mcpMethodHeader = req.headers[MCP_METHOD_HEADER] as string | undefined;
      const bodyMethod = typeof parsedRpc.method === 'string' ? parsedRpc.method : undefined;
      let headerMismatch: string | undefined;
      if (!mcpMethodHeader) {
        headerMismatch = 'Missing required header: Mcp-Method';
      } else if (mcpMethodHeader !== bodyMethod) {
        headerMismatch = `Header mismatch: Mcp-Method header value '${mcpMethodHeader}' does not match body value '${bodyMethod}'`;
      } else if (bodyMethod && NAME_HEADER_REQUIRED_METHODS.has(bodyMethod)) {
        const mcpNameHeader = req.headers[MCP_NAME_HEADER] as string | undefined;
        const bodyName = typeof parsedRpc.params?.name === 'string' ? parsedRpc.params.name : undefined;
        if (!mcpNameHeader) {
          headerMismatch = 'Missing required header: Mcp-Name';
        } else if (mcpNameHeader !== bodyName) {
          headerMismatch = `Header mismatch: Mcp-Name header value '${mcpNameHeader}' does not match body value '${bodyName}'`;
        }
      }
      if (headerMismatch) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: (parsedRpc.id as string | number | null) ?? null,
          error: { code: -32020, message: headerMismatch },
        }));
        return;
      }
    } else {
      // MCP Streamable HTTP transport: once a session is established the client
      // SHOULD send MCP-Protocol-Version on every request; a value the gateway
      // doesn't support gets a 400, not a silent pass-through. `initialize` is
      // exempt — that request IS the negotiation, before any version is agreed.
      // Checked against SUPPORTED_PROTOCOL_VERSIONS (not the single
      // MCP_PROTOCOL_VERSION the gateway uses for its OWN upstream hop) because
      // `initialize`'s reply relays whatever protocolVersion the upstream
      // mcp-server negotiated — a spec-following client then echoes that value
      // back on every later request, and a single-version check here rejected
      // it (TECH_DEBT: "Agent Gateway HTTP /mcp protocol-version mismatch").
      const inboundProtocolVersion = req.headers[MCP_PROTO_HEADER] as string | undefined;
      if (
        inboundProtocolVersion
        && parsedRpc.method !== 'initialize'
        && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(inboundProtocolVersion)
      ) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'unsupported_protocol_version',
          message: `This gateway supports MCP protocol version(s) ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}, not ${inboundProtocolVersion}.`,
          supported: SUPPORTED_PROTOCOL_VERSIONS,
        }));
        return;
      }
    }

    // MCP spec: notifications/cancelled. HTTP has no persistent connection to
    // carry this to the in-flight call the way WS does, so intercept it here
    // — before it falls through to forwardToUpstream's default routing, which
    // doesn't understand it — abort the matching registry entry, and ack per
    // the Streamable HTTP transport's handling of notifications (202, no body).
    if (parsedRpc.method === 'notifications/cancelled') {
      const cancelParams = parsedRpc.params as { requestId?: string | number } | undefined;
      const targetId = cancelParams?.requestId;
      if (targetId !== undefined) {
        const key = this.callKey(callerScope, targetId);
        this.inFlightCalls.get(key)?.abort();
        this.inFlightCalls.delete(key);
      }
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end();
      return;
    }

    // MCP spec 2026-07-28: server/discover — servers MUST implement it.
    // Answered locally, not forwarded upstream: it exists so a client can
    // learn about the server it is directly connected to, and the gateway
    // is a real MCP server in its own right. Mirrors the identity/capabilities
    // the WS transport (index.ts) already answers `initialize` with locally.
    if (parsedRpc.method === 'server/discover') {
      const result = buildDiscoverResult(
        { tools: {}, logging: {}, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false }, completions: {} },
        { name: 'banking-mcp-gateway', version: '1.0.0' },
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: parsedRpc.id ?? null, result }));
      return;
    }

    // Middleware (Plan 243-02 will inject authorize + exchange here).
    // Default: pass through with the caller's bearer token.
    await runWithCorrelation(correlationId, async () => {
      await this.middleware(
        bearerToken,
        body,
        req,
        res,
        async (upstreamToken, upstreamBody) => {
          await this.forwardToUpstream(req, res, upstreamToken, upstreamBody, callerScope);
        },
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Upstream forwarding — sends the MCP request to the upstream HTTP transport
  // Propagates MCP-Protocol-Version and MCP-Session-Id headers (D-03)
  //
  // The upstream MCP server (HttpMCPTransport) requires an initialize handshake
  // before any tool call. When the caller doesn't supply a MCP-Session-Id, this
  // method performs the handshake automatically (initialize → notifications/initialized)
  // to obtain a session ID, then forwards the actual request.
  // ---------------------------------------------------------------------------

  // IN-04: each forward is a fresh axios request on the default agent (no
  // keepAlive pool, no maxSockets cap), mirroring the per-call WS model in
  // proxy.ts. This is intentional for demo scale — the stateless
  // one-connection-per-call model keeps the proxy reasoning simple and the
  // backend is loopback. If this is ever load-bearing, an
  // http.Agent({ keepAlive: true, maxSockets }) here is the cheapest first
  // step; not built now to avoid speculative complexity.
  private async forwardToUpstream(
    req: IncomingMessage,
    res: ServerResponse,
    upstreamToken: string,
    body: Buffer,
    callerScope: string,
  ): Promise<void> {
    const timeoutMs = parseInt(process.env.GW_UPSTREAM_TIMEOUT_MS || '30000', 10);

    // Parse body to determine if we need the initialize handshake
    let jsonRpc: { method?: string; id?: unknown; params?: { name?: string } } = {};
    try { jsonRpc = JSON.parse(body.toString('utf-8')); } catch { /* malformed — forward as-is */ }

    // Invest tools live on the mcp-resource-server WS backend — the HTTP upstream
    // (mcp-server) does not serve them. Mirror the WS ingress routing here;
    // the middleware already exchanged upstreamToken for the invest audience.
    // MCP Resources and Prompts capabilities are served by the same backend
    // (only implementer of either) — same routing rule, not tool-name-based.
    const rpcToolName = jsonRpc.method === 'tools/call' ? jsonRpc.params?.name : undefined;
    const isResourceServerOnlyMethod = jsonRpc.method === 'resources/list'
      || jsonRpc.method === 'resources/read'
      || jsonRpc.method === 'resources/templates/list'
      || jsonRpc.method === 'prompts/list'
      || jsonRpc.method === 'prompts/get'
      || jsonRpc.method === 'completion/complete';
    if ((rpcToolName && routeTool(rpcToolName) === 'invest') || isResourceServerOnlyMethod) {
      // MCP spec: Progress notifications. The WS transport already forwards
      // proxyJsonRpc's onProgress frames; the HTTP transport has no
      // persistent connection to push them over unless the caller opts in
      // via params._meta.progressToken — only then upgrade to SSE.
      const progressToken = (jsonRpc.params as { _meta?: { progressToken?: string | number } } | undefined)
        ?._meta?.progressToken;
      const useSse = progressToken !== undefined;
      const requestId = jsonRpc.id as string | number | undefined;

      const controller = new AbortController();
      const callKey = requestId !== undefined ? this.callKey(callerScope, requestId) : undefined;
      if (callKey !== undefined) this.inFlightCalls.set(callKey, controller);

      if (useSse) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
      }

      try {
        const rpcResult = await proxyJsonRpc(
          backendWsUrl('invest', this.config),
          upstreamToken,
          JSON.parse(body.toString('utf-8')),
          undefined,
          undefined,
          useSse
            ? (params) => {
                res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params })}\n\n`);
              }
            : undefined,
          controller.signal,
        );
        if (useSse) {
          res.write(`data: ${JSON.stringify(rpcResult)}\n\n`);
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rpcResult));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[GatewayServer] invest WS proxy error for ${rpcToolName ?? jsonRpc.method}:`, msg);
        const errBody = JSON.stringify({ jsonrpc: '2.0', id: jsonRpc.id ?? null, error: { code: -32500, message: 'Backend error' } });
        if (useSse) {
          res.write(`data: ${errBody}\n\n`);
          res.end();
        } else {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(errBody);
        }
      } finally {
        if (callKey !== undefined) this.inFlightCalls.delete(callKey);
      }
      return;
    }

    // demo_mcp_jwt_verifier (FastMCP/Python), demo_mcp_weather, and demo_mcp_brave
    // are additional HTTP-forward targets — same Streamable HTTP handshake/forward
    // path as 'olb' below, just pointed at a different upstream base. weather/brave
    // never reach here with an exchanged token — authorizeMcpRequest.ts's Step 3.6
    // forwards the caller's original bearer token unchanged for these two targets,
    // matching ping-gateway's rsFilter->ReverseProxyHandler chain (no RFC 8693 hop).
    const rpcTarget = rpcToolName ? routeTool(rpcToolName) : undefined;
    const upstreamBase = rpcTarget === 'jwtverifier'
      ? backendHttpMcpUrl('jwtverifier', this.config)
      : rpcTarget === 'weather'
        ? backendHttpMcpUrl('weather', this.config)
        : rpcTarget === 'brave'
          ? backendHttpMcpUrl('brave', this.config)
          : this.upstreamMcpUrl;
    const upstreamUrl = `${upstreamBase}/mcp`;

    const isInitialize = jsonRpc.method === 'initialize';
    const isNotification = !isInitialize && jsonRpc.id === undefined;

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      // MCP spec 2025-11-25 §Streamable HTTP: a POST to the upstream /mcp MUST
      // list BOTH application/json and text/event-stream. Set this explicitly so
      // upstream compliance is intentional, not an accident of the HTTP client's
      // default Accept (axios happens to include */*, but that is not a contract).
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${upstreamToken}`,
      [MCP_PROTO_HEADER]: MCP_PROTOCOL_VERSION,
    };

    // Bridge the gateway's DPoP verification outcome to the upstream MCP server
    // (trusted internal hop, same pattern as the act/may_act bridge). The MCP
    // server enforces its own cnf gate from these when REQUIRE_DPOP_PROOF=true.
    const _dpopVerified = (req as unknown as { _dpopVerified?: boolean })._dpopVerified;
    const _dpopJkt = (req as unknown as { _dpopJkt?: string })._dpopJkt;
    if (_dpopVerified) baseHeaders['X-DPoP-Verified'] = 'true';
    if (_dpopJkt) baseHeaders['X-DPoP-Jkt'] = _dpopJkt;
    // Shared-secret on the trusted internal hop: if GW_MCP_BRIDGE_SECRET is set, the MCP
    // server only honors X-DPoP-Verified when this matches — so a direct caller that
    // reaches the MCP port cannot spoof the verified flag. Unset = demo default (no guard).
    if (_dpopVerified && process.env.GW_MCP_BRIDGE_SECRET) {
      baseHeaders['X-Gw-Bridge-Secret'] = process.env.GW_MCP_BRIDGE_SECRET;
    }

    // For non-initialize requests without a caller-supplied session ID, do the
    // MCP handshake (initialize → notifications/initialized) to get a session ID.
    let sessionId = req.headers[MCP_SESSION_HEADER] as string | undefined;
    // Filled only when THIS request performed the upstream handshake.
    let mcpHandshake: { initialize: Record<string, unknown>; initialized: boolean; sessionId: string | null } | undefined;
    if (!isInitialize && !isNotification && !sessionId) {
      const initBody = JSON.stringify({
        jsonrpc: '2.0',
        id: 'gw-init',
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'banking-mcp-gateway', version: '1.0.0' },
        },
      });
      try {
        const initResp = await axios.post(upstreamUrl, initBody, {
          headers: baseHeaders,
          timeout: 10_000,
          validateStatus: () => true,
          httpsAgent: this.upstreamHttpsAgent,
        });
        sessionId = initResp.headers[MCP_SESSION_HEADER] as string | undefined;
        // Record the handshake for the Token Chain. On the gateway path the BFF
        // is NOT the MCP client — the gateway is — so initialize and
        // notifications/initialized happen here, one hop beyond anything the BFF
        // can observe. Without this the chain could only say "not visible from
        // here". Reported on its own header rather than folded into
        // X-Gw-Audit-Trail, which authorizeMcpRequest has already stamped by the
        // time this code runs.
        let initResult: Record<string, unknown> | undefined;
        try {
          const parsed = JSON.parse(Buffer.from(initResp.data as ArrayBuffer).toString('utf8'));
          initResult = parsed?.result;
        } catch { /* non-JSON body: report the handshake without server detail */ }
        mcpHandshake = {
          initialize: {
            status: initResp.status,
            protocolVersion: (initResult?.protocolVersion as string) || MCP_PROTOCOL_VERSION,
            serverInfo: initResult?.serverInfo ?? null,
          },
          initialized: false,
          sessionId: sessionId ?? null,
        };
        if (sessionId) {
          // Send notifications/initialized — upstream expects this before any tool call
          const notifHeaders = { ...baseHeaders, [MCP_SESSION_HEADER]: sessionId };
          await axios.post(
            upstreamUrl,
            JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
            { headers: notifHeaders, timeout: 5_000, validateStatus: () => true, httpsAgent: this.upstreamHttpsAgent },
          );
          if (mcpHandshake) mcpHandshake.initialized = true;
        }
      } catch (err) {
        const axErr = err as AxiosError;
        if (axErr.code === 'ECONNREFUSED' || axErr.code === 'ETIMEDOUT' || axErr.code === 'ECONNRESET') {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'upstream_unavailable', message: 'Upstream MCP server is unreachable (handshake)' }));
          return;
        }
        throw err;
      }
    }

    const headers: Record<string, string> = { ...baseHeaders };
    if (sessionId) headers[MCP_SESSION_HEADER] = sessionId;

    try {
      const upstream = await axios.post(upstreamUrl, body, {
        headers,
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        validateStatus: () => true, // forward all status codes
        httpsAgent: this.upstreamHttpsAgent,
      });

      // Propagate upstream response headers clients care about
      const responseHeaders: Record<string, string> = {
        'Content-Type': String(upstream.headers['content-type'] || 'application/json'),
      };
      const upstreamSession = upstream.headers[MCP_SESSION_HEADER] as string | undefined;
      if (upstreamSession) responseHeaders[MCP_SESSION_HEADER] = upstreamSession;
      const upstreamWwwAuth = upstream.headers['www-authenticate'] as string | undefined;
      if (upstreamWwwAuth) responseHeaders['WWW-Authenticate'] = upstreamWwwAuth;
      if (mcpHandshake) responseHeaders['X-Gw-Mcp-Handshake'] = JSON.stringify(mcpHandshake);

      res.writeHead(upstream.status, responseHeaders);
      res.end(Buffer.from(upstream.data));
    } catch (err) {
      const axErr = err as AxiosError;
      if (axErr.code === 'ECONNREFUSED' || axErr.code === 'ETIMEDOUT' || axErr.code === 'ECONNRESET') {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream_unavailable', message: 'Upstream MCP server is unreachable' }));
      } else {
        throw err;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // McpProtectionFilter equivalent: WWW-Authenticate with resource_metadata per RFC 9728 §4.
  // resource_metadata MUST be a fetchable URL the client can GET — derive it from the
  // request's own scheme+host (e.g. http://api.ping.demo:3005), NOT from gatewayResourceUri,
  // which is the bare audience id (mcpgateway.ping.demo, no scheme/host) and is unreachable,
  // breaking MCP OAuth auto-discovery.
  private sendUnauthorized(req: IncomingMessage, res: ServerResponse, errorCode: string, description: string): void {
    const realm = 'banking-mcp-gateway';
    const metadataUrl = `${selfBaseUrl(req, this.config.port)}/.well-known/oauth-protected-resource`;
    const safeDesc = sanitizeHeaderDescription(description);
    // RFC 6750 §3.1 SHOULD include scope= on 401 — advertise the minimum scope
    // the gateway requires for any tool invocation.
    const baseScope = 'mcp:invoke';
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': appendEnterpriseWwwAuthHint([
        `Bearer realm="${realm}"`,
        `scope="${baseScope}"`,
        `resource_metadata="${metadataUrl}"`,
        `error="${errorCode}"`,
        `error_description="${safeDesc}"`,
      ].join(', ')),
    });
    res.end(JSON.stringify({ error: errorCode, message: description }));
  }

  // McpValidationFilter equivalent: CORS origin validation
  // MCP_ACCEPTED_ORIGINS env var — regex pattern, default .* (allow all)
  private validateCors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers['origin'] as string | undefined;
    if (!origin) return true; // non-browser agents do not send Origin
    if (this.acceptedOriginsRe.test(origin)) return true;
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden', message: `Origin not permitted: ${origin}` }));
    return false;
  }

  // McpValidationFilter equivalent: JSON-RPC 2.0 format validation
  private validateJsonRpc(body: Buffer): string | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf-8'));
    } catch {
      return 'Invalid JSON in request body';
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return 'JSON-RPC payload must be a JSON object';
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.jsonrpc !== '2.0') return 'Missing or invalid jsonrpc field (must be "2.0")';
    if (typeof obj.method !== 'string' || !obj.method) return 'Missing or invalid method field';
    return null;
  }

  // Per-caller scope for the in-flight cancellation registry. Derived from the
  // inbound bearer token (hashed, not stored raw) so a cancel only affects a
  // call registered under the SAME caller's token — different callers get
  // different scopes even when they reuse the same JSON-RPC id. Works under
  // devBypass too, where the token isn't a verifiable JWT.
  private callerScope(bearerToken: string): string {
    return crypto.createHash('sha256').update(bearerToken).digest('hex').slice(0, 16);
  }

  private callKey(callerScope: string, id: string | number): string {
    return `${callerScope}:${id}`;
  }

  // Reads the request body with a hard size cap (HTTP_MAX_BODY_BYTES). Once the
  // accumulated length crosses the limit it stops buffering (further chunks are
  // discarded, so memory stays bounded) and rejects with a 413 marker so the
  // caller can answer 413 Payload Too Large. The socket is deliberately NOT
  // destroyed here — that would race the 413 response and surface as a socket
  // hang up; draining and ignoring the rest lets the response flush cleanly.
  private readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let aborted = false;
      req.on('data', (chunk: Buffer) => {
        if (aborted) return;
        total += chunk.length;
        if (total > HTTP_MAX_BODY_BYTES) {
          aborted = true;
          reject(Object.assign(new Error('payload_too_large'), { statusCode: 413 }));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks)); });
      req.on('error', (err) => { if (!aborted) reject(err); });
    });
  }

  start(port: number, host = '0.0.0.0'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.on('error', reject);
      this.server.listen(port, host, () => {
        console.log(`[GatewayServer] HTTP MCP gateway listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
