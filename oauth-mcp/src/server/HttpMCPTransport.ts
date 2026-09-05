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
 *   GET  /sse                                    — legacy HTTP+SSE transport (2024-11-05) stream
 *   POST /messages?sessionId=…                   — legacy HTTP+SSE transport inbound channel
 *
 * The legacy HTTP+SSE pair exists for ONE caller: the PingOne Privilege AI
 * Gateway's discovery client, which opens a bare GET and waits for the SSE
 * `endpoint` event rather than POSTing `initialize` (see
 * .claude/skills/privilege-mcpgw-agent-k8s). Without it, registering this
 * server as an Agentic App fails with "Gateway Unreachable — Error discovering
 * MCP server: calling initialize: Unauthorized", which reads as an auth fault
 * and is not one. It is deliberately NOT served on GET /mcp: that path requires
 * a bearer to open the server→client stream, and keeping it that way matters
 * more than supporting a catalog-pinned backend URL.
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
import { resolveEmbeddedIssuer } from '../oauth/embeddedIssuer';
import { openClientRegistrationEnabled } from '../oauth/ClientRegistry';
import { BANKING_SCOPES as SHARED_BANKING_SCOPES } from '../oauth/scopes';

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

// The protocol revision the legacy HTTP+SSE transport belongs to. Its clients
// predate the MCP-Protocol-Version header, so /messages supplies this on their
// behalf when they omit it (see handleLegacySseMessage) rather than 400ing on a
// header their transport generation never had.
const LEGACY_SSE_PROTOCOL_VERSION = '2024-11-05';

// Idle SSE streams get dropped by proxies; a comment frame keeps them open.
const LEGACY_SSE_KEEPALIVE_MS = 25_000;

// Opening a legacy stream is unauthenticated (it must be — the gateway
// discovers tokenless), so cap concurrent streams: each one costs a socket and
// a timer, and nothing else bounds them.
const MAX_LEGACY_SSE_STREAMS = 64;

// Shared with the authorization-server metadata in OAuthRouter — see oauth/scopes.ts
// for why these must not be declared in two places.
const BANKING_SCOPES = [...SHARED_BANKING_SCOPES];

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
  /**
   * True only when open-access mode admitted a request that carried no usable
   * bearer — the Privilege gateway hop, which authorizes upstream. It means
   * "someone else already decided", NOT "a token with an empty scope set".
   * A validated bearer never sets it, so enforcement stays on for every other
   * caller while the mode is enabled.
   */
  openAccess?: boolean;
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

/**
 * A ServerResponse stand-in that captures what handlePost writes instead of
 * sending it, so the legacy HTTP+SSE transport can deliver the reply on the SSE
 * stream (where that transport expects it) while the POST itself just ACKs.
 *
 * Reusing handlePost verbatim is the entire point: it owns the bearer gate, the
 * discovery allowlist, session handling and every security check. A second
 * dispatch path for /messages would be a second place for those to drift — and
 * an unauthenticated `tools/call` is exactly what that drift would look like.
 *
 * handlePost and every helper it delegates to touch only writeHead() and end()
 * — no write(), setHeader() or headersSent — so this is the whole surface.
 */
class CapturedResponse {
  statusCode = 200;
  readonly headers: Record<string, string> = {};
  private body = '';

  writeHead(status: number, headers?: unknown): this {
    this.statusCode = status;
    if (headers && typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
        this.headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      }
    }
    return this;
  }

  end(chunk?: unknown): this {
    if (typeof chunk === 'string') this.body += chunk;
    return this;
  }

  /** The JSON-RPC payload handlePost produced, or '' for a 202/no-body reply. */
  get payload(): string {
    return this.body;
  }
}

export class HttpMCPTransport {
  /**
   * MCP-Session-Id → HTTP session metadata.
   * All sessions share the same BankingSessionManager used by WebSocket connections.
   */
  private readonly sessions = new Map<string, HttpSession>();

  /**
   * Legacy HTTP+SSE transport: our own session id → the open stream and its
   * keep-alive timer. Separate from `sessions` above on purpose — that map is
   * Streamable HTTP's MCP-Session-Id, a different identifier with different
   * lifetime rules, and conflating them would let one transport's session
   * terminate the other's stream.
   */
  private readonly legacySseStreams = new Map<string, {
    res: ServerResponse;
    keepAlive: NodeJS.Timeout;
    /**
     * The Streamable-HTTP session id that the `initialize` flowing over THIS
     * stream created. handlePost hands it back in a response header, which a
     * legacy client never sees (it reads only the SSE body), so the stream
     * remembers it and presents it on that client's behalf for every later
     * message. Without this, everything after initialize is "Unknown or
     * expired MCP-Session-Id".
     */
    mcpSessionId?: string;
  }>();

  /** Idle TTL for HTTP sessions (ms). Override with MCP_HTTP_SESSION_TTL_MS. */
  private readonly sessionTtlMs: number;

  /** When true, skip bearer validation entirely — all callers are trusted. */
  private readonly authDisabled = process.env.MCP_AUTH_DISABLED === 'true';

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

    // RFC 9728 §3.1: a client constructs this URL as <well-known>/<resource-path>
    // (e.g. .../oauth-protected-resource/mcp), not just the bare well-known
    // path — match the segment-delimited suffix too, or such a request 404s
    // here even after the ingress correctly routes it (see
    // k8s/aws/se-ingress.yaml's matching fix).
    if (
      pathname === '/.well-known/oauth-protected-resource' ||
      pathname.startsWith('/.well-known/oauth-protected-resource/')
    ) {
      this.handleMetadata(req, res);
      return;
    }

    // Internal audit endpoint (proxied by BFF /api/mcp/audit — admin-gated at BFF level).
    // Bearer + admin:read required: audit data contains PII and security-sensitive events.
    // Under MCP_AUTH_DISABLED the scope gate must not fail closed (mirrors
    // AuthenticationIntegration's tool-path fallback): PingOne refuses to mint
    // admin:read alongside mcp:invoke in one client-credentials token ("May not
    // request scopes for multiple resources"), so the BFF's token-chain poll can
    // never present admin:read here and every /audit fetch answered 403 — the
    // ProofStrip then reported "Run failed before authorize-decision" on runs
    // that actually succeeded.
    if (pathname === '/audit' && req.method === 'GET') {
      const authed = await this.authenticateBearer(req, res);
      if (!authed) return;
      const hasAdmin = await this.authManager.validateTokenScopes(authed.token, ['admin:read']);
      if (!hasAdmin) {
        if (process.env.MCP_AUTH_DISABLED !== 'true') {
          this.sendInsufficientScope(res, ['admin:read']);
          return;
        }
        console.warn(
          '[HttpMCPTransport] MCP_AUTH_DISABLED=true — serving GET /audit despite missing admin:read; the caller in front of this server owns authorization'
        );
      }
      await this.handleAuditQuery(req, res);
      return;
    }

    // Demo reset: clear in-memory audit log (BFF reset-demo route calls this).
    // Bearer + admin:write required — wiping the audit trail is privileged.
    // Same open-access fallback as GET: the BFF cannot carry admin:write and
    // mcp:invoke in one token either, so reset-demo 403s under MCP_AUTH_DISABLED.
    if (pathname === '/audit' && req.method === 'DELETE') {
      const authed = await this.authenticateBearer(req, res);
      if (!authed) return;
      const hasAdmin = await this.authManager.validateTokenScopes(authed.token, ['admin:write']);
      if (!hasAdmin) {
        if (process.env.MCP_AUTH_DISABLED !== 'true') {
          this.sendInsufficientScope(res, ['admin:write']);
          return;
        }
        console.warn(
          '[HttpMCPTransport] MCP_AUTH_DISABLED=true — allowing DELETE /audit despite missing admin:write; the caller in front of this server owns authorization'
        );
      }
      AuditLogger.clearEvents();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Audit log cleared' }));
      return;
    }

    // Legacy HTTP+SSE transport (2024-11-05). See the file header for why this
    // exists and why it is not also mounted on GET /mcp.
    if (pathname === '/sse' && req.method === 'GET') {
      this.handleLegacySseOpen(req, res);
      return;
    }
    if (pathname === '/messages' && req.method === 'POST') {
      await this.handleLegacySseMessage(req, res);
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
    // When this server admits clients it has never seen, the AS they must use is
    // the embedded one — it is the only one that can register them, because
    // PingOne has no dynamic client registration. Advertising PingOne here sends
    // such a client somewhere it can never obtain a client_id, and the failure
    // lands at the far end of the discovery chain where nothing names the cause.
    // The resource identifier is derived from the same issuer so the document
    // describes the server as external clients actually address it, rather than
    // by its in-cluster MCP_RESOURCE_URL.
    const openRegistration = openClientRegistrationEnabled();
    const embeddedIssuer = openRegistration ? resolveEmbeddedIssuer() : '';
    const base = embeddedIssuer || this.resourceBaseUrl();
    const baseMetadata = {
      resource: `${base}/mcp`,
      authorization_servers: [embeddedIssuer || this.config.authServerUrl],
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
    const isDiscovery = isInitialize
      || message.method === 'tools/list'
      || message.method === 'notifications/initialized';

    // 2. Bearer token — required on every request except discovery methods
    // (initialize, notifications/initialized, tools/list). These are
    // unauthenticated so MCP clients and gateways (e.g. PingOne Privilege) can
    // discover capabilities before auth. notifications/initialized is included
    // because the spec REQUIRES it between initialize and tools/list — gating it
    // made the mandatory handshake impossible for tokenless discovery
    // ("Error discovering MCP server: sending "notifications/initialized": Unauthorized").
    // Only this one notification is exempt; all others still authenticate.
    let bearerToken: string | undefined;
    let tokenInfo: Awaited<ReturnType<typeof this.authManager.validateAgentToken>> | undefined;
    // Set only for a request the open-access hop admitted without a usable
    // bearer. Every downstream bypass keys off THIS, not off the env var, so
    // turning the mode on for one gateway cannot disarm the other's enforcement.
    let openAccess = false;
    if (!isDiscovery) {
      const authed = await this.authenticateBearer(req, res);
      if (!authed) return;
      bearerToken = authed.token;
      tokenInfo = authed.tokenInfo;
      openAccess = authed.openAccess === true;
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
    // apply to authenticated requests — discovery is unauthenticated, and so is
    // an open-access hop admitted without a usable bearer (there is no token to
    // check them against). Keyed off this request's admission, not off the env
    // var: a caller that presented a validated bearer still runs every check
    // below even while open-access mode is on.
    if (!isDiscovery && !openAccess) {

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
      // Discovery initialize may create a session with no bearer. Subsequent
      // authenticated calls must bind the validated request bearer into the
      // session so tool execution / scope checks see the real token — not the
      // empty string stored at unauthenticated initialize (#1166 Privilege path).
      if (bearerToken) {
        httpSession.agentToken = bearerToken;
      }
      // Log protocol version for non-initialize requests (for observability)
      console.log(`[HttpMCPTransport] Request on session ${mcpSessionId} using protocol ${httpSession.protocolVersion}`);
    }

    // 6. Build MCPMessageHandler context, reusing the existing banking session
    const bankingSession = (await this.sessionManager.getSession(httpSession.bankingSessionId)) ?? undefined;
    const context = this.makeContext(
      mcpSessionId,
      bankingSession,
      bearerToken ?? (httpSession.agentToken || undefined),
      openAccess,
    );

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
  // GET /sse  — legacy HTTP+SSE transport (2024-11-05), stream half
  //
  // Unauthenticated by necessity: the Privilege gateway discovers tokenless,
  // and this is the handshake it performs instead of POST initialize. That
  // exposes nothing on its own — no data crosses this stream until a POST
  // /messages arrives, and that runs the full handlePost gate, so the method
  // set reachable here is exactly the one POST /mcp already serves tokenless
  // (initialize, notifications/initialized, tools/list). Everything else still
  // needs a bearer.
  // -------------------------------------------------------------------------

  private handleLegacySseOpen(req: IncomingMessage, res: ServerResponse): void {
    if (this.legacySseStreams.size >= MAX_LEGACY_SSE_STREAMS) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many open SSE streams; retry shortly' }));
      return;
    }

    const sessionId = randomUUID();
    res.writeHead(200, {
      'Content-Type':                'text/event-stream',
      'Cache-Control':               'no-cache, no-transform',
      'Connection':                  'keep-alive',
      'X-Accel-Buffering':           'no', // disable Nginx buffering
      'Access-Control-Allow-Origin': req.headers.origin || '*',
    });

    // THE handshake: it tells the client where to POST. A client that never
    // sees this event waits forever, which is what "Gateway Unreachable"
    // actually is at the far end.
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, LEGACY_SSE_KEEPALIVE_MS);
    // Node keeps the process alive for a pending timer; this one must not.
    keepAlive.unref?.();

    this.legacySseStreams.set(sessionId, { res, keepAlive });
    console.log(`[HttpMCPTransport] legacy SSE stream opened (session ${sessionId})`);

    req.on('close', () => {
      clearInterval(keepAlive);
      this.legacySseStreams.delete(sessionId);
      console.log(`[HttpMCPTransport] legacy SSE stream closed (session ${sessionId})`);
    });
  }

  // -------------------------------------------------------------------------
  // POST /messages?sessionId=…  — legacy HTTP+SSE transport, inbound half
  //
  // Delegates to handlePost so the bearer gate, discovery allowlist and every
  // other check run identically to POST /mcp; only the reply's destination
  // differs (the stream, per that transport, not the POST body).
  // -------------------------------------------------------------------------

  private async handleLegacySseMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = new URL(req.url ?? '/messages', 'http://localhost').searchParams.get('sessionId');
    const stream = sessionId ? this.legacySseStreams.get(sessionId) : undefined;
    if (!stream) {
      // Name the part that is wrong: a stale session id is otherwise
      // indistinguishable from a broken server.
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown or closed SSE session', sessionId }));
      return;
    }

    // This transport predates MCP-Protocol-Version, and handlePost requires it
    // on every non-initialize request. Supply the revision this transport IS,
    // and only when the client sent none — never override what it did send.
    if (!req.headers[MCP_PROTO_HEADER]) {
      req.headers[MCP_PROTO_HEADER] = LEGACY_SSE_PROTOCOL_VERSION;
    }
    // Likewise the session id: it lives in this stream, not in the client's
    // headers. See the mcpSessionId note on legacySseStreams.
    if (!req.headers[MCP_SESSION_HEADER] && stream.mcpSessionId) {
      req.headers[MCP_SESSION_HEADER] = stream.mcpSessionId;
    }

    // handlePost reads the body off `req` itself, so it must not be consumed here.
    const captured = new CapturedResponse();
    await this.handlePost(req, captured as unknown as ServerResponse);

    // Latch the session that `initialize` just created onto this stream.
    const issuedSessionId = captured.headers[MCP_SESSION_HEADER];
    if (issuedSessionId) stream.mcpSessionId = issuedSessionId;

    // The POST is only an ACK in this transport; the reply travels on the stream.
    res.writeHead(202);
    res.end();
    if (captured.payload) {
      stream.res.write(`event: message\ndata: ${captured.payload}\n\n`);
    }
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
    agentToken?: string,
    openAccess?: boolean
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
      openAccess,
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
    if (this.authDisabled) {
      // Open-access mode still keeps a REAL bearer when one is presented. The
      // placeholder below is not a token: handing it downstream as the agent
      // token made every per-tool scope check decode the string 'disabled',
      // fail with "Malformed JWT", and answer -32005 insufficient_scope — so
      // the flag that means "trust all callers" denied every scoped tool call
      // (PingGateway path included, after Authorize had already PERMITted).
      const presented = this.extractBearer(req);
      if (presented) {
        try {
          return { token: presented, tokenInfo: await this.authManager.validateAgentToken(presented) };
        } catch {
          // Unvalidatable token in open-access mode: fall through to the
          // placeholder rather than 401 — that is what the flag asks for.
        }
      }
      // No usable bearer: this is the upstream-authorized hop the flag exists
      // for. Flag it as such rather than letting it look like a token that
      // simply has no scopes — the scope gate keys off openAccess, so the
      // bypass reaches ONLY requests admitted here, never a validated token.
      console.warn(
        `[HttpMCPTransport] Open-access hop admitted a request with ${presented ? 'an unvalidatable' : 'no'} bearer — the upstream gateway owns authorization for it`
      );
      return {
        token: 'disabled',
        openAccess: true,
        tokenInfo: {
          tokenHash: 'disabled',
          clientId: 'anonymous',
          scopes: [],
          expiresAt: new Date(Date.now() + 3_600_000),
          isValid: true,
          signatureVerified: false,
        },
      };
    }
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
    // Two issuers are legitimate here: PingOne (delegated/exchanged tokens) and
    // oauth-mcp's own embedded AS (self-issued via /register + /token, Part A/B
    // of the DCR work). Anything else is still rejected as a mix-up attack.
    if (tokenInfo.signatureVerified && tokenInfo.verifiedClaims) {
      const issFromToken = (tokenInfo.verifiedClaims as any)?.iss;
      const pingOneIssuer = process.env.PINGONE_ISSUER || this.config.authServerUrl;
      const acceptedIssuers = [pingOneIssuer, resolveEmbeddedIssuer()].filter(Boolean);
      if (issFromToken && acceptedIssuers.length > 0 && !acceptedIssuers.includes(issFromToken)) {
        console.warn(
          `[HttpMCPTransport][RFC9207] Issuer mismatch: token iss="${issFromToken}" ` +
          `is not one of the accepted issuers (${acceptedIssuers.join(', ')}) — rejecting token as potential mix-up attack`
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
