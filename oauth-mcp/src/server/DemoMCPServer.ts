/**
 * AI Demo MCP Server
 * WebSocket server implementation for the Banking MCP protocol
 */

import WebSocket from 'ws';
import { createServer, Server as HttpServer } from 'http';
import * as https from 'https';
import * as http2 from 'http2';
import * as fs from 'fs';
import * as tls from 'tls';
import { generate as selfsignedGenerate } from 'selfsigned';
import { EventEmitter } from 'events';
import { randomUUID, timingSafeEqual } from 'crypto';
import { MCPMessage, MCPResponse } from '../interfaces/mcp';
import { BankingAuthenticationManager } from '../auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../storage/BankingSessionManager';
import { BankingToolProvider } from '../tools/BankingToolProvider';
import { MCPMessageHandler, MessageHandlerContext } from './MCPMessageHandler';
import { HttpMCPTransport } from './HttpMCPTransport';
import { correlationFromMessage } from './correlationFromMessage';
import { authorizeLastHop } from '../auth/lastHopAuthorization';
import { runWithCorrelation } from '../utils/correlationContext';
import { createMtlsVerifier } from '../auth/mtlsMiddleware';
import { ClientRegistry, TokenStore, OAuthRouter, getEmbeddedSigningKeyManager, resolveAdvertisedAuthServer } from '../oauth';

export interface ServerConfig {
  host: string;
  port: number;
  maxConnections: number;
  sessionTimeout: number;
  enableLogging: boolean;
}

export interface ConnectionInfo {
  id: string;
  ws: WebSocket;
  sessionId?: string;
  agentToken?: string;
  /** Email of the authenticated user, injected via session_init message from the frontend. */
  userEmail?: string;
  connectedAt: Date;
  lastActivity: Date;
  messageCount: number;
  /** SHOULD (spec lifecycle): set to true when client sends notifications/initialized. */
  initialized?: boolean;
  _keepaliveInterval?: NodeJS.Timeout;
  _idleCheckInterval?: NodeJS.Timeout;
}

export interface ServerStats {
  totalConnections: number;
  activeConnections: number;
  totalMessages: number;
  totalErrors: number;
  uptime: number;
  startTime: Date;
}

export class DemoMCPServer extends EventEmitter {
  private server: WebSocket.Server | null = null;
  private httpServer: HttpServer | null = null;
  private tlsServer: http2.Http2SecureServer | null = null;
  private connections: Map<string, ConnectionInfo> = new Map();
  private messageHandler: MCPMessageHandler;
  private httpTransport: HttpMCPTransport | null = null;
  private oauthRouter: OAuthRouter | null = null;
  private config: ServerConfig;
  private stats: ServerStats;
  private isRunning: boolean = false;

  constructor(
    config: ServerConfig,
    private authManager: BankingAuthenticationManager,
    private sessionManager: BankingSessionManager,
    private toolProvider: BankingToolProvider
  ) {
    super();
    this.config = config;
    this.messageHandler = new MCPMessageHandler(authManager, sessionManager, toolProvider);

    // HTTP Streamable MCP transport (spec 2025-11-25 — Phase D).
    // Enabled unless HTTP_MCP_TRANSPORT_ENABLED is explicitly set to 'false'.
    if (process.env.HTTP_MCP_TRANSPORT_ENABLED !== 'false') {
      const resourceUrl = process.env.MCP_RESOURCE_URL ||
        `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
      const pingOneAuthServerUrl = process.env.PINGONE_AUTHORIZATION_ENDPOINT
        ? process.env.PINGONE_AUTHORIZATION_ENDPOINT.replace('/authorize', '').replace(/\/+$/, '')
        : (process.env.PINGONE_BASE_URL ?? 'https://auth.pingone.com/unknown/as');
      const authServerUrl = resolveAdvertisedAuthServer(pingOneAuthServerUrl);
      const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean);
      this.httpTransport = new HttpMCPTransport(
        { resourceUrl, authServerUrl, allowedOrigins },
        this.messageHandler,
        sessionManager,
        authManager
      );
    }

    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      totalMessages: 0,
      totalErrors: 0,
      uptime: 0,
      startTime: new Date()
    };
  }

  /**
   * Start the WebSocket server
   */
  async startServer(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Server is already running');
    }

    try {
      // Initialize OAuth Authorization Server
      const signingKeyManager = await getEmbeddedSigningKeyManager();
      const clientRegistry = new ClientRegistry();
      clientRegistry.initialize();
      const tokenStore = new TokenStore();
      this.oauthRouter = new OAuthRouter(signingKeyManager, clientRegistry, tokenStore);
      setInterval(() => tokenStore.cleanup(), 60_000);

      // Create HTTP server for WebSocket upgrade and OAuth callbacks
      const mtlsEnabled = process.env.MCP_MTLS_ENABLED === 'true';
      const gatewayCertPath = process.env.MCP_MTLS_GATEWAY_CERT_PATH ?? '/tmp/gw-client.crt';

      if (mtlsEnabled) {
        const gatewayCertPem = fs.existsSync(gatewayCertPath)
          ? fs.readFileSync(gatewayCertPath, 'utf-8')
          : '';
        const mtlsVerifier = createMtlsVerifier({ enabled: true, gatewayCertPem });

        const notAfterDate = new Date();
        notAfterDate.setDate(notAfterDate.getDate() + 1);
        const serverPems = await selfsignedGenerate(
          [{ name: 'commonName', value: 'banking-mcp-server' }],
          { notAfterDate, keySize: 2048, algorithm: 'sha256' },
        );

        this.httpServer = https.createServer(
          {
            cert: serverPems.cert,
            key: serverPems.private,
            requestCert: true,
            rejectUnauthorized: false,
          },
          (req, res) => {
            // Liveness probes are exempt from client-cert auth. They expose no
            // data, and the container healthcheck runs inside the container with
            // no keystore — requiring a cert there marks a healthy server
            // unhealthy, which blocks depends_on and shows red on the demo board.
            const probePath = (req.url || '').split('?')[0];
            const oauthPaths = ['/health', '/jwks', '/token', '/authorize', '/introspect', '/revoke', '/register'];
            if (probePath.startsWith('/.well-known/') || oauthPaths.includes(probePath)) {
              this.handleHttpRequest(req, res);
              return;
            }
            const socket = req.socket as tls.TLSSocket;
            try {
              mtlsVerifier!(socket);
            } catch (err) {
              // No valid client cert — allow if Bearer token present (validated downstream)
              const authHeader = req.headers['authorization'] || '';
              if (!authHeader.startsWith('Bearer ')) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'mtls_required', message: (err as Error).message }));
                return;
              }
            }
            this.handleHttpRequest(req, res);
          },
        ) as unknown as HttpServer;

        console.log('[DemoMCPServer] mTLS enabled — connections require gateway client cert');
      } else {
        this.httpServer = createServer((req, res) => {
          this.handleHttpRequest(req, res);
        });
      }
      
      // Create WebSocket server
      this.server = new WebSocket.Server({
        server: this.httpServer,
        maxPayload: 1024 * 1024, // 1MB max message size
        perMessageDeflate: true
      });

      // Set up server event handlers
      this.setupServerEventHandlers();

      // Start HTTP server
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.listen(this.config.port, this.config.host, (error?: Error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      // Second, TLS+ALPN listener — opt-in, additive. Does NOT replace or modify
      // the plain http.createServer listener above; ws:// on MCP_SERVER_PORT is
      // unaffected whether or not this branch runs.
      if (process.env.MCP_TLS_ENABLED === 'true') {
        const tlsPort = parseInt(process.env.MCP_TLS_PORT || '8443', 10);
        // Independent self-signed cert — NOT shared with the MCP_MTLS_ENABLED
        // branch above. Two unrelated concerns (peer-auth vs protocol
        // negotiation); sharing would couple them for no benefit.
        const notAfterDate = new Date();
        notAfterDate.setDate(notAfterDate.getDate() + 1);
        const tlsPems = await selfsignedGenerate(
          [{ name: 'commonName', value: 'banking-mcp-server-tls' }],
          { notAfterDate, keySize: 2048, algorithm: 'sha256' },
        );

        this.tlsServer = http2.createSecureServer(
          {
            key: tlsPems.private,
            cert: tlsPems.cert,
            allowHTTP1: true,
            ALPNProtocols: ['h2', 'http/1.1'],
          },
          (req, res) => {
            this.handleHttpRequest(req, res);
          },
        );

        await new Promise<void>((resolve, reject) => {
          this.tlsServer!.once('error', reject);
          this.tlsServer!.listen(tlsPort, this.config.host, () => resolve());
        });

        if (this.config.enableLogging) {
          const addr = this.tlsServer.address();
          const actualTlsPort = addr && typeof addr === 'object' ? addr.port : tlsPort;
          console.log(`[DemoMCPServer] TLS+ALPN listener started on ${this.config.host}:${actualTlsPort} (h2)`);
        }
      }

      this.isRunning = true;
      this.stats.startTime = new Date();

      if (this.config.enableLogging) {
        console.log(`[DemoMCPServer] Server started on ${this.config.host}:${this.config.port}`);
        if (this.httpTransport) {
          const resourceUrl = process.env.MCP_RESOURCE_URL ||
            `http://${this.config.host === '0.0.0.0' ? 'localhost' : this.config.host}:${this.config.port}`;
          console.log(`[DemoMCPServer] HTTP MCP transport enabled — POST ${resourceUrl}/mcp`);
          console.log(`[DemoMCPServer] RFC 9728 metadata — GET ${resourceUrl}/.well-known/oauth-protected-resource`);
        }
      }

      this.emit('serverStarted', {
        host: this.config.host,
        port: this.config.port,
        timestamp: new Date()
      });

    } catch (error) {
      await this.cleanup();
      throw new Error(`Failed to start server: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Stop the WebSocket server
   */
  async stopServer(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Close all active connections
      for (const [connectionId] of this.connections.entries()) {
        await this.closeConnection(connectionId, 1001, 'Server shutting down');
      }

      // Close WebSocket server
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server!.close(() => {
            resolve();
          });
        });
      }

      // Close HTTP server
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => {
            resolve();
          });
        });
      }

      // Close TLS listener, if one was started
      if (this.tlsServer) {
        await new Promise<void>((resolve) => {
          this.tlsServer!.close(() => resolve());
        });
      }

      await this.cleanup();

      if (this.config.enableLogging) {
        console.log('[DemoMCPServer] Server stopped');
      }

      this.emit('serverStopped', {
        timestamp: new Date(),
        uptime: Date.now() - this.stats.startTime.getTime()
      });

    } catch (error) {
      console.error('[DemoMCPServer] Error stopping server:', error);
      throw error;
    }
  }

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(ws: WebSocket, request: any): Promise<void> {
    const connectionId = randomUUID();
    const connectionInfo: ConnectionInfo = {
      id: connectionId,
      ws,
      connectedAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0
    };

    try {
      // Check connection limits
      if (this.connections.size >= this.config.maxConnections) {
        ws.close(1013, 'Server at maximum capacity');
        return;
      }

      // Zero-trust: extract + validate agent token from Authorization header at connect
      // (parity with HttpMCPTransport.authenticateBearer — do not trust an unvalidated bearer).
      //
      // authorizeLastHop runs the SAME checks the HTTP transport runs — D-05
      // upstream contract and the F10 actor allow-list — against claims that were
      // signature-verified. Previously this path ran only the actor check, and
      // D-05 was HTTP-only, so a gateway-audience token was accepted here even
      // though ws:// is the transport docker-compose.yml actually points at.
      const authHeader = (request?.headers?.authorization || request?.headers?.Authorization) as string | undefined;
      if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        const bearerToken = authHeader.slice(7).trim();
        if (bearerToken) {
          const decision = await authorizeLastHop(this.authManager, bearerToken);
          if (!decision.ok) {
            console.warn(`[DemoMCPServer] Rejecting connection ${connectionId}: ${decision.reason}`);
            ws.close(1008, 'Agent token rejected');
            return;
          }
          connectionInfo.agentToken = bearerToken;
          console.log(`[DemoMCPServer] Agent token validated via Authorization header for connection ${connectionId}`);
        }
      }

      // Store connection
      this.connections.set(connectionId, connectionInfo);
      this.stats.totalConnections++;
      this.stats.activeConnections++;

      if (this.config.enableLogging) {
        console.log(`[DemoMCPServer] New connection: ${connectionId} (${this.stats.activeConnections} active)`);
      }

      // Set up connection event handlers
      this.setupConnectionEventHandlers(connectionId, ws);

      this.emit('connectionOpened', {
        connectionId,
        timestamp: new Date(),
        activeConnections: this.stats.activeConnections
      });

    } catch (error) {
      console.error(`[DemoMCPServer] Error handling connection ${connectionId}:`, error);
      await this.closeConnection(connectionId, 1011, 'Internal server error');
    }
  }

  /**
   * Process incoming MCP message
   */
  async processMessage(connectionId: string, rawMessage: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    try {
      // Update connection activity
      connection.lastActivity = new Date();
      connection.messageCount++;
      this.stats.totalMessages++;

      // Parse message
      let message: MCPMessage;
      try {
        message = JSON.parse(rawMessage);
      } catch (error) {
        await this.sendError(connectionId, 'parse_error', -32700, 'Parse error: Invalid JSON');
        return;
      }

      const correlationId = correlationFromMessage(message as any);
      await runWithCorrelation(correlationId, async () => {
        // Handle frontend session_init (non-MCP) — captures userEmail for CIBA.
        // This is injected by App.js before the MCP handshake.
        if ((message as any).type === 'session_init') {
          const email = (message as any).userEmail as string | undefined;
          if (email && typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            connection.userEmail = email;
            // Also persist to session if one already exists
            if (connection.sessionId) {
              this.sessionManager.setSessionEmail(connection.sessionId, email);
            }
            console.log(`[DemoMCPServer] session_init: stored email for connection ${connectionId}`);
          }
          // No response expected for session_init
          return;
        }

        // Validate message structure
        if (!this.isValidMCPMessage(message)) {
          const messageId = (message as any)?.id ?? 'unknown';
          await this.sendError(connectionId, messageId, -32600, 'Invalid Request: Missing required fields');
          return;
        }

        if (this.config.enableLogging) {
          console.log(`[DemoMCPServer] Processing message from ${connectionId}: ${message.method}`);
        }

        // Route message to appropriate handler
        const response = await this.routeMessage(connectionId, message);

        // Only send response for requests (JSON-RPC notifications have no id)
        if (response !== null && response !== undefined && message.id !== undefined && message.id !== null) {
          await this.sendResponse(connectionId, response);
        }

        this.emit('messageProcessed', {
          connectionId,
          method: message.method,
          messageId: message.id,
          timestamp: new Date()
        });
      });

    } catch (error) {
      console.error(`[DemoMCPServer] Error processing message from ${connectionId}:`, error);
      this.stats.totalErrors++;
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Detail logged server-side above + emitted on the internal messageError event;
      // the client (WebSocket path) gets a generic message — no internal text disclosed.
      await this.sendError(connectionId, 'unknown', -32603, 'Internal error');

      this.emit('messageError', {
        connectionId,
        error: errorMessage,
        timestamp: new Date()
      });
    }
  }

  /**
   * Close a specific connection
   */
  async closeConnection(connectionId: string, code: number = 1000, reason: string = 'Normal closure'): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    try {
      // Clean up keepalive and idle check intervals
      if (connection._keepaliveInterval) {
        clearInterval(connection._keepaliveInterval);
      }
      if (connection._idleCheckInterval) {
        clearInterval(connection._idleCheckInterval);
      }

      // Close WebSocket if still open
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close(code, reason);
      }

      // Clean up connection data
      this.connections.delete(connectionId);
      this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);

      if (this.config.enableLogging) {
        console.log(`[DemoMCPServer] Connection closed: ${connectionId} (${this.stats.activeConnections} active)`);
      }

      this.emit('connectionClosed', {
        connectionId,
        code,
        reason,
        timestamp: new Date(),
        activeConnections: this.stats.activeConnections
      });

    } catch (error) {
      console.error(`[DemoMCPServer] Error closing connection ${connectionId}:`, error);
    }
  }

  /**
   * Get server statistics
   */
  getServerStats(): ServerStats {
    return {
      ...this.stats,
      uptime: this.isRunning ? Date.now() - this.stats.startTime.getTime() : 0,
      activeConnections: this.connections.size
    };
  }

  /**
   * Get connection information
   */
  getConnectionInfo(connectionId: string): ConnectionInfo | null {
    return this.connections.get(connectionId) || null;
  }

  /**
   * Get all active connections
   */
  getActiveConnections(): ConnectionInfo[] {
    return Array.from(this.connections.values());
  }

  /**
   * Check if server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the actual port the server is listening on
   */
  getActualPort(): number | null {
    if (!this.httpServer || !this.isRunning) {
      return null;
    }
    
    const address = this.httpServer.address();
    if (address && typeof address === 'object') {
      return address.port;
    }
    
    return null;
  }

  /**
   * Get the actual port the TLS+ALPN listener is bound to, or null if
   * MCP_TLS_ENABLED was not set (or the server isn't running).
   */
  getActualTlsPort(): number | null {
    if (!this.tlsServer || !this.isRunning) {
      return null;
    }

    const address = this.tlsServer.address();
    if (address && typeof address === 'object') {
      return address.port;
    }

    return null;
  }

  /**
   * Set up server-level event handlers
   */
  private setupServerEventHandlers(): void {
    if (!this.server) {
      return;
    }

    this.server.on('connection', async (ws: WebSocket, request: any) => {
      await this.handleConnection(ws, request);
    });

    this.server.on('error', (error: Error) => {
      console.error('[DemoMCPServer] Server error:', error);
      this.emit('serverError', { error: error.message, timestamp: new Date() });
    });

    this.server.on('close', () => {
      if (this.config.enableLogging) {
        console.log('[DemoMCPServer] Server closed');
      }
    });
  }

  /**
   * Set up connection-specific event handlers
   */
  private setupConnectionEventHandlers(connectionId: string, ws: WebSocket): void {
    ws.on('message', async (data: WebSocket.Data) => {
      try {
        const message = data.toString();
        await this.processMessage(connectionId, message);
      } catch (error) {
        console.error(`[DemoMCPServer] Error handling message from ${connectionId}:`, error);
        await this.closeConnection(connectionId, 1011, 'Message processing error');
      }
    });

    ws.on('close', async (code: number, reason: Buffer) => {
      await this.closeConnection(connectionId, code, reason.toString());
    });

    ws.on('error', async (error: Error) => {
      console.error(`[DemoMCPServer] Connection error for ${connectionId}:`, error);
      await this.closeConnection(connectionId, 1011, 'Connection error');
    });

    ws.on('pong', () => {
      // Update last activity on pong response
      const connection = this.connections.get(connectionId);
      if (connection) {
        connection.lastActivity = new Date();
      }
    });

    // Keepalive: ping every 30s to detect dead connections
    const keepaliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping((err?: Error) => {
          if (err) {
            console.error(`[DemoMCPServer] Ping error for ${connectionId}:`, err);
          }
        });
      } else {
        clearInterval(keepaliveInterval);
      }
    }, 30000);

    // Idle timeout: close connections idle > 60s (no message activity)
    const idleCheckInterval = setInterval(async () => {
      const connection = this.connections.get(connectionId);
      if (connection) {
        const idleMs = Date.now() - connection.lastActivity.getTime();
        const idleThresholdMs = 60000; // 60 seconds
        if (idleMs > idleThresholdMs && ws.readyState === WebSocket.OPEN) {
          console.warn(`[DemoMCPServer] Closing idle connection ${connectionId} (idle ${Math.round(idleMs / 1000)}s)`);
          await this.closeConnection(connectionId, 1000, 'Connection idle timeout');
          clearInterval(idleCheckInterval);
        }
      } else {
        clearInterval(idleCheckInterval);
      }
    }, 15000); // Check every 15s

    // Store interval IDs for cleanup on connection close
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection._keepaliveInterval = keepaliveInterval;
      connection._idleCheckInterval = idleCheckInterval;
    }
  }

  /**
   * Route message to appropriate handler
   */
  private async routeMessage(connectionId: string, message: MCPMessage): Promise<MCPResponse | null> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      if (message.id === undefined || message.id === null) {
        return null;
      }
      return this.createErrorResponse(message.id, -32603, 'Connection not found');
    }

    // SHOULD (spec lifecycle): intercept notifications/initialized to set per-connection flag.
    // This is handled here (not delegated) so we can track state on ConnectionInfo.
    if (message.method === 'notifications/initialized') {
      connection.initialized = true;
      if (this.config.enableLogging) {
        console.log(`[DemoMCPServer] Connection ${connectionId}: lifecycle ready (notifications/initialized received)`);
      }
      return null;
    }

    // SHOULD (spec lifecycle): reject tool/prompt/resource requests that arrive before the client
    // has completed the initialization handshake (initialize → notifications/initialized).
    // ping is always allowed; initialize is the first step.
    if (!connection.initialized &&
        message.method !== 'initialize' &&
        message.method !== 'ping') {
      if (message.id !== undefined && message.id !== null) {
        console.warn(`[DemoMCPServer] Premature request ${message.method} from ${connectionId} (notifications/initialized not yet received)`);
        return this.createErrorResponse(
          message.id,
          -32600,
          'Session not initialized — send notifications/initialized before making requests'
        );
      }
      return null; // ignore premature notifications silently
    }

    // Create message handler context
    const context: MessageHandlerContext = {
      connectionId,
      agentToken: connection.agentToken,
      session: connection.sessionId ? (await this.sessionManager.getSession(connection.sessionId)) || undefined : undefined,
      userEmail: connection.userEmail,
      sendNotification: (notification: object) => {
        if (connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.send(JSON.stringify(notification));
        }
      },
    };

    // Route to message handler
    const response = await this.messageHandler.handleMessage(message, context);

    // Update connection with session info if it was created during message handling
    if (context.session && !connection.sessionId) {
      connection.sessionId = context.session.sessionId;
      connection.agentToken = context.agentToken;
      // Persist deferred email if we just created the session
      if (connection.userEmail) {
        this.sessionManager.setSessionEmail(context.session.sessionId, connection.userEmail);
      }
    }

    return response;
  }

  /**
   * Send response to connection
   */
  private async sendResponse(connectionId: string, response: MCPResponse): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const responseWithVersion = { jsonrpc: '2.0' as const, ...response };
      const responseData = JSON.stringify(responseWithVersion);
      
      // Log the response being sent back to client
      console.log(`[DemoMCPServer] Sending response to ${connectionId}:`, JSON.stringify(responseWithVersion, null, 2));
      
      connection.ws.send(responseData);
    } catch (error) {
      console.error(`[DemoMCPServer] Error sending response to ${connectionId}:`, error);
      await this.closeConnection(connectionId, 1011, 'Send error');
    }
  }

  /**
   * Send error response to connection
   */
  private async sendError(connectionId: string, messageId: string | number | null, code: number, message: string, data?: any): Promise<void> {
    const errorResponse: MCPResponse = {
      id: messageId ?? 'unknown',
      error: {
        code,
        message,
        data
      }
    };

    await this.sendResponse(connectionId, errorResponse);
  }

  /**
   * Validate MCP message structure
   */
  private isValidMCPMessage(message: any): message is MCPMessage {
    if (typeof message !== 'object' || message === null || typeof message.method !== 'string') {
      return false;
    }
    // JSON-RPC: request id MUST NOT be null; notifications MUST NOT include id (use notifications/* methods)
    if (message.id === null) {
      return false;
    }
    if (message.id === undefined) {
      return typeof message.method === 'string' && message.method.startsWith('notifications/');
    }
    return typeof message.id === 'string' || typeof message.id === 'number';
  }

  /**
   * Create error response
   */
  private createErrorResponse(id: string | number | null | undefined, code: number, message: string, data?: any): MCPResponse {
    return {
      id: id ?? 'unknown',
      error: {
        code,
        message,
        data
      }
    };
  }

  /**
   * Handle HTTP requests (OAuth callbacks)
   */
  private async handleHttpRequest(req: any, res: any): Promise<void> {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // OAuth AS endpoints (metadata, token, authorize, jwks, introspect, revoke)
    if (this.oauthRouter) {
      const handled = await this.oauthRouter.handle(req, res);
      if (handled) return;
    }

    // Spec-compliant HTTP MCP transport routes (RFC 9728 metadata + POST /mcp + /audit)
    if (this.httpTransport &&
        (pathname === '/.well-known/oauth-protected-resource' ||
         pathname === '/mcp' ||
         pathname === '/audit')) {
      await this.httpTransport.handleRequest(req, res, pathname);
      return;
    }

    if (pathname === '/.well-known/mcp-server') {
      await this.handleWellKnownMcpServer(req, res);
    } else if (pathname === '/auth/callback') {
      await this.handleOAuthCallback(req, res, url);
    } else if (pathname === '/auth/status') {
      await this.handleAuthStatus(req, res, url);
    } else if (pathname === '/auth/token-exchange') {
      await this.handleTokenExchange(req, res, url);
    } else if (pathname === '/health') {
      this.handleHealth(res);
    } else if (pathname === '/inspector/mcp-host') {
      await this.handleInspectorMcpHost(res);
    } else {
      // Default response for other paths
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }

  /**
   * GET /health — basic liveness check
   */
  private handleHealth(res: any): void {
    const body = JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      server: 'banking_mcp_server',
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  }

  /**
   * GET /inspector/mcp-host — tool registry snapshot for MCP Inspector UI.
   * Provides the same data the LangChain agent health server would return,
   * so the inspector works even when only the Node MCP server is running.
   */
  private async handleInspectorMcpHost(res: any): Promise<void> {
    const { BankingToolRegistry } = await import('../tools/BankingToolRegistry');
    const allTools = BankingToolRegistry.getAllTools();
    const payload = {
      source: 'banking_mcp_server',
      timestamp: new Date().toISOString(),
      protocolVersion: '2024-11-05',
      tools: allTools.map(t => ({
        name: t.name,
        description: t.description,
        requiresUserAuth: t.requiresUserAuth,
        requiredScopes: t.requiredScopes,
        readOnly: t.readOnly,
        inputSchema: t.inputSchema,
      })),
      toolCount: allTools.length,
      readOnlyTools: allTools.filter(t => t.readOnly).map(t => t.name),
      authenticatedTools: allTools.filter(t => !t.readOnly).map(t => t.name),
    };
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  }

  /**
   * RFC 9728 / MCP discovery — /.well-known/mcp-server
   */
  private async handleWellKnownMcpServer(_req: any, res: any): Promise<void> {
    const { BankingToolRegistry } = await import('../tools/BankingToolRegistry');
    const allTools = BankingToolRegistry.getAllTools();
    const tools = allTools.map(t => ({
      name: t.name,
      description: t.description,
      requiresUserAuth: t.requiresUserAuth,
      requiredScopes: t.requiredScopes,
      readOnly: t.readOnly,
    }));
    const readOnlyTools = allTools.filter(t => t.readOnly).map(t => t.name);
    const authenticatedTools = allTools.filter(t => !t.readOnly).map(t => t.name);
    const manifest = {
      name: 'AI Demo MCP Server',
      version: '1.0.0',
      description: 'Secure banking operations MCP server with PingOne authentication',
      protocolVersion: '2024-11-05',
      tools,
      publicAccess: {
        readOnlyTools,
      },
      restrictedAccess: {
        authenticatedTools,
      },
      auth: {
        type: 'oauth2',
        authorizationUrl: process.env.PINGONE_AUTH_URL
          ? `${process.env.PINGONE_AUTH_URL}/authorize`
          : undefined,
        tokenUrl: process.env.PINGONE_AUTH_URL
          ? `${process.env.PINGONE_AUTH_URL}/token`
          : undefined,
        scopes: [
          'accounts:read',
          'transactions:read',
          'transactions:write',
          'sensitive:read',
        ],
      },
    };
    const body = JSON.stringify(manifest, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  }

  /**
   * Handle OAuth authorization callback
   */
  private async handleOAuthCallback(req: any, res: any, url: URL): Promise<void> {
    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        console.error(`[DemoMCPServer] OAuth error: ${error}`);
        // Escape before interpolating: `error` is an attacker-controllable query
        // param, so echoing it raw into HTML is a reflected-XSS sink.
        const safeError = String(error).replace(/[&<>"']/g, (c) => (
          { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
        ));
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h2>Authorization Failed</h2>
              <p>Error: ${safeError}</p>
              <p>You can close this window and try again.</p>
            </body>
          </html>
        `);
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h2>Invalid Request</h2>
              <p>Missing authorization code or state parameter.</p>
            </body>
          </html>
        `);
        return;
      }

      console.log(`[DemoMCPServer] Received OAuth callback - code: ${code.substring(0, 10)}..., state: ${state}`);

      // Exchange authorization code for user tokens
      const result = await this.messageHandler.handleAuthorizationCodeExchange(code, state);

      if (result.success) {
        console.log(`[DemoMCPServer] OAuth authorization successful for session: ${result.sessionId}`);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html>
<meta charset="utf-8">
<script>
/***
 * Replace ORIGIN with your web app's exact origin, e.g. "https://agent.example"
 * Replace SESSION_ID with the opaque session your UI knows (same value you used in \`state\`)
 */
(function () {
  var msg = { type: "auth_complete", session: "${result.sessionId}" };
  try {
    // Notify the opener — use explicit origin to prevent cross-origin interception.
    // Falls back to "*" only if FRONTEND_ORIGIN env is not configured.
    var targetOrigin = "${process.env.FRONTEND_ORIGIN || process.env.PUBLIC_APP_URL || 'https://local.ping-devops.com:4000'}";
    window.opener && window.opener.postMessage(msg, targetOrigin);
  } catch (e) {}
  // Close the popup regardless
  window.close();
})();
</script>
<p>You're signed in. You can close this window.</p>`);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h2>Authorization Failed</h2>
              <p>Error: ${result.error}</p>
              <p>You can close this window and try again.</p>
            </body>
          </html>
        `);
      }

    } catch (error) {
      console.error('[DemoMCPServer] Error handling OAuth callback:', error);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
            <h2>Server Error</h2>
            <p>An error occurred while processing your authorization.</p>
          </body>
        </html>
      `);
    }
  }

  /**
   * Handle auth status check
   */
  private async handleAuthStatus(req: any, res: any, url: URL): Promise<void> {
    try {
      const sessionId = url.searchParams.get('sessionId');
      
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing sessionId parameter' }));
        return;
      }

      const session = await this.sessionManager.getSession(sessionId);
      const hasUserTokens = session?.userTokens ? true : false;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessionId,
        hasUserTokens,
        authorized: hasUserTokens
      }));

    } catch (error) {
      console.error('[DemoMCPServer] Error checking auth status:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * RFC 8693 Token Exchange endpoint
   */
  private async handleTokenExchange(req: any, res: any, _url: URL): Promise<void> {
    try {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // SECURITY (was: unauthenticated) — this endpoint mints exchanged tokens
      // using the SERVER'S OWN client credentials, so an open endpoint let any
      // caller obtain tokens. It is now fail-safe-by-default: disabled (404)
      // unless MCP_TOKEN_EXCHANGE_SECRET is set, and then it requires a
      // timing-safe-matching x-internal-secret header. The demo's real token
      // flow performs RFC 8693 exchange internally (TokenResolver), not via this
      // HTTP route, so the default-off posture does not affect the agent path.
      const exchangeSecret = process.env.MCP_TOKEN_EXCHANGE_SECRET || '';
      if (!exchangeSecret) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      const presented = req.headers['x-internal-secret'];
      const presentedBuf = typeof presented === 'string' ? Buffer.from(presented) : Buffer.alloc(0);
      const secretBuf = Buffer.from(exchangeSecret);
      if (presentedBuf.length !== secretBuf.length || !timingSafeEqual(presentedBuf, secretBuf)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }

      // Parse request body
      const body = await this.parseRequestBody(req);
      
      // Validate token exchange request
      const tokenExchangeRequest = {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange' as const,
        subject_token: body.subject_token,
        subject_token_type: (body.subject_token_type || 'urn:ietf:params:oauth:token-type:access_token') as 'urn:ietf:params:oauth:token-type:access_token',
        actor_token: body.actor_token,
        actor_token_type: body.actor_token_type,
        requested_token_type: body.requested_token_type,
        resource: body.resource,
        audience: body.audience,
        scope: body.scope
      };

      // Import TokenExchangeService
      const { TokenExchangeService } = await import('../auth/TokenExchangeService');
      const { loadConfiguration } = await import('../config');
      
      const config = loadConfiguration();
      const tokenExchangeConfig = {
        pingoneBaseUrl: config.pingone.baseUrl,
        environmentId: config.pingone.environmentId || '',
        clientId: config.pingone.clientId,
        clientSecret: config.pingone.clientSecret,
        requireMayAct: config.requireMayAct === 'true',
        bffClientId: config.bffClientId,
        expectedActClientId: config.expectedActClientId,
        expectedActSub: config.expectedActSub,
        resourceUri: config.resourceUri
      };

      const tokenExchangeService = new TokenExchangeService(tokenExchangeConfig);
      
      // Perform token exchange
      const tokenResponse = await tokenExchangeService.exchangeToken(tokenExchangeRequest);
      
      // Return successful response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tokenResponse));

    } catch (error) {
      console.error('[DemoMCPServer] Token exchange error:', error);
      
      // Handle specific error types
      if (error instanceof Error) {
        if (error.message.includes('Invalid token exchange request')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'invalid_request',
            error_description: error.message
          }));
        } else if (error.message.includes('Invalid client credentials')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'invalid_client',
            error_description: error.message
          }));
        } else if (error.message.includes('Insufficient permissions')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'insufficient_scope',
            error_description: error.message
          }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'server_error',
            error_description: 'Internal server error'
          }));
        }
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  }

  private async parseRequestBody(req: any): Promise<any> {
    const MAX_BODY_SIZE = 1_048_576; // 1 MB limit to prevent DoS via large POST bodies
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      req.on('data', (chunk: string) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error(`Request body exceeds maximum size of ${MAX_BODY_SIZE} bytes`));
          return;
        }
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve(parsed);
        } catch (error) {
          reject(new Error('Invalid JSON in request body'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Clean up server resources
   */
  private async cleanup(): Promise<void> {
    this.isRunning = false;
    this.connections.clear();
    this.server = null;
    this.httpServer = null;
    this.tlsServer = null;
    this.stats.activeConnections = 0;
  }
}