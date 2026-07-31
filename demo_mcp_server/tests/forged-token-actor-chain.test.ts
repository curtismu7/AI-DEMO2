/**
 * forged-token-actor-chain.test.ts — WS-E, the forgery case the F10 gate missed.
 *
 * The actor allow-list (F10, docs/authorization-decision-split.md §6.1) decides
 * authorization from the `act` claim of the presented token. Until this suite the
 * claim was read by a bare base64 decode, so the allow-list was satisfied by
 * ANY well-formed JWT that named a whitelisted actor — including an `alg:none`
 * token minted by the caller. An allow-list that an attacker can write himself
 * into is not an allow-list.
 *
 * These tests drive the REAL BankingAuthenticationManager / TokenIntrospector, so
 * signature verification is production code, not a mock. Only the JWKS *key
 * transport* is doubled (jose is ESM-only under Jest): `jwtVerify` below performs
 * a genuine HMAC check, so a wrong-key token really fails to verify.
 *
 * Covers three enforcement points that must agree:
 *   - HTTP  POST /mcp                       (HttpMCPTransport.handlePost)
 *   - WS    connect Authorization header    (DemoMCPServer.handleConnection)
 *   - WS    initialize params.agentToken    (MCPMessageHandler.handleHandshake)
 */

import { EventEmitter } from 'events';
import { createHmac } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { HttpMCPTransport, HttpMCPTransportConfig } from '../src/server/HttpMCPTransport';
import { DemoMCPServer } from '../src/server/DemoMCPServer';
import { MCPMessageHandler } from '../src/server/MCPMessageHandler';
import { BankingSessionManager, BankingSession } from '../src/storage/BankingSessionManager';
import { BankingAuthenticationManager } from '../src/auth/BankingAuthenticationManager';
import { BankingToolProvider } from '../src/tools/BankingToolProvider';
import { PingOneConfig } from '../src/interfaces/auth';

// ---------------------------------------------------------------------------
// jose double — real HMAC verification, faked key transport.
//
// jest.config.js maps `jose` to a CJS shim whose jwtVerify always throws (so it
// cannot distinguish a good token from a forged one). Replace it with a verifier
// that does real crypto against mockSigningKey, which the tests set. Error text
// deliberately avoids the strings TokenIntrospector.isJwksUnavailableError treats
// as "JWKS endpoint down" — a signature mismatch must fail closed, not fail open.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-var, prefer-const
var mockSigningKey = 'correct-signing-key';

function mockJwtVerify(token: string): Promise<{ payload: Record<string, unknown> }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWSInvalid: compact JWS must have three parts');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (header.alg !== 'HS256') {
    throw new Error(`JWSSignatureVerificationFailed: alg "${header.alg}" not accepted`);
  }
  const expected = createHmac('sha256', mockSigningKey)
    .update(`${parts[0]}.${parts[1]}`)
    .digest('base64url');
  if (parts[2] !== expected) throw new Error('JWSSignatureVerificationFailed: signature mismatch');
  return Promise.resolve({ payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) });
}

jest.mock('jose', () => ({
  createRemoteJWKSet: () => ({ __keyset: true }),
  jwtVerify: (token: string) => mockJwtVerify(token),
}));

jest.mock('../src/storage/BankingSessionManager');
jest.mock('../src/tools/BankingToolProvider');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UPSTREAM_AUD = 'mcpserver.test.invalid';
const GATEWAY_AUD = 'mcpgateway.test.invalid';
const GATEWAY_CLIENT_ID = 'gateway-client-id-1';
const JWKS_URI = 'https://as.test.invalid/as/jwks';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 300;
}

/** Whitelisted-actor payload — the claims an attacker wants the server to trust. */
function whitelistedActorClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'user-1',
    aud: UPSTREAM_AUD,
    exp: futureExp(),
    act: { sub: GATEWAY_CLIENT_ID, client_id: GATEWAY_CLIENT_ID },
    ...overrides,
  };
}

/** An `alg:none` JWT — no signature at all. The classic forgery. */
function algNoneToken(claims: Record<string, unknown> = whitelistedActorClaims()): string {
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
}

/** A structurally valid HS256 JWT signed with `key`. */
function signedToken(key: string, claims: Record<string, unknown> = whitelistedActorClaims()): string {
  const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
  return `${input}.${createHmac('sha256', key).update(input).digest('base64url')}`;
}

const pingOneConfig: PingOneConfig = {
  baseUrl: 'https://as.test.invalid',
  clientId: 'client',
  clientSecret: 'secret',
  tokenIntrospectionEndpoint: 'https://as.test.invalid/introspect',
  authorizationEndpoint: 'https://as.test.invalid/authorize',
  tokenEndpoint: 'https://as.test.invalid/token',
};

const mockSession: BankingSession = {
  sessionId: 'banking-session-1',
  agentTokenHash: 'hash',
  createdAt: new Date(),
  lastActivity: new Date(),
  expiresAt: new Date(Date.now() + 3_600_000),
};

function makeRequest(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const ee = new EventEmitter();
  const req = Object.assign(ee, {
    method: options.method ?? 'POST',
    url: '/mcp',
    headers: options.headers ?? {},
  }) as unknown as IncomingMessage;
  setImmediate(() => {
    if (options.body !== undefined) req.emit('data', Buffer.from(options.body));
    req.emit('end');
  });
  return req;
}

interface MockResponse {
  res: ServerResponse;
  statusCode: number | undefined;
  headers: Record<string, string>;
  body: string;
}

function makeResponse(): MockResponse {
  const mock: MockResponse = { statusCode: undefined, headers: {}, body: '', res: null as unknown as ServerResponse };
  mock.res = {
    writeHead(code: number, hdrs?: Record<string, string | string[]>) {
      mock.statusCode = code;
      if (hdrs) for (const [k, v] of Object.entries(hdrs)) mock.headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
    },
    end(data?: string | Buffer) {
      if (data) mock.body = typeof data === 'string' ? data : data.toString();
    },
    setHeader(name: string, value: string) {
      mock.headers[name.toLowerCase()] = value;
    },
  } as unknown as ServerResponse;
  return mock;
}

const envSnapshot = { ...process.env };

/** Strip every env var these tests steer, so each case states its own posture. */
function clearAuthEnv(): void {
  for (const key of [
    'PINGONE_JWKS_URI', 'PINGONE_ISSUER', 'PINGONE_BASE_URL',
    'MCP_ALLOWED_ACTORS', 'MCP_SERVER_RESOURCE_URI', 'MCP_UPSTREAM_RESOURCE_URI',
    'MCP_AUDIENCE', 'PINGONE_RESOURCE_MCP_URI', 'MCP_GW_RESOURCE_URI',
    'STRICT_AUTH', 'SKIP_TOKEN_SIGNATURE_VALIDATION', 'ALLOW_JWKS_FAILOPEN',
    'REQUIRE_DPOP_PROOF', 'MCP_TRAT_MODE_ENABLED',
  ]) {
    delete process.env[key];
  }
}

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

describe('forged token vs the F10 actor allow-list — HTTP POST /mcp', () => {
  let transport: HttpMCPTransport;
  let mockSessionManager: jest.Mocked<BankingSessionManager>;
  let authManager: BankingAuthenticationManager;
  let mockHandler: MCPMessageHandler;

  const config: HttpMCPTransportConfig = {
    resourceUrl: 'https://mcp.test.invalid',
    authServerUrl: 'https://as.test.invalid/as',
    allowedOrigins: [],
  };

  beforeEach(() => {
    clearAuthEnv();
    mockSigningKey = 'correct-signing-key';
    // REAL auth manager — signature verification is the code under test.
    authManager = new BankingAuthenticationManager(pingOneConfig);
    mockSessionManager = new BankingSessionManager('path', 'key') as jest.Mocked<BankingSessionManager>;
    mockSessionManager.createSession = jest.fn().mockResolvedValue(mockSession);
    mockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
    mockSessionManager.removeSession = jest.fn().mockResolvedValue(undefined);
    mockHandler = {
      handleMessage: jest.fn().mockResolvedValue({
        id: 'init-1',
        result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 't', version: '1' } },
      }),
    } as unknown as MCPMessageHandler;

    transport = new HttpMCPTransport(config, mockHandler, mockSessionManager, authManager);
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  function initialize(token: string) {
    return makeRequest({
      body: JSON.stringify({
        id: 'init-1',
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      }),
      headers: { authorization: `Bearer ${token}` },
    });
  }

  /** Establish a session via unauthenticated initialize and return the session id. */
  async function establishSession(): Promise<string> {
    const mock = makeResponse();
    await transport.handleRequest(
      makeRequest({
        body: JSON.stringify({
          id: 'init-s',
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } },
        }),
        headers: {},
      }),
      mock.res,
      '/mcp',
    );
    return mock.headers['mcp-session-id'];
  }

  /** Build a tools/call request — fails at auth (step 2) before session lookup (step 5). */
  function toolsCall(token: string, sessionId = 'dummy') {
    return makeRequest({
      body: JSON.stringify({ id: 'call-1', method: 'tools/call', params: { name: 'get_balance', arguments: {} } }),
      headers: {
        authorization: `Bearer ${token}`,
        'mcp-session-id': sessionId,
        'mcp-protocol-version': '2025-11-25',
      },
    });
  }

  describe('no JWKS configured — the signature CANNOT be verified', () => {
    beforeEach(() => {
      // The deployed demo posture: demo_mcp_server has no JWKS endpoint set, so
      // TokenIntrospector warns and accepts. That is survivable for authentication
      // (the gateway already authorized the call) but NOT for an authorization
      // decision read out of the token's own claims.
      process.env.MCP_ALLOWED_ACTORS = GATEWAY_CLIENT_ID;
    });

    it('REJECTS an alg:none token that names a whitelisted actor', async () => {
      const mock = makeResponse();
      await transport.handleRequest(toolsCall(algNoneToken()), mock.res, '/mcp');

      expect(mock.statusCode).toBe(401);
      expect(mock.body).toMatch(/verif/i);
    });

    it('REJECTS an unsigned token even when its act.client_id is exactly the allow-listed id', async () => {
      const mock = makeResponse();
      await transport.handleRequest(
        toolsCall(`${b64({ alg: 'none' })}.${b64(whitelistedActorClaims())}.forged`),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(401);
    });

    it('does not create a banking session for a forged token', async () => {
      const mock = makeResponse();
      await transport.handleRequest(toolsCall(algNoneToken()), mock.res, '/mcp');

      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('leaves the gate unarmed when MCP_ALLOWED_ACTORS is unset (C4 skip marker, not a deny)', async () => {
      // The fix must not turn "no allow-list configured" into "deny everything" —
      // that would break every deployment that has not armed the gate.
      delete process.env.MCP_ALLOWED_ACTORS;

      const mock = makeResponse();
      await transport.handleRequest(initialize(algNoneToken()), mock.res, '/mcp');

      expect(mock.statusCode).toBe(200);
    });
  });

  describe('JWKS configured — signatures are verified for real', () => {
    beforeEach(() => {
      process.env.PINGONE_JWKS_URI = JWKS_URI;
      process.env.MCP_ALLOWED_ACTORS = GATEWAY_CLIENT_ID;
    });

    it('ACCEPTS a correctly signed token whose actor is allow-listed', async () => {
      const sessionId = await establishSession();
      mockHandler.handleMessage = jest.fn().mockResolvedValue({
        id: 'call-1',
        result: { content: [{ type: 'text', text: 'ok' }] },
      });

      const mock = makeResponse();
      await transport.handleRequest(toolsCall(signedToken(mockSigningKey), sessionId), mock.res, '/mcp');

      expect(mock.statusCode).toBe(200);
    });

    it('REJECTS a valid-shaped token signed with the WRONG key', async () => {
      const mock = makeResponse();
      await transport.handleRequest(toolsCall(signedToken('attacker-key')), mock.res, '/mcp');

      expect(mock.statusCode).toBe(401);
    });

    it('REJECTS an alg:none token', async () => {
      const mock = makeResponse();
      await transport.handleRequest(toolsCall(algNoneToken()), mock.res, '/mcp');

      expect(mock.statusCode).toBe(401);
    });

    it('REJECTS a correctly signed token whose actor is NOT allow-listed', async () => {
      const mock = makeResponse();
      await transport.handleRequest(
        toolsCall(signedToken(mockSigningKey, whitelistedActorClaims({ act: { client_id: 'rogue-agent' } }))),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(401);
      expect(mock.body).toMatch(/rogue-agent/);
    });
  });
});

// ---------------------------------------------------------------------------
// WebSocket transport — docker-compose.yml points the Node gateway at ws://,
// so an HTTP-only control is bypassable by switching transport.
// ---------------------------------------------------------------------------

describe('forged token vs the F10 actor allow-list — WebSocket', () => {
  let server: DemoMCPServer;
  let mockSessionManager: jest.Mocked<BankingSessionManager>;

  function makeWs() {
    return { close: jest.fn(), on: jest.fn(), readyState: 1, send: jest.fn() } as any;
  }

  beforeEach(() => {
    clearAuthEnv();
    mockSigningKey = 'correct-signing-key';
    process.env.HTTP_MCP_TRANSPORT_ENABLED = 'false';
    mockSessionManager = new BankingSessionManager('p', 'k') as jest.Mocked<BankingSessionManager>;
    mockSessionManager.createSession = jest.fn().mockResolvedValue(mockSession);
    mockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);

    server = new DemoMCPServer(
      { host: 'localhost', port: 0, maxConnections: 10, sessionTimeout: 3600, enableLogging: false },
      new BankingAuthenticationManager(pingOneConfig),
      mockSessionManager,
      {} as jest.Mocked<BankingToolProvider>,
    );
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  describe('connect-time Authorization header', () => {
    it('CLOSES a connection presenting an alg:none token with a whitelisted actor', async () => {
      process.env.MCP_ALLOWED_ACTORS = GATEWAY_CLIENT_ID;
      const ws = makeWs();

      await server.handleConnection(ws, { headers: { authorization: `Bearer ${algNoneToken()}` } });

      expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
    });

    it('ADMITS a correctly signed token with a whitelisted actor', async () => {
      process.env.PINGONE_JWKS_URI = JWKS_URI;
      process.env.MCP_ALLOWED_ACTORS = GATEWAY_CLIENT_ID;
      const ws = makeWs();

      await server.handleConnection(ws, {
        headers: { authorization: `Bearer ${signedToken(mockSigningKey)}` },
      });

      expect(ws.close).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // The header-less bypass: DemoMCPServer only ran the actor check inside
  // `if (authHeader?.startsWith('bearer '))`. A client that sends NO header and
  // puts the token in initialize params reached handleHandshake, which validated
  // it and created a session without ever consulting the allow-list.
  // -------------------------------------------------------------------------
  describe('initialize params.agentToken (no Authorization header)', () => {
    async function connectHeaderless(): Promise<string> {
      const ws = makeWs();
      await server.handleConnection(ws, { headers: {} });
      const ids = [...(server as unknown as { connections: Map<string, unknown> }).connections.keys()];
      return ids[ids.length - 1];
    }

    async function initializeWith(token: string): Promise<void> {
      const connectionId = await connectHeaderless();
      await server.processMessage(
        connectionId,
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'init-1',
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, agentToken: token },
        }),
      );
    }

    it('does NOT create a session for an alg:none token naming a whitelisted actor', async () => {
      process.env.MCP_ALLOWED_ACTORS = GATEWAY_CLIENT_ID;

      await initializeWith(algNoneToken());

      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('does NOT create a session for a signed token whose actor is not allow-listed', async () => {
      process.env.PINGONE_JWKS_URI = JWKS_URI;
      process.env.MCP_ALLOWED_ACTORS = GATEWAY_CLIENT_ID;

      await initializeWith(signedToken(mockSigningKey, whitelistedActorClaims({ act: { client_id: 'rogue-agent' } })));

      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('DOES create a session for a correctly signed, allow-listed token', async () => {
      process.env.PINGONE_JWKS_URI = JWKS_URI;
      process.env.MCP_ALLOWED_ACTORS = GATEWAY_CLIENT_ID;

      await initializeWith(signedToken(mockSigningKey));

      expect(mockSessionManager.createSession).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // D-05 anti-bypass on the WS path. enforceUpstreamContract was called only
  // from HttpMCPTransport, while docker-compose.yml points the Node gateway at
  // ws://mcp-server:8080 — so the anti-bypass rule did not cover the primary
  // transport.
  // -------------------------------------------------------------------------
  describe('D-05 upstream contract on the WS connect path', () => {
    beforeEach(() => {
      process.env.PINGONE_JWKS_URI = JWKS_URI;
      process.env.MCP_UPSTREAM_RESOURCE_URI = UPSTREAM_AUD;
      process.env.MCP_GW_RESOURCE_URI = GATEWAY_AUD;
    });

    it('CLOSES a connection presenting a gateway-audience token', async () => {
      const ws = makeWs();

      await server.handleConnection(ws, {
        headers: {
          authorization: `Bearer ${signedToken(mockSigningKey, whitelistedActorClaims({ aud: GATEWAY_AUD }))}`,
        },
      });

      expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
    });

    it('CLOSES a connection presenting a multi-resource gateway+upstream token', async () => {
      const ws = makeWs();

      await server.handleConnection(ws, {
        headers: {
          authorization: `Bearer ${signedToken(mockSigningKey, whitelistedActorClaims({ aud: [GATEWAY_AUD, UPSTREAM_AUD] }))}`,
        },
      });

      expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
    });

    it('ADMITS a correctly exchanged upstream-audience token', async () => {
      const ws = makeWs();

      await server.handleConnection(ws, {
        headers: { authorization: `Bearer ${signedToken(mockSigningKey)}` },
      });

      expect(ws.close).not.toHaveBeenCalled();
    });
  });
});
