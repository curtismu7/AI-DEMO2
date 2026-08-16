'use strict';

/**
 * @file mcpInspectorRpc.test.js
 * @description POST /api/mcp/inspector/rpc — generic JSON-RPC tester for the MCP
 * protocol methods that are not tool calls (Resources, Prompts, Completion,
 * Logging). These methods only exist behind the MCP gateway's proxy to
 * demo_mcp_resource_server (see demo_mcp_gateway/src/index.ts
 * RESOURCE_SERVER_ONLY_METHODS) — the plain mcp-server does not implement them.
 * Unlike POST /invoke (tools/call), this route requires a real session (no
 * local-fallback handler exists for these methods) and is restricted to an
 * explicit method allow-list so it can never become an open JSON-RPC proxy.
 */

const express = require('express');
const request = require('supertest');

const mockRpcCall = jest.fn();
const mockGetMcpGatewayWsUrl = jest.fn();
jest.mock('../services/mcpWebSocketClient', () => {
  const actual = jest.requireActual('../services/mcpWebSocketClient');
  return {
    ...actual,
    mcpRpcCall: (...args) => mockRpcCall(...args),
    getMcpGatewayWsUrl: (...args) => mockGetMcpGatewayWsUrl(...args),
  };
});

const mockResolveMcpAccessTokenWithEvents = jest.fn();
jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: (...args) => mockResolveMcpAccessTokenWithEvents(...args),
}));

// Test-only session shim ahead of the router — mirrors mcpInspectorProfiles.test.js.
function testSession(req, res, next) {
  req.session = req.session || {};
  if (req.headers['x-test-authed']) {
    req.session.user = { id: 'rpc-test-user', role: req.headers['x-test-role'] || 'user' };
  }
  next();
}

const mcpInspectorRoutes = require('../routes/mcpInspector');

function buildApp() {
  const app = express();
  app.use(testSession);
  app.use('/api/mcp/inspector', mcpInspectorRoutes);
  return app;
}

const GATEWAY_WS_URL = 'ws://mcp-gateway:3005';

describe('POST /api/mcp/inspector/rpc', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    mockRpcCall.mockReset();
    mockGetMcpGatewayWsUrl.mockReset();
    mockResolveMcpAccessTokenWithEvents.mockReset();
    mockGetMcpGatewayWsUrl.mockReturnValue(GATEWAY_WS_URL);
    mockResolveMcpAccessTokenWithEvents.mockResolvedValue({
      token: 'agent-token-abc',
      userSub: 'rpc-test-user-sub',
      tokenEvents: [],
    });
    mockRpcCall.mockResolvedValue({
      result: { resources: [] },
      frames: {
        request: { jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} },
        response: { jsonrpc: '2.0', id: 2, result: { resources: [] } },
      },
    });
  });

  it('401s without a session', async () => {
    const res = await request(app)
      .post('/api/mcp/inspector/rpc')
      .send({ method: 'resources/list', params: {} });

    expect(res.status).toBe(401);
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('400s when method is missing', async () => {
    const res = await request(app)
      .post('/api/mcp/inspector/rpc')
      .set('x-test-authed', '1')
      .send({ params: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_method');
  });

  it('400s for a method not on the allow-list (never an open JSON-RPC proxy)', async () => {
    const res = await request(app)
      .post('/api/mcp/inspector/rpc')
      .set('x-test-authed', '1')
      .send({ method: 'tools/call', params: { name: 'get_my_accounts' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_method');
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('503s when the MCP gateway is not configured', async () => {
    mockGetMcpGatewayWsUrl.mockReturnValue(null);

    const res = await request(app)
      .post('/api/mcp/inspector/rpc')
      .set('x-test-authed', '1')
      .send({ method: 'resources/list', params: {} });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('mcp_gateway_not_configured');
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('resolves a gateway-audience token (not forceDirectMcpAudience) and dials the gateway WS URL', async () => {
    const res = await request(app)
      .post('/api/mcp/inspector/rpc')
      .set('x-test-authed', '1')
      .send({ method: 'resources/list', params: {} });

    expect(res.status).toBe(200);
    expect(mockResolveMcpAccessTokenWithEvents).toHaveBeenCalledTimes(1);
    const [, , tokenOpts] = mockResolveMcpAccessTokenWithEvents.mock.calls[0];
    expect(tokenOpts.forceDirectMcpAudience).not.toBe(true);
    expect(Array.isArray(tokenOpts.scopeOverride)).toBe(true);

    expect(mockRpcCall).toHaveBeenCalledWith(
      'resources/list',
      {},
      'agent-token-abc',
      'rpc-test-user-sub',
      undefined,
      expect.objectContaining({ serverUrl: GATEWAY_WS_URL })
    );
  });

  it('returns the result, frames, and tokenEvents from the RPC call', async () => {
    const res = await request(app)
      .post('/api/mcp/inspector/rpc')
      .set('x-test-authed', '1')
      .send({ method: 'prompts/list', params: {} });

    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ resources: [] });
    expect(res.body.frames.request.method).toBe('resources/list');
    expect(res.body.inspector.method).toBe('prompts/list');
  });

  it('401s when token resolution yields no token (no local-fallback path)', async () => {
    mockResolveMcpAccessTokenWithEvents.mockResolvedValue({ token: null, need_auth: true, tokenEvents: [] });

    const res = await request(app)
      .post('/api/mcp/inspector/rpc')
      .set('x-test-authed', '1')
      .send({ method: 'resources/list', params: {} });

    expect(res.status).toBe(401);
    expect(mockRpcCall).not.toHaveBeenCalled();
  });

  it('propagates a token-resolution error status/message', async () => {
    const err = new Error('exchange scope denied');
    err.code = 'missing_exchange_scopes';
    err.httpStatus = 403;
    mockResolveMcpAccessTokenWithEvents.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/mcp/inspector/rpc')
      .set('x-test-authed', '1')
      .send({ method: 'resources/list', params: {} });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('missing_exchange_scopes');
  });

  it('502s with the JSON-RPC error frames when the gateway call fails', async () => {
    const err = new Error('Insufficient scope for resource');
    err.frames = { request: { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'banking://accounts' } } };
    mockRpcCall.mockRejectedValue(err);

    const res = await request(app)
      .post('/api/mcp/inspector/rpc')
      .set('x-test-authed', '1')
      .send({ method: 'resources/read', params: { uri: 'banking://accounts' } });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('mcp_rpc_failed');
    expect(res.body.frames).toEqual(err.frames);
  });
});
