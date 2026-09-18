const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireSession: (req, _res, next) => {
    req.session = { user: { id: 'demo-user' } };
    next();
  },
}));

const mcpApps = require('../routes/mcpApps');
const app = express();
app.use('/api/mcp/apps', mcpApps);

describe('MCP Apps transfer approval resource', () => {
  test('serves a credential-free MCP App resource with the approval bridge', async () => {
    const res = await request(app).get('/api/mcp/apps/transfer-approval');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html.*profile=mcp-app/);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'self'/);
    expect(res.text).toContain('mcp-app-ready');
    expect(res.text).toContain('approve_transfer');
    expect(res.text).toContain('data-action="reject"');
    expect(res.text).not.toContain('fetch(');
    expect(res.text).not.toMatch(/access[_-]?token/i);
  });
});
