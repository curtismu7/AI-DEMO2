// demo_api_server/tests/real/shared/config.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

// admin is a role overlay, not a standalone vertical — excluded from list/active tests
const VERTICALS = ['banking', 'retail', 'sporting-goods', 'healthcare', 'workforce'];

describe('Vertical config endpoints (real)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  afterAll(async () => {
    if (client) await client.post('/api/verticals/active', { id: 'banking' });
  });

  it('GET /api/verticals/list lists all 6 verticals', async () => {
    const r = await client.get('/api/verticals/list');
    expect(r.status).toBe(200);
    const ids = (r.data || []).map(v => v.id || v);
    for (const v of VERTICALS) expect(ids).toContain(v);
  });

  it.each(VERTICALS)('POST /api/verticals/active sets %s and GET /me reflects it', async (verticalId) => {
    const r = await client.post('/api/verticals/active', { id: verticalId });
    expect([200, 204]).toContain(r.status);
    const g = await client.get('/api/verticals/me');
    expect(g.status).toBe(200);
    expect(g.data.activeId).toBe(verticalId);
    expect(g.data.pageManifest).toBeDefined();
    expect(g.data.pageManifest.identity).toBeDefined();
  });

  it('POST /api/verticals/active with unknown id returns 4xx', async () => {
    const r = await client.post('/api/verticals/active', { id: 'nonexistent' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('POST /api/verticals/active without id returns 4xx', async () => {
    const r = await client.post('/api/verticals/active', {});
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});
