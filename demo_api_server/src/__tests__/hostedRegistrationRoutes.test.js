'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/hostedRegistrationService', () => ({
  createHostedRegistrationService: jest.fn(() => ({
    request: jest.fn(async ({ email }) => ({ requestId: 'req-1', status: 'otp_pending', email })),
    verify: jest.fn(async () => ({ id: 'req-1', status: 'pending_approval', email: 'alice@pingidentity.com' })),
    get: jest.fn(() => ({ id: 'req-1', status: 'pending_approval', updatedAt: 1000 })),
  })),
}));
jest.mock('../../services/emailService', () => ({
  sendHostedRegistrationAdminAlert: jest.fn(async () => {}),
  sendHostedRegistrationConfirmation: jest.fn(async () => {}),
}));

const router = require('../../routes/hostedRegistration');
const { sendHostedRegistrationConfirmation } = require('../../services/emailService');

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/auth/hosted-registration', router);
  return server;
}

describe('hosted registration routes', () => {
  test('accepts a request and returns an OTP-pending reference', async () => {
    const res = await request(app()).post('/api/auth/hosted-registration/request')
      .send({ email: 'alice@pingidentity.com', firstName: 'Alice' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ requestId: 'req-1', status: 'otp_pending', email: 'alice@pingidentity.com' });
  });

  test('verification advances the request and triggers the admin alert', async () => {
    const res = await request(app()).post('/api/auth/hosted-registration/verify')
      .send({ requestId: 'req-1', otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requestId: 'req-1', status: 'pending_approval' });
    expect(sendHostedRegistrationConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'req-1', status: 'pending_approval' }),
      { status: 'pending_approval' },
    );
  });

  test('status does not expose OTP or approval secrets', async () => {
    const res = await request(app()).get('/api/auth/hosted-registration/status?requestId=req-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requestId: 'req-1', status: 'pending_approval', updatedAt: 1000 });
  });
});
