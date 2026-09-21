'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/hostedRegistrationAdminService', () => ({
  createHostedRegistrationAdminService: jest.fn(() => ({
    list: jest.fn(() => [{ id: 'req-1', email: 'alice@pingidentity.com', status: 'pending_approval', requestedRole: 'user' }]),
    approve: jest.fn(async () => ({ id: 'req-1', status: 'approved', groups: ['hosted-users'] })),
    reject: jest.fn(async () => ({ id: 'req-1', status: 'rejected' })),
    disable: jest.fn(async () => ({ id: 'req-1', status: 'disabled' })),
  })),
}));

const router = require('../../routes/hostedRegistrationAdmin');

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); });
  server.use('/api/admin/hosted-registrations', router);
  return server;
}

describe('hosted registration admin routes', () => {
  test('lists pending registrations', async () => {
    const res = await request(app()).get('/api/admin/hosted-registrations');
    expect(res.status).toBe(200);
    expect(res.body.registrations[0].status).toBe('pending_approval');
  });

  test('approves with an explicit role', async () => {
    const res = await request(app()).post('/api/admin/hosted-registrations/req-1/approve')
      .send({ role: 'user' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  test('supports reject and disable actions', async () => {
    expect((await request(app()).post('/api/admin/hosted-registrations/req-1/reject')).status).toBe(200);
    expect((await request(app()).post('/api/admin/hosted-registrations/req-1/disable')).status).toBe(200);
  });
});
