'use strict';

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

const VERTICAL = 'retail';

describe(`Transactions — ${VERTICAL} vertical (real)`, () => {
  let client;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    await setVertical(client, VERTICAL);
  });

  afterAll(async () => {
    await restoreVertical(client);
  });

  describe('GET /api/transactions/my', () => {
    it('returns 200 with array', async () => {
      const r = await client.get('/api/transactions/my');
      expect(r.status).toBe(200);
      expect(Array.isArray(r.data.transactions)).toBe(true);
    });

    it('transactions include expected fields', async () => {
      const r = await client.get('/api/transactions/my');
      if (!r.data.transactions?.length) return;
      const tx = r.data.transactions[0];
      expect(tx).toMatchObject({
        id:     expect.any(String),
        type:   expect.any(String),
        amount: expect.any(Number),
      });
    });
  });

  describe('GET /api/transactions (admin-only)', () => {
    it('returns 403 for enduser', async () => {
      const r = await client.get('/api/transactions');
      expect(r.status).toBe(403);
    });
  });
});
