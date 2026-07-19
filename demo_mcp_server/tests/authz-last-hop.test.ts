/**
 * authz-last-hop.test.ts — WS-E: authorization enforcement at the final hop
 * (docs/authorization-decision-split.md §6.1 F10, planning/authz-fix-contract.md).
 *
 * The gateway verifies the delegation chain, the DPoP proof and the TraT
 * transaction context, then forwards to this server. Historically every one of
 * those facts was discarded here. This suite pins the checks that close the gap:
 *
 *   F10  — act (delegation chain) verified against an actor allow-list
 *   D-05 — upstream-audience contract runs unconditionally, not behind a flag
 *   DPoP — X-DPoP-Verified is only trusted when the bridge secret proves the hop
 *   TraT — the transaction context is bound to the tool actually being called
 *
 * WHAT THIS FILE DOES NOT COVER, BY DESIGN: forged/unsigned tokens, and the WS
 * transports. Those need real signature verification, so they live in
 * forged-token-actor-chain.test.ts against the real TokenIntrospector. Here the
 * auth manager is a double that reports a VERIFIED token — which is the point:
 * it holds signature verification constant so each test isolates the one check
 * it names. A double that returned bare `{}` (as this file used to) would make
 * every case fail for the same uninteresting reason and prove nothing about D-05,
 * DPoP or TraT.
 */

import { EventEmitter } from 'events';
import { IncomingMessage, ServerResponse } from 'http';
import { HttpMCPTransport, HttpMCPTransportConfig } from '../src/server/HttpMCPTransport';
import { MCPMessageHandler } from '../src/server/MCPMessageHandler';
import { BankingSessionManager, BankingSession } from '../src/storage/BankingSessionManager';
import { BankingAuthenticationManager } from '../src/auth/BankingAuthenticationManager';
import { BankingToolProvider } from '../src/tools/BankingToolProvider';
import { PingOneConfig, AgentTokenInfo } from '../src/interfaces/auth';
import { verifyActorChain, parseAllowedActors } from '../src/auth/actorChain';

jest.mock('../src/server/MCPMessageHandler');
jest.mock('../src/storage/BankingSessionManager');
jest.mock('../src/auth/BankingAuthenticationManager');
jest.mock('../src/tools/BankingToolProvider');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UPSTREAM_AUD = 'mcpserver.ping.demo';
const GATEWAY_AUD = 'mcpgateway.ping.demo';
const GATEWAY_CLIENT_ID = 'gateway-client-id-1';

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

/** A token shaped the way Exchange #3 is expected to mint it (WS-A). */
function delegatedToken(overrides: Record<string, unknown> = {}): string {
  return makeJwt({
    sub: 'user-1',
    aud: UPSTREAM_AUD,
    exp: Math.floor(Date.now() / 1000) + 300,
    act: { sub: GATEWAY_CLIENT_ID, client_id: GATEWAY_CLIENT_ID },
    ...overrides,
  });
}

/**
 * Stand-in for TokenIntrospector.validateAgentToken on the happy authentication
 * path: signature verified, claims surfaced. Modelling "verified" explicitly is
 * what lets the tests below attribute a 401 to the check under test rather than
 * to a missing signature.
 */
function verifiedTokenInfo(token: string): AgentTokenInfo {
  const parts = token.split('.');
  const claims = parts.length === 3
    ? (JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>)
    : {};
  return {
    tokenHash: 'hash',
    clientId: 'client',
    scopes: [],
    expiresAt: new Date(Date.now() + 300_000),
    isValid: true,
    signatureVerified: true,
    verifiedClaims: claims,
  };
}

function makeRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const ee = new EventEmitter();
  const req = Object.assign(ee, {
    method: options.method ?? 'POST',
    url: options.url ?? '/mcp',
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
  const mock: MockResponse = {
    statusCode: undefined,
    headers: {},
    body: '',
    res: null as unknown as ServerResponse,
  };
  mock.res = {
    writeHead(code: number, hdrs?: Record<string, string | string[]>) {
      mock.statusCode = code;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          mock.headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
        }
      }
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

// ---------------------------------------------------------------------------
// F10 — actor chain verification (pure function)
// ---------------------------------------------------------------------------

describe('F10 — verifyActorChain', () => {
  const allowedActors = [GATEWAY_CLIENT_ID, 'other-gateway'];
  const verified = { allowedActors, signatureVerified: true };

  it('permits a token whose act.client_id is in the allow-list', () => {
    const result = verifyActorChain(
      { sub: 'user-1', act: { sub: GATEWAY_CLIENT_ID, client_id: GATEWAY_CLIENT_ID } },
      verified,
    );
    expect(result.ran).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.actor).toBe(GATEWAY_CLIENT_ID);
    expect(result.errors).toHaveLength(0);
  });

  it('falls back to act.sub when act.client_id is absent', () => {
    const result = verifyActorChain({ sub: 'user-1', act: { sub: GATEWAY_CLIENT_ID } }, verified);
    expect(result.valid).toBe(true);
    expect(result.actor).toBe(GATEWAY_CLIENT_ID);
  });

  it('FAILS CLOSED when the token carries no act claim at all', () => {
    // This is the state of the world until WS-A adds actor_token to Exchange #3.
    // A token with no delegation chain must not be treated as "no restriction".
    const result = verifyActorChain({ sub: 'user-1', aud: UPSTREAM_AUD }, verified);
    expect(result.ran).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/act/i);
  });

  it('denies an actor that is not in the allow-list', () => {
    const result = verifyActorChain({ sub: 'user-1', act: { client_id: 'attacker-client' } }, verified);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/attacker-client/);
  });

  it('denies an act claim that carries no usable actor identifier', () => {
    const result = verifyActorChain({ sub: 'user-1', act: {} }, verified);
    expect(result.valid).toBe(false);
  });

  it('denies a non-object act claim (RFC 8693 §4.1 requires a JSON object)', () => {
    const result = verifyActorChain({ sub: 'user-1', act: 'gateway-client-id-1' }, verified);
    expect(result.valid).toBe(false);
  });

  // -------------------------------------------------------------------------
  // The forgery guard. `act` is an authorization input, so it is worth exactly
  // as much as the signature over it.
  // -------------------------------------------------------------------------

  it('DENIES an allow-listed actor when the signature was not verified', () => {
    const result = verifyActorChain(
      { sub: 'user-1', act: { client_id: GATEWAY_CLIENT_ID } },
      { allowedActors, signatureVerified: false },
    );
    expect(result.ran).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/signature was not verified/i);
  });

  it('DENIES by default when the caller omits signatureVerified', () => {
    // Fail-closed default: a call site that forgets the flag must not inherit
    // "trusted". This is the property that makes the API hard to misuse.
    const result = verifyActorChain({ sub: 'user-1', act: { client_id: GATEWAY_CLIENT_ID } }, { allowedActors });
    expect(result.valid).toBe(false);
  });

  it('C4: reports an explicit skip marker when no allow-list is configured', () => {
    // "Omission is not permission" — an unarmed gate must be inspectable,
    // never indistinguishable from a PERMIT. Checked before the signature rule
    // so an unarmed deployment is not broken by unverifiable tokens.
    const result = verifyActorChain({ sub: 'user-1' }, { allowedActors: [], signatureVerified: false });
    expect(result.ran).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.skipReason).toBeTruthy();
  });

  it('parseAllowedActors splits, trims and drops empties', () => {
    expect(parseAllowedActors(' a , b ,, c ')).toEqual(['a', 'b', 'c']);
    expect(parseAllowedActors(undefined)).toEqual([]);
    expect(parseAllowedActors('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Transport-level enforcement
// ---------------------------------------------------------------------------

describe('HttpMCPTransport — last-hop enforcement call sites', () => {
  let transport: HttpMCPTransport;
  let mockHandler: jest.Mocked<MCPMessageHandler>;
  let mockSessionManager: jest.Mocked<BankingSessionManager>;
  let mockAuthManager: jest.Mocked<BankingAuthenticationManager>;
  const envSnapshot = { ...process.env };

  const config: HttpMCPTransportConfig = {
    resourceUrl: 'https://mcp.example.com',
    authServerUrl: 'https://auth.example.com/as',
    allowedOrigins: [],
  };

  const mockSession: BankingSession = {
    sessionId: 'banking-session-1',
    agentTokenHash: 'hash',
    createdAt: new Date(),
    lastActivity: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
  };

  beforeEach(() => {
    const pingOneConfig: PingOneConfig = {
      baseUrl: 'https://auth.example.com',
      clientId: 'client',
      clientSecret: 'secret',
      tokenIntrospectionEndpoint: 'https://auth.example.com/introspect',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
    };
    mockAuthManager = new BankingAuthenticationManager(pingOneConfig) as jest.Mocked<BankingAuthenticationManager>;
    mockSessionManager = new BankingSessionManager('path', 'key') as jest.Mocked<BankingSessionManager>;
    const mockToolProvider = {} as jest.Mocked<BankingToolProvider>;
    mockHandler = new MCPMessageHandler(mockAuthManager, mockSessionManager, mockToolProvider) as jest.Mocked<MCPMessageHandler>;

    // Signature verification held constant at "verified" — see file header.
    mockAuthManager.validateAgentToken = jest.fn(async (token: string) => verifiedTokenInfo(token));
    mockSessionManager.createSession = jest.fn().mockResolvedValue(mockSession);
    mockSessionManager.getSession = jest.fn().mockResolvedValue(mockSession);
    mockSessionManager.removeSession = jest.fn().mockResolvedValue(undefined);
    mockHandler.handleMessage = jest.fn().mockResolvedValue({
      id: 'init-1',
      result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 't', version: '1' } },
    });

    transport = new HttpMCPTransport(config, mockHandler, mockSessionManager, mockAuthManager);
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  function initializePost(token: string, headers: Record<string, string> = {}) {
    return makeRequest({
      method: 'POST',
      body: JSON.stringify({
        id: 'init-1',
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      }),
      headers: { authorization: `Bearer ${token}`, ...headers },
    });
  }

  // -------------------------------------------------------------------------
  // D-05 must not be gated on MCP_GATEWAY_MODE
  // -------------------------------------------------------------------------

  describe('D-05 upstream contract runs unconditionally', () => {
    it('rejects a gateway-audience token even when MCP_GATEWAY_MODE is unset', async () => {
      // MCP_GATEWAY_MODE is set in NO deployment (not in docker-compose.yml, not
      // in .env.example) — so gating the anti-bypass check on it disabled the
      // check everywhere. A gateway-aud token reaching the backend directly is
      // exactly the bypass D-05 exists to stop.
      delete process.env.MCP_GATEWAY_MODE;
      process.env.MCP_UPSTREAM_RESOURCE_URI = UPSTREAM_AUD;
      process.env.MCP_GW_RESOURCE_URI = GATEWAY_AUD;

      const mock = makeResponse();
      await transport.handleRequest(
        initializePost(makeJwt({ sub: 'a', aud: GATEWAY_AUD, exp: Math.floor(Date.now() / 1000) + 300 })),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(401);
      expect(mock.body).toMatch(/D-05/);
      // The bypass must be stopped BEFORE a session exists, not merely reported.
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('rejects a token whose aud is a third party, not the upstream', async () => {
      // Rule 2 of the contract, distinct from the gateway-aud case above: an
      // otherwise well-formed token minted for some other resource server.
      process.env.MCP_UPSTREAM_RESOURCE_URI = UPSTREAM_AUD;
      process.env.MCP_GW_RESOURCE_URI = GATEWAY_AUD;

      const mock = makeResponse();
      await transport.handleRequest(
        initializePost(delegatedToken({ aud: 'someone-elses-api.ping.demo' })),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(401);
      expect(mock.body).toMatch(/aud mismatch/i);
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('accepts a correctly exchanged upstream-audience token AND establishes a session', async () => {
      // Guards the other direction: the anti-bypass rule must not deny the very
      // token shape Exchange #3 is supposed to produce. Asserting the session was
      // created makes this more than "no 401 was sent".
      process.env.MCP_UPSTREAM_RESOURCE_URI = UPSTREAM_AUD;
      process.env.MCP_GW_RESOURCE_URI = GATEWAY_AUD;

      const mock = makeResponse();
      await transport.handleRequest(initializePost(delegatedToken()), mock.res, '/mcp');

      expect(mock.statusCode).toBe(200);
      expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
      expect(mock.headers['mcp-session-id']).toBeTruthy();
    });

    it('does not reject an aud-less token when nothing is configured to enforce', async () => {
      // Removing the MCP_GATEWAY_MODE gate must not convert "unconfigured" into
      // "deny everything": with no upstream/gateway audience set there is no
      // contract to enforce. (Audience presence is separately mandatory in
      // TokenIntrospector whenever MCP_SERVER_RESOURCE_URI is configured.)
      for (const k of ['MCP_GATEWAY_MODE', 'MCP_UPSTREAM_RESOURCE_URI', 'MCP_AUDIENCE', 'PINGONE_RESOURCE_MCP_URI', 'MCP_GW_RESOURCE_URI']) {
        delete process.env[k];
      }

      const mock = makeResponse();
      await transport.handleRequest(initializePost(makeJwt({ sub: 'a' })), mock.res, '/mcp');

      expect(mock.statusCode).toBe(200);
      expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
    });

    it('rejects an aud-less token once an upstream audience IS configured', async () => {
      process.env.MCP_UPSTREAM_RESOURCE_URI = UPSTREAM_AUD;

      const mock = makeResponse();
      await transport.handleRequest(initializePost(makeJwt({ sub: 'a' })), mock.res, '/mcp');

      expect(mock.statusCode).toBe(401);
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // F10 at the HTTP transport. Forged-token cases live in
  // forged-token-actor-chain.test.ts, which drives real signature verification.
  // -------------------------------------------------------------------------

  describe('F10 — delegation chain enforced at the MCP server', () => {
    it('rejects a token with no act claim when an allow-list is configured', async () => {
      process.env.MCP_ALLOWED_ACTORS = GATEWAY_CLIENT_ID;

      const mock = makeResponse();
      await transport.handleRequest(
        initializePost(makeJwt({ sub: 'user-1', aud: UPSTREAM_AUD, exp: Math.floor(Date.now() / 1000) + 300 })),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(401);
      expect(mock.body).toMatch(/delegation|act/i);
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('rejects a token whose actor is not in the allow-list', async () => {
      process.env.MCP_ALLOWED_ACTORS = GATEWAY_CLIENT_ID;

      const mock = makeResponse();
      await transport.handleRequest(
        initializePost(delegatedToken({ act: { client_id: 'rogue-agent' } })),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(401);
      expect(mock.body).toMatch(/rogue-agent/);
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('accepts a token whose actor is in the allow-list AND establishes a session', async () => {
      process.env.MCP_ALLOWED_ACTORS = `${GATEWAY_CLIENT_ID}, another-gateway`;

      const mock = makeResponse();
      await transport.handleRequest(initializePost(delegatedToken()), mock.res, '/mcp');

      expect(mock.statusCode).toBe(200);
      expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
    });

    it('does not enforce when MCP_ALLOWED_ACTORS is unset (pre-WS-A default)', async () => {
      delete process.env.MCP_ALLOWED_ACTORS;

      const mock = makeResponse();
      await transport.handleRequest(
        initializePost(makeJwt({ sub: 'user-1', aud: UPSTREAM_AUD })),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // X-DPoP-Verified must be bridge-authenticated
  // -------------------------------------------------------------------------

  describe('X-DPoP-Verified trusted-header hardening', () => {
    beforeEach(() => {
      process.env.REQUIRE_DPOP_PROOF = 'true';
      delete process.env.MCP_ALLOWED_ACTORS;
    });

    it('refuses to trust X-DPoP-Verified when no bridge secret is configured', async () => {
      // Without a shared secret the header is attacker-supplied: anyone who can
      // reach the MCP port can assert "DPoP was verified" and satisfy the gate.
      delete process.env.GW_MCP_BRIDGE_SECRET;

      const mock = makeResponse();
      await transport.handleRequest(
        initializePost(delegatedToken(), { 'x-dpop-verified': 'true' }),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(401);
      expect(mock.body).toMatch(/DPoP/i);
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('rejects X-DPoP-Verified carrying a wrong bridge secret', async () => {
      process.env.GW_MCP_BRIDGE_SECRET = 'real-secret';

      const mock = makeResponse();
      await transport.handleRequest(
        initializePost(delegatedToken(), {
          'x-dpop-verified': 'true',
          'x-gw-bridge-secret': 'guessed-secret',
        }),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(401);
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('accepts X-DPoP-Verified with the matching bridge secret', async () => {
      process.env.GW_MCP_BRIDGE_SECRET = 'real-secret';

      const mock = makeResponse();
      await transport.handleRequest(
        initializePost(delegatedToken(), {
          'x-dpop-verified': 'true',
          'x-gw-bridge-secret': 'real-secret',
        }),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(200);
      expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
    });

    it('rejects when the gateway did not verify DPoP even with a valid bridge secret', async () => {
      process.env.GW_MCP_BRIDGE_SECRET = 'real-secret';

      const mock = makeResponse();
      await transport.handleRequest(
        initializePost(delegatedToken(), { 'x-gw-bridge-secret': 'real-secret' }),
        mock.res,
        '/mcp',
      );

      expect(mock.statusCode).toBe(401);
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // TraT bound to the tool being invoked
  // -------------------------------------------------------------------------

  describe('TraT transaction context is bound to the called tool', () => {
    const tratFor = (tool: string) =>
      JSON.stringify({
        purp: 'banking.transfer',
        reqctx: { tool, session_id: 's1', correlation_id: 'c1' },
        azd: { sub: 'user-1' },
        rctx: { ip: '1.2.3.4', user_agent: 'test', timestamp: new Date().toISOString() },
      });

    beforeEach(() => {
      process.env.MCP_TRAT_MODE_ENABLED = 'true';
      process.env.ALLOW_UNSIGNED_TRAT_CONTEXT = 'true';
      delete process.env.MCP_ALLOWED_ACTORS;
      delete process.env.REQUIRE_DPOP_PROOF;
    });

    async function callTool(toolName: string, tratTool: string) {
      // establish a session first
      const initMock = makeResponse();
      await transport.handleRequest(initializePost(delegatedToken()), initMock.res, '/mcp');
      const sessionId = initMock.headers['mcp-session-id'];

      mockHandler.handleMessage = jest.fn().mockResolvedValue({
        id: 'call-1',
        result: { content: [{ type: 'text', text: 'ok' }] },
      });

      const mock = makeResponse();
      await transport.handleRequest(
        makeRequest({
          method: 'POST',
          body: JSON.stringify({ id: 'call-1', method: 'tools/call', params: { name: toolName, arguments: {} } }),
          headers: {
            authorization: `Bearer ${delegatedToken()}`,
            'mcp-session-id': sessionId,
            'mcp-protocol-version': '2025-11-25',
            'x-trat-context': tratFor(tratTool),
          },
        }),
        mock.res,
        '/mcp',
      );
      return { mock, handler: mockHandler };
    }

    it('rejects a tools/call whose tool differs from the TraT reqctx.tool', async () => {
      // A transaction token issued for `get_balance` must not authorize
      // `create_transfer` — otherwise the transaction binding is decorative.
      const { mock, handler } = await callTool('create_transfer', 'get_balance');

      expect(mock.statusCode).toBe(403);
      expect(mock.body).toMatch(/trat/i);
      // The call must be stopped before dispatch, not merely flagged afterwards.
      expect(handler.handleMessage).not.toHaveBeenCalled();
    });

    it('permits a tools/call that matches the TraT reqctx.tool', async () => {
      const { mock, handler } = await callTool('get_balance', 'get_balance');

      expect(mock.statusCode).toBe(200);
      expect(handler.handleMessage).toHaveBeenCalledTimes(1);
    });
  });
});
