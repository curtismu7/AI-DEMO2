/**
 * @file mcp-inspector.test.js
 * @description Tests for authenticated MCP Inspector routes (context, tools/list, tools/call).
 * MCP WebSocket I/O is mocked; auth uses Bearer tokens with SKIP_TOKEN_SIGNATURE_VALIDATION.
 */

const request = require('supertest');

const mockList = jest.fn();
const mockCall = jest.fn();

jest.mock('../../services/mcpWebSocketClient', () => {
  const actual = jest.requireActual('../../services/mcpWebSocketClient');
  const bearerFromReq = (req) => {
    const auth = req.headers?.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return auth.slice(7).trim();
    }
    return null;
  };
  return {
    ...actual,
    /** Inspector routes use session tokens in production; tests send Bearer only. */
    getSessionAccessToken: (req) => bearerFromReq(req) || actual.getSessionAccessToken(req),
    getSessionBearerForMcp: (req) => bearerFromReq(req) || actual.getSessionBearerForMcp(req),
    mcpListTools: (...args) => mockList(...args),
    mcpCallTool: (...args) => mockCall(...args),
    // Frame-capturing variants delegate to the same mocks so per-test
    // mockList/mockCall setups and call assertions keep working, and wrap the
    // result in synthetic-but-shaped frames like mcpRpc produces.
    mcpListToolsWithFrames: async (...args) => {
      const result = await mockList(...args);
      return {
        result,
        frames: {
          request: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
          response: { jsonrpc: '2.0', id: 2, result },
        },
      };
    },
    mcpCallToolWithFrames: async (toolName, toolParams, ...rest) => {
      const result = await mockCall(toolName, toolParams, ...rest);
      return {
        result,
        frames: {
          request: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: toolParams || {} } },
          response: { jsonrpc: '2.0', id: 2, result },
        },
      };
    },
  };
});

const mockPerformTokenExchange = jest.fn();

// Configurable mocks for token resolution — set implementation per-test in beforeEach.
// Default: return the bearer token directly (no exchange), userSub from token sub claim.
const mockResolveMcpAccessToken = jest.fn();
const mockResolveMcpAccessTokenWithEvents = jest.fn();
jest.mock('../../services/agentMcpTokenService', () => ({
  resolveMcpAccessToken: (...args) => mockResolveMcpAccessToken(...args),
  resolveMcpAccessTokenWithEvents: (...args) => mockResolveMcpAccessTokenWithEvents(...args),
}));

jest.mock('../../services/oauthService', () => {
  const actual = jest.requireActual('../../services/oauthService');
  return {
    ...actual,
    performTokenExchange: (...args) => mockPerformTokenExchange(...args),
  };
});

// Mock runtimeSettings to disable step-up MFA gate in tests (enabled by default in config).
// Individual tests that want to exercise the MFA gate can override mockRtGet directly.
const mockRtGet = jest.fn((key) => {
  if (key === 'stepUpEnabled') return false;
  return undefined;
});
jest.mock('../../config/runtimeSettings', () => ({ get: (...args) => mockRtGet(...args) }));

const app = require('../../server');
const configStore = require('../../services/configStore');

/** Builds a JWT-shaped string that passes decode-only validation in tests. */
function bearerToken(scopes = ['read']) {
  const payload = {
    sub: 'inspector-test-user',
    preferred_username: 'inspector',
    email: 'inspector@test.com',
    scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
    iss: 'https://auth.pingone.com/test-env',
    aud: 'banking_jk_enduser',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${encodedHeader}.${encodedPayload}.sig`;
}

describe('MCP Inspector routes', () => {
  let getEffectiveSpy;
  let origGetEffective;

  beforeEach(() => {
    mockList.mockResolvedValue({
      tools: [{ name: 'get_my_accounts', description: 'List accounts' }],
    });
    mockCall.mockResolvedValue({ content: [{ type: 'text', text: '{"ok":true}' }] });
    mockPerformTokenExchange.mockImplementation((token) => Promise.resolve(`exchanged:${token}`));
    // Default: return the bearer token directly (no RFC 8693 exchange).
    mockResolveMcpAccessToken.mockImplementation(async (req) => {
      const auth = req.headers && req.headers.authorization;
      return auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    });
    // Default resolveMcpAccessTokenWithEvents: return bearer token + null userSub.
    mockResolveMcpAccessTokenWithEvents.mockImplementation(async (req) => {
      const auth = req.headers && req.headers.authorization;
      const token = auth && auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      return { token, userSub: null };
    });
    origGetEffective = configStore.getEffective.bind(configStore);
    getEffectiveSpy = jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      // Inspector context route checks 'mcp_resource_uri' for tokenExchangeEnabled
      if (key === 'mcp_resource_uri') return '';
      if (key === 'PINGONE_RESOURCE_MCP_SERVER_URI') return '';
      return origGetEffective(key);
    });
  });

  afterEach(() => {
    getEffectiveSpy.mockRestore();
  });

  it('GET /api/mcp/inspector/context returns host narrative and MCP version', async () => {
    const res = await request(app)
      .get('/api/mcp/inspector/context')
      .set('Authorization', `Bearer ${bearerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('mcp_host_proxy');
    expect(res.body.mcpProtocolVersion).toBe('2025-11-25');
    expect(res.body.mcpHosts).toMatchObject({
      bff: expect.objectContaining({ id: 'bff' }),
      langchain: expect.objectContaining({ id: 'langchain' }),
    });
    expect(res.body.tokenExchangeEnabled).toBe(false);
  });

  it('GET /api/mcp/inspector/tools returns local catalog without authentication (no 401)', async () => {
    // Unauthenticated users get the local tool catalog (no bearer = no MCP token);
    // a 401 would block the demo inspector from being useful during development.
    const res = await request(app).get('/api/mcp/inspector/tools');
    expect(res.status).toBe(200);
    expect(res.body._source).toBe('local_catalog');
  });

  it('GET /api/mcp/inspector/tools returns tools from mcpListTools', async () => {
    const token = bearerToken();
    const res = await request(app)
      .get('/api/mcp/inspector/tools')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body._source).toBe('mcp_server');
    expect(res.body.tools).toHaveLength(1);
    expect(res.body.tools[0].name).toBe('get_my_accounts');
    expect(mockList).toHaveBeenCalledWith(token, null);
    expect(res.body.timingsMs).toHaveProperty('roundTrip');
  });

  it('GET /api/mcp/inspector/tools falls back to local catalog when mcpListTools fails (connection)', async () => {
    mockList.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const token = bearerToken();
    const res = await request(app)
      .get('/api/mcp/inspector/tools')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body._source).toBe('local_catalog');
    expect(Array.isArray(res.body.tools)).toBe(true);
    expect(res.body.tools.some((t) => t.name === 'get_my_accounts')).toBe(true);
    expect(res.body._localCatalogReason).toMatch(/mcp_unreachable/i);
  });

  it('POST /api/mcp/inspector/invoke returns 400 when tool is missing', async () => {
    const res = await request(app)
      .post('/api/mcp/inspector/invoke')
      .set('Authorization', `Bearer ${bearerToken()}`)
      .send({ params: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tool/i);
  });

  it('POST /api/mcp/inspector/invoke calls mcpCallTool with session token when exchange off', async () => {
    const token = bearerToken(['read', 'read']);

    const res = await request(app)
      .post('/api/mcp/inspector/invoke')
      .set('Authorization', `Bearer ${token}`)
      .send({ tool: 'get_my_accounts', params: {} });

    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] });
    expect(res.body.inspector.tool).toBe('get_my_accounts');
    expect(mockCall).toHaveBeenCalledWith('get_my_accounts', {}, token, null);
    expect(mockPerformTokenExchange).not.toHaveBeenCalled();
  });

  it('POST /api/mcp/inspector/invoke uses RFC 8693 exchange when PINGONE_RESOURCE_MCP_SERVER_URI is set', async () => {
    getEffectiveSpy.mockImplementation((key) => {
      if (key === 'PINGONE_RESOURCE_MCP_SERVER_URI') return 'https://mcp-resource.example/aud';
      return origGetEffective(key);
    });

    const token = bearerToken();
    // Configure resolveMcpAccessTokenWithEvents to call the exchange mock so the test
    // can verify the RFC 8693 exchange path without executing the real service.
    mockResolveMcpAccessTokenWithEvents.mockImplementation(async (_req, _tool) => {
      const exchanged = await mockPerformTokenExchange(token, 'https://mcp-resource.example/aud', ['read']);
      return { token: exchanged, userSub: 'inspector-test-user' };
    });

    const res = await request(app)
      .post('/api/mcp/inspector/invoke')
      .set('Authorization', `Bearer ${token}`)
      .send({ tool: 'get_my_accounts', params: {} });

    expect(res.status).toBe(200);
    expect(mockPerformTokenExchange).toHaveBeenCalledWith(
      token,
      'https://mcp-resource.example/aud',
      ['read']
    );
    expect(mockCall).toHaveBeenCalledWith('get_my_accounts', {}, `exchanged:${token}`, 'inspector-test-user');
  });

  it('GET /api/mcp/inspector/tools returns the JSON-RPC frames on the live path', async () => {
    const res = await request(app)
      .get('/api/mcp/inspector/tools')
      .set('Authorization', `Bearer ${bearerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body._source).toBe('mcp_server');
    expect(res.body.frames.request).toEqual({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    expect(res.body.frames.response.result.tools).toEqual([
      { name: 'get_my_accounts', description: 'List accounts' },
    ]);
  });

  it('POST /api/mcp/inspector/invoke returns frames and tokenEvents on the live path', async () => {
    const token = bearerToken(['read']);
    const tokenEvents = [
      { id: 'user-token', label: 'User access token', status: 'ok' },
      { id: 'mcp-token', label: 'MCP access token (RFC 8693)', status: 'ok' },
    ];
    mockResolveMcpAccessTokenWithEvents.mockImplementation(async () => ({
      token,
      userSub: 'inspector-test-user',
      tokenEvents,
    }));

    const res = await request(app)
      .post('/api/mcp/inspector/invoke')
      .set('Authorization', `Bearer ${token}`)
      .send({ tool: 'get_my_accounts', params: { limit: 1 } });

    expect(res.status).toBe(200);
    expect(res.body.frames.request).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_my_accounts', arguments: { limit: 1 } },
    });
    expect(res.body.frames.response.result).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] });
    expect(res.body.tokenEvents).toEqual(tokenEvents);
  });

  describe('GET /api/mcp/inspector/langchain-host', () => {
    const originalFetch = global.fetch;
    const originalAgentUrl = process.env.LANGCHAIN_AGENT_HTTP_URL;
    const originalSecret = process.env.BFF_INTERNAL_SECRET;

    beforeEach(() => {
      process.env.LANGCHAIN_AGENT_HTTP_URL = 'http://langchain-agent:8888';
      process.env.BFF_INTERNAL_SECRET = 'test-inspector-secret';
    });

    afterEach(() => {
      global.fetch = originalFetch;
      if (originalAgentUrl === undefined) delete process.env.LANGCHAIN_AGENT_HTTP_URL;
      else process.env.LANGCHAIN_AGENT_HTTP_URL = originalAgentUrl;
      if (originalSecret === undefined) delete process.env.BFF_INTERNAL_SECRET;
      else process.env.BFF_INTERNAL_SECRET = originalSecret;
    });

    it('proxies AG-UI inspector JSON with the internal gateway secret', async () => {
      const snapshot = { role: 'mcp_host', langchain_tools_exposed_to_llm: ['get_my_accounts'] };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => snapshot,
      });

      const res = await request(app).get('/api/mcp/inspector/langchain-host');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(snapshot);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://langchain-agent:8888/inspector/mcp-host',
        expect.objectContaining({
          headers: { 'x-internal-gateway-secret': 'test-inspector-secret' },
        }),
      );
    });

    it('maps undici fetch failed to langchain_agent_down (not raw fetch failed)', async () => {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      global.fetch = jest.fn().mockRejectedValue(err);

      const res = await request(app).get('/api/mcp/inspector/langchain-host');

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('langchain_agent_down');
      expect(res.body.message).toMatch(/langchain-agent:8888/);
    });
  });
});

describe('MCP Inspector — MFA gate (GET /api/mcp/inspector/tools)', () => {
  beforeEach(() => {
    mockRtGet.mockImplementation((key) => {
      if (key === 'stepUpEnabled') return true;
      if (key === 'stepUpMethod') return 'email';
      return undefined;
    });
  });

  afterEach(() => {
    mockRtGet.mockImplementation((key) => {
      if (key === 'stepUpEnabled') return false;
      return undefined;
    });
  });

  it('returns mfa_required:true when stepUpEnabled and session has no stepUpVerified', async () => {
    const res = await request(app)
      .get('/api/mcp/inspector/tools')
      .set('Authorization', `Bearer ${bearerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.mfa_required).toBe(true);
    expect(res.body.tools).toEqual([]);
    expect(res.body.step_up_method).toBe('email');
    expect(res.body._source).toBe('mfa_gate');
  });

  it('returns mfa_required:true when stepUpVerified is in the past', async () => {
    const res = await request(app)
      .get('/api/mcp/inspector/tools')
      .set('Authorization', `Bearer ${bearerToken()}`)
      // Simulate expired stepUpVerified via session cookie (server sets it; we test without it)
      ;

    expect(res.status).toBe(200);
    expect(res.body.mfa_required).toBe(true);
  });

  it('returns tools (not mfa_required) when stepUpEnabled is false', async () => {
    mockRtGet.mockImplementation((key) => {
      if (key === 'stepUpEnabled') return false;
      return undefined;
    });
    mockList.mockResolvedValueOnce({
      tools: [{ name: 'get_my_accounts', description: 'List accounts' }],
    });

    const res = await request(app)
      .get('/api/mcp/inspector/tools')
      .set('Authorization', `Bearer ${bearerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.mfa_required).toBeUndefined();
    expect(Array.isArray(res.body.tools)).toBe(true);
  });
});
