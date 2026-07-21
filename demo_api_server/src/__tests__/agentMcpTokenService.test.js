/**
 * @file agentMcpTokenService.test.js
 *
 * Tests for resolveMcpAccessTokenWithEvents — verifying that:
 * 1. Agent client_credentials (actor token) are always used when PINGONE_AGENT_CLIENT_ID is set.
 * 2. Without PINGONE_RESOURCE_MCP_SERVER_URI, resolution returns null token (user access token not forwarded to MCP).
 * 3. User token must have ≥ MIN_USER_SCOPES_FOR_MCP distinct scopes before exchange.
 * 4. RFC 8693 exchange path works when PINGONE_RESOURCE_MCP_SERVER_URI is set and scopes are sufficient.
 * 5. Subject-only fallback emits an on-behalf-of-warning event when no agent client is configured.
 */

'use strict';

// ── JWT helpers ───────────────────────────────────────────────────────────────

function makeJwt(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

const USER_SUB = 'user-sub-abc123';
/** Sample JWT strings for unit tests only (unsigned); not used in production. */
const sampleJwtUserAccessToken = makeJwt({
  sub: USER_SUB,
  aud: 'banking_enduser',
  scope: 'openid profile email offline_access read read',
  iss: 'https://auth.pingone.com/test-env/as',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

const sampleJwtUserAccessNarrowScopes = makeJwt({
  sub: USER_SUB,
  aud: 'banking_enduser',
  scope: 'openid profile read',
  iss: 'https://auth.pingone.com/test-env/as',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

// Token with no scopes — triggers user_token_insufficient_scopes (MIN is 1, 0 < 1)
const sampleJwtUserAccessNoScopes = makeJwt({
  sub: USER_SUB,
  aud: 'banking_enduser',
  scope: '',
  iss: 'https://auth.pingone.com/test-env/as',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

const sampleJwtAgentAccessToken = makeJwt({
  sub: 'agent-client-id',
  aud: 'banking_mcp_server',
  scope: 'openid',
  iss: 'https://auth.pingone.com/test-env/as',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  client_id: 'agent-client-id',
});

const sampleJwtMcpAccessToken = makeJwt({
  sub: USER_SUB,
  aud: 'mcp-resource-uri',
  scope: 'read',
  act: { client_id: 'bff-client-id' },
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetAgentClientCredentialsToken = jest.fn();
const mockPerformTokenExchange = jest.fn();
const mockPerformTokenExchangeWithActor = jest.fn();
const mockGetClientCredentialsTokenAs = jest.fn();
const mockPerformTokenExchangeAs = jest.fn();
const mockGetMcpExchangerToken = jest.fn();
const mockGetAiAgentClientCredentialsToken = jest.fn();

jest.mock('../../services/oauthService', () => ({
  config: { clientId: 'bff-client-id' },
  getAgentClientCredentialsToken: (...args) => mockGetAgentClientCredentialsToken(...args),
  getMcpExchangerToken: (...args) => mockGetMcpExchangerToken(...args),
  getAiAgentClientCredentialsToken: (...args) => mockGetAiAgentClientCredentialsToken(...args),
  performTokenExchange: (...args) => mockPerformTokenExchange(...args),
  performTokenExchangeWithActor: (...args) => mockPerformTokenExchangeWithActor(...args),
  getClientCredentialsTokenAs: (...args) => mockGetClientCredentialsTokenAs(...args),
  performTokenExchangeAs: (...args) => mockPerformTokenExchangeAs(...args),
}));

jest.mock('../../services/mcpWebSocketClient', () => ({
  MCP_TOOL_SCOPES: {
    get_my_accounts:  ['read'],
    create_transfer:  ['write'],
  },
  getSessionAccessToken: (req) => req._mockToken || null,
  getSessionBearerForMcp: (req) => {
    const t = req._mockToken || null;
    if (!t || t === '_cookie_session') return null;
    return t;
  },
}));

// Mock tokenIntrospectionService so unit tests don't need real PingOne credentials.
// validateToken returns valid: true by default (introspection "passes" for the fake JWTs).
// Individual tests can override via jest.spyOn if they need to test the invalid path.
jest.mock('../../services/tokenIntrospectionService', () => ({
  validateToken: jest.fn().mockResolvedValue({ valid: true, sub: 'user-sub-abc123', scopes: 'read write' }),
}));

// The user-token active check is JWKS-based (tokenValidationService.validateToken) —
// NOT RFC 7662 introspection, and never the Worker. Mock it so the fake test JWTs
// don't hit a real JWKS endpoint; default rejects as an infra error so the active
// check records "skipped" and proceeds (matching the real "JWKS unavailable" path).
jest.mock('../../services/tokenValidationService', () => ({
  validateToken: jest.fn().mockRejectedValue(new Error('JWKS unavailable (test default)')),
}));

jest.mock('../../services/configStore', () => {
  const actual = jest.requireActual('../../services/configStore');
  return {
    get: jest.fn((key) => null),
    getEffective: jest.fn((key) => {
      if (key === 'PINGONE_RESOURCE_MCP_SERVER_URI') return '';
      return null;
    }),
    validateTwoExchangeConfig: jest.fn(() => ({
      valid: true,
      credentials: {
        aiAgentClientId: 'test-ai-agent-id',
        mcpClientId: 'test-mcp-id'
      },
      audiences: {
        agentGatewayAud: 'https://agent-gateway.example.com',
        intermediateAud: 'https://ai-agent-gateway.example.com',
        mcpGatewayAud: 'https://mcp-gateway.example.com',
        finalAud: 'https://mcp-resource.example.com'
      }
    })),
    // Real implementations for error code functions (plan 56-05)
    getErrorDetails: actual.getErrorDetails,
    mapErrorToCode: actual.mapErrorToCode,
    ERROR_CODES: actual.ERROR_CODES,
    validateScopeAudience: actual.validateScopeAudience,
    buildAllowedScopesByAudience: actual.buildAllowedScopesByAudience,
  };
});

const configStore = require('../../services/configStore');
const { resolveMcpAccessTokenWithEvents, buildSessionPreviewTokenEvents } = require('../../services/agentMcpTokenService');

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Single-exchange path: mcpExchangeMode='single' bypasses the two-exchange delegation path
// added in Phase 44+. All legacy single-exchange tests use this.
function makeReq(token) {
  return { _mockToken: token, session: { agentConsentGiven: true, mcpExchangeMode: 'single' } };
}

// Two-exchange path: no mcpExchangeMode set (defaults to 'double' behavior per service logic)
function makeReq2ex(token) {
  return { _mockToken: token, session: { agentConsentGiven: true } };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('resolveMcpAccessTokenWithEvents — no session token', () => {
  it('returns null token and empty events when no session token', async () => {
    const { token, tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(null), 'get_my_accounts');
    expect(token).toBeNull();
    expect(tokenEvents).toHaveLength(0);
  });
});

describe('resolveMcpAccessTokenWithEvents — PINGONE_RESOURCE_MCP_SERVER_URI unset', () => {
  const origClientId = process.env.PINGONE_AGENT_CLIENT_ID;
  const origSecret = process.env.PINGONE_AGENT_CLIENT_SECRET;

  beforeEach(() => {
    process.env.PINGONE_AGENT_CLIENT_ID = 'agent-client-id';
    process.env.PINGONE_AGENT_CLIENT_SECRET = 'agent-secret';
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'PINGONE_RESOURCE_MCP_SERVER_URI') return '';
      return null;
    });
    mockGetAgentClientCredentialsToken.mockResolvedValue(sampleJwtAgentAccessToken);
  });

  afterEach(() => {
    if (origClientId !== undefined) process.env.PINGONE_AGENT_CLIENT_ID = origClientId;
    else delete process.env.PINGONE_AGENT_CLIENT_ID;
    if (origSecret !== undefined) process.env.PINGONE_AGENT_CLIENT_SECRET = origSecret;
    else delete process.env.PINGONE_AGENT_CLIENT_SECRET;
  });

  it('returns null token (not throw) when PINGONE_RESOURCE_MCP_SERVER_URI is unset — local fallback path', async () => {
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(token).toBeNull();
  });

  it('includes exchange-required token event when URI is unset (status skipped — not a failure)', async () => {
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    const ev = tokenEvents.find((x) => x.id === 'exchange-required');
    expect(ev).toBeDefined();
    // 'skipped' — token exchange is not configured, not an error; local fallback is used instead
    expect(ev.status).toBe('skipped');
  });

  it('does not call performTokenExchange when PINGONE_RESOURCE_MCP_SERVER_URI is unset', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(mockPerformTokenExchange).not.toHaveBeenCalled();
  });

  it('does not call getMcpExchangerToken when PINGONE_RESOURCE_MCP_SERVER_URI is unset (returns before actor step)', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    // pingone_resource_mcp_server_uri check returns early before the actor token step
    expect(mockGetMcpExchangerToken).not.toHaveBeenCalled();
  });
});

// ── Architecture-note R1 (2026-05-15) / T-2 ───────────────────────────────
// The BFF no longer makes a local authorization decision in
// resolveMcpAccessTokenWithEvents. The former agentMcpScopePolicy veto that
// threw `agent_mcp_scope_denied` (403) when `agent_mcp_allowed_scopes`
// excluded a tool's scope has been REMOVED. Whether a tool call is permitted
// is decided solely by PingAuthorize via
// mcpToolAuthorizationService.evaluateMcpFirstToolGate (server.js — a separate,
// unconditional code path exercised by the hitlGateway/oauthStatus/hitlRoute
// suites). These tests pin the new behavior: the local allow-list no longer
// vetoes the exchange.
describe('resolveMcpAccessTokenWithEvents — R1: local scope allow-list no longer vetoes (T-2)', () => {
  // User token DOES carry write so the RFC 8693 user-token-scope guard
  // (a separate, legitimate check kept by R1) passes. The variable under test
  // is purely the removed local `agent_mcp_allowed_scopes` admin-config veto:
  // it excludes write below, which pre-R1 made the veto throw
  // agent_mcp_scope_denied before any exchange.
  const userTokenWithWrite = makeJwt({
    sub: USER_SUB,
    aud: 'banking_enduser',
    scope: 'openid profile email offline_access read write',
    iss: 'https://auth.pingone.com/test-env/as',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      // Pre-R1 this config (write absent) made the local veto throw
      // agent_mcp_scope_denied for create_transfer. Post-R1 it is inert.
      if (key === 'agent_mcp_allowed_scopes') {
        return 'read';
      }
      return null;
    });
    mockPerformTokenExchange.mockResolvedValue(sampleJwtMcpAccessToken);
  });

  it('does NOT throw agent_mcp_scope_denied even when the old local map would have blocked the tool', async () => {
    // Pre-R1 this rejected with agent_mcp_scope_denied/403 (the local veto).
    // Post-R1 the veto is gone — the exchange proceeds; PingAuthorize
    // (server.js gate) is the only thing that can deny.
    const { token } = await resolveMcpAccessTokenWithEvents(
      makeReq(userTokenWithWrite),
      'create_transfer'
    );
    expect(token).toBe(sampleJwtMcpAccessToken);
  });

  it('emits no agent-scope-denied token event (the local authz event was removed)', async () => {
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(
      makeReq(userTokenWithWrite),
      'create_transfer'
    );
    expect(tokenEvents.find((e) => e.id === 'agent-scope-denied')).toBeUndefined();
  });

  it('proceeds to the RFC 8693 exchange instead of short-circuiting on the local allow-list', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(userTokenWithWrite), 'create_transfer');
    // Pre-R1 the veto threw before any exchange call. Post-R1 the exchange runs;
    // authorization is delegated to PingAuthorize downstream (server.js gate).
    expect(mockPerformTokenExchange).toHaveBeenCalled();
  });
});

describe('resolveMcpAccessTokenWithEvents — insufficient user scopes (PINGONE_RESOURCE_MCP_SERVER_URI set)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      return null;
    });
  });

  it('throws user_token_insufficient_scopes when JWT has zero scopes', async () => {
    await expect(
      resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessNoScopes), 'get_my_accounts')
    ).rejects.toMatchObject({
      code: 'missing_exchange_scopes',
      httpStatus: 403,
    });
  });

  it('does not call performTokenExchange when scopes insufficient', async () => {
    try {
      await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessNoScopes), 'get_my_accounts');
    } catch {
      /* expected */
    }
    expect(mockPerformTokenExchange).not.toHaveBeenCalled();
  });
});

describe('resolveMcpAccessTokenWithEvents — RFC 8693 exchange, subject-only (PINGONE_AGENT_CLIENT_ID unset)', () => {
  const origClientId = process.env.PINGONE_AGENT_CLIENT_ID;
  const origUri = process.env.PINGONE_RESOURCE_MCP_SERVER_URI;

  beforeEach(() => {
    delete process.env.PINGONE_AGENT_CLIENT_ID;
    process.env.PINGONE_RESOURCE_MCP_SERVER_URI = 'https://mcp.example.com/api';
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      return null;
    });
    mockPerformTokenExchange.mockResolvedValue(sampleJwtMcpAccessToken);
  });

  afterEach(() => {
    if (origClientId !== undefined) process.env.PINGONE_AGENT_CLIENT_ID = origClientId;
    else delete process.env.PINGONE_AGENT_CLIENT_ID;
    if (origUri !== undefined) process.env.PINGONE_RESOURCE_MCP_SERVER_URI = origUri;
    else delete process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
  });

  it('returns the exchanged MCP token, not the User token', async () => {
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(token).toBe(sampleJwtMcpAccessToken);
    expect(token).not.toBe(sampleJwtUserAccessToken);
  });

  it('calls performTokenExchange with User token and the resource URI', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(mockPerformTokenExchange).toHaveBeenCalledWith(
      sampleJwtUserAccessToken,
      'https://mcp.example.com/api',
      expect.arrayContaining(['read']),
      expect.any(Object) // JIT exchangeOptions (buildJitExchangeOptions)
    );
  });

  it('returns userSub from user access token', async () => {
    const { userSub } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(userSub).toBe(USER_SUB);
  });

  it('emits a user-token event and an exchanged-token event', async () => {
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(tokenEvents.find(e => e.id === 'user-token')).toBeDefined();
    expect(tokenEvents.find(e => e.id === 'exchanged-token')).toBeDefined();
  });

  it('includes jwtFullDecode (header + full claims) on user-token and exchanged-token', async () => {
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    const userEv = tokenEvents.find(e => e.id === 'user-token');
    const mcpTokEv = tokenEvents.find(e => e.id === 'exchanged-token');
    expect(userEv.jwtFullDecode.header.alg).toBe('RS256');
    expect(userEv.jwtFullDecode.claims.sub).toBe(USER_SUB);
    expect(mcpTokEv.jwtFullDecode.claims.sub).toBe(USER_SUB);
    expect(mcpTokEv.jwtFullDecode.claims.aud).toBe('mcp-resource-uri');
    expect(mcpTokEv.jwtFullDecode.claims.act).toEqual({ client_id: 'bff-client-id' });
  });

  // ── C1 regression: failure path must attach the chain to the thrown error ──
  // Before the fix, the catch block at agentMcpTokenService.js built the
  // exchange-failed event into the local tokenEvents array then `throw err`
  // WITHOUT err.tokenEvents = tokenEvents, so the Token Chain went blank
  // exactly on an exchange failure — the one moment it matters most. Every
  // caller reads the chain off err.tokenEvents.
  it('C1: on RFC 8693 exchange failure, err.tokenEvents carries the exchange-failed step', async () => {
    const boom = new Error('PingOne rejected: invalid_grant');
    boom.httpStatus = 400;
    boom.pingoneError = 'invalid_grant';
    mockPerformTokenExchange.mockRejectedValueOnce(boom);

    let caught;
    try {
      await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(Array.isArray(caught.tokenEvents)).toBe(true);
    expect(caught.tokenEvents.length).toBeGreaterThan(0);
    const failed = caught.tokenEvents.find(e => e.id === 'exchange-failed');
    expect(failed).toBeDefined();
    expect(failed.status).toBe('failed');
    // The preceding user-token step must also survive so the chain shows
    // WHERE it broke, not just THAT it broke.
    expect(caught.tokenEvents.find(e => e.id === 'user-token')).toBeDefined();
  });

  // ── Leak guard: no raw JWT / signature anywhere in the chain ───────────────
  it('M4: tokenEvents never contain a raw JWT string or a signature segment', async () => {
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    const serialized = JSON.stringify(tokenEvents);
    // Raw compact tokens used in this suite end with ".sig"; the chain must
    // carry decoded claims only, never the raw 3-segment string.
    expect(serialized).not.toContain(sampleJwtUserAccessToken);
    expect(serialized).not.toContain(sampleJwtMcpAccessToken);
    expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  });
});

describe('resolveMcpAccessTokenWithEvents — on_behalf_of (PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID set)', () => {
  const origClientId = process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
  const origSecret   = process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID = 'agent-client-id';
    process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET = 'agent-secret';
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      if (key === 'pingone_mcp_token_exchanger_client_id') return 'agent-client-id';
      return null;
    });
    mockGetMcpExchangerToken.mockResolvedValue(sampleJwtAgentAccessToken);
    mockGetAiAgentClientCredentialsToken.mockResolvedValue(sampleJwtAgentAccessToken);
    mockPerformTokenExchangeWithActor.mockResolvedValue(sampleJwtMcpAccessToken);
  });

  afterEach(() => {
    if (origClientId !== undefined) process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID = origClientId;
    else delete process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
    if (origSecret !== undefined) process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET = origSecret;
    else delete process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET;
  });

  it('uses the AI Agent as actor_token by default (enforce_may_act on) for native act', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(mockGetAiAgentClientCredentialsToken).toHaveBeenCalledTimes(1);
    expect(mockGetMcpExchangerToken).not.toHaveBeenCalled();
  });

  it('calls performTokenExchangeWithActor (not subject-only) when agent client is configured', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(mockPerformTokenExchangeWithActor).toHaveBeenCalledWith(
      sampleJwtUserAccessToken,
      sampleJwtAgentAccessToken,
      'https://mcp.example.com/api',
      expect.arrayContaining(['read']),
      expect.any(Object) // JIT exchangeOptions (buildJitExchangeOptions)
    );
    expect(mockPerformTokenExchange).not.toHaveBeenCalled();
  });

  it('returns exchanged token, not user token', async () => {
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(token).toBe(sampleJwtMcpAccessToken);
    expect(token).not.toBe(sampleJwtUserAccessToken);
    expect(token).not.toBe(sampleJwtAgentAccessToken);
  });

  it('emits agent-actor-token event in the token chain', async () => {
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    const actorEv = tokenEvents.find(e => e.id === 'agent-actor-token');
    expect(actorEv).toBeDefined();
    expect(actorEv.status).toBe('active');
  });

  it('does not emit on-behalf-of-warning when agent client is configured', async () => {
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(tokenEvents.find(e => e.id === 'on-behalf-of-warning')).toBeUndefined();
  });
});

describe('resolveMcpAccessTokenWithEvents — subject-only warning when no agent client', () => {
  const origClientId = process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      return null;
    });
    mockPerformTokenExchange.mockResolvedValue(sampleJwtMcpAccessToken);
  });

  afterEach(() => {
    if (origClientId !== undefined) process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID = origClientId;
    else delete process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
  });

  it('emits agent-actor-token-unavailable event when PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID is not set', async () => {
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    const warn = tokenEvents.find(e => e.id === 'agent-actor-token-unavailable');
    expect(warn).toBeDefined();
    expect(warn.status).toBe('degraded');
  });

  it('still completes RFC 8693 subject-only exchange (user token never forwarded)', async () => {
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(token).toBe(sampleJwtMcpAccessToken);
    expect(token).not.toBe(sampleJwtUserAccessToken);
    expect(mockGetMcpExchangerToken).not.toHaveBeenCalled();
    expect(mockPerformTokenExchange).toHaveBeenCalledTimes(1);
  });
});

describe('buildSessionPreviewTokenEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty tokenEvents when no session token', async () => {
    const { tokenEvents } = await buildSessionPreviewTokenEvents(makeReq(null));
    expect(tokenEvents).toEqual([]);
  });

  it('returns user-token plus exchange-required failed when MCP_RESOURCE_URI is unset', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return '';
      return null;
    });
    const { tokenEvents } = await buildSessionPreviewTokenEvents(makeReq(sampleJwtUserAccessToken));
    expect(tokenEvents).toHaveLength(2);
    expect(tokenEvents[0].id).toBe('user-token');
    expect(tokenEvents[0].status).toBe('active');
    expect(tokenEvents[1].id).toBe('exchange-required');
    // 'skipped' — exchange not configured is not a failure, local fallback is used
    expect(tokenEvents[1].status).toBe('skipped');
    expect(mockPerformTokenExchange).not.toHaveBeenCalled();
  });

  it('returns user-scopes-insufficient when URI is set but JWT has no scopes', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      return null;
    });
    const { tokenEvents } = await buildSessionPreviewTokenEvents(makeReq(sampleJwtUserAccessNoScopes));
    expect(tokenEvents.some(e => e.id === 'user-scopes-insufficient')).toBe(true);
  });

  it('returns waiting exchange rows when MCP_RESOURCE_URI is set and scopes sufficient — does not call PingOne exchange', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      return null;
    });
    const { tokenEvents } = await buildSessionPreviewTokenEvents(makeReq(sampleJwtUserAccessToken));
    expect(tokenEvents).toHaveLength(3);
    expect(tokenEvents[0].id).toBe('user-token');
    expect(tokenEvents[1].id).toBe('exchange');
    expect(tokenEvents[1].status).toBe('waiting');
    expect(tokenEvents[2].id).toBe('exchanged-token');
    expect(tokenEvents[2].status).toBe('waiting');
    expect(mockPerformTokenExchange).not.toHaveBeenCalled();
  });

  it('surfaces ID token (decoded) and refresh token (opaque) when present in the session', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return '';
      return null;
    });
    const idToken = makeJwt({
      sub: USER_SUB,
      aud: 'banking_enduser_client',
      iss: 'https://auth.pingone.com/test-env/as',
      auth_time: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = makeReq(sampleJwtUserAccessToken);
    req.session.oauthTokens = { idToken, refreshToken: 'opaque-refresh-secret-value' };

    const { tokenEvents } = await buildSessionPreviewTokenEvents(req);
    const idEvent = tokenEvents.find(e => e.id === 'id-token');
    const refreshEvent = tokenEvents.find(e => e.id === 'refresh-token');

    // ID token is a JWT — decoded identity claims surface (sub from the id_token).
    expect(idEvent).toBeDefined();
    expect(idEvent.claims?.sub).toBe(USER_SUB);
    expect(idEvent.claims?.aud).toBe('banking_enduser_client');

    // Refresh token is opaque — present, no decoded claims, value never leaked.
    expect(refreshEvent).toBeDefined();
    expect(refreshEvent.claims).toBeNull();
    expect(JSON.stringify(refreshEvent)).not.toContain('opaque-refresh-secret-value');
  });

  it('omits the ID/refresh cards when neither is in the session, and skips the cookie-only refresh sentinel', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return '';
      return null;
    });
    const req = makeReq(sampleJwtUserAccessToken);
    req.session.oauthTokens = { refreshToken: '_cookie_session' };

    const { tokenEvents } = await buildSessionPreviewTokenEvents(req);
    expect(tokenEvents.some(e => e.id === 'id-token')).toBe(false);
    expect(tokenEvents.some(e => e.id === 'refresh-token')).toBe(false);
  });
});

// ── Broad scope (read / write) support ───────────────────────

/** User token that has read but NOT read */
const sampleJwtUserAccessBroadRead = makeJwt({
  sub: USER_SUB,
  aud: 'banking_enduser',
  scope: 'openid profile email offline_access read write',
  iss: 'https://auth.pingone.com/test-env/as',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

describe('resolveMcpAccessTokenWithEvents — read/write broad scope in token', () => {
  const origClientId = process.env.AGENT_OAUTH_CLIENT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AGENT_OAUTH_CLIENT_ID;
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      // Allow all scopes including broad ones
      if (key === 'agent_mcp_allowed_scopes')
        return 'read write read read write ai_agent';
      return null;
    });
    mockPerformTokenExchange.mockResolvedValue(sampleJwtMcpAccessToken);
  });

  afterEach(() => {
    if (origClientId !== undefined) process.env.AGENT_OAUTH_CLIENT_ID = origClientId;
    else delete process.env.AGENT_OAUTH_CLIENT_ID;
  });

  it('calls performTokenExchange with read when user token has broad scope', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessBroadRead), 'get_my_accounts');
    expect(mockPerformTokenExchange).toHaveBeenCalledWith(
      sampleJwtUserAccessBroadRead,
      'https://mcp.example.com/api',
      expect.arrayContaining(['read']),
      expect.any(Object) // JIT exchangeOptions (buildJitExchangeOptions)
    );
  });

  it('calls performTokenExchange with write for write tool when user has broad scope', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessBroadRead), 'create_transfer');
    expect(mockPerformTokenExchange).toHaveBeenCalledWith(
      sampleJwtUserAccessBroadRead,
      'https://mcp.example.com/api',
      expect.arrayContaining(['write']),
      expect.any(Object) // JIT exchangeOptions (buildJitExchangeOptions)
    );
  });

  it('returns the exchanged token (not user token) for broad-scope token', async () => {
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessBroadRead), 'get_my_accounts');
    expect(token).toBe(sampleJwtMcpAccessToken);
    expect(token).not.toBe(sampleJwtUserAccessBroadRead);
  });
});

describe('resolveMcpAccessTokenWithEvents — R1: agent_mcp_allowed_scopes is inert config (T-2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AGENT_OAUTH_CLIENT_ID;
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      if (key === 'agent_mcp_allowed_scopes') return 'read write ai_agent';
      return null;
    });
    mockPerformTokenExchange.mockResolvedValue(sampleJwtMcpAccessToken);
  });

  it('resolves get_my_accounts when the scope is in the allowed set (happy path unchanged)', async () => {
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessBroadRead), 'get_my_accounts');
    expect(token).toBe(sampleJwtMcpAccessToken);
    expect(mockPerformTokenExchange).toHaveBeenCalledTimes(1);
  });

  it('R1: still resolves create_transfer even when agent_mcp_allowed_scopes excludes write', async () => {
    // Pre-R1 this configuration made the local veto throw agent_mcp_scope_denied
    // and skip the exchange. Post-R1 the local allow-list is inert advisory
    // config: the exchange proceeds and authorization is PingAuthorize's call
    // (server.js evaluateMcpFirstToolGate — exercised by the gate test suites).
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      if (key === 'agent_mcp_allowed_scopes') return 'read ai_agent'; // write intentionally excluded
      return null;
    });
    const { token } = await resolveMcpAccessTokenWithEvents(
      makeReq(sampleJwtUserAccessBroadRead),
      'create_transfer'
    );
    expect(token).toBe(sampleJwtMcpAccessToken);
    expect(mockPerformTokenExchange).toHaveBeenCalledTimes(1);
  });
});

// ─── ENDUSER_AUDIENCE delegation-scope-only token (ai:agent:read) ────
// Regression: when ENDUSER_AUDIENCE restricts login to only ai:agent:read,
// the fallback must NOT use ai:agent:read as the exchange scope (it lives
// on the enduser resource, not the MCP resource).  The exchange should be attempted
// with the tool's actual scopes so PingOne can evaluate its exchange policy.

/** User token that carries ONLY the delegation scope (ENDUSER_AUDIENCE login path) */
const sampleJwtAgentInvokeOnly = makeJwt({
  sub: USER_SUB,
  aud: 'enduser.ping.demo',
  scope: 'profile email offline_access ai:agent:read',
  iss: 'https://auth.pingone.com/test-env/as',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

describe('resolveMcpAccessTokenWithEvents — ENDUSER_AUDIENCE ai:agent:read only token', () => {
  const origClientId = process.env.AGENT_OAUTH_CLIENT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AGENT_OAUTH_CLIENT_ID;
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      if (key === 'agent_mcp_allowed_scopes')
        return 'read write read read write ai:agent ai_agent';
      return null;
    });
    mockPerformTokenExchange.mockResolvedValue(sampleJwtMcpAccessToken);
  });

  afterEach(() => {
    if (origClientId !== undefined) process.env.AGENT_OAUTH_CLIENT_ID = origClientId;
    else delete process.env.AGENT_OAUTH_CLIENT_ID;
  });

  it('uses tool candidate scopes (not ai:agent:read) for write tool exchange', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtAgentInvokeOnly), 'create_transfer');
    const callArgs = mockPerformTokenExchange.mock.calls[0][2];
    // Must request actual MCP resource scopes, not the delegation scope
    expect(callArgs).not.toContain('ai:agent:read');
    expect(callArgs).toEqual(expect.arrayContaining(['write']));
  });

  it('uses tool candidate scopes (not ai:agent:read) for read tool exchange', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtAgentInvokeOnly), 'get_my_accounts');
    const callArgs = mockPerformTokenExchange.mock.calls[0][2];
    expect(callArgs).not.toContain('ai:agent:read');
    expect(callArgs).toEqual(expect.arrayContaining(['read']));
  });
});

// ─── ff_inject_may_act tests removed — may_act injection feature deleted ─────

// ─── ff_inject_audience injection tests ──────────────────────────────────────

/** User token whose aud does NOT include the MCP resource URI */
const sampleJwtAudMismatch = makeJwt({
  sub: USER_SUB,
  aud: 'banking_enduser',  // only the admin client; not the MCP URI
  scope: 'openid profile email offline_access read read',
  iss: 'https://auth.pingone.com/test-env/as',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

/** User token whose aud already includes the MCP resource URI */
const sampleJwtAudIncludes = makeJwt({
  sub: USER_SUB,
  aud: ['banking_enduser', 'https://mcp.example.com/api'],
  scope: 'openid profile email offline_access read read',
  iss: 'https://auth.pingone.com/test-env/as',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
});

describe('resolveMcpAccessTokenWithEvents — ff_inject_audience', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AGENT_OAUTH_CLIENT_ID;
    mockPerformTokenExchange.mockResolvedValue(sampleJwtMcpAccessToken);
  });

  it('pushes audience-injected event when flag ON and aud missing resource URI', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')    return 'https://mcp.example.com/api';
      if (key === 'ff_inject_audience')  return 'true';
      return null;
    });
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtAudMismatch), 'get_my_accounts');
    const injEv = tokenEvents.find(e => e.id === 'audience-injected');
    expect(injEv).toBeDefined();
    expect(injEv.status).toBe('active');
    expect(injEv.synthetic).toBe(true);
    expect(injEv.injectedValue).toBe('https://mcp.example.com/api');
  });

  it('patches user-token event with audInjected=true when flag ON and aud missing', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')    return 'https://mcp.example.com/api';
      if (key === 'ff_inject_audience')  return 'true';
      return null;
    });
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtAudMismatch), 'get_my_accounts');
    const utEv = tokenEvents.find(e => e.id === 'user-token');
    expect(utEv.audInjected).toBe(true);
  });

  it('does NOT push audience-injected when flag ON but aud already contains resource URI', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')    return 'https://mcp.example.com/api';
      if (key === 'ff_inject_audience')  return 'true';
      return null;
    });
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtAudIncludes), 'get_my_accounts');
    expect(tokenEvents.find(e => e.id === 'audience-injected')).toBeUndefined();
  });

  it('does NOT push audience-injected event when flag OFF (default)', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')    return 'https://mcp.example.com/api';
      if (key === 'ff_inject_audience')  return 'false';
      return null;
    });
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtAudMismatch), 'get_my_accounts');
    expect(tokenEvents.find(e => e.id === 'audience-injected')).toBeUndefined();
  });

  it('still calls performTokenExchange even when audience is injected', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')    return 'https://mcp.example.com/api';
      if (key === 'ff_inject_audience')  return 'true';
      return null;
    });
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtAudMismatch), 'get_my_accounts');
    expect(token).toBe(sampleJwtMcpAccessToken);
    expect(mockPerformTokenExchange).toHaveBeenCalledTimes(1);
  });
});

// ─── ff_skip_token_exchange — direct user token bypass ────────────────────────

describe('resolveMcpAccessTokenWithEvents — ff_skip_token_exchange', () => {
  const origClientId = process.env.AGENT_OAUTH_CLIENT_ID;
  const origSecret   = process.env.AGENT_OAUTH_CLIENT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_OAUTH_CLIENT_ID     = 'agent-client-id';
    process.env.AGENT_OAUTH_CLIENT_SECRET = 'agent-secret';
    mockGetMcpExchangerToken.mockResolvedValue(sampleJwtAgentAccessToken);
    mockGetAiAgentClientCredentialsToken.mockResolvedValue(sampleJwtAgentAccessToken);
    mockPerformTokenExchangeAs.mockResolvedValue(sampleJwtMcpAccessToken);
  });

  afterEach(() => {
    if (origClientId !== undefined) process.env.AGENT_OAUTH_CLIENT_ID = origClientId;
    else delete process.env.AGENT_OAUTH_CLIENT_ID;
    if (origSecret !== undefined) process.env.AGENT_OAUTH_CLIENT_SECRET = origSecret;
    else delete process.env.AGENT_OAUTH_CLIENT_SECRET;
  });

  it('returns user token directly when flag ON (no exchange)', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')         return 'https://mcp.example.com/api';
      if (key === 'ff_skip_token_exchange')   return 'true';
      return null;
    });
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(token).toBe(sampleJwtUserAccessToken);
  });

  it('does NOT call performTokenExchange or getMcpExchangerToken when flag ON', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')         return 'https://mcp.example.com/api';
      if (key === 'ff_skip_token_exchange')   return 'true';
      return null;
    });
    await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(mockPerformTokenExchange).not.toHaveBeenCalled();
    expect(mockPerformTokenExchangeWithActor).not.toHaveBeenCalled();
    expect(mockPerformTokenExchangeAs).not.toHaveBeenCalled();
    expect(mockGetMcpExchangerToken).not.toHaveBeenCalled();
  });

  it('emits exchange-skipped event with status skipped when flag ON', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')         return 'https://mcp.example.com/api';
      if (key === 'ff_skip_token_exchange')   return 'true';
      return null;
    });
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    const ev = tokenEvents.find(e => e.id === 'exchange-skipped');
    expect(ev).toBeDefined();
    expect(ev.status).toBe('skipped');
    expect(ev.bypass).toBe(true);
  });

  it('still returns user-token event in chain when flag ON', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')         return 'https://mcp.example.com/api';
      if (key === 'ff_skip_token_exchange')   return 'true';
      return null;
    });
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(tokenEvents.find(e => e.id === 'user-token')).toBeDefined();
  });

  it('performs full RFC 8693 exchange when flag OFF (default)', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')         return 'https://mcp.example.com/api';
      if (key === 'ff_skip_token_exchange')   return 'false';
      // Exchanger creds now route through configStore (a3db6dbd); the single-
      // exchange path gates the actor token + exchange on these keys, not the
      // legacy AGENT_OAUTH_* env vars.
      if (key === 'pingone_mcp_token_exchanger_client_id')     return 'exchanger-client-id';
      if (key === 'pingone_mcp_token_exchanger_client_secret') return 'exchanger-secret';
      return null;
    });
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(token).toBe(sampleJwtMcpAccessToken);
    expect(token).not.toBe(sampleJwtUserAccessToken);
    expect(mockPerformTokenExchangeAs).toHaveBeenCalledTimes(1);
  });

  it('returns userSub even when exchange is skipped', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')         return 'https://mcp.example.com/api';
      if (key === 'ff_skip_token_exchange')   return 'true';
      return null;
    });
    const { userSub } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(userSub).toBe(USER_SUB);
  });
});

// ---------------------------------------------------------------------------
// 2-Exchange delegation JWT fixtures (unsigned — test-only)
// ---------------------------------------------------------------------------
const AI_AGENT_CLIENT = 'ai-agent-client-id';
const MCP_EXCHANGER_CLIENT = 'mcp-exchanger-client-id';

const agentActorJwt = makeJwt({
  sub: AI_AGENT_CLIENT,
  aud: ['agentgateway.ping.demo'],
  scope: 'openid',
  client_id: AI_AGENT_CLIENT,
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const agentExchangedJwt = makeJwt({
  sub: USER_SUB,
  aud: 'mcpserver.ping.demo',
  scope: 'read',
  act: { sub: AI_AGENT_CLIENT },
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const mcpActorJwt = makeJwt({
  sub: MCP_EXCHANGER_CLIENT,
  aud: ['https://mcp-gateway.pingdemo.com'],
  scope: 'openid',
  client_id: MCP_EXCHANGER_CLIENT,
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const TWO_EX_MCP_RESOURCE = 'mcpserver.ping.demo';

const finalMcpJwt = makeJwt({
  sub: USER_SUB,
  aud: TWO_EX_MCP_RESOURCE,
  scope: 'read',
  act: {
    sub: MCP_EXCHANGER_CLIENT,
    act: { sub: AI_AGENT_CLIENT },
  },
  exp: Math.floor(Date.now() / 1000) + 3600,
});

// ---------------------------------------------------------------------------
// resolveMcpAccessTokenWithEvents — 2-exchange delegation
// ---------------------------------------------------------------------------
describe('resolveMcpAccessTokenWithEvents — 2-exchange delegation (ff_two_exchange_delegation)', () => {
  // Cache env vars set in beforeEach so afterEach can restore exactly
  let savedEnv = {};
  const TWO_EX_VARS = [
    'AI_AGENT_CLIENT_ID',
    'AI_AGENT_CLIENT_SECRET',
    'AGENT_OAUTH_CLIENT_ID',
    'AGENT_OAUTH_CLIENT_SECRET',
    'AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD',
    'MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD',
  ];

  beforeEach(() => {
    // Save and inject 2-exchange credentials
    savedEnv = {};
    for (const v of TWO_EX_VARS) savedEnv[v] = process.env[v];
    process.env.AI_AGENT_CLIENT_ID     = AI_AGENT_CLIENT;
    process.env.AI_AGENT_CLIENT_SECRET = 'ai-agent-secret';
    process.env.AGENT_OAUTH_CLIENT_ID  = MCP_EXCHANGER_CLIENT;
    process.env.AGENT_OAUTH_CLIENT_SECRET = 'mcp-exchanger-secret';
    delete process.env.AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD;
    delete process.env.MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD;

    jest.clearAllMocks();

    // Config: 2-exchange flag on, MCP URI set
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')            return TWO_EX_MCP_RESOURCE;
      if (key === 'ff_two_exchange_delegation')   return 'true';
      return null; // agent_gateway_audience / mcp_gateway_audience etc use defaults
    });

    // Mock successful 4-step chain by default
    mockGetClientCredentialsTokenAs
      .mockResolvedValueOnce(agentActorJwt)   // Step 1: AI Agent actor token
      .mockResolvedValueOnce(mcpActorJwt);    // Step 3: MCP actor token
    mockPerformTokenExchangeAs
      .mockResolvedValueOnce(agentExchangedJwt) // Step 2: Exchange #1
      .mockResolvedValueOnce(finalMcpJwt);      // Step 4: Exchange #2
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('happy path: returns finalMcpJwt (not userToken or agentExchangedJwt)', async () => {
    const { token } = await resolveMcpAccessTokenWithEvents(
      makeReq2ex(sampleJwtUserAccessToken), 'get_my_accounts'
    );
    expect(token).toBe(finalMcpJwt);
    expect(token).not.toBe(sampleJwtUserAccessToken);
    expect(token).not.toBe(agentExchangedJwt);
  });

  it('happy path: calls getClientCredentialsTokenAs twice and performTokenExchangeAs twice', async () => {
    await resolveMcpAccessTokenWithEvents(makeReq2ex(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(mockGetClientCredentialsTokenAs).toHaveBeenCalledTimes(2);
    expect(mockPerformTokenExchangeAs).toHaveBeenCalledTimes(2);
  });

  it('happy path: tokenEvents include two-ex-agent-actor, two-ex-exchange1, two-ex-mcp-actor, two-ex-final-token', async () => {
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(
      makeReq2ex(sampleJwtUserAccessToken), 'get_my_accounts'
    );
    const ids = tokenEvents.map((e) => e.id);
    expect(ids).toContain('two-ex-agent-actor');
    expect(ids).toContain('two-ex-exchange1');
    expect(ids).toContain('two-ex-mcp-actor');
    expect(ids).toContain('two-ex-final-token');
  });

  // Regression: the Banking MCP Inspector's WS client always dials the raw
  // MCP server directly (mcpWebSocketClient.js getMcpServerUrl()), never
  // through PingGateway — but Exchange #2 minted a PingGateway-audience token
  // whenever ff_mcp_gateway_pinggateway was on, regardless of caller. The
  // direct MCP server rejected that token's aud (WS close 1008 "Agent token
  // rejected"). forceDirectMcpAudience lets a caller opt out of the
  // PingGateway override.
  describe('forceDirectMcpAudience opt (direct-WS callers bypass PingGateway audience)', () => {
    const pingGatewayAud = 'https://api.ping.demo:3036/mcp';

    beforeEach(() => {
      configStore.getEffective.mockImplementation((key) => {
        if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return TWO_EX_MCP_RESOURCE;
        if (key === 'ff_two_exchange_delegation') return 'true';
        if (key === 'ff_mcp_gateway_pinggateway') return 'true';
        if (key === 'pingone_resource_pinggateway_uri') return pingGatewayAud;
        return null;
      });
    });

    it('without the opt, Exchange #2 requests the PingGateway audience', async () => {
      // finalMcpJwt's fixture aud (TWO_EX_MCP_RESOURCE) won't match the
      // requested pingGatewayAud, so the final-audience-enforcement check
      // (below) rejects it — irrelevant here, we only assert what was
      // requested, not whether the mocked fixture happened to match it.
      await resolveMcpAccessTokenWithEvents(makeReq2ex(sampleJwtUserAccessToken), 'get_my_accounts').catch(() => {});
      const exchange2Audience = mockPerformTokenExchangeAs.mock.calls[1][4];
      expect(exchange2Audience).toEqual([pingGatewayAud]);
    });

    it('with the opt, Exchange #2 requests the direct mcp-server audience instead', async () => {
      await resolveMcpAccessTokenWithEvents(
        makeReq2ex(sampleJwtUserAccessToken), 'get_my_accounts', { forceDirectMcpAudience: true }
      );
      const exchange2Audience = mockPerformTokenExchangeAs.mock.calls[1][4];
      expect(exchange2Audience).not.toEqual([pingGatewayAud]);
      expect(exchange2Audience).toBe(TWO_EX_MCP_RESOURCE);
    });
  });

  it('preflight: missing AI_AGENT_CLIENT_ID → throws 503 with two-exchange-not-configured event', async () => {
    delete process.env.AI_AGENT_CLIENT_ID;
    // Override validateTwoExchangeConfig to throw (simulating missing credentials)
    const configErr = new Error('Two-exchange delegation requires AI_AGENT_CLIENT_ID');
    configErr.code = 'two_exchange_not_configured';
    configErr.httpStatus = 503;
    configErr.tokenEvents = [{ id: 'two-exchange-not-configured', status: 'failed' }];
    configStore.validateTwoExchangeConfig.mockImplementationOnce(() => { throw configErr; });
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')           return TWO_EX_MCP_RESOURCE;
      if (key === 'ff_two_exchange_delegation')  return 'true';
      if (key === 'ai_agent_client_id')          return null;
      return null;
    });

    let err;
    try {
      await resolveMcpAccessTokenWithEvents(makeReq2ex(sampleJwtUserAccessToken), 'get_my_accounts');
    } catch (e) { err = e; }

    expect(err).toBeDefined();
    expect(err.httpStatus).toBe(503);
  });

  it('preflight: missing AGENT_OAUTH_CLIENT_SECRET → throws 503', async () => {
    delete process.env.AGENT_OAUTH_CLIENT_SECRET;
    // Override validateTwoExchangeConfig to throw
    const configErr = new Error('Two-exchange delegation requires AGENT_OAUTH_CLIENT_SECRET');
    configErr.code = 'two_exchange_not_configured';
    configErr.httpStatus = 503;
    configStore.validateTwoExchangeConfig.mockImplementationOnce(() => { throw configErr; });
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return TWO_EX_MCP_RESOURCE;
      if (key === 'ff_two_exchange_delegation') return 'true';
      return null;
    });
    let err;
    try {
      await resolveMcpAccessTokenWithEvents(makeReq2ex(sampleJwtUserAccessToken), 'get_my_accounts');
    } catch (e) { err = e; }
    expect(err?.httpStatus).toBe(503);
  });

  it('Exchange #1 failure → throws error with exchange context', async () => {
    const exchangeErr = Object.assign(new Error('may_act mismatch'), { httpStatus: 400, pingoneError: 'invalid_request' });
    // Step 1 (CC actor) succeeds, Step 2 (exchange #1) fails
    mockGetClientCredentialsTokenAs.mockReset();
    mockPerformTokenExchangeAs.mockReset();
    mockGetClientCredentialsTokenAs.mockResolvedValueOnce(agentActorJwt);
    mockPerformTokenExchangeAs.mockRejectedValueOnce(exchangeErr);

    let err;
    try {
      await resolveMcpAccessTokenWithEvents(makeReq2ex(sampleJwtUserAccessToken), 'get_my_accounts');
    } catch (e) { err = e; }

    expect(err).toBeDefined();
    // The error thrown is an RFCCompliantError from createTokenExchangeError
    expect(err.error || err.code || err.message).toBeDefined();
  });

  it('session.mcpExchangeMode=double triggers 2-exchange even when ff_two_exchange_delegation=false', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')           return TWO_EX_MCP_RESOURCE;
      if (key === 'ff_two_exchange_delegation')  return 'false'; // flag OFF
      return null;
    });
    const req = makeReq(sampleJwtUserAccessToken);
    req.session.mcpExchangeMode = 'double'; // session override forces 2-exchange
    const { token } = await resolveMcpAccessTokenWithEvents(req, 'get_my_accounts');
    expect(token).toBe(finalMcpJwt);
    expect(mockPerformTokenExchangeAs).toHaveBeenCalledTimes(2);
  });

  it('session.mcpExchangeMode=single blocks 2-exchange even when ff_two_exchange_delegation=true', async () => {
    // ff is true but session says single → 1-exchange path
    const req = makeReq(sampleJwtUserAccessToken);
    req.session.mcpExchangeMode = 'single';
    // The 1-exchange path calls getMcpExchangerToken + performTokenExchangeAs
    mockGetMcpExchangerToken.mockResolvedValue(sampleJwtAgentAccessToken);
    mockGetAiAgentClientCredentialsToken.mockResolvedValue(sampleJwtAgentAccessToken);
    mockPerformTokenExchangeAs.mockReset();
    mockPerformTokenExchangeAs.mockResolvedValue(sampleJwtMcpAccessToken);
    process.env.AGENT_OAUTH_CLIENT_ID = 'agent-client-id';
    process.env.AGENT_OAUTH_CLIENT_SECRET = 'agent-secret';

    const { token } = await resolveMcpAccessTokenWithEvents(req, 'get_my_accounts');
    // 2-exchange methods should not have been called (getClientCredentialsTokenAs is 2-exchange only)
    expect(mockGetClientCredentialsTokenAs).not.toHaveBeenCalled();
    // 1-exchange was taken — token is defined
    expect(token).toBeDefined();
  });

  // ── F4 — audMatches was computed and then discarded ───────────────────────
  // A final token whose aud does not carry the requested audience was minted,
  // logged with "❌ mismatch", and then SENT — failing downstream at the
  // gateway instead of at the mint. It is now enforced where it is computed.
  describe('final-token audience is enforced, not just reported', () => {
    it('throws instead of returning a token minted for the wrong audience', async () => {
      const wrongAudJwt = makeJwt({
        sub: USER_SUB,
        aud: 'https://attacker.example/mcp', // not TWO_EX_MCP_RESOURCE
        scope: 'read',
        act: { sub: MCP_EXCHANGER_CLIENT, act: { sub: AI_AGENT_CLIENT } },
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      mockPerformTokenExchangeAs.mockReset();
      mockPerformTokenExchangeAs
        .mockResolvedValueOnce(agentExchangedJwt)
        .mockResolvedValueOnce(wrongAudJwt);

      // The mismatch is raised inside the Exchange #2 try, so it surfaces as the
      // path's standard delegation_chain_broken error (the specific cause —
      // expected vs actual aud — is carried on the two-ex-final-token event and
      // the exchange audit log). What matters here is that NO token comes back.
      let err;
      try {
        await resolveMcpAccessTokenWithEvents(makeReq2ex(sampleJwtUserAccessToken), 'get_my_accounts');
      } catch (e) { err = e; }

      expect(err).toBeDefined();
      expect(err.error || err.code).toBe('delegation_chain_broken');
      expect(err.exchangeContext).toMatchObject({ exchangeStep: '2-exchange' });
    });

    it('still returns the token when the audience matches', async () => {
      const { token } = await resolveMcpAccessTokenWithEvents(
        makeReq2ex(sampleJwtUserAccessToken), 'get_my_accounts',
      );
      expect(token).toBe(finalMcpJwt);
    });
  });
});

// ---------------------------------------------------------------------------
// Security properties
// ---------------------------------------------------------------------------
describe('Security properties', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_OAUTH_CLIENT_ID     = 'agent-client-id';
    process.env.AGENT_OAUTH_CLIENT_SECRET = 'agent-secret';
    mockGetMcpExchangerToken.mockResolvedValue(sampleJwtAgentAccessToken);
    mockGetAiAgentClientCredentialsToken.mockResolvedValue(sampleJwtAgentAccessToken);
    mockPerformTokenExchangeAs.mockResolvedValue(sampleJwtMcpAccessToken);
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'mcp-resource-uri';
      return null;
    });
  });

  it('exchanged token is never the raw user access token when MCP_RESOURCE_URI is set', async () => {
    // SECURITY: the user's original session token must never be forwarded to the MCP server.
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(token).not.toBe(sampleJwtUserAccessToken);
    expect(token).toBe(sampleJwtMcpAccessToken); // RFC 8693 result returned instead
  });

  it('exchanged-token event has audMatches=true when issued token aud matches mcp_resource_uri', async () => {
    // sampleJwtMcpAccessToken has aud='mcp-resource-uri' — should match mcp_resource_uri='mcp-resource-uri'
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    const ev = tokenEvents.find((e) => e.id === 'exchanged-token');
    expect(ev).toBeDefined();
    expect(ev.audMatches).toBe(true);
  });

  it('exchanged-token event has audMatches=false when issued token aud differs from mcp_resource_uri', async () => {
    // Override mcp_resource_uri to a different value — simulates mis-issued token
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://different-audience.example.com';
      return null;
    });
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    const ev = tokenEvents.find((e) => e.id === 'exchanged-token');
    expect(ev).toBeDefined();
    expect(ev.audMatches).toBe(false);
  });

  it('exchanged-token event has actPresent=true when act claim is in the issued token', async () => {
    // sampleJwtMcpAccessToken has act: { client_id: 'bff-client-id' }
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    const ev = tokenEvents.find((e) => e.id === 'exchanged-token');
    expect(ev).toBeDefined();
    expect(ev.actPresent).toBe(true);
  });

  it('ff_skip_token_exchange=true returns user token directly — explicit security opt-out', async () => {
    // SECURITY OPT-OUT: ff_skip_token_exchange bypasses RFC 8693.
    // Only valid for dev/demo environments where PingOne token exchange is NOT configured.
    // In production with a real MCP resource server, this flag MUST be false.
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')       return 'mcp-resource-uri';
      if (key === 'ff_skip_token_exchange') return 'true';
      return null;
    });
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(sampleJwtUserAccessToken), 'get_my_accounts');
    expect(token).toBe(sampleJwtUserAccessToken);
    expect(mockPerformTokenExchangeWithActor).not.toHaveBeenCalled();
    expect(mockPerformTokenExchangeAs).not.toHaveBeenCalled();
    expect(mockPerformTokenExchange).not.toHaveBeenCalled();
  });

// ---------------------------------------------------------------------------
// RFC 8693 Compliance: Subject Preservation & may_act Format Validation
// ---------------------------------------------------------------------------
describe('RFC 8693 Compliance - Subject Preservation & may_act Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_OAUTH_CLIENT_ID = 'agent-client-id';
    process.env.AGENT_OAUTH_CLIENT_SECRET = 'agent-secret';
    mockGetMcpExchangerToken.mockResolvedValue(sampleJwtAgentAccessToken);
    mockGetAiAgentClientCredentialsToken.mockResolvedValue(sampleJwtAgentAccessToken);
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri')
        return 'https://mcp-server.banking-demo.com';
      // Exchanger creds now route through configStore (a3db6dbd); without them
      // the single-exchange path skips the actor token + exchange, so the
      // subject-preservation comparison never runs.
      if (key === 'pingone_mcp_token_exchanger_client_id')     return 'exchanger-client-id';
      if (key === 'pingone_mcp_token_exchanger_client_secret') return 'exchanger-secret';
      return null;
    });
  });

  it('should validate subject claim preservation in exchanged token', async () => {
    // When exchanged token has correct subject (matches original user_sub)
    mockPerformTokenExchangeAs.mockResolvedValue(sampleJwtMcpAccessToken);
    
    const req = makeReq(sampleJwtUserAccessToken);
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(req, 'get_my_accounts');
    
    // Should NOT have a subject-preservation-mismatch event
    const mismatchEvent = tokenEvents.find(e => e.id === 'subject-preservation-mismatch');
    expect(mismatchEvent).toBeUndefined();
  });

  it('should emit warning when exchanged token has different subject', async () => {
    // Mock exchanged token with DIFFERENT subject
    const mismatchedMcpToken = makeJwt({
      sub: 'different-user-sub', // NOT USER_SUB
      aud: 'mcp-server',
      scope: 'read',
      act: { client_id: 'agent-client' },
      iss: 'https://auth.pingone.com/test-env/as',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });
    
    mockPerformTokenExchangeAs.mockResolvedValue(mismatchedMcpToken);
    
    const req = makeReq(sampleJwtUserAccessToken);
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(req, 'get_my_accounts');
    
    // Should have subject-preservation-mismatch event
    const mismatchEvent = tokenEvents.find(e => e.id === 'subject-preservation-mismatch');
    expect(mismatchEvent).toBeDefined();
    expect(mismatchEvent.status).toBe('warning');
  });

  it('should NOT inject synthetic may_act claims', async () => {
    // User token has no may_act claim
    const userTokenNoMayAct = makeJwt({
      sub: USER_SUB,
      aud: 'banking_enduser',
      scope: 'read read',
      // NO may_act claim
      iss: 'https://auth.pingone.com/test-env/as',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });
    
    mockPerformTokenExchangeAs.mockResolvedValue(sampleJwtMcpAccessToken);
    
    const req = makeReq(userTokenNoMayAct);
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(req, 'get_my_accounts');
    
    // Should NOT have a 'may-act-injected' event (no synthetic injection)
    const injectedEvent = tokenEvents.find(e => e.id === 'may-act-injected');
    expect(injectedEvent).toBeUndefined();
  });

  it('should skip token exchange gracefully when exchange config is minimal', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') 
        return 'https://mcp-server.banking-demo.com';
      return null;
    });
    
    mockPerformTokenExchangeAs.mockResolvedValue(sampleJwtMcpAccessToken);
    
    const req = makeReq(sampleJwtUserAccessToken);
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(req, 'get_my_accounts');
    
    // Should NOT emit may_act validation events (feature removed)
    const mayActEvents = tokenEvents.filter(e => e.id && e.id.includes('may-act'));
    expect(mayActEvents.length).toBe(0);
  });
});



describe('Scope & Audience Mapping (RFC 8707)', () => {
  // Use an audience from the known mapping defaults (configStore.get returns null → uses defaults)
  const testAudience = 'mcpgateway.ping.demo';
  // Allowed scopes for this audience: ['read', 'write', 'mcp:invoke', 'ai:agent']

  beforeEach(() => {
    // validateScopeAudience is the REAL configStore fn; its internal
    // buildAllowedScopesByAudience() reads the audience URIs via the real
    // getEffective (env → default), NOT the exported jest mock. Feed the
    // canonical ping.demo audiences (a385d679) through env so testAudience maps
    // to its allowlist.
    process.env.ENDUSER_AUDIENCE = 'enduser.ping.demo';
    process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI = 'agentgateway.ping.demo';
    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI = 'mcpgateway.ping.demo';
    process.env.PINGONE_RESOURCE_MCP_SERVER_URI = 'mcpserver.ping.demo';
  });

  it('should validate scopes match audience', () => {
    const result = require('../../services/configStore').validateScopeAudience(
      ['read', 'write'],
      testAudience
    );
    expect(result.valid).toBe(true);
    expect(result.scopes).toEqual(['read', 'write']);
    expect(result.narrowed).toBe(false);
  });

  it('should narrow scopes to audience allowlist', () => {
    const result = require('../../services/configStore').validateScopeAudience(
      ['read', 'ai:agent', 'invalid:scope'],
      testAudience
    );
    expect(result.valid).toBe(true);
    expect(result.scopes).toContain('read');
    expect(result.scopes).not.toContain('invalid:scope');
    expect(result.narrowed).toBe(true);
  });

  it('should reject scopes with no audience match', () => {
    expect(() => {
      require('../../services/configStore').validateScopeAudience(
        ['invalid:scope', 'another:invalid'],
        testAudience
      );
    }).toThrow(/SCOPE_MISMATCH/);
  });

  it('should allow unknown audiences (graceful degradation)', () => {
    const result = require('../../services/configStore').validateScopeAudience(
      ['read'],
      'https://unknown.example.com'
    );
    // Gracefully degrade: return scopes unchanged for unknown audiences
    expect(result.valid).toBe(true);
    expect(result.scopes).toEqual(['read']);
  });

  it('should reject empty scope list', () => {
    expect(() => {
      require('../../services/configStore').validateScopeAudience([], testAudience);
    }).toThrow(/SCOPE_ERROR/);
  });
});

describe('Scope & Audience Mapping (RFC 8707) — additional', () => {
  const testAudience = 'mcpgateway.ping.demo';

  beforeEach(() => {
    jest.clearAllMocks();
    // Feed canonical audience URIs via env so the real
    // buildAllowedScopesByAudience() resolves testAudience's allowlist.
    process.env.ENDUSER_AUDIENCE = 'enduser.ping.demo';
    process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI = 'agentgateway.ping.demo';
    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI = 'mcpgateway.ping.demo';
    process.env.PINGONE_RESOURCE_MCP_SERVER_URI = 'mcpserver.ping.demo';
  });

  it('should validate scopes match audience', () => {
    const result = require('../../services/configStore').validateScopeAudience(
      ['read', 'write'],
      testAudience
    );
    expect(result.valid).toBe(true);
    expect(result.scopes).toEqual(['read', 'write']);
    expect(result.narrowed).toBe(false);
  });

  it('should narrow scopes to audience allowlist', () => {
    const result = require('../../services/configStore').validateScopeAudience(
      ['read', 'ai:agent', 'invalid:scope'],
      testAudience
    );
    expect(result.valid).toBe(true);
    expect(result.scopes).toContain('read');
    expect(result.scopes).not.toContain('invalid:scope');
    expect(result.narrowed).toBe(true);
  });

  it('should reject scopes with no audience match', () => {
    expect(() => {
      require('../../services/configStore').validateScopeAudience(
        ['invalid:scope', 'another:invalid'],
        testAudience
      );
    }).toThrow(/SCOPE_MISMATCH/);
  });

  it('should gracefully degrade for unknown audiences', () => {
    // Unknown audiences return all scopes unchanged (graceful degradation)
    const result = require('../../services/configStore').validateScopeAudience(
      ['read'],
      'https://unknown.example.com'
    );
    expect(result.valid).toBe(true);
    expect(result.scopes).toEqual(['read']);
  });

  it('should reject empty scope list', () => {
    expect(() => {
      require('../../services/configStore').validateScopeAudience([], testAudience);
    }).toThrow(/SCOPE_ERROR/);
  });
});

});

describe('RFC 8693 Error Code Standardization', () => {
  const { mapErrorToStructuredResponse } = require('../../services/agentMcpTokenService');
  const configStore = require('../../services/configStore');

  it('should map invalid_client errors to RFC 8693 invalid_client code', () => {
    const err = new Error('invalid_client: client authentication failed');
    const result = mapErrorToStructuredResponse(err);
    expect(result.errorCode).toBe('invalid_client');
    expect(result.errorDetails.oauth_error).toBe('invalid_client');
    expect(result.errorDetails.http_status).toBe(401);
  });

  it('should include http_status and category in error details', () => {
    const err = new Error('invalid_grant: authorization code expired');
    const result = mapErrorToStructuredResponse(err);
    expect(result.errorDetails).toHaveProperty('http_status');
    expect(result.errorDetails).toHaveProperty('oauth_error');
    expect(result.errorDetails).toHaveProperty('category');
  });

  it('should fall back to server_error for unknown error messages', () => {
    const err = new Error('some completely unknown internal failure');
    const result = mapErrorToStructuredResponse(err);
    expect(result.errorCode).toBe('server_error');
    expect(result.errorDetails.http_status).toBe(500);
    expect(result.errorDetails.oauth_error).toBe('server_error');
  });

  it('configStore.getErrorDetails returns valid detail for all known codes', () => {
    const knownCodes = ['invalid_client', 'invalid_grant', 'invalid_scope', 'server_error', 'access_denied'];
    knownCodes.forEach(code => {
      const details = configStore.getErrorDetails(code);
      expect(details).toHaveProperty('http_status');
      expect(details).toHaveProperty('oauth_error');
      expect(details).toHaveProperty('category');
    });
  });

  it('configStore.getErrorDetails returns server_error for unknown code', () => {
    const details = configStore.getErrorDetails('completely_unknown_code_xyz');
    expect(details.oauth_error).toBe('server_error');
    expect(details.http_status).toBe(500);
  });

  it('mapErrorToStructuredResponse returns message from error', () => {
    const err = new Error('Token exchange rejected by authorization server');
    const result = mapErrorToStructuredResponse(err);
    expect(result.message).toBe('Token exchange rejected by authorization server');
  });
});

// ── Regression: introspection CALL failure must not force a re-login loop ──────
// A 401 from PingOne's /as/introspect (e.g. the introspecting worker client is not
// entitled to introspect a token issued to another client) is NOT evidence the user
// token is inactive. tokenIntrospectionService.validateToken signals a call failure
// with error:'token_introspection_failed' (vs a bare {valid:false} for a genuine
// 200 {active:false}). Pre-fix, the call failure was treated as TOKEN_INACTIVE, which
// agentInvokeRoute surfaces as a 401 → the SPA shows "not logged in" → re-login →
// same cross-client 401 → infinite login loop.
describe('resolveMcpAccessTokenWithEvents — user-token active check (no re-login loop)', () => {
  // The active check is JWKS-based (tokenValidationService). Infra failure (JWKS
  // unreachable) → "skipped" → proceed; a genuine invalid/expired JWT → not active
  // → TOKEN_INACTIVE. Distinguishing the two prevents an infinite re-login loop.
  const tokenValidationService = require('../../services/tokenValidationService');
  const origClientId = process.env.PINGONE_AGENT_CLIENT_ID;
  const origUri = process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
  const userTokenWithScopes = makeJwt({
    sub: USER_SUB,
    aud: 'banking_enduser',
    scope: 'openid profile email offline_access read write',
    iss: 'https://auth.pingone.com/test-env/as',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PINGONE_AGENT_CLIENT_ID; // subject-only exchange path
    process.env.PINGONE_RESOURCE_MCP_SERVER_URI = 'https://mcp.example.com/api';
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'pingone_resource_mcp_server_uri' || key === 'mcp_resource_uri') return 'https://mcp.example.com/api';
      return null;
    });
    mockPerformTokenExchange.mockResolvedValue(sampleJwtMcpAccessToken);
  });

  afterEach(() => {
    if (origClientId !== undefined) process.env.PINGONE_AGENT_CLIENT_ID = origClientId;
    else delete process.env.PINGONE_AGENT_CLIENT_ID;
    if (origUri !== undefined) process.env.PINGONE_RESOURCE_MCP_SERVER_URI = origUri;
    else delete process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
  });

  it('does NOT throw TOKEN_INACTIVE when the active check fails (JWKS unreachable) — proceeds to the exchange', async () => {
    // Infra error (not a JWT-validity verdict) → jwksActiveCheckUserToken re-throws → caller records "skipped".
    tokenValidationService.validateToken.mockRejectedValueOnce(new Error('JWKS endpoint unreachable'));
    const { token } = await resolveMcpAccessTokenWithEvents(makeReq(userTokenWithScopes), 'get_my_accounts');
    expect(token).toBe(sampleJwtMcpAccessToken);
    expect(mockPerformTokenExchange).toHaveBeenCalled();
  });

  it('emits a non-failed user-token-introspection event (status skipped) on active-check infra failure', async () => {
    tokenValidationService.validateToken.mockRejectedValueOnce(new Error('JWKS endpoint unreachable'));
    const { tokenEvents } = await resolveMcpAccessTokenWithEvents(makeReq(userTokenWithScopes), 'get_my_accounts');
    const ev = tokenEvents.find((x) => x.id === 'user-token-introspection');
    expect(ev).toBeDefined();
    expect(ev.status).toBe('skipped');
  });

  it('throws TOKEN_INACTIVE on a genuinely invalid/expired user token (no refresh token)', async () => {
    // A JWT-validity error (name in the expired/invalid set) → not active → TOKEN_INACTIVE.
    tokenValidationService.validateToken.mockRejectedValueOnce(
      Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' })
    );
    await expect(
      resolveMcpAccessTokenWithEvents(makeReq(userTokenWithScopes), 'get_my_accounts')
    ).rejects.toMatchObject({ code: 'TOKEN_INACTIVE' });
    expect(mockPerformTokenExchange).not.toHaveBeenCalled();
  });
});
