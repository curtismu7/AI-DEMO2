'use strict';

const mockRecords = new Map();

jest.mock('../services/lmdb/openEnv', () => ({
  getDb: () => ({
    putSync: (k, v) => mockRecords.set(k, v),
    get:     (k)    => mockRecords.get(k),
    getRange: ()    => [...mockRecords.values()].map(value => ({ value })),
  }),
}));

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, res, next) => next(),
}));

// Prevent real PingOne network calls during tests
jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn().mockResolvedValue({ user: null }),
}));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockRejectedValue(new Error('not configured')),
}));
jest.mock('../services/pingoneBootstrapService', () => ({
  fetchFirstPopulationId: jest.fn().mockResolvedValue('pop-id'),
}));

const express = require('express');
const request = require('supertest');

// Must require AFTER mocks
const delegationRouter = require('../routes/delegation');

function makeApp(userId, email) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: userId, email }; next(); });
  app.use('/api/delegation', delegationRouter);
  return app;
}

beforeEach(() => mockRecords.clear());

describe('GET /api/delegation/granted-to-me', () => {
  test('returns 200 with active delegations where user is delegate', async () => {
    const aliceApp = makeApp('alice-id', 'alice@example.com');
    await request(aliceApp)
      .post('/api/delegation')
      .send({ delegateEmail: 'bob@example.com', scopes: ['view_accounts'] });

    const bobApp = makeApp('bob-id', 'bob@example.com');
    const res = await request(bobApp).get('/api/delegation/granted-to-me');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.delegations)).toBe(true);
    expect(res.body.delegations).toHaveLength(1);
    expect(res.body.delegations[0].delegator_user_id).toBe('alice-id');
    expect(res.body.delegations[0].scopes).toEqual(['view_accounts']);
  });

  test('returns empty array when user has no incoming delegations', async () => {
    const app = makeApp('nobody-id', 'nobody@example.com');
    const res = await request(app).get('/api/delegation/granted-to-me');
    expect(res.status).toBe(200);
    expect(res.body.delegations).toHaveLength(0);
  });

  test('does not return revoked delegations', async () => {
    const aliceApp = makeApp('alice2-id', 'alice2@example.com');
    const grantRes = await request(aliceApp)
      .post('/api/delegation')
      .send({ delegateEmail: 'carol@example.com', scopes: ['view_balances'] });
    const id = grantRes.body.delegation?.id;

    if (id) await request(aliceApp).delete(`/api/delegation/${id}`);

    const carolApp = makeApp('carol-id', 'carol@example.com');
    const res = await request(carolApp).get('/api/delegation/granted-to-me');
    expect(res.body.delegations).toHaveLength(0);
  });
});
