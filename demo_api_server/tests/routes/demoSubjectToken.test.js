const request = require('supertest');
const express = require('express');

// The mint endpoint must 404 unless MCP_AUTH_DISABLED === 'true' — it hands out
// a real demo-user token, so the open-access flag is its only gate.
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
    delete process.env.DEMO_USER_USERNAME; delete process.env.DEMO_USER_PASSWORD;
    // Unconfigured creds -> 500 demo_user_unconfigured, proving the gate passed.
    const res = await request(appWithRouter()).post('/api/path/demo-subject-token').send({}).expect(500);
    expect(res.body.error).toBe('demo_user_unconfigured');
  });
});
