/**
 * @file mcpInspectorProfiles.test.js
 * @description Generic MCP Inspector — profile CRUD and non-default-profile
 * tools/list + tools/call dispatch (mcpTransports/http, mcpTransports/stdio).
 * The default-banking-profile path is covered by mcp-inspector.test.js and is
 * intentionally NOT re-tested here; these tests only exercise the new
 * ?profile=<id> / body.profile branch.
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockHttpListTools = jest.fn();
const mockHttpCallTool = jest.fn();
jest.mock('../../services/mcpTransports/http', () => ({
  listTools: (...args) => mockHttpListTools(...args),
  callTool: (...args) => mockHttpCallTool(...args),
}));

const mockStdioListTools = jest.fn();
const mockStdioCallTool = jest.fn();
jest.mock('../../services/mcpTransports/stdio', () => ({
  listTools: (...args) => mockStdioListTools(...args),
  callTool: (...args) => mockStdioCallTool(...args),
}));

const mockListToolsWithFrames = jest.fn();
const mockCallToolWithFrames = jest.fn();
jest.mock('../../services/mcpWebSocketClient', () => {
  const actual = jest.requireActual('../../services/mcpWebSocketClient');
  return {
    ...actual,
    mcpListToolsWithFrames: (...args) => mockListToolsWithFrames(...args),
    mcpCallToolWithFrames: (...args) => mockCallToolWithFrames(...args),
  };
});

jest.mock('../../config/runtimeSettings', () => ({ get: (key) => (key === 'stepUpEnabled' ? false : undefined) }));

const mockGetMcpUrl = jest.fn(() => 'https://mcp.pingone.com/admin/env-123/mcp');
jest.mock('../../services/mcpPingOneHttpAdapter', () => ({
  getMcpUrl: (...args) => mockGetMcpUrl(...args),
}));

// Test-only session shim ahead of the router: sets req.session.user when the
// request carries x-test-authed. Default role is admin (profile CRUD and
// non-default dispatch are admin-gated); pass x-test-role: user to exercise
// the customer 403 path. The unauthenticated 401 behavior is left intact.
// x-test-pingone-token (JSON) seeds req.session.pingoneMcpAdminToken for the
// built-in PingOne profile's dispatch; x-test-privilege-token does the same
// for req.session.privilegeMcpToken.
function testSession(req, res, next) {
  req.session = req.session || {};
  if (req.headers['x-test-authed']) {
    req.session.user = {
      id: 'profile-test-user',
      role: req.headers['x-test-role'] || 'admin',
    };
  }
  if (req.headers['x-test-pingone-token']) {
    req.session.pingoneMcpAdminToken = JSON.parse(req.headers['x-test-pingone-token']);
  }
  if (req.headers['x-test-privilege-token']) {
    req.session.privilegeMcpToken = JSON.parse(req.headers['x-test-privilege-token']);
  }
  next();
}

const mcpInspectorRoutes = require('../../routes/mcpInspector');

function buildApp() {
  const app = express();
  app.use(testSession);
  app.use('/api/mcp/inspector', mcpInspectorRoutes);
  return app;
}

describe('Generic MCP Inspector — profiles', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    mockHttpListTools.mockReset();
    mockHttpCallTool.mockReset();
    mockStdioListTools.mockReset();
    mockStdioCallTool.mockReset();
    mockListToolsWithFrames.mockReset();
    mockCallToolWithFrames.mockReset();
  });

  describe('GET /api/mcp/inspector/profiles', () => {
    it('lists the seeded default banking profile with no auth required', async () => {
      const res = await request(app).get('/api/mcp/inspector/profiles');
      expect(res.status).toBe(200);
      expect(res.body.defaultProfileId).toBeTruthy();
      expect(res.body.profiles.some((p) => p.isDefault && p.id === res.body.defaultProfileId)).toBe(true);
    });
  });

  describe('POST /api/mcp/inspector/profiles', () => {
    it('401s without a session', async () => {
      const res = await request(app)
        .post('/api/mcp/inspector/profiles')
        .send({ label: 'Brave Search', transport: 'http', url: 'https://example.test/mcp' });
      expect(res.status).toBe(401);
    });

    it('403s for a signed-in customer (a stdio profile would be RCE on the BFF host)', async () => {
      const res = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .set('x-test-role', 'user')
        .send({
          label: 'evil',
          transport: 'stdio',
          command: 'node',
          args: ['-e', "require('fs').writeFileSync('/tmp/pwned','x')"],
        });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('admin_required');
      expect(mockStdioListTools).not.toHaveBeenCalled();
      expect(mockStdioCallTool).not.toHaveBeenCalled();
    });

    it('creates an http profile and never echoes the secret back', async () => {
      const res = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({
          label: 'Brave Search',
          transport: 'http',
          url: 'https://example.test/mcp',
          authHeader: 'Authorization',
          authValue: 'Bearer secret-token',
        });
      expect(res.status).toBe(201);
      expect(res.body.profile.label).toBe('Brave Search');
      expect(res.body.profile.hasAuthValue).toBe(true);
      expect(res.body.profile.authValue).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/secret-token/);
    });

    it('rejects a stdio profile with no command', async () => {
      const res = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({ label: 'bad', transport: 'stdio' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/mcp/inspector/profiles/:id', () => {
    it('401s without a session', async () => {
      const res = await request(app).delete('/api/mcp/inspector/profiles/some-id');
      expect(res.status).toBe(401);
    });

    it('refuses to delete the default profile (400)', async () => {
      const list = await request(app).get('/api/mcp/inspector/profiles');
      const res = await request(app)
        .delete(`/api/mcp/inspector/profiles/${list.body.defaultProfileId}`)
        .set('x-test-authed', '1');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('default_profile_protected');
    });

    it('deletes a profile it created (204)', async () => {
      const created = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({ label: 'throwaway', transport: 'http', url: 'https://example.test/mcp3' });
      const res = await request(app)
        .delete(`/api/mcp/inspector/profiles/${created.body.profile.id}`)
        .set('x-test-authed', '1');
      expect(res.status).toBe(204);
    });
  });

  describe('GET /api/mcp/inspector/tools?profile=<id> (non-default dispatch)', () => {
    it('dispatches to the http transport and returns its tools', async () => {
      const created = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({ label: 'Brave Search', transport: 'http', url: 'https://example.test/mcp' });
      const profileId = created.body.profile.id;

      mockHttpListTools.mockResolvedValue({ tools: [{ name: 'brave_web_search', description: 'Web search' }] });

      const res = await request(app)
        .get(`/api/mcp/inspector/tools?profile=${profileId}`)
        .set('x-test-authed', '1');
      expect(res.status).toBe(200);
      expect(res.body._source).toBe('profile');
      expect(res.body.tools).toEqual([{ name: 'brave_web_search', description: 'Web search' }]);
      expect(mockHttpListTools).toHaveBeenCalledWith(expect.objectContaining({ id: profileId, url: 'https://example.test/mcp' }));
      // No local-catalog fallback wired for a non-default profile.
      expect(mockCallToolWithFrames).not.toHaveBeenCalled();
    });

    it('returns a profile_error (not a fake tool list) when the transport throws', async () => {
      const created = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({ label: 'Down server', transport: 'http', url: 'https://example.test/down' });
      const profileId = created.body.profile.id;

      mockHttpListTools.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const res = await request(app)
        .get(`/api/mcp/inspector/tools?profile=${profileId}`)
        .set('x-test-authed', '1');
      expect(res.status).toBe(200);
      expect(res.body._source).toBe('profile_error');
      expect(res.body.error).toBe(true);
      expect(res.body.tools).toEqual([]);
      expect(res.body.reason).toMatch(/ECONNREFUSED/);
    });

    it('dispatches a stdio profile to the stdio transport', async () => {
      const created = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({ label: 'Brave stdio', transport: 'stdio', command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'] });
      const profileId = created.body.profile.id;

      mockStdioListTools.mockResolvedValue({ tools: [{ name: 'brave_web_search' }] });

      const res = await request(app)
        .get(`/api/mcp/inspector/tools?profile=${profileId}`)
        .set('x-test-authed', '1');
      expect(res.status).toBe(200);
      expect(res.body._source).toBe('profile');
      expect(mockStdioListTools).toHaveBeenCalledWith(expect.objectContaining({ command: 'npx' }));
    });

    it('dispatches a custom websocket profile with the profile url as serverUrl', async () => {
      const created = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({ label: 'Other WS server', transport: 'websocket', url: 'ws://example.test:9000' });
      const profileId = created.body.profile.id;

      mockListToolsWithFrames.mockResolvedValue({
        result: { tools: [{ name: 'ws_tool' }] },
        frames: { request: {}, response: {} },
      });

      const res = await request(app)
        .get(`/api/mcp/inspector/tools?profile=${profileId}`)
        .set('x-test-authed', '1');
      expect(res.status).toBe(200);
      expect(res.body.tools).toEqual([{ name: 'ws_tool' }]);
      expect(mockListToolsWithFrames).toHaveBeenCalledWith(null, null, undefined, { serverUrl: 'ws://example.test:9000' });
    });

    it('404s for an unknown profile id', async () => {
      const res = await request(app)
        .get('/api/mcp/inspector/tools?profile=does-not-exist')
        .set('x-test-authed', '1');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/mcp/inspector/invoke with body.profile (non-default dispatch)', () => {
    it('dispatches tools/call to the http transport', async () => {
      const created = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({ label: 'Brave Search', transport: 'http', url: 'https://example.test/mcp' });
      const profileId = created.body.profile.id;

      mockHttpCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'result' }] });

      const res = await request(app)
        .post('/api/mcp/inspector/invoke')
        .set('x-test-authed', '1')
        .send({ tool: 'brave_web_search', params: { query: 'ping identity' }, profile: profileId });

      expect(res.status).toBe(200);
      expect(res.body.result).toEqual({ content: [{ type: 'text', text: 'result' }] });
      expect(mockHttpCallTool).toHaveBeenCalledWith(
        expect.objectContaining({ id: profileId }),
        'brave_web_search',
        { query: 'ping identity' }
      );
    });

    it('returns 502 (not a local-handler fallback) when the transport throws', async () => {
      const created = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({ label: 'Down server', transport: 'http', url: 'https://example.test/down' });
      const profileId = created.body.profile.id;

      mockHttpCallTool.mockRejectedValue(new Error('MCP HTTP 401: invalid key'));

      const res = await request(app)
        .post('/api/mcp/inspector/invoke')
        .set('x-test-authed', '1')
        .send({ tool: 'brave_web_search', params: {}, profile: profileId });

      expect(res.status).toBe(502);
      expect(res.body.error).toBe('mcp_profile_invoke_failed');
      expect(res.body.message).toMatch(/401/);
    });
  });

  describe('built-in PingOne MCP profile (transport: pingone)', () => {
    const PINGONE_PROFILE_ID = 'built-in-pingone-mcp';

    it('is seeded automatically and cannot be deleted', async () => {
      const list = await request(app).get('/api/mcp/inspector/profiles');
      const pingoneProfile = list.body.profiles.find((p) => p.id === PINGONE_PROFILE_ID);
      expect(pingoneProfile).toMatchObject({ transport: 'pingone', isBuiltIn: true });

      const del = await request(app)
        .delete(`/api/mcp/inspector/profiles/${PINGONE_PROFILE_ID}`)
        .set('x-test-authed', '1');
      expect(del.status).toBe(400);
      expect(del.body.error).toBe('default_profile_protected');
    });

    it('signals pingone_admin_login_required when no session token is present (GET /tools)', async () => {
      const res = await request(app)
        .get(`/api/mcp/inspector/tools?profile=${PINGONE_PROFILE_ID}`)
        .set('x-test-authed', '1');
      expect(res.status).toBe(200);
      expect(res.body.pingone_admin_login_required).toBe(true);
      expect(res.body.loginUrl).toBe('/api/mcp/inspector/pingone-admin/login');
      expect(res.body.tools).toEqual([]);
      expect(mockHttpListTools).not.toHaveBeenCalled();
    });

    it('signals pingone_admin_login_required when the session token is expired', async () => {
      const expired = JSON.stringify({ accessToken: 'stale', expiresAt: Date.now() - 1000 });
      const res = await request(app)
        .get(`/api/mcp/inspector/tools?profile=${PINGONE_PROFILE_ID}`)
        .set('x-test-authed', '1')
        .set('x-test-pingone-token', expired);
      expect(res.body.pingone_admin_login_required).toBe(true);
    });

    it('dispatches to the http transport with the session token as a Bearer header when signed in', async () => {
      const token = JSON.stringify({ accessToken: 'admin-mcp-token', expiresAt: Date.now() + 60000 });
      mockHttpListTools.mockResolvedValue({ tools: [{ name: 'read_users' }] });

      const res = await request(app)
        .get(`/api/mcp/inspector/tools?profile=${PINGONE_PROFILE_ID}`)
        .set('x-test-authed', '1')
        .set('x-test-pingone-token', token);

      expect(res.status).toBe(200);
      expect(res.body._source).toBe('profile');
      expect(res.body.tools).toEqual([{ name: 'read_users' }]);
      expect(mockHttpListTools).toHaveBeenCalledWith({
        url: 'https://mcp.pingone.com/admin/env-123/mcp',
        authHeader: 'Authorization',
        authValue: 'Bearer admin-mcp-token',
      });
    });

    it('POST /invoke 401s with pingone_admin_login_required when not signed in', async () => {
      const res = await request(app)
        .post('/api/mcp/inspector/invoke')
        .set('x-test-authed', '1')
        .send({ tool: 'read_users', params: {}, profile: PINGONE_PROFILE_ID });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('pingone_admin_login_required');
      expect(res.body.loginUrl).toBe('/api/mcp/inspector/pingone-admin/login');
    });

    it('rejects transport:"pingone" on POST /profiles (reserved for the built-in)', async () => {
      const res = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({ label: 'sneaky', transport: 'pingone' });
      expect(res.status).toBe(400);
    });
  });

  describe('built-in Privilege MCP profile (transport: privilege)', () => {
    const PRIVILEGE_PROFILE_ID = 'built-in-privilege-mcp';

    it('is seeded automatically and cannot be deleted', async () => {
      const list = await request(app).get('/api/mcp/inspector/profiles');
      const privilegeProfile = list.body.profiles.find((p) => p.id === PRIVILEGE_PROFILE_ID);
      expect(privilegeProfile).toMatchObject({ transport: 'privilege', isBuiltIn: true });

      const del = await request(app)
        .delete(`/api/mcp/inspector/profiles/${PRIVILEGE_PROFILE_ID}`)
        .set('x-test-authed', '1');
      expect(del.status).toBe(400);
      expect(del.body.error).toBe('default_profile_protected');
    });

    it('signals privilege_login_required when no session token is present (GET /tools)', async () => {
      const res = await request(app)
        .get(`/api/mcp/inspector/tools?profile=${PRIVILEGE_PROFILE_ID}`)
        .set('x-test-authed', '1');
      expect(res.status).toBe(200);
      expect(res.body.privilege_login_required).toBe(true);
      expect(res.body.loginUrl).toBe('/api/mcp/inspector/privilege/login');
      expect(res.body.tools).toEqual([]);
      expect(mockHttpListTools).not.toHaveBeenCalled();
    });

    it('signals privilege_login_required when the session token is expired', async () => {
      const expired = JSON.stringify({ accessToken: 'stale', expiresAt: Date.now() - 1000 });
      const res = await request(app)
        .get(`/api/mcp/inspector/tools?profile=${PRIVILEGE_PROFILE_ID}`)
        .set('x-test-authed', '1')
        .set('x-test-privilege-token', expired);
      expect(res.body.privilege_login_required).toBe(true);
    });

    it('dispatches to the http transport with the session token as a Bearer header when signed in', async () => {
      const token = JSON.stringify({ accessToken: 'privilege-mcp-token', expiresAt: Date.now() + 60000 });
      mockHttpListTools.mockResolvedValue({ tools: [{ name: 'get_my_accounts' }] });

      const res = await request(app)
        .get(`/api/mcp/inspector/tools?profile=${PRIVILEGE_PROFILE_ID}`)
        .set('x-test-authed', '1')
        .set('x-test-privilege-token', token);

      expect(res.status).toBe(200);
      expect(res.body._source).toBe('profile');
      expect(res.body.tools).toEqual([{ name: 'get_my_accounts' }]);
      expect(mockHttpListTools).toHaveBeenCalledWith({
        url: 'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp',
        authHeader: 'Authorization',
        authValue: 'Bearer privilege-mcp-token',
      });
    });

    it('POST /invoke 401s with privilege_login_required when not signed in', async () => {
      const res = await request(app)
        .post('/api/mcp/inspector/invoke')
        .set('x-test-authed', '1')
        .send({ tool: 'get_my_accounts', params: {}, profile: PRIVILEGE_PROFILE_ID });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('privilege_login_required');
      expect(res.body.loginUrl).toBe('/api/mcp/inspector/privilege/login');
    });

    it('rejects transport:"privilege" on POST /profiles (reserved for the built-in)', async () => {
      const res = await request(app)
        .post('/api/mcp/inspector/profiles')
        .set('x-test-authed', '1')
        .send({ label: 'sneaky', transport: 'privilege' });
      expect(res.status).toBe(400);
    });
  });
});
