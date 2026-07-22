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

jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn().mockResolvedValue({ user: null }),
}));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockRejectedValue(new Error('not configured')),
}));
jest.mock('../services/pingoneBootstrapService', () => ({
  fetchFirstPopulationId: jest.fn().mockResolvedValue('pop-id'),
}));
jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  setDelegatedToAttribute: jest.fn().mockResolvedValue(undefined),
}));

const express = require('express');
const request = require('supertest');

const delegationRouter = require('../routes/delegation');

function makeApp(userId, email) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: userId, email }; next(); });
  app.use('/api/delegation', delegationRouter);
  return app;
}

beforeEach(() => mockRecords.clear());

async function grantAsManager() {
  const managerApp = makeApp('manager-1', 'sam@example.com');
  const res = await request(managerApp)
    .post('/api/delegation')
    .send({ delegateEmail: 'dana@example.com', scopes: ['create_transfer'] });
  return res.body.delegation.id;
}

describe('POST /api/delegation/:id/approve', () => {
  test('manager approves their own pending delegation', async () => {
    const id = await grantAsManager();
    mockRecords.set(id, { ...mockRecords.get(id), pendingApproval: { status: 'pending', authReqId: 'a1', amount: 600 } });

    const res = await request(makeApp('manager-1', 'sam@example.com'))
      .post(`/api/delegation/${id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockRecords.get(id).pendingApproval.status).toBe('approved');
  });

  test('a non-owner gets 404, not the manager\'s pending record', async () => {
    const id = await grantAsManager();
    mockRecords.set(id, { ...mockRecords.get(id), pendingApproval: { status: 'pending', authReqId: 'a1', amount: 600 } });

    const res = await request(makeApp('someone-else', 'eve@example.com'))
      .post(`/api/delegation/${id}/approve`);
    expect(res.status).toBe(404);
    expect(mockRecords.get(id).pendingApproval.status).toBe('pending'); // unchanged
  });

  test('404 for a delegation with nothing pending', async () => {
    const id = await grantAsManager(); // no pendingApproval set
    const res = await request(makeApp('manager-1', 'sam@example.com'))
      .post(`/api/delegation/${id}/approve`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/delegation/:id/deny', () => {
  test('manager denies their own pending delegation', async () => {
    const id = await grantAsManager();
    mockRecords.set(id, { ...mockRecords.get(id), pendingApproval: { status: 'pending', authReqId: 'a1', amount: 600 } });

    const res = await request(makeApp('manager-1', 'sam@example.com'))
      .post(`/api/delegation/${id}/deny`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockRecords.get(id).pendingApproval.status).toBe('denied');
  });
});
