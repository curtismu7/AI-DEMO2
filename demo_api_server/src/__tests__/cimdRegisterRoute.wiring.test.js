/**
 * CIMD wiring — POST /api/oauth/clients/register-cimd end-to-end:
 * the route fetches a REAL published metadata document (ephemeral express
 * server mounting routes/cimdAgentMetadata on a loopback port, no mocked
 * fetch) and registers the agent through the mocked AS path.
 */
'use strict';

jest.mock('../../middleware/auth', () => ({
  requireAdmin: (req, res, next) => next()
}));

const express = require('express');
const request = require('supertest');
const registry = require('../../services/oauthClientRegistry');

describe('POST /api/oauth/clients/register-cimd (route wiring)', () => {
  let server;
  let baseUrl;

  beforeAll((done) => {
    const pub = express();
    pub.use('/api/cimd', require('../../routes/cimdAgentMetadata'));
    server = pub.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => { server.close(done); });
  beforeEach(() => registry.clearRegistry());

  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/oauth/clients', require('../../routes/oauthClients'));
    return app;
  }

  test('registers an agent end-to-end from its published metadata document', async () => {
    const docUrl = `${baseUrl}/api/cimd/agents/super-banking-investment-advisor-agent/client-metadata.json`;

    const res = await request(makeApp())
      .post('/api/oauth/clients/register-cimd')
      .send({ client_id: docUrl });

    expect(res.status).toBe(201);
    expect(res.body.mocked).toBe(true);
    expect(res.body.engine).toBe('mock');
    expect(res.body.notice).toMatch(/PingOne does not yet support CIMD/);
    expect(res.body.client.client_id).toBe(docUrl);
    expect(res.body.steps.map((s) => s.step)).toEqual(['fetch', 'validate', 'register']);
  });

  // `admin:read` joined agent:invoke in #1689 so the agent's client-credentials
  // token can reach the MCP /audit endpoint, which requires that scope. This
  // asserts the EXACT scope string on the published document on purpose: the set
  // is a privilege boundary, so widening it should have to change this line and
  // be seen in review, never drift in unnoticed.
  test('the main AI Agent (scopes agent:invoke + admin:read) registers end-to-end from its published document', async () => {
    const docUrl = `${baseUrl}/api/cimd/agents/super-banking-ai-agent/client-metadata.json`;

    const res = await request(makeApp())
      .post('/api/oauth/clients/register-cimd')
      .send({ client_id: docUrl });

    expect(res.status).toBe(201);
    expect(res.body.client.client_id).toBe(docUrl);
    expect(res.body.client.scope).toBe('agent:invoke admin:read');
    expect(res.body.steps.every((s) => s.status === 'success')).toBe(true);
  });

  test('missing client_id is a 400 invalid_request', async () => {
    const res = await request(makeApp()).post('/api/oauth/clients/register-cimd').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });
});
