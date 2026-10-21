'use strict';

// The connector trace behind the Personal Agent "Add to ChatGPT / Claude" tab: /connector/probe runs the tokenless call
// and the two discovery documents for real; /connector/trace returns what sign-in recorded plus the held token.

const express = require('express');
const request = require('supertest');

const MCP_URL = 'https://mcpgw.example.com/aggregate/mcp';
const BASE = 'https://mcpgw.example.com/aggregate';
const RESOURCE_URL = 'https://mcpgw.example.com/.well-known/oauth-protected-resource/aggregate/mcp';

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-connector-trace-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

const reply = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] || null },
  text: async () => JSON.stringify(body),
  json: async () => body,
});

describe('privilege MCP connector trace', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('probe records the challenge, the protected-resource document and the AS document, from real responses', async () => {
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: MCP_URL }).expect(200);
    const calls = [];
    global.fetch = jest.fn(async (url, options = {}) => {
      const target = String(url);
      calls.push({ target, method: options.method, auth: options.headers?.Authorization });
      if (target === RESOURCE_URL) return reply({ resource: MCP_URL, authorization_servers: [BASE], scopes_supported: ['mcp:invoke'] });
      if (target === MCP_URL) return reply({ error: 'unauthorized' }, 401, { 'www-authenticate': `Bearer resource_metadata="${RESOURCE_URL}"` });
      if (target === `${BASE}/.well-known/oauth-authorization-server`) return reply({ code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true });
      return reply({}, 404);
    });

    const { body } = await request(app).post('/api/privilege-mcp/connector/probe').send({}).expect(200);

    expect(body.trace.challenge.response.status).toBe(401);
    expect(body.trace.challenge.response.wwwAuthenticate).toContain(RESOURCE_URL);
    expect(body.trace.resource.response.body.authorization_servers).toEqual([BASE]);
    expect(body.trace.as.response.body.client_id_metadata_document_supported).toBe(true);
    // The first call is the tokenless tool call — no Authorization header at all.
    expect(calls[0]).toMatchObject({ method: 'POST', auth: undefined });
  });

  it('trace reports no token before sign-in and stays empty of steps that did not run', async () => {
    const app = buildApp();
    const { body } = await request(app).get('/api/privilege-mcp/connector/trace').expect(200);
    expect(body.token).toBeNull();
    expect(body.trace).toEqual({});
  });

  it('probe survives an unreachable door and says so instead of throwing', async () => {
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: MCP_URL }).expect(200);
    global.fetch = jest.fn(async () => { throw new Error('connect ECONNREFUSED'); });
    const { body } = await request(app).post('/api/privilege-mcp/connector/probe').send({}).expect(200);
    expect(body.trace.challenge.response.error).toContain('ECONNREFUSED');
    expect(body.trace.as).toBeUndefined();
  });
});
