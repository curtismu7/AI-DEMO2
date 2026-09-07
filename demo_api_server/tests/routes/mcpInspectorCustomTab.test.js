'use strict';

/**
 * GET /api/mcp/inspector/custom-tools and POST /api/mcp/inspector/custom-invoke —
 * these were dead stubs (always empty / "not implemented"). They now dispatch
 * to a saved MCP server profile (mcpProfileStore.js) via the same
 * handleProfileTools/handleProfileInvoke helpers GET /tools?profile=X and
 * POST /invoke already use, admin-gated the same way (requireAdminSession).
 *
 * mcpProfileStore.getProfile and mcpTransports/http are mocked so this test
 * exercises only the new routes' own dispatch/validation logic, not a real
 * transport or LMDB.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../services/mcpProfileStore', () => ({
  DEFAULT_PROFILE_ID: 'default-banking',
  getProfile: jest.fn(),
}));
jest.mock('../../services/mcpTransports/http', () => ({
  listTools: jest.fn(),
  callTool: jest.fn(),
}));

const mcpProfileStore = require('../../services/mcpProfileStore');
const mcpHttpTransport = require('../../services/mcpTransports/http');
const mcpInspectorRouter = require('../../routes/mcpInspector');

function makeApp(session) {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/mcp/inspector', mcpInspectorRouter);
  return app;
}

const ADMIN_SESSION = { user: { id: 'u1', role: 'admin' } };
const CUSTOMER_SESSION = { user: { id: 'u2', role: 'customer' } };

const HTTP_PROFILE = {
  id: 'custom-1',
  label: 'banking-rest2 (Privilege)',
  transport: 'http',
  url: 'https://mcpgw.example/banking-rest2/mcp',
};

afterEach(() => jest.clearAllMocks());

describe('GET /api/mcp/inspector/custom-tools', () => {
  test('no profile query: empty list, no auth required', async () => {
    const res = await request(makeApp(undefined)).get('/api/mcp/inspector/custom-tools');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tools: [], _source: 'custom_no_profile' });
    expect(mcpProfileStore.getProfile).not.toHaveBeenCalled();
  });

  test('no session: 401 for a real profile request', async () => {
    const res = await request(makeApp(undefined)).get('/api/mcp/inspector/custom-tools?profile=custom-1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
  });

  test('signed in but not admin: 403', async () => {
    const res = await request(makeApp(CUSTOMER_SESSION)).get('/api/mcp/inspector/custom-tools?profile=custom-1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('admin_required');
  });

  test('admin session: dispatches to the profile transport and returns its tools', async () => {
    mcpProfileStore.getProfile.mockReturnValue(HTTP_PROFILE);
    mcpHttpTransport.listTools.mockResolvedValue({ tools: [{ name: 'get_balance' }] });

    const res = await request(makeApp(ADMIN_SESSION)).get('/api/mcp/inspector/custom-tools?profile=custom-1');

    expect(res.status).toBe(200);
    expect(res.body.tools).toEqual([{ name: 'get_balance' }]);
    expect(res.body._source).toBe('profile');
    expect(res.body._profileId).toBe('custom-1');
    expect(mcpHttpTransport.listTools).toHaveBeenCalledWith(HTTP_PROFILE);
  });

  test('unknown profile id: 404', async () => {
    mcpProfileStore.getProfile.mockReturnValue(undefined);
    const res = await request(makeApp(ADMIN_SESSION)).get('/api/mcp/inspector/custom-tools?profile=nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('profile_not_found');
  });
});

describe('POST /api/mcp/inspector/custom-invoke', () => {
  test('missing tool: 400, no dispatch attempted', async () => {
    const res = await request(makeApp(ADMIN_SESSION))
      .post('/api/mcp/inspector/custom-invoke')
      .send({ profile: 'custom-1' });
    expect(res.status).toBe(400);
    expect(mcpProfileStore.getProfile).not.toHaveBeenCalled();
  });

  test('missing profile: 400, no dispatch attempted', async () => {
    const res = await request(makeApp(ADMIN_SESSION))
      .post('/api/mcp/inspector/custom-invoke')
      .send({ tool: 'get_balance' });
    expect(res.status).toBe(400);
    expect(mcpProfileStore.getProfile).not.toHaveBeenCalled();
  });

  test('no session: 401', async () => {
    const res = await request(makeApp(undefined))
      .post('/api/mcp/inspector/custom-invoke')
      .send({ tool: 'get_balance', profile: 'custom-1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
  });

  test('admin session: dispatches to the profile transport and returns its result', async () => {
    mcpProfileStore.getProfile.mockReturnValue(HTTP_PROFILE);
    mcpHttpTransport.callTool.mockResolvedValue({ balance: 42 });

    const res = await request(makeApp(ADMIN_SESSION))
      .post('/api/mcp/inspector/custom-invoke')
      .send({ tool: 'get_balance', params: { accountId: 'a1' }, profile: 'custom-1' });

    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ balance: 42 });
    expect(res.body._profileId).toBe('custom-1');
    expect(mcpHttpTransport.callTool).toHaveBeenCalledWith(HTTP_PROFILE, 'get_balance', { accountId: 'a1' });
  });
});
