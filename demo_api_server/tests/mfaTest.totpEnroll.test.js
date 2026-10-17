'use strict';
/**
 * TOTP (authenticator app) enrollment: init returns the secret/keyUri for the
 * browser to show as a QR, complete activates the device with the first code.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({
  enrollTotpDevice: jest.fn(),
  activateTotpDevice: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({ authenticateToken: (req, _res, next) => next() }));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/apiCallTrackerService', () => ({ trackApiCall: jest.fn() }));
jest.mock('../services/pingOneUserLookupService', () => ({ fetchPingOneUserByUsername: jest.fn() }));

const mfaService = require('../services/mfaService');
const { trackApiCall } = require('../services/apiCallTrackerService');
const { mfaLogger } = require('../utils/mfaLogger');
const router = require('../routes/mfaTest');

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.session = {
    user: { oauthProvider: 'pingone', oauthId: 'p1-uuid', username: 'demoUser' },
    oauthTokens: { accessToken: 'tok' },
    save: (cb) => cb && cb(),
  };
  next();
});
app.use('/api/mfa/test', router);

beforeEach(() => jest.clearAllMocks());

test('init enrolls a TOTP device for the signed-in user and returns keyUri + secret', async () => {
  mfaService.enrollTotpDevice.mockResolvedValue({
    id: 'dev-1', status: 'ACTIVATION_REQUIRED', secret: 'JBSWY3DP', keyUri: 'otpauth://totp/x?secret=JBSWY3DP',
  });
  const res = await request(app).post('/api/mfa/test/integration/enroll-totp-init').send({}).expect(200);
  expect(mfaService.enrollTotpDevice).toHaveBeenCalledWith('p1-uuid');
  expect(res.body).toMatchObject({
    success: true, deviceId: 'dev-1', status: 'ACTIVATION_REQUIRED', secret: 'JBSWY3DP', keyUri: 'otpauth://totp/x?secret=JBSWY3DP',
  });
});

test('init never writes the secret to the MFA log or the API call tracker', async () => {
  const logSpy = jest.spyOn(mfaLogger, 'logApiCall').mockImplementation(() => {});
  const device = { id: 'dev-1', status: 'ACTIVATION_REQUIRED', secret: 'JBSWY3DP', keyUri: 'otpauth://totp/x?secret=JBSWY3DP' };
  mfaService.enrollTotpDevice.mockResolvedValue({ ...device, _debug: { request: { method: 'POST', url: 'u', body: { type: 'TOTP' } }, response: device } });
  const res = await request(app).post('/api/mfa/test/integration/enroll-totp-init').send({}).expect(200);
  expect(res.body.keyUri).toContain('JBSWY3DP');
  expect(logSpy).toHaveBeenCalled();
  expect(JSON.stringify(logSpy.mock.calls)).not.toContain('JBSWY3DP');
  expect(trackApiCall).toHaveBeenCalled();
  expect(JSON.stringify(trackApiCall.mock.calls)).not.toContain('JBSWY3DP');
  logSpy.mockRestore();
});

test('complete activates the device with the code', async () => {
  mfaService.activateTotpDevice.mockResolvedValue({ id: 'dev-1', status: 'ACTIVE' });
  const res = await request(app)
    .post('/api/mfa/test/integration/enroll-totp-complete')
    .send({ deviceId: 'dev-1', otp: '123456' })
    .expect(200);
  expect(mfaService.activateTotpDevice).toHaveBeenCalledWith('p1-uuid', 'dev-1', '123456');
  expect(res.body).toMatchObject({ success: true, deviceId: 'dev-1', status: 'ACTIVE' });
});

test('complete without otp is a 400 and never calls PingOne', async () => {
  await request(app)
    .post('/api/mfa/test/integration/enroll-totp-complete')
    .send({ deviceId: 'dev-1' })
    .expect(400);
  expect(mfaService.activateTotpDevice).not.toHaveBeenCalled();
});
