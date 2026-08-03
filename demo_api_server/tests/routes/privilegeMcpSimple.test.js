'use strict';

// The minimal Privilege-style MCP relay: client_credentials in, MCP JSON-RPC out.
// Guards the two details that cost real debugging time against the live stack:
// the token request must name its scopes (PingOne rejects a bare
// client_credentials for a multi-resource app), and every non-initialize request
// must carry mcp-protocol-version or the MCP server answers 400.

const express = require('express');
const request = require('supertest');
const https = require('https');
const { EventEmitter } = require('events');

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpSimple');
  const app = express();
  app.use('/api/privilege-mcp-simple', router);
  return app;
}

// Minimal stand-in for https.request: records what was sent, replays a response.
function stubHttps(responder) {
  const sent = [];
  jest.spyOn(https, 'request').mockImplementation((options, cb) => {
    const req = new EventEmitter();
    let body = '';
    req.end = (payload) => {
      body = payload;
      sent.push({ options, body: JSON.parse(payload) });
      const { status = 200, json = {}, headers = {} } = responder(JSON.parse(payload)) || {};
      const res = new EventEmitter();
      res.statusCode = status;
      res.headers = headers;
      process.nextTick(() => {
        res.emit('data', JSON.stringify(json));
        res.emit('end');
      });
      cb(res);
    };
    return req;
  });
  return sent;
}

function tokenOk() {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }),
  };
}

describe('privilege MCP simple relay', () => {
  const originalFetch = global.fetch;
  const savedEnv = {};
  const ENV_KEYS = ['PRIVILEGE_SSO_CLIENT_ID', 'PRIVILEGE_SSO_CLIENT_SECRET', 'PRIVILEGE_SSO_ENV_ID', 'MCP_MTLS_ENABLED', 'PRIVILEGE_SIMPLE_MCP_URL'];

  beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.PRIVILEGE_SSO_CLIENT_ID = 'client-1';
    process.env.PRIVILEGE_SSO_CLIENT_SECRET = 'secret-1';
    process.env.PRIVILEGE_SSO_ENV_ID = 'env-1';
    process.env.MCP_MTLS_ENABLED = 'false';
    process.env.PRIVILEGE_SIMPLE_MCP_URL = 'https://mcp-server:8080/mcp';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    jest.restoreAllMocks();
  });

  test('status reports the target without calling anything', async () => {
    const app = buildApp();
    global.fetch = jest.fn();

    const res = await request(app).get('/api/privilege-mcp-simple/status').expect(200);

    expect(res.body.mcpUrl).toBe('https://mcp-server:8080/mcp');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // Regression: the default target was a hardcoded https://, but mcp-server only
  // serves TLS when the mTLS switch is on. With it off the relay died on
  // "wrong version number" — a TLS error for talking https to a plaintext port.
  test('the default target scheme follows the mTLS switch', async () => {
    delete process.env.PRIVILEGE_SIMPLE_MCP_URL;

    process.env.MCP_MTLS_ENABLED = 'false';
    let res = await request(buildApp()).get('/api/privilege-mcp-simple/status').expect(200);
    expect(res.body.mcpUrl).toBe('http://mcp-server:8080/mcp');

    process.env.MCP_MTLS_ENABLED = 'true';
    res = await request(buildApp()).get('/api/privilege-mcp-simple/status').expect(200);
    expect(res.body.mcpUrl).toBe('https://mcp-server:8080/mcp');
  });

  test('tools/list names its scopes and sends mcp-protocol-version', async () => {
    const app = buildApp();
    global.fetch = jest.fn(async () => tokenOk());
    const sent = stubHttps((rpc) => {
      if (rpc.method === 'initialize') {
        return { status: 200, json: { result: { protocolVersion: '2024-11-05' } }, headers: { 'mcp-session-id': 'sess-1' } };
      }
      return { status: 200, json: { result: { tools: [{ name: 'get_my_accounts' }] } } };
    });

    const res = await request(app).post('/api/privilege-mcp-simple/tools/list').send({}).expect(200);

    expect(res.body.tools).toEqual([{ name: 'get_my_accounts' }]);

    // PingOne rejects a bare client_credentials for this app with
    // "May not request scopes for multiple resources" — the scope must be named.
    const tokenBody = global.fetch.mock.calls[0][1].body.toString();
    expect(tokenBody).toContain('scope=');
    expect(tokenBody).toContain('grant_type=client_credentials');

    const listCall = sent.find((c) => c.body.method === 'tools/list');
    expect(listCall.options.headers['mcp-protocol-version']).toBe('2024-11-05');
    expect(listCall.options.headers['MCP-Session-Id']).toBe('sess-1');
    const initCall = sent.find((c) => c.body.method === 'initialize');
    expect(initCall.options.headers['mcp-protocol-version']).toBeUndefined();
  });

  test('an upstream 4xx keeps its status; the relay does not flatten it', async () => {
    const app = buildApp();
    global.fetch = jest.fn(async () => tokenOk());
    stubHttps(() => ({ status: 403, json: { error: 'forbidden' } }));

    const res = await request(app).post('/api/privilege-mcp-simple/tools/list').send({});

    expect(res.status).toBe(403);
  });

  test('missing credentials fail with a named cause, not a crash', async () => {
    delete process.env.PRIVILEGE_SSO_CLIENT_ID;
    delete process.env.PINGONE_MCP_GATEWAY_CLIENT_ID;
    const app = buildApp();
    global.fetch = jest.fn();

    const res = await request(app).post('/api/privilege-mcp-simple/tools/list').send({}).expect(500);

    expect(res.body.error).toMatch(/credentials/i);
  });
});
