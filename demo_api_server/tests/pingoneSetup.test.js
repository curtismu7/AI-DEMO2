'use strict';
/**
 * Tests for routes/pingoneSetup.js — POST /api/pingone/setup
 *
 * After minting a worker client_credentials token, the route must test the
 * HOSTED PingOne MCP server (streamable-HTTP JSON-RPC tools/list POST to the
 * adapter-built https://mcp.pingone.{region}/admin/{envId}/mcp URL), NOT the
 * local demo gateway. The real mcpPingOneHttpAdapter is loaded so the URL
 * asserted here is the adapter's single-source-of-truth format.
 *
 * The response must keep the 3-step shape PingOneSetup.jsx renders:
 * steps.tokenAcquisition / steps.gatewayConnectivity / steps.toolCall + nextSteps.
 *
 * NOTE: the global setup.js runs jest.resetModules() after every test, so
 * axios/configStore/route must be required inside each test (via setup())
 * to stay in the same module registry as the route under test.
 */

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => next(),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));
// Loaded by mcpPingOneHttpAdapter at require time; the route only uses the
// adapter's pure helpers, so no token mechanics are exercised.
jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  getAccessToken: jest.fn(),
}));

const request = require('supertest');
const express = require('express');

const TOOLS = [
  { name: 'listApplications', description: 'List apps' },
  { name: 'listEnvironments', description: 'List envs' },
];

const CREDS = { environmentId: 'env-abc', clientId: 'client-1', clientSecret: 'secret-1' };

// Require everything from the CURRENT module registry (see NOTE above).
function setup({ getEffective } = {}) {
  const axios = require('axios');
  const configStore = require('../services/configStore');
  if (getEffective) configStore.getEffective.mockImplementation(getEffective);
  const app = express();
  app.use(express.json());
  app.use('/api/pingone/setup', require('../routes/pingoneSetup'));
  return { app, axios, configStore };
}

function mockTokenOk() {
  return { data: { access_token: 'worker-token-xyz' } };
}

function rpcBody(payload) {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, ...payload });
}

describe('POST /api/pingone/setup', () => {
  test('happy path: mints token, then tools/list against the hosted PingOne MCP URL', async () => {
    const { app, axios } = setup();
    axios.post.mockImplementation(async (url) => {
      if (url.includes('/as/token')) return mockTokenOk();
      return { status: 200, data: rpcBody({ result: { tools: TOOLS } }) };
    });

    const res = await request(app).post('/api/pingone/setup').send(CREDS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // 3-step shape the JSX renders — key names must not drift.
    expect(Object.keys(res.body.steps)).toEqual(['tokenAcquisition', 'gatewayConnectivity', 'toolCall']);
    expect(res.body.steps.tokenAcquisition.success).toBe(true);
    expect(res.body.steps.gatewayConnectivity.success).toBe(true);
    expect(res.body.steps.toolCall).toMatchObject({ success: true, toolsFound: 2 });
    expect(res.body.steps.toolCall.tools.map((t) => t.name)).toEqual(['listApplications', 'listEnvironments']);

    // Exactly two upstream calls: token endpoint, then the HOSTED MCP server.
    expect(axios.post).toHaveBeenCalledTimes(2);
    const [mcpUrl, mcpBody, mcpCfg] = axios.post.mock.calls[1];
    // Adapter-built NEW hosted format (region default com, submitted envId) —
    // not the deprecated api.pingone.{region}/v1/environments/{envId}/mcp.
    expect(mcpUrl).toBe('https://mcp.pingone.com/admin/env-abc/mcp');
    expect(mcpBody).toMatchObject({ jsonrpc: '2.0', method: 'tools/list' });
    expect(mcpCfg.headers.Authorization).toBe('Bearer worker-token-xyz');

    // nextSteps points at the real UI host, not localhost:3000.
    expect(res.body.nextSteps.join(' ')).toContain('https://local.ping-devops.com:4000');
    expect(res.body.nextSteps.join(' ')).not.toContain('localhost:3000');
  });

  test('uses the configured pingone_region in the hosted MCP URL', async () => {
    const { app, axios } = setup({ getEffective: (k) => (k === 'pingone_region' ? 'eu' : null) });
    axios.post.mockImplementation(async (url) => {
      if (url.includes('/as/token')) return mockTokenOk();
      return { status: 200, data: rpcBody({ result: { tools: TOOLS } }) };
    });

    const res = await request(app).post('/api/pingone/setup').send(CREDS);

    expect(res.body.success).toBe(true);
    expect(axios.post.mock.calls[0][0]).toBe('https://auth.pingone.eu/env-abc/as/token');
    expect(axios.post.mock.calls[1][0]).toBe('https://mcp.pingone.eu/admin/env-abc/mcp');
  });

  test('token mint failure short-circuits: no MCP call, step keys intact', async () => {
    const { app, axios } = setup();
    axios.post.mockImplementation(async () => {
      const e = new Error('Request failed with status code 401');
      e.response = { data: { error: 'invalid_client' } };
      throw e;
    });

    const res = await request(app).post('/api/pingone/setup').send(CREDS);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.steps.tokenAcquisition).toMatchObject({ success: false, error: 'invalid_client' });
    expect(res.body.steps.gatewayConnectivity.success).toBe(false);
    expect(res.body.steps.toolCall.success).toBe(false);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(Object.keys(res.body.steps)).toEqual(['tokenAcquisition', 'gatewayConnectivity', 'toolCall']);
  });

  test('hosted MCP HTTP failure lands on gatewayConnectivity with the status', async () => {
    const { app, axios } = setup();
    axios.post.mockImplementation(async (url) => {
      if (url.includes('/as/token')) return mockTokenOk();
      const e = new Error('Request failed with status code 401');
      e.response = { status: 401 };
      throw e;
    });

    const res = await request(app).post('/api/pingone/setup').send(CREDS);

    expect(res.body.success).toBe(false);
    expect(res.body.steps.tokenAcquisition.success).toBe(true);
    expect(res.body.steps.gatewayConnectivity).toMatchObject({ success: false, error: 'HTTP 401' });
    expect(res.body.steps.toolCall.success).toBe(false);
  });

  test('JSON-RPC error body: connectivity passes, toolCall fails with the RPC message', async () => {
    const { app, axios } = setup();
    axios.post.mockImplementation(async (url) => {
      if (url.includes('/as/token')) return mockTokenOk();
      return { status: 200, data: rpcBody({ error: { code: -32000, message: 'denied by policy' } }) };
    });

    const res = await request(app).post('/api/pingone/setup').send(CREDS);

    expect(res.body.success).toBe(false);
    expect(res.body.steps.gatewayConnectivity.success).toBe(true);
    expect(res.body.steps.toolCall).toMatchObject({ success: false, error: 'denied by policy' });
  });

  test('parses an SSE-framed tools/list response (adapter extractJsonRpc reuse)', async () => {
    const { app, axios } = setup();
    axios.post.mockImplementation(async (url) => {
      if (url.includes('/as/token')) return mockTokenOk();
      return { status: 200, data: `event: message\ndata: ${rpcBody({ result: { tools: TOOLS } })}\n\n` };
    });

    const res = await request(app).post('/api/pingone/setup').send(CREDS);

    expect(res.body.success).toBe(true);
    expect(res.body.steps.toolCall.toolsFound).toBe(2);
  });

  test('missing credentials returns 400 with { error }', async () => {
    const { app, axios } = setup();

    const res = await request(app).post('/api/pingone/setup').send({ environmentId: 'env-abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required credentials');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
