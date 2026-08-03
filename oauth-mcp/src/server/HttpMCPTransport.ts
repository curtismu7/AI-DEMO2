/**
 * HTTP Streamable MCP Transport (MCP spec 2025-11-25 & 2026-07-28 — Phase D & beyond)
 *
 * Dual-stack support: routes requests to 2025-11-25 or 2026-07-28 handlers based on
 * MCP-Protocol-Version header. Adds HTTP surfaces on the same port as WebSocket:
 *
 *   GET  /.well-known/oauth-protected-resource   — RFC 9728 metadata
 *   GET  /.well-known/mcp-server                 — MCP discovery manifest
 *   POST /mcp                                    — Streamable HTTP MCP endpoint
 *   GET  /mcp                                    — 405 (SSE not required for basic spec compliance)
 *   DELETE /mcp                                  — client-initiated session termination
 *
 * The WebSocket transport is completely unchanged; enable HTTP transport with:
 *   HTTP_MCP_TRANSPORT_ENABLED=true   (env var, default true)
 *
 * Spec refs:
 *   2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
 *   2026-07-28: https://modelcontextprotocol.io/specification/draft/basic/transports
 */

import { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { MCPMessage } from '../interfaces/mcp';
import { MCPMessageHandler, MessageHandlerContext } from './MCPMessageHandler';
import { isSupportedProtocolVersion, MCP_LATEST_PROTOCOL_VERSION, detectProtocolVersion } from './protocolVersions';
import { BankingSessionManager } from '../storage/BankingSessionManager';
import { BankingAuthenticationManager } from '../auth/BankingAuthenticationManager';
import { AgentTokenInfo } from '../interfaces/auth';
import { BankingToolRegistry } from '../tools/BankingToolRegistry';
import pkg from '../../package.json';
import { AuditLogger } from '../utils/AuditLogger';
import { Logger, createDefaultLoggerConfig } from '../utils/Logger';
import { correlationFromMessage } from './correlationFromMessage';
import { runWithCorrelation } from '../utils/correlationContext';
import { emitHop } from '../utils/transactionHop';
import { extractTratClaims } from '../auth/TratClaimsExtractor';
import { verifyActorChain, parseAllowedActors } from '../auth/actorChain';
import { enforceUpstreamContract, resolveUpstreamAudiences } from '../auth/lastHopAuthorization';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MCP_SESSION_HEADER = 'mcp-session-id';
const MCP_PROTO_HEADER = 'mcp-protocol-version';
const MCP_METHOD_HEADER = 'mcp-method';       // 2026-07-28: routing header (e.g., 'tools/call')
const MCP_NAME_HEADER = 'mcp-name';           // 2026-07-28: routing header (e.g., tool name for tools/call)

// HTTP session idle TTL. Sessions unused for longer are evicted (lazily on access,
// and swept on each initialize) so the in-memory map can't grow unbounded.
const DEFAULT_HTTP_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

const BANKING_SCOPES = [
  'accounts:read',
  'transactions:read',
  'transactions:write',
  'sensitive:read',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpMCPTransportConfig {
  /**
   * Public base URL of this MCP server, e.g. https://mcp.example.com
   * Used in RFC 9728 metadata and WWW-Authenticate headers.
   */
  resourceUrl: string;

  /**
   * PingOne AS base URL, e.g. https://auth.pingone.com/{envId}/as
   * Used in RFC 9728 metadata so clients can discover the authorization server.
   */
  authServerUrl: string;

  /**
   * Allowed HTTP Origin values.  An empty array means any origin is permitted
   * (suitable for demo / server-to-server clients).  Set MCP_ALLOWED_ORIGINS to
   * restrict for production.
   */
  allowedOrigins: string[];
}

/**
 * Result of authenticating a bearer token: the raw token plus what validation
 * actually established about it. `tokenInfo.verifiedClaims` is the only
 * trustworthy claim source — it is undefined when the signature was not verified.
 */
interface AuthenticatedBearer {
  token: string;
  tokenInfo: AgentTokenInfo;
}

/** In-memory HTTP session (maps MCP-Session-Id → banking session). */
interface HttpSession {
  bankingSessionId: string;
  agentToken: string;
  /** Negotiated protocol version, filled after first initialize round-trip. */
  protocolVersion: string;
  createdAt: Date;
  /** Updated on every request that touches the session; drives idle-TTL eviction. */
  lastAccessedAt: Date;
  /** Active SSE response stream for server-initiated notifications, if the client opened GET /mcp. */
  sseResponse?: ServerResponse;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class HttpMCPTransport {
  /**
   * MCP-Session-Id → HTTP session metadata.
   * All sessions share the same BankingSessionManager used by WebSocket connections.
   */
  private readonly sessions = new Map<string, HttpSession>();

  /** Idle TTL for HTTP sessions (ms). Override with MCP_HTTP_SESSION_TTL_MS. */
  private readonly sessionTtlMs: number;

  constructor(
    private readonly config: HttpMCPTransportConfig,
    private readonly messageHandler: MCPMessageHandler,
    private readonly sessionManager: BankingSessionManager,
    private readonly authManager: BankingAuthenticationManager
  ) {
    // Only a positive override is honored — 0 / negative / garbage falls back to
    // the default so a misconfigured env can't expire every session immediately.
    const parsed = Number(process.env.MCP_HTTP_SESSION_TTL_MS);
    this.sessionTtlMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HTTP_SESSION_TTL_MS;
  }

  // -------------------------------------------------------------------------
  // Static helpers — exported for testability (D-05, gateway mode)
  // -------------------------------------------------------------------------

  /**
   * Build RFC 9728 metadata hints that signal this server is a protected
   * upstream behind the gateway (not a public front door).
   * Embedded in the /.well-known/oauth-protected-resource response when
   * MCP_GATEWAY_MODE=true.
   */
  static buildGatewayModeMetadataHints(
    upstreamResourceUrl: string,
    gatewayUri: string,
  ): Record<string, string> {
    return {
      x_gateway_protected_by: gatewayUri,
      x_direct_access:        'blocked_in_gateway_mode',
      x_upstream_resource:    upstreamResourceUrl,
    };
  }

  // -------------------------------------------------------------------------
  // Entry point — called by DemoMCPServer.handleHttpRequest
  // -------------------------------------------------------------------------

  async handleRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    // Public discovery endpoint — skip origin check (D-09: publicly discoverable)
    if (pathname === '/.well-known/mcp-server' && req.method === 'GET') {
      this.handleMcpDiscovery(res);
      return;
    }

    // MUST validate Origin header on all HTTP MCP requests to prevent DNS rebinding
    // (transport spec §2.0.1)
    if (!this.isOriginAllowed(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Forbidden: invalid Origin header' }
      }));
      return;
    }

    if (pathname === '/.well-known/oauth-protected-resource') {
      this.handleMetadata(req, res);
      return;
    }

    // Internal audit endpoint (proxied by BFF /api/mcp/audit — admin-gated at BFF level).
    // Bearer + admin:read required: audit data contains PII and security-sensitive events.
    if (pathname === '/audit' && req.method === 'GET') {
      const authed = await this.authenticateBearer(req, res);
      if (!authed) return;
      const hasAdmin = await this.authManager.validateTokenScopes(authed.token, ['admin:read']);
      if (!hasAdmin) {
        this.sendInsufficientScope(res, ['admin:read']);
        return;
      }
      await this.handleAuditQuery(req, res);
      return;
    }

    // Demo reset: clear in-memory audit log (BFF reset-demo route calls this).
    // Bearer + admin:write required — wiping the audit trail is privileged.
    if (pathname === '/audit' && req.method === 'DELETE') {
      const authed = await this.authenticateBearer(req, res);
      if (!authed) return;
      const hasAdmin = await this.authManager.validateTokenScopes(authed.token, ['admin:write']);
      if (!hasAdmin) {
        this.sendInsufficientScope(res, ['admin:write']);
        return;
      }
      AuditLogger.clearEvents();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Audit log cleared' }));
      return;
    }

    if (pathname === '/mcp') {
      switch (req.method) {
        case 'POST':
          await this.handlePost(req, res);
          break;
        case 'DELETE':
          await this.handleDelete(req, res);
          break;
        case 'GET':
          await this.handleSse(req, res);
          break;
        default:
          res.writeHead(405, { Allow: 'GET, POST, DELETE', 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed; use GET (SSE), POST, or DELETE' }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  }

  // -------------------------------------------------------------------------
  // GET /.well-known/oauth-protected-resource  (RFC 9728)
  // -------------------------------------------------------------------------

  private handleMetadata(_req: IncomingMessage, res: ServerResponse): void {
    const base = this.resourceBaseUrl();
    const baseMetadata = {
      resource: `${base}/mcp`,
      authorization_servers: [this.config.authServerUrl],
      bearer_methods_supported: ['header'],
      scopes_supported: BANKING_SCOPES,
      resource_name: 'Demo MCP Server',
      resource_documentation:
        'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization',
    };

    // Gateway mode (Phase 243, D-02): indicate this server is a protected upstream.
    const gatewayUri = process.env.MCP_GW_RESOURCE_URI;
    const metadata: Record<string, unknown> =
      process.env.MCP_GATEWAY_MODE === 'true' && gatewayUri
        ? { ...baseMetadata, ...HttpMCPTransport.buildGatewayModeMetadataHints(`${base}/mcp`, gatewayUri) }
        : baseMetadata;

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(metadata, null, 2));
  }


  // -------------------------------------------------------------------------
  // GET /.well-known/mcp-server  — public MCP discovery manifest (D-07, D-08, D-09)
  // -------------------------------------------------------------------------

  private handleMcpDiscovery(res: ServerResponse): void {
    const allTools = BankingToolRegistry.getAllTools();
    const readOnlyToolNames = allTools.filter(t => t.readOnly).map(t => t.name);
    const authenticatedToolNames = allTools.filter(t => !t.readOnly).map(t => t.name);
    const manifest = {
      name: 'Demo MCP Server',
      description:
        'MCP server providing banking tools for AI agents — account access, transactions, transfers, ' +
        'and balance queries. Implements MCP 2025-11-05 with OAuth 2.0 / PingOne authorization.',
      version: pkg.version,
      tools: allTools.map((t) => ({ name: t.name, description: t.description, readOnly: t.readOnly })),
      publicAccess: {
        readOnlyTools: readOnlyToolNames,
      },
      restrictedAccess: {
        authenticatedTools: authenticatedToolNames,
      },
      auth: {
        type: 'oauth2',
        required: true,
        authorization_servers: [
          process.env.PINGONE_ISSUER || this.config.authServerUrl,
        ],
        scopes: [
          'accounts:read',
          'transactions:read',
          'transactions:write',
          'sensitive:read',
        ],
      },
      contact: {
        url: 'https://github.com/pingidentity/pingsafe-banking-demo',
      },
    };
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(JSON.stringify(manifest, null, 2));
  }

  // -------------------------------------------------------------------------
  // GET /audit  — internal audit log query (proxied by BFF, admin-gated there)
  // -------------------------------------------------------------------------

  private async handleAuditQuery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/audit', 'http://localhost');
    const summary = url.searchParams.get('summary') === '1';

    // Lazily get (or init) AuditLogger singleton
    let logger: AuditLogger;
    try {
      logger = AuditLogger.getInstance(Logger.getInstance(createDefaultLoggerConfig()));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(summary
        ? { totalEvents: 0, byEventType: {}, byOutcome: {}, recentActivity: [] }
        : []
      ));
      return;
    }

    try {
      if (summary) {
        const summaryData = await logger.generateAuditSummary(new Date(0), new Date());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          totalEvents: summaryData.totalEvents,
          byEventType: summaryData.eventsByType,
          byOutcome: {
            success: summaryData.successfulOperations,
            failure: summaryData.failedOperations,
          },
          recentActivity: [],
        }));
      } else {
        const filters: Parameters<typeof logger.queryAuditLogs>[0] = {};
        const eventType = url.searchParams.get('eventType');
        const outcome = url.searchParams.get('outcome');
        const limit = url.searchParams.get('limit');
        if (eventType) filters.eventType = eventType as any;
        if (outcome) filters.outcome = outcome as any;
        if (limit) filters.limit = parseInt(limit, 10);
        const agentId = url.searchParams.get("agentId");
        const operation = url.searchParams.get("operation");
        if (agentId) filters.agentId = agentId;
        if (operation) filters.operation = operation;
        const events = await logger.queryAuditLogs(filters);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(events));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'audit_query_failed', message: err instanceof Error ? err.message : 'Unknown error' }));
    }
  }

  // -------------------------------------------------------------------------
  // POST /mcp  — Streamable HTTP MCP endpoint
  // -------------------------------------------------------------------------

  private async handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 1. Read and parse body
    let body: string;
    try {
      body = await this.readBody(req);
    } catch {
      this.sendHttpError(res, 400, 'Could not read request body');
      return;
    }

    let message: MCPMessage;
    try {
      message = JSON.parse(body);
    } catch {
      this.sendJsonRpcError(res, null, -32700, 'Parse error: invalid JSON');
      return;
    }

    if (!message || typeof message.method !== 'string') {
      this.sendJsonRpcError(res, (message as any)?.id ?? null, -32600, 'Invalid Request');
      return;
    }

    // 1a. Accept header — Streamable HTTP requires the client to accept
    // application/json and/or text/event-stream. Reject (406) only when an
    // explicit Accept is present and matches neither (absent / */* is allowed).
    if (!this.acceptsStreamableHttp(req)) {
      res.writeHead(406, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Acceptable: client must accept application/json or text/event-stream' }));
      return;
    }

    // 1b. Routing headers validation (2026-07-28 SEP-2243).
    // Clients may send Mcp-Method and Mcp-Name headers to enable stateless routing.
    // If present, they MUST match the JSON-RPC body (method, params.name for tools/call).
    // If absent, that's OK during 2025-11-25 compatibility period.
    const mcpMethodHeader = (req.headers[MCP_METHOD_HEADER] as string | undefined)?.trim();
    const mcpNameHeader = (req.headers[MCP_NAME_HEADER] as string | undefined)?.trim();
    if (mcpMethodHeader || mcpNameHeader) {
      // Validate header consistency with body
      if (mcpMethodHeader && mcpMethodHeader !== message.method) {
        this.sendJsonRpcError(
          res,
          (message as any)?.id ?? null,
          -32600,
          `Invalid Request: Mcp-Method header "${mcpMethodHeader}" does not match body method "${message.method}"`
        );
        return;
      }
      if (mcpNameHeader && message.method === 'tools/call') {
        const toolName = (message.params as { name?: string } | undefined)?.name;
        if (toolName && mcpNameHeader !== toolName) {
          this.sendJsonRpcError(
            res,
            (message as any)?.id ?? null,
            -32600,
            `Invalid Request: Mcp-Name header "${mcpNameHeader}" does not match body params.name "${toolName}"`
          );
          return;
        }
      }
    }

    const isNotification = message.id === undefined;
    const isInitialize = message.method === 'initialize';
    const isDiscovery = isInitialize || message.method === 'tools/list';

    // 2. Bearer token — required on every request except discovery methods
    // (initialize, tools/list). These are unauthenticated so MCP clients and
    // gateways (e.g. PingOne Privilege) can discover capabilities before auth.
    let bearerToken: string | undefined;
    let tokenInfo: Awaited<ReturnType<typeof this.authManager.validateAgentToken>> | undefined;
    if (!isDiscovery) {
      const authed = await this.authenticateBearer(req, res);
      if (!authed) return;
      bearerToken = authed.token;
      tokenInfo = authed.tokenInfo;
    } else {
      // Opportunistic: use the token if supplied, but don't reject without one.
      const optionalBearer = this.extractBearer(req);
      if (optionalBearer) {
        try {
          tokenInfo = await this.authManager.validateAgentToken(optionalBearer);
          bearerToken = optionalBearer;
        } catch { /* proceed unauthenticated */ }
      }
    }

    // 3. Notifications — route and return 202 (no response body per spec §2.1)
    if (isNotification) {
      const context = this.makeContext('http-notification', undefined);
      await this.messageHandler.handleMessage(message, context);
      res.writeHead(202);
      res.end();
      return;
    }

    // 3a–3b: Security checks (TraT, upstream contract, delegation chain) only
    // apply to authenticated requests — discovery is unauthenticated.
    if (!isDiscovery) {

    // 3a. TraT claim extraction — when MCP_TRAT_MODE_ENABLED is set, extract the
    // TraT context and BIND it to the request. A transaction token names the tool
    // it was issued for (reqctx.tool); replaying it against a different tool would
    // make the binding decorative, so a mismatch is refused here.
    const tratMode = process.env.MCP_TRAT_MODE_ENABLED === 'true';
    if (tratMode) {
      const xTratContext = req.headers['x-trat-context'] as string | undefined;
      const tratClaims = extractTratClaims(bearerToken!, xTratContext, true);
      if (tratClaims) {
        console.log(`[HttpMCPTransport][TraT] Claims extracted — tool=${tratClaims.reqctx.tool} purp=${tratClaims.purp} sim=${tratClaims.trat_sim ?? false}`);
        if (message.method === 'tools/call') {
          const calledTool = (message.params as { name?: string } | undefined)?.name;
          const boundTool = tratClaims.reqctx.tool;
          if (calledTool && boundTool && calledTool !== boundTool) {
            console.warn(`[HttpMCPTransport][TraT] Binding violation — token bound to "${boundTool}", call is "${calledTool}"`);
            this.sendHttpError(
              res,
              403,
              `TraT binding violation: transaction context is bound to tool "${boundTool}", not "${calledTool}"`,
            );
            return;
          }
        }
      } else {
        console.warn('[HttpMCPTransport][TraT] MCP_TRAT_MODE_ENABLED but no TraT claims found');
      }
    }

    // 3b. Next-hop token contract — D-05 anti-bypass + RFC 8693 delegation chain.
    //
    // D-05 runs UNCONDITIONALLY (was: gated on MCP_GATEWAY_MODE, which is set in no
    // deployment — docker-compose.yml and .env.example never define it — so the
    // anti-bypass check was dead everywhere). enforceUpstreamContract is already
    // self-disarming when neither audience is configured, so the flag added no
    // safety, only an off switch nobody knew was on.
    // Claims come from validateAgentToken and exist ONLY when the signature was
    // verified. Both checks below are authorization decisions read out of the
    // token's own claims, so an unverified token must not supply them: it is
    // attacker-authored and can assert any aud or actor it likes.
    const claims = tokenInfo!.verifiedClaims ?? {};
    const contractCheck = enforceUpstreamContract(claims, resolveUpstreamAudiences());
    if (!contractCheck.valid) {
      this.sendUnauthorized(res, `Gateway next-hop contract violation: ${contractCheck.errors[0]}`);
      return;
    }

    // F10 — verify the delegation chain the gateway proved and then dropped.
    // Armed by MCP_ALLOWED_ACTORS; fail-closed once armed (a token with no act
    // claim, or no verified signature over it, has no provable actor). C4: an
    // unarmed gate logs an explicit skip marker so it is never indistinguishable
    // from a PERMIT.
    const actorCheck = verifyActorChain(claims, {
      allowedActors: parseAllowedActors(process.env.MCP_ALLOWED_ACTORS),
      signatureVerified: tokenInfo!.signatureVerified === true,
    });
    if (!actorCheck.ran) {
      console.warn(`[HttpMCPTransport][F10] actor chain gate skipped — ran=false skipReason="${actorCheck.skipReason}"`);
    } else if (!actorCheck.valid) {
      console.warn(`[HttpMCPTransport][F10] actor chain denied — ${actorCheck.errors[0]}`);
      this.sendUnauthorized(res, `Delegation chain rejected: ${actorCheck.errors[0]}`);
      return;
    }

    } // end !isDiscovery security checks

    // 4. MCP-Protocol-Version header — required on non-initialize requests, and
    // its VALUE must be one this server supports (presence alone is insufficient).
    if (!isInitialize) {
      const protoHeader = (req.headers[MCP_PROTO_HEADER] as string | undefined)?.trim();
      if (!protoHeader) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `${MCP_PROTO_HEADER} header is required on non-initialize requests` }));
        return;
      }
      if (!isSupportedProtocolVersion(protoHeader)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Unsupported ${MCP_PROTO_HEADER}: "${protoHeader}"`,
          latestSupportedVersion: MCP_LATEST_PROTOCOL_VERSION,
        }));
        return;
      }
    }

    // 5. Session management
    let httpSession: HttpSession;
    let mcpSessionId: string;

    if (isInitialize) {
      // Evict idle-expired sessions before creating a new one (bounds the map).
      await this.sweepExpiredSessions();
      // Create a new banking session and issue a fresh MCP-Session-Id
      const bankingSession = await this.sessionManager.createSession(bearerToken ?? '');
      mcpSessionId = randomUUID();
      const now = new Date();
      // Detect protocol version for this session (defaults to latest supported if not specified)
      const detectedVersion = detectProtocolVersion(req.headers);
      httpSession = {
        bankingSessionId: bankingSession.sessionId,
        agentToken: bearerToken ?? '',
        protocolVersion: detectedVersion ?? MCP_LATEST_PROTOCOL_VERSION,
        createdAt: now,
        lastAccessedAt: now,
      };
      this.sessions.set(mcpSessionId, httpSession);
      console.log(`[HttpMCPTransport] Created session ${mcpSessionId} → banking ${bankingSession.sessionId} (protocol: ${detectedVersion})`);
    } else {
      const incomingSessionId = req.headers[MCP_SESSION_HEADER] as string | undefined;
      const existing = incomingSessionId ? this.sessions.get(incomingSessionId) : undefined;
      // Per spec §2.5: server MUST return 404 for unknown (or idle-expired) session IDs.
      if (!incomingSessionId || !existing || this.isSessionExpired(existing)) {
        if (incomingSessionId && existing) await this.deleteSession(incomingSessionId);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown or expired MCP-Session-Id; send a new initialize request' }));
        return;
      }
      mcpSessionId = incomingSessionId;
      httpSession = existing;
      httpSession.lastAccessedAt = new Date();
      // Log protocol version for non-initialize requests (for observability)
      console.log(`[HttpMCPTransport] Request on session ${mcpSessionId} using protocol ${httpSession.protocolVersion}`);
    }

    // 6. Build MCPMessageHandler context, reusing the existing banking session
    const bankingSession = (await this.sessionManager.getSession(httpSession.bankingSessionId)) ?? undefined;
    const context = this.makeContext(mcpSessionId, bankingSession, httpSession.agentToken);

    // 7. Route message — wrapped in ALS correlation scope so all downstream
    // teachLog.step calls (TokenIntrospector etc.) inherit correlation_id automatically.
    const correlationId = correlationFromMessage(message as any, req.headers);
    // Correlation scope begins here: pre-route bearer/JWKS validation, gateway-contract and protocol-version checks (steps 1-6 above) run before the correlation id is bound. The RFC 7662 introspection that the teaching trace cares about runs inside handleMessage (within this scope) on both transports.
    await runWithCorrelation(correlationId, async () => {
      const mcpResponse = await this.messageHandler.handleMessage(message, context);

      if (message.method === 'tools/call') {
        emitHop({
          phase: 'mcp.tool',
          op: String((message.params as any)?.name ?? 'unknown'),
          params: (message.params as any)?.arguments ?? {},
          status: mcpResponse?.error ? 'error' : 'ok',
        });
      }

      // Capture negotiated protocol version from initialize response
      if (isInitialize && mcpResponse?.result?.['protocolVersion']) {
        httpSession.protocolVersion = mcpResponse.result['protocolVersion'] as string;
      }

      // Notifications produce null responses
      if (mcpResponse === null) {
        res.writeHead(202);
        res.end();
        return;
      }

      // 8. Detect auth-challenge in tool call result and promote to HTTP 403 with scope hint.
      // An auth challenge means the token lacks a specific scope — we return
      // 403 + WWW-Authenticate so the client knows which scope to request.
      // Published canonically under result._meta.authChallenge.
      if (message.method === 'tools/call' && mcpResponse.result) {
        const meta = mcpResponse.result['_meta'] as { authChallenge?: { scope?: string } } | undefined;
        const authChallenge = meta?.authChallenge;
        if (authChallenge?.scope) {
          this.sendInsufficientScope(res, authChallenge.scope.split(' ').filter(Boolean));
          return;
        }
      }

      // 9. Send JSON-RPC response with MCP-Session-Id header
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        [MCP_SESSION_HEADER]: mcpSessionId,
      };

      res.writeHead(200, headers);
      res.end(JSON.stringify({ jsonrpc: '2.0', ...mcpResponse }));
    });
  }

  // -------------------------------------------------------------------------
  // DELETE /mcp  — client-initiated session termination (spec §2.5)
  // -------------------------------------------------------------------------

  private async handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A bearer token is required to terminate a session — the session id alone is
    // not a credential (it travels in a header and could be observed/replayed).
    const authed = await this.authenticateBearer(req, res);
    if (!authed) return;

    const mcpSessionId = req.headers[MCP_SESSION_HEADER] as string | undefined;
    if (mcpSessionId && this.sessions.has(mcpSessionId)) {
      console.log(`[HttpMCPTransport] Session terminated by client: ${mcpSessionId}`);
      await this.deleteSession(mcpSessionId);
      res.writeHead(200);
    } else {
      res.writeHead(404);
    }
    res.end();
  }

  // -------------------------------------------------------------------------
  // GET /mcp  — server-initiated SSE stream (MCP spec §2.4 Streamable HTTP)
  // -------------------------------------------------------------------------

  private async handleSse(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A bearer token is required to open the server→client stream — the session
    // id alone is not a credential.
    const authed = await this.authenticateBearer(req, res);
    if (!authed) return;

    // SSE requires a valid, existing session — the client must have completed
    // initialize via POST before opening the SSE channel.
    const mcpSessionId = req.headers[MCP_SESSION_HEADER] as string | undefined;
    const httpSession = mcpSessionId ? this.sessions.get(mcpSessionId) : undefined;
    if (!mcpSessionId || !httpSession || this.isSessionExpired(httpSession)) {
      if (mcpSessionId && httpSession) await this.deleteSession(mcpSessionId);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown or missing MCP-Session-Id; complete POST initialize first' }));
      return;
    }
    httpSession.lastAccessedAt = new Date();

    // Only one SSE stream per session — close the old one if the client reconnects.
    if (httpSession.sseResponse) {
      try { httpSession.sseResponse.end(); } catch { /* ignore */ }
    }

    // Send SSE headers — keep-alive, no cache, CORS open for server-to-server.
    res.writeHead(200, {
      'Content-Type':                'text/event-stream',
      'Cache-Control':               'no-cache, no-transform',
      'Connection':                  'keep-alive',
      'X-Accel-Buffering':           'no', // disable Nginx buffering
      [MCP_SESSION_HEADER]:          mcpSessionId,
      'Access-Control-Allow-Origin': req.headers.origin || '*',
    });

    // Initial comment keeps the connection alive and confirms the stream is open.
    res.write(': MCP SSE stream established\n\n');

    httpSession.sseResponse = res;
    console.log(`[HttpMCPTransport] SSE stream opened for session ${mcpSessionId}`);

    // Clean up when the client disconnects.
    req.on('close', () => {
      if (httpSession.sseResponse === res) {
        httpSession.sseResponse = undefined;
      }
      console.log(`[HttpMCPTransport] SSE stream closed for session ${mcpSessionId}`);
    });

    // Keep-alive ping every 55 seconds — just under typical 60s proxy idle timeout.
    // Only fires while a client SSE connection is open; zero cost when no users.
    const pingInterval = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(pingInterval);
        return;
      }
      res.write(': ping\n\n');
    }, 55_000);

    req.on('close', () => clearInterval(pingInterval));
  }

  /**
   * Push a JSON-RPC notification to the client's open SSE stream (if any).
   * Called from makeContext's sendNotification callback so the message handler
   * can deliver server-initiated events (e.g. CIBA progress, tools/list_changed).
   */
  private publishSse(mcpSessionId: string, notification: object): void {
    const httpSession = this.sessions.get(mcpSessionId);
    const res = httpSession?.sseResponse;
    if (!res || res.writableEnded) return;
    const data = JSON.stringify(notification);
    res.write(`data: ${data}\n\n`);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private makeContext(
    connectionId: string,
    bankingSession: any,
    agentToken?: string
  ): MessageHandlerContext {
    // connectionId for HTTP sessions equals the MCP-Session-Id, so we can route
    // server-initiated notifications to the client's open SSE stream (if any).
    const sendNotification = this.sessions.has(connectionId)
      ? (notification: object) => this.publishSse(connectionId, notification)
      : undefined;

    return {
      connectionId,
      agentToken,
      session: bankingSession,
      sendNotification,
    };
  }

  private extractBearer(req: IncomingMessage): string | null {
    const auth = req.headers['authorization'] as string | undefined;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) return null;
    return auth.slice(7).trim() || null;
  }

  /**
   * Extract and validate the bearer token. On failure, writes a 401 (with
   * WWW-Authenticate) and returns null so the caller can simply `return`.
   * Shared by POST/GET/DELETE /mcp so every method enforces the same auth.
   * 
   * Per 2026-07-28 SEP-2468 (RFC 9207), validates the 'iss' claim to prevent
   * authorization server mix-up attacks.
   */
  private async authenticateBearer(req: IncomingMessage, res: ServerResponse): Promise<AuthenticatedBearer | null> {
    const bearer = this.extractBearer(req);
    if (!bearer) {
      this.sendUnauthorized(res, 'Bearer token required');
      return null;
    }
    // The returned info carries whether the signature was actually verified and,
    // if so, the claims it covers. Callers that authorize on a claim use those —
    // never a re-decode of the raw token, which proves nothing.
    let tokenInfo: AgentTokenInfo;
    try {
      tokenInfo = await this.authManager.validateAgentToken(bearer);
    } catch {
      this.sendUnauthorized(res, 'Invalid or expired token');
      return null;
    }
    // RFC 9207 / SEP-2468: Validate 'iss' claim to prevent authorization server
    // mix-up attacks. Only check if signature was verified (claims are untrustworthy otherwise).
    if (tokenInfo.signatureVerified && tokenInfo.verifiedClaims) {
      const issFromToken = (tokenInfo.verifiedClaims as any)?.iss;
      const expectedIssuer = process.env.PINGONE_ISSUER || this.config.authServerUrl;
      if (issFromToken && expectedIssuer && issFromToken !== expectedIssuer) {
        console.warn(
          `[HttpMCPTransport][RFC9207] Issuer mismatch: token iss="${issFromToken}" ` +
          `does not match PINGONE_ISSUER="${expectedIssuer}" — rejecting token as potential mix-up attack`
        );
        this.sendUnauthorized(res, 'Invalid token issuer (RFC 9207 check failed)');
        return null;
      }
    }
    // DPoP (RFC 9449) — bridged enforcement. The gateway verifies the DPoP proof with
    // real crypto on the BFF→gateway hop and bridges the outcome via X-DPoP-Verified
    // (the same trusted-internal-hop model as the act/may_act bridge, since the proof
    // header itself does not survive the hop). Fail-closed only when REQUIRE_DPOP_PROOF
    // is set, so the demo can run with the flag on but enforcement observe-only.
    if (process.env.REQUIRE_DPOP_PROOF === 'true') {
      const verified = (req.headers['x-dpop-verified'] as string | undefined) === 'true';
      // X-DPoP-Verified is an assertion made by the gateway, so it is only worth as
      // much as proof that the gateway is the one making it. GW_MCP_BRIDGE_SECRET is
      // that proof and is now REQUIRED (was: `!bridgeSecret ||` — an unset secret
      // trusted the header from any caller, so anyone able to reach the MCP port could
      // send X-DPoP-Verified: true and satisfy the gate with no DPoP proof at all).
      const bridgeSecret = process.env.GW_MCP_BRIDGE_SECRET;
      if (!bridgeSecret) {
        console.error('[HttpMCPTransport][DPoP] REQUIRE_DPOP_PROOF=true but GW_MCP_BRIDGE_SECRET is unset — X-DPoP-Verified cannot be authenticated, refusing.');
        this.sendUnauthorized(res, 'DPoP bridge not configured (GW_MCP_BRIDGE_SECRET required to trust X-DPoP-Verified)');
        return null;
      }
      const secretOk = (req.headers['x-gw-bridge-secret'] as string | undefined) === bridgeSecret;
      if (!verified || !secretOk) {
        this.sendUnauthorized(res, 'DPoP proof required (sender-constrained token)');
        return null;
      }
    }
    return { token: bearer, tokenInfo };
  }

  /**
   * Streamable HTTP requires the client to accept application/json and/or
   * text/event-stream. We're lenient: an absent Accept (CLI/server-to-server) or
   * a wildcard accept-all is allowed; only an explicit Accept matching neither
   * MIME type is rejected (406).
   */
  private acceptsStreamableHttp(req: IncomingMessage): boolean {
    const accept = (req.headers['accept'] as string | undefined)?.toLowerCase();
    if (!accept) return true;
    return (
      accept.includes('*/*') ||
      accept.includes('application/json') ||
      accept.includes('text/event-stream')
    );
  }

  private isSessionExpired(session: HttpSession): boolean {
    return Date.now() - session.lastAccessedAt.getTime() > this.sessionTtlMs;
  }

  /**
   * Remove an HTTP session: end its SSE stream, drop it from the map, and remove
   * the underlying banking session it created at initialize. Without the latter
   * the banking session would be orphaned until BankingSessionManager's own
   * (much longer) sweeper reaped it.
   */
  private async deleteSession(mcpSessionId: string): Promise<void> {
    const session = this.sessions.get(mcpSessionId);
    if (!session) return;
    if (session.sseResponse) {
      try { session.sseResponse.end(); } catch { /* ignore */ }
    }
    this.sessions.delete(mcpSessionId);
    try {
      await this.sessionManager.removeSession(session.bankingSessionId);
    } catch {
      // Already gone / store unavailable — the banking sweeper is the backstop.
    }
  }

  /** Evict all idle-expired sessions (called on initialize; no background timer). */
  private async sweepExpiredSessions(): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (this.isSessionExpired(session)) await this.deleteSession(id);
    }
  }

  private sendUnauthorized(res: ServerResponse, detail: string, options?: {
    authorizationUrl?: string;
    requiredScopes?: string[];
    requestId?: string;
  }): void {
    const base = this.resourceBaseUrl();
    const scopePart = options?.requiredScopes && options.requiredScopes.length > 0
      ? `, scope="${options.requiredScopes.join(' ')}"`
      : '';
    
    const errorResponse = {
      error: 'unauthorized',
      error_description: detail,
      error_code: -32001, // MCPErrorCode.UNAUTHORIZED
      resource_metadata: `${base}/.well-known/oauth-protected-resource`,
      timestamp: new Date().toISOString(),
      request_id: options?.requestId
    };
    
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 
        `Bearer realm="Demo MCP Server"${scopePart}, ` +
        `error="unauthorized", ` +
        `error_description="${detail}", ` +
        `resource_metadata="${base}/.well-known/oauth-protected-resource"`
    });
    
    res.end(JSON.stringify(errorResponse, null, 2));
  }

  /**
   * 403 Insufficient Scope — SHOULD per spec §Authorization when token is valid but lacks scope.
   * Returns structured WWW-Authenticate with the missing scope so clients can request it.
   */
  private sendInsufficientScope(
    res: ServerResponse, 
    requiredScopes: string[], 
    options?: { requestId?: string }
  ): void {
    const base = this.resourceBaseUrl();
    
    const errorResponse = {
      error: 'insufficient_scope',
      error_description: `Token is missing required scope(s): ${requiredScopes.join(', ')}`,
      error_code: -32005, // MCPErrorCode.INSUFFICIENT_SCOPE
      required_scope: requiredScopes.join(' '),
      resource_metadata: `${base}/.well-known/oauth-protected-resource`,
      timestamp: new Date().toISOString(),
      request_id: options?.requestId
    };
    
    res.writeHead(403, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 
        `Bearer realm="Demo MCP Server", ` +
        `error="insufficient_scope", ` +
        `scope="${requiredScopes.join(' ')}", ` +
        `error_description="Token is missing required scope(s): ${requiredScopes.join(', ')}", ` +
        `resource_metadata="${base}/.well-known/oauth-protected-resource"`
    });
    
    res.end(JSON.stringify(errorResponse, null, 2));
  }

  private sendHttpError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }

  private sendJsonRpcError(
    res: ServerResponse,
    id: string | number | null,
    code: number,
    message: string,
    data?: any
  ): void {
    const errorResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data: {
          type: 'json_rpc',
          details: data,
          timestamp: new Date().toISOString(),
          request_id: typeof id === 'string' ? id : undefined,
          server: 'Demo MCP Server',
          version: process.env.npm_package_version || '1.0.0'
        }
      }
    };
    
    const httpStatus = this.mapErrorCodeToHttpStatus(code);
    res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse, null, 2));
  }

  private mapErrorCodeToHttpStatus(code: number): number {
    switch (code) {
      case -32700: // PARSE_ERROR
      case -32600: // INVALID_REQUEST
      case -32602: // INVALID_PARAMS
        return 400;
      case -32001: // UNAUTHORIZED
        return 401;
      case -32005: // INSUFFICIENT_SCOPE
      case -32002: // FORBIDDEN
        return 403;
      case -32601: // METHOD_NOT_FOUND
      case -32006: // TOOL_NOT_FOUND
        return 404;
      case -32008: // RATE_LIMITED
        return 429;
      case -32603: // INTERNAL_ERROR
      case -32007: // TOOL_EXECUTION_ERROR
        return 500;
      default:
        return 500;
    }
  }

  private isOriginAllowed(req: IncomingMessage): boolean {
    const origin = req.headers['origin'] as string | undefined;
    if (!origin) {
      // No Origin header — non-browser client (CLI, MCP Inspector, server-to-server); allow.
      return true;
    }
    if (this.config.allowedOrigins.length === 0) {
      // No restriction configured — allow all.
      return true;
    }
    return this.config.allowedOrigins.includes(origin);
  }

  private resourceBaseUrl(): string {
    // Strip trailing slash if present
    return this.config.resourceUrl.replace(/\/+$/, '');
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const MAX_BYTES = 1024 * 1024; // 1 MB
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
}
