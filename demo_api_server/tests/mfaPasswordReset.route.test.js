'use strict';
/** POST /api/auth/mfa/password-reset — MFA-gated worker-token password set. */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({}));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => next(),
}));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/posthog', () => ({ capture: jest.fn() }));
jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../services/pingOneUserService', () => ({ setUserPassword: jest.fn() }));

const pingOneUserService = require('../services/pingOneUserService');
const router = require('../routes/mfa');

let session;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.session = session; next(); });
app.use('/api/auth/mfa', router);

describe('POST /api/auth/mfa/password-reset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    session = { user: { oauthId: 'p1-uuid' } };
  });

  test('refuses without a fresh MFA step-up', async () => {
    await request(app).post('/api/auth/mfa/password-reset').send({ newPassword: 'Str0ng!Pass' }).expect(403);
    expect(pingOneUserService.setUserPassword).not.toHaveBeenCalled();
  });

  test('sets the password after MFA, and the step-up is single-use', async () => {
    session.stepUpVerified = Date.now() + 60000;
    pingOneUserService.setUserPassword.mockResolvedValue();
    await request(app).post('/api/auth/mfa/password-reset').send({ newPassword: 'Str0ng!Pass' }).expect(200);
    expect(pingOneUserService.setUserPassword).toHaveBeenCalledWith('p1-uuid', 'Str0ng!Pass');
    expect(session.user).toBeTruthy();
    await request(app).post('/api/auth/mfa/password-reset').send({ newPassword: 'Str0ng!Pass' }).expect(403);
  });

  test('requires a new password', async () => {
    session.stepUpVerified = Date.now() + 60000;
    await request(app).post('/api/auth/mfa/password-reset').send({}).expect(400);
  });
});
