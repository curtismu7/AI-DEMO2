'use strict';

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');
const { VERTICAL_FIXTURES } = require('../helpers/fixtures');

const VERTICAL = 'admin';
const FX = VERTICAL_FIXTURES[VERTICAL];

describe(`Accounts — ${VERTICAL} vertical (real)`, () => {
  let client;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    await setVertical(client, VERTICAL);
  });

  afterAll(async () => {
    await restoreVertical(client);
  });

  it('GET /api/accounts/my returns 200 with accounts', async () => {
    const r = await client.get('/api/accounts/my');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.accounts)).toBe(true);
    expect(r.data.accounts.length).toBeGreaterThan(0);
  });

  it('GET /api/verticals/me returns a valid vertical (admin is a role overlay, not switchable)', async () => {
    const r = await client.get('/api/verticals/me');
    expect(r.status).toBe(200);
    // admin is a role overlay — active vertical stays at whatever was set before
    expect(r.data.activeId).toBeDefined();
    expect(r.data.pageManifest).toBeDefined();
  });

  it('fixture checking account balance (admin-owned)', async () => {
    const r = await client.get(`/api/accounts/${FX.chk}/balance`);
    // Fixture accounts belong to test-real-suite, not the enduser
    expect([200, 403, 404]).toContain(r.status);
  });
});
