/**
 * POST /api/self-service/users — registration device enrollment + email rules.
 * Registration must enroll BOTH an email and an SMS MFA device (passwordless
 * robustness), reject off-domain / plus-addressed emails, and require a phone.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  searchUsers: jest.fn().mockResolvedValue({ _embedded: { users: [] } }),
  createPingOneUser: jest.fn().mockResolvedValue({
    id: 'u-1', email: 'new.user@pingidentity.com', username: 'newuser',
    name: 'New User', enabled: true, createdAt: '2026-10-10T00:00:00Z',
  }),
  ensureAdminRoleAssignments: jest.fn().mockResolvedValue([]),
}));
jest.mock('../services/mfaService', () => ({
  ensureEmailDevice: jest.fn().mockResolvedValue({ status: 'created', deviceId: 'd-e' }),
  ensureSmsDevice: jest.fn().mockResolvedValue({ status: 'created', deviceId: 'd-s' }),
}));
jest.mock('../utils/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), logErrorHandling: jest.fn() };
  return { logger, LOG_CATEGORIES: { USER_MANAGEMENT: 'user_management' } };
});

const router = require('../routes/selfServiceUsers');
const mfaService = require('../services/mfaService');
const { oauthErrorHandler } = require('../middleware/oauthErrorHandler');

const app = express();
app.use(express.json());
app.use('/api/self-service/users', router);
app.use(oauthErrorHandler);

// NANP-valid (a 555 exchange is rejected by the phone validator as fictional).
const validBody = () => ({
  email: 'new.user@pingidentity.com',
  username: 'newuser',
  firstName: 'New',
  lastName: 'User',
  password: 'Password1',
  phone: '+12065551234',
});

describe('POST /api/self-service/users — registration device + email rules', () => {
  test('enrolls BOTH an email and an SMS device for a valid registration', async () => {
    const res = await request(app).post('/api/self-service/users').send(validBody());
    expect(res.status).toBe(201);
    expect(res.body.mfaEmailDevice).toEqual({ status: 'created', deviceId: 'd-e' });
    expect(res.body.mfaSmsDevice).toEqual({ status: 'created', deviceId: 'd-s' });
    expect(mfaService.ensureSmsDevice).toHaveBeenCalledWith('u-1', '+12065551234');
  });

  test.each([
    'user+p1@pingone.com',
    'someone@gmail.com',
    'odd@notping.dev',
  ])('rejects email %s (plus-addressed or off-domain)', async (bad) => {
    const res = await request(app).post('/api/self-service/users').send({ ...validBody(), email: bad });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/pingidentity\.com|pingone\.com/);
  });

  test('phone is required', async () => {
    const { phone: _omit, ...noPhone } = validBody();
    const res = await request(app).post('/api/self-service/users').send(noPhone);
    expect(res.status).toBe(400);
  });

  test('a display-formatted phone is normalized to E.164 for the SMS device', async () => {
    const res = await request(app).post('/api/self-service/users')
      .send({ ...validBody(), phone: '+1 (206) 555-1234' });
    expect(res.status).toBe(201);
    expect(mfaService.ensureSmsDevice).toHaveBeenCalledWith('u-1', '+12065551234');
  });

  test('SMS enrollment failure does not fail registration', async () => {
    mfaService.ensureSmsDevice.mockRejectedValueOnce(new Error('pingone 503'));
    const res = await request(app).post('/api/self-service/users').send(validBody());
    expect(res.status).toBe(201);
    expect(res.body.mfaSmsDevice.status).toBe('failed');
  });
});
