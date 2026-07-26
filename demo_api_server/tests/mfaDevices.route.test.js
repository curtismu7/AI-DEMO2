'use strict';
/**
 * GET /api/auth/mfa/devices contact masking.
 *
 * PingOne returns an SMS device's number as a bare E.164 string
 * ("phone": "+19725551234"), not { number }. Reading only `phone.number` left
 * maskedContact null for every SMS device, and since this route strips the raw
 * `phone` field from the response the UI had nothing to fall back on and
 * rendered "your phone" instead of the masked number.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({ listMfaDevices: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => next(),
}));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/posthog', () => ({ capture: jest.fn() }));
jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));

const mfaService = require('../services/mfaService');
const router = require('../routes/mfa');

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.session = { user: { oauthId: 'user-uuid' }, save: (cb) => cb && cb() };
  next();
});
app.use('/api/auth/mfa', router);

describe('GET /api/auth/mfa/devices — contact masking', () => {
  beforeEach(() => jest.clearAllMocks());

  test('masks an SMS device whose phone is a bare string (PingOne shape)', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ id: 'd1', type: 'SMS', phone: '+19725231586' }],
    });

    const res = await request(app).get('/api/auth/mfa/devices').expect(200);

    expect(res.body.devices[0].maskedContact).toBe('***-***-1586');
  });

  test('still masks the legacy { number } phone shape', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ id: 'd2', type: 'SMS', phone: { number: '+19725231586' } }],
    });

    const res = await request(app).get('/api/auth/mfa/devices').expect(200);

    expect(res.body.devices[0].maskedContact).toBe('***-***-1586');
  });

  test('masks an EMAIL device address', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ id: 'd3', type: 'EMAIL', email: 'cmuir@pingidentity.com' }],
    });

    const res = await request(app).get('/api/auth/mfa/devices').expect(200);

    expect(res.body.devices[0].maskedContact).toBe('c***r@pingidentity.com');
  });

  test('leaves maskedContact null when an SMS device carries no number', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ id: 'd4', type: 'SMS' }],
    });

    const res = await request(app).get('/api/auth/mfa/devices').expect(200);

    expect(res.body.devices[0].maskedContact).toBeNull();
  });

  test('never returns the raw phone or email to the client', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ id: 'd5', type: 'SMS', phone: '+19725231586' }],
    });

    const res = await request(app).get('/api/auth/mfa/devices').expect(200);

    expect(JSON.stringify(res.body)).not.toContain('9725231586');
  });
});
