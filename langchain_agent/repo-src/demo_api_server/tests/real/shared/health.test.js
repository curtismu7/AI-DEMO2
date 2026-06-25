// demo_api_server/tests/real/shared/health.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

describe('GET /api/health (real)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  it('returns 200 with status healthy', async () => {
    const r = await client.get('/api/health');
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ status: expect.any(String) });
  });

  it('returns 200 from /api/healthz', async () => {
    const r = await client.get('/api/healthz');
    expect(r.status).toBe(200);
  });
});
