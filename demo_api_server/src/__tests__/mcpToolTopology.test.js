'use strict';

const request = require('supertest');
const app = require('../../server');

describe('GET /api/mcp/tool-topology', () => {
  it('returns found entry for a known tool', async () => {
    const res = await request(app).get('/api/mcp/tool-topology?tool=create_transfer');
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.requiredScopes).toContain('write');
    expect(res.body.challengeType).toBe('consent');
    expect(res.body.surface).toBe('gateway');
  });

  it('returns found:false for an unknown tool', async () => {
    const res = await request(app).get('/api/mcp/tool-topology?tool=nonexistent_tool');
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it('returns 400 when tool param is missing', async () => {
    const res = await request(app).get('/api/mcp/tool-topology');
    expect(res.status).toBe(400);
  });
});
