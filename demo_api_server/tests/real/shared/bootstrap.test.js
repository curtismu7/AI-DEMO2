// demo_api_server/tests/real/shared/bootstrap.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

// admin is a role overlay — not in the switcher list and not settable as active
const EXPECTED_VERTICALS = ['banking', 'retail', 'sporting-goods', 'healthcare', 'workforce'];

describe('Bootstrap contract (real)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  it('GET /api/health returns 200', async () => {
    const r = await client.get('/api/health');
    expect(r.status).toBe(200);
  });

  it('GET /api/verticals/list returns all 6 verticals', async () => {
    const r = await client.get('/api/verticals/list');
    expect(r.status).toBe(200);
    const ids = (r.data || []).map(v => v.id || v);
    for (const v of EXPECTED_VERTICALS) {
      expect(ids).toContain(v);
    }
  });

  it.each(EXPECTED_VERTICALS)('vertical %s: POST active → GET me returns correct id', async (verticalId) => {
    const post = await client.post('/api/verticals/active', { id: verticalId });
    expect([200, 204]).toContain(post.status);
    const get = await client.get('/api/verticals/me');
    expect(get.status).toBe(200);
    expect(get.data.activeId).toBe(verticalId);
  });

  afterAll(async () => {
    if (client) await client.post('/api/verticals/active', { id: 'banking' });
  });

  it('GET /api/auth/oauth/status returns authenticated: true', async () => {
    const r = await client.get('/api/auth/oauth/status');
    expect(r.status).toBe(200);
    expect(r.data.authenticated).toBe(true);
    expect(r.data.user).toMatchObject({
      id: expect.any(String),
      email: expect.any(String),
    });
  });

  it('GET /api/accounts/my returns accounts array', async () => {
    const r = await client.get('/api/accounts/my');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.accounts)).toBe(true);
    expect(r.data.accounts.length).toBeGreaterThan(0);
  });
});
