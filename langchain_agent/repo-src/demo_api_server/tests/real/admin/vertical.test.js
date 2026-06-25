'use strict';

const { createBffClient } = require('../helpers/bffClient');

// Admin is a role overlay, not a switchable vertical — no manifest.json.
// Verify the API correctly rejects admin as an active vertical.
describe('Vertical manifest — admin (real)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('admin');
  });

  it('GET /api/verticals/list does not expose admin as a switchable vertical', async () => {
    const r = await client.get('/api/verticals/list');
    expect(r.status).toBe(200);
    const ids = (r.data || []).map(v => v.id || v);
    expect(ids).not.toContain('admin');
    expect(ids).not.toContain('admin-console');
  });

  it('POST /api/verticals/active with admin id returns 4xx (not a switchable vertical)', async () => {
    const r = await client.post('/api/verticals/active', { id: 'admin' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('GET /api/verticals/me returns a valid active vertical', async () => {
    const r = await client.get('/api/verticals/me');
    expect(r.status).toBe(200);
    expect(r.data.activeId).toBeDefined();
    expect(r.data.pageManifest).toBeDefined();
  });
});
