const request = require('supertest');
const express = require('express');

describe('GET /api/mcp/inspector/pingone-admin/callback redirects', () => {
  let app;
  beforeEach(() => {
    app = express();
    app.use((req, _res, next) => { req.session = {}; next(); });
    app.use('/api/mcp/inspector/pingone-admin', require('../routes/mcpPingOneAdminAuth'));
  });

  test('invalid_state redirects to /pingone-mcp-inspector?source=custom with the error', async () => {
    const res = await request(app)
      .get('/api/mcp/inspector/pingone-admin/callback')
      .query({ code: 'abc', state: 'wrong' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pingone-mcp-inspector?source=custom&pingone_admin_error=invalid_state');
  });

  test('missing_code redirects to /pingone-mcp-inspector?source=custom with the error', async () => {
    app = express();
    app.use((req, _res, next) => {
      req.session = { pingoneMcpAdminOAuth: { state: 'xyz', codeVerifier: 'v', redirectUri: 'http://x/cb' } };
      next();
    });
    app.use('/api/mcp/inspector/pingone-admin', require('../routes/mcpPingOneAdminAuth'));
    const res = await request(app)
      .get('/api/mcp/inspector/pingone-admin/callback')
      .query({ state: 'xyz' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pingone-mcp-inspector?source=custom&pingone_admin_error=missing_code');
  });
});
