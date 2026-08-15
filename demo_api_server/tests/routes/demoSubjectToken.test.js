const request = require('supertest');
const express = require('express');

// The mint endpoint must 404 unless MCP_AUTH_DISABLED === 'true' — it hands out
// a real worker (client_credentials) token, so the open-access flag is its only gate.
describe('POST /api/path/demo-subject-token — gate', () => {
  const orig = process.env.MCP_AUTH_DISABLED;
  afterEach(() => { if (orig === undefined) delete process.env.MCP_AUTH_DISABLED; else process.env.MCP_AUTH_DISABLED = orig; });

  function appWithRouter() {
    jest.resetModules();
    const router = require('../../routes/verticalTool');
    const app = express();
    app.use('/api/path', router);
    return app;
  }

  it('404s when MCP_AUTH_DISABLED is not true', async () => {
    process.env.MCP_AUTH_DISABLED = 'false';
    const res = await request(appWithRouter()).post('/api/path/demo-subject-token').send({}).expect(404);
    expect(res.body.error).toBe('Not found');
  });

  it('does not 404 when MCP_AUTH_DISABLED is true (proceeds to mint)', async () => {
    process.env.MCP_AUTH_DISABLED = 'true';
    // Mock the worker-token mint to fail, hermetically: proves the open-access gate
    // passed and the endpoint attempted the client_credentials mint (502, not 404).
    jest.resetModules();
    jest.doMock('../../services/agentCCTokenService', () => ({
      getAgentCCToken: async () => { throw new Error('no worker client in test'); },
    }));
    const router = require('../../routes/verticalTool');
    const app = express();
    app.use('/api/path', router);
    const res = await request(app).post('/api/path/demo-subject-token').send({}).expect(502);
    expect(res.body.error).toBe('worker_token_failed');
    jest.dontMock('../../services/agentCCTokenService');
  });
});
