'use strict';
/**
 * Unit tests for mcpPingOneHttpAdapter — listTools() / callTool()
 *
 * Strategy: mock axios (no real HTTP). Verify JSON-RPC shaping, the DELEGATED
 * PKCE Authorization header, caching, error propagation, and SSE-framing
 * fallback.
 *
 * The hosted server takes an authorization-code + PKCE token only; a worker
 * client_credentials token is audienced for the Management API and is rejected
 * `401 Invalid authentication` (measured 2026-08-30). So every call here passes
 * a token, and a call WITHOUT one must throw rather than fall back.
 */

const TOKEN = 'delegated-pkce-token-abc';

const FAKE_TOOLS = [
  { name: 'listApplications', description: 'List apps', inputSchema: { type: 'object', properties: {} } },
  { name: 'listEnvironments', description: 'List envs', inputSchema: { type: 'object', properties: {} } },
];

// Build a syntactically valid JWT (unsigned sig) carrying the given claims.
function fakeJwt(claims, header = { alg: 'RS256', typ: 'JWT' }) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64(header)}.${b64(claims)}.sig`;
}

function loadAdapter({ post } = {}) {
  jest.resetModules();
  const axiosPost = post || jest.fn();
  jest.doMock('axios', () => ({ post: axiosPost }));
  // Minimal config so _mcpUrl() resolves without real env.
  jest.doMock('../services/configStore', () => ({
    getEffective: (k) => (k === 'PINGONE_ENVIRONMENT_ID' ? 'env-123' : k === 'PINGONE_REGION' ? 'com' : null),
  }));
  const adapter = require('../services/mcpPingOneHttpAdapter');
  return { adapter, axiosPost };
}

// Build an axios.post mock that answers JSON-RPC by method.
function jsonRpcResponder(resultByMethod) {
  return jest.fn(async (_url, body) => {
    const result = resultByMethod[body.method];
    return { status: 200, data: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) };
  });
}

describe('mcpPingOneHttpAdapter', () => {
  const ENV_BACKUP = { ...process.env };
  beforeEach(() => {
    delete process.env.PINGONE_ENVIRONMENT_ID;
    delete process.env.PINGONE_REGION;
  });
  afterEach(() => {
    process.env = { ...ENV_BACKUP };
    jest.clearAllMocks();
  });

  describe('listTools()', () => {
    it('POSTs tools/list and returns the tools array', async () => {
      const post = jsonRpcResponder({ 'tools/list': { tools: FAKE_TOOLS } });
      const { adapter } = loadAdapter({ post });
      const tools = await adapter.listTools(TOKEN);

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('listApplications');
      const [url, body, cfg] = post.mock.calls[0];
      expect(url).toBe('https://mcp.pingone.com/admin/env-123/mcp');
      expect(body).toMatchObject({ jsonrpc: '2.0', method: 'tools/list' });
      expect(cfg.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('caches the result (one POST for two calls)', async () => {
      const post = jsonRpcResponder({ 'tools/list': { tools: FAKE_TOOLS } });
      const { adapter } = loadAdapter({ post });
      const first = await adapter.listTools(TOKEN);
      const second = await adapter.listTools(TOKEN);
      expect(first).toBe(second);
      expect(post.mock.calls.filter(([, b]) => b.method === 'tools/list')).toHaveLength(1);
    });

    it('returns [] when result.tools is missing', async () => {
      const post = jsonRpcResponder({ 'tools/list': {} });
      const { adapter } = loadAdapter({ post });
      expect(await adapter.listTools(TOKEN)).toEqual([]);
    });
  });

  describe('callTool()', () => {
    it('POSTs tools/call with name + arguments and returns the result', async () => {
      const post = jsonRpcResponder({ 'tools/call': { content: [{ type: 'text', text: 'ok' }] } });
      const { adapter } = loadAdapter({ post });
      const result = await adapter.callTool('listApplications', { environmentId: 'e1' }, TOKEN);
      expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
      const [, body] = post.mock.calls[0];
      expect(body).toMatchObject({ method: 'tools/call', params: { name: 'listApplications', arguments: { environmentId: 'e1' } } });
    });

    it('throws on a JSON-RPC error response', async () => {
      const post = jest.fn(async (_u, body) => ({ status: 200, data: JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'denied' } }) }));
      const { adapter } = loadAdapter({ post });
      await expect(adapter.callTool('x', {}, TOKEN)).rejects.toThrow('denied');
    });

    it('surfaces an HTTP error with status', async () => {
      const post = jest.fn(async () => { const e = new Error('boom'); e.response = { status: 403, data: 'forbidden' }; throw e; });
      const { adapter } = loadAdapter({ post });
      await expect(adapter.callTool('x', {}, TOKEN)).rejects.toThrow(/403/);
    });

    it('parses SSE-framed responses', async () => {
      const post = jest.fn(async (_u, body) => ({ status: 200, data: `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ text: 'sse' }] } })}\n\n` }));
      const { adapter } = loadAdapter({ post });
      const result = await adapter.callTool('x', {}, TOKEN);
      expect(result).toEqual({ content: [{ text: 'sse' }] });
    });
  });

  describe('getWorkerTokenDecoded()', () => {
    it('decodes the DELEGATED JWT into { header, claims } for the token-chain card', async () => {
      const jwt = fakeJwt({ client_id: 'mcp-pkce-client', aud: ['https://mcp.pingone.com'] });
      const { adapter } = loadAdapter();
      const decoded = await adapter.getWorkerTokenDecoded(jwt);
      expect(decoded.claims).toEqual({ client_id: 'mcp-pkce-client', aud: ['https://mcp.pingone.com'] });
      expect(decoded.header).toEqual({ alg: 'RS256', typ: 'JWT' });
    });

    it('accepts a session object and reads the stored PKCE token', async () => {
      const jwt = fakeJwt({ client_id: 'mcp-pkce-client' });
      const { adapter } = loadAdapter();
      const session = { pingoneMcpAdminToken: { accessToken: jwt } };
      const decoded = await adapter.getWorkerTokenDecoded(session);
      expect(decoded.claims.client_id).toBe('mcp-pkce-client');
    });

    it('returns null (never throws) when there is no token at all', async () => {
      const { adapter } = loadAdapter();
      await expect(adapter.getWorkerTokenDecoded(null)).resolves.toBeNull();
    });

    it('returns null for a non-JWT / opaque token', async () => {
      const { adapter } = loadAdapter();
      await expect(adapter.getWorkerTokenDecoded('opaque-token')).resolves.toBeNull();
    });
  });

  // The whole point of the PKCE cutover: no silent worker-token fallback. A
  // worker token is not a weaker credential for this server, it is an invalid
  // one, and sending it produced an opaque 401 that hid the real cause.
  describe('no delegated token', () => {
    it('listTools() throws pingone_mcp_auth_required instead of falling back', async () => {
      const { adapter, axiosPost } = loadAdapter();
      await expect(adapter.listTools()).rejects.toMatchObject({ code: 'pingone_mcp_auth_required' });
      expect(axiosPost).not.toHaveBeenCalled();
    });

    it('callTool() throws pingone_mcp_auth_required instead of falling back', async () => {
      const { adapter, axiosPost } = loadAdapter();
      await expect(adapter.callTool('listApplications', {}))
        .rejects.toMatchObject({ code: 'pingone_mcp_auth_required' });
      expect(axiosPost).not.toHaveBeenCalled();
    });

    it('the error names how to obtain one', async () => {
      const { adapter } = loadAdapter();
      await expect(adapter.listTools()).rejects.toThrow(/delegated PKCE token/i);
    });
  });
});
