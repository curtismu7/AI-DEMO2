'use strict';
const request = require('supertest');
const express = require('express');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/authorize', require('../../routes/authorize'));
  return app;
}

describe('POST /api/authorize/test-mcp-live', () => {
  const app = makeApp();

  test('400 when parameters missing', async () => {
    const res = await request(app).post('/api/authorize/test-mcp-live').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parameters/);
  });

  test('400 when parameters is not an object', async () => {
    const res = await request(app).post('/api/authorize/test-mcp-live').send({ parameters: [] });
    expect(res.status).toBe(400);
  });

  test('409 when PingOne Authorize is not configured', async () => {
    // No worker creds / decision endpoint in the unit-test env -> isConfigured() is false.
    const res = await request(app)
      .post('/api/authorize/test-mcp-live')
      .send({ parameters: { DecisionContext: 'McpFirstTool', ToolName: 'banking_get_accounts', UserId: 'u1' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('pingone_not_configured');
  });
});
