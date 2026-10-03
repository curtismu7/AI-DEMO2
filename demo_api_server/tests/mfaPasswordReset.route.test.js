'use strict';
/** Forgot-password without sign-in: MFA on the worker token, then a worker-token password set. */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({
  initiateDeviceAuth: jest.fn(),
  submitOtp: jest.fn(),
}));
// Signed-out callers are rejected by the real guard; mirror that.
jest.mock('../middleware/auth', () => ({
  authenticateToken: (_req, res) => res.status(401).json({ error: 'unauthorized' }),
}));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/posthog', () => ({ capture: jest.fn() }));
jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../services/pingOneUserService', () => ({ setUserPassword: jest.fn() }));
jest.mock('../services/pingOneUserLookupService', () => ({ fetchPingOneUserByUsername: jest.fn() }));

const mfaService = require('../services/mfaService');
const pingOneUserService = require('../services/pingOneUserService');
const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');
const router = require('../routes/mfa');

let session;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.session = session; session.save = (cb) => cb && cb(); next(); });
app.use('/api/auth/mfa', router);

const start = () => request(app).post('/api/auth/mfa/forgot-password/start').send({ username: 'jdoe' });
const complete = () => request(app).post('/api/auth/mfa/forgot-password/complete').send({ newPassword: 'Str0ng!Pass' });

describe('forgot password (no sign-in)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    session = {};
    fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'p1-uuid' } });
    mfaService.initiateDeviceAuth.mockResolvedValue({ id: 'da-1', status: 'DEVICE_SELECTION_REQUIRED', _embedded: { devices: [] } });
  });

  test('unknown username starts nothing', async () => {
    fetchPingOneUserByUsername.mockResolvedValue({ user: null });
    await start().expect(404);
    expect(mfaService.initiateDeviceAuth).not.toHaveBeenCalled();
  });

  test('refuses to set a password before MFA completes', async () => {
    await start().expect(200);
    await complete().expect(403);
    expect(pingOneUserService.setUserPassword).not.toHaveBeenCalled();
  });

  test('MFA completes, password is set once, and a wrong challenge id is rejected', async () => {
    await start().expect(200);
    mfaService.submitOtp.mockResolvedValue({ status: 'COMPLETED' });
    await request(app).put('/api/auth/mfa/challenge/other-da').send({ deviceId: 'd', otp: '111111' }).expect(401);
    await request(app).put('/api/auth/mfa/challenge/da-1').send({ deviceId: 'd', otp: '111111' }).expect(200);
    expect(session.stepUpVerified).toBeUndefined();
    await complete().expect(200);
    expect(pingOneUserService.setUserPassword).toHaveBeenCalledWith('p1-uuid', 'Str0ng!Pass');
    await complete().expect(403);
  });

  test('the 123123 demo OTP does not pass a reset challenge', async () => {
    await start().expect(200);
    mfaService.submitOtp.mockResolvedValue({ status: 'OTP_REQUIRED' });
    await request(app).put('/api/auth/mfa/challenge/da-1').send({ deviceId: 'd', otp: '123123' }).expect(200);
    expect(mfaService.submitOtp).toHaveBeenCalled();
    await complete().expect(403);
  });
});
