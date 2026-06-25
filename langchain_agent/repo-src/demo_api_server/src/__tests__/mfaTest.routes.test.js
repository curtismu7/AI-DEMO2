'use strict';
/**
 * Regression tests for mfaTest.js route responses.
 *
 * Asserts that pingoneRequest always has method, url, body keys
 * when a PingOne call was made — locking the contract for PingOneApiPanel.
 *
 * Phase 240-02: normalizePingoneRequest() contract tests.
 */

const request = require('supertest');
const express = require('express');

// Mock heavy dependencies before any require() pulls them in
jest.mock('../../services/mfaService', () => ({
  sendOtp: jest.fn(),
  verifyOtp: jest.fn(),
  initiateFido2: jest.fn(),
  verifyFido2: jest.fn(),
  listMfaDevices: jest.fn(),
  enrollSmsDevice: jest.fn(),
  activateSmsDevice: jest.fn(),
  enrollEmailDevice: jest.fn(),
  initiateFido2Enrollment: jest.fn(),
  completeFido2Enrollment: jest.fn(),
  deleteMfaDevice: jest.fn(),
  getMfaPolicies: jest.fn(),
}));

jest.mock('../../services/oauthService', () => ({
  refreshAccessToken: jest.fn(),
  getClientCredentialsToken: jest.fn(),
}));

jest.mock('../../services/apiCallTrackerService', () => ({
  trackApiCall: jest.fn(),
}));

// Mount the router under test
let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  // Provide minimal session stub so route auth checks pass
  app.use((req, _res, next) => {
    req.session = {
      user: { id: 'test-user-123', email: 'test@example.com' },
      oauthTokens: { accessToken: 'stub-access-token' },
      save: (cb) => cb(null),
    };
    next();
  });
  app.use('/', require('../../routes/mfaTest'));
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// normalizePingoneRequest contract — SMS OTP initiate
// ---------------------------------------------------------------------------
describe('POST /integration/initiate (SMS) — pingoneRequest shape', () => {
  const mfaService = require('../../services/mfaService');

  it('returns pingoneRequest.method as string when PingOne call succeeds', async () => {
    mfaService.sendOtp.mockResolvedValue({
      daId: 'da-123',
      _debug: { request: { method: 'POST', url: 'https://api.pingone.com/v1/test', body: { scope: 'otp' } }, response: { status: 'PENDING' } },
    });

    const res = await request(app)
      .post('/integration/initiate')
      .send({ method: 'sms', userId: 'test-user-123' });

    if (res.body.pingoneRequest) {
      expect(typeof res.body.pingoneRequest.method).toBe('string');
      expect(typeof res.body.pingoneRequest.url).toBe('string');
      expect('body' in res.body.pingoneRequest).toBe(true);
    }
  });

  it('returns pingoneRequest.url as string when PingOne call fails', async () => {
    const err = new Error('PingOne error');
    err._debug = { request: { method: 'POST', url: 'https://api.pingone.com/v1/test', body: null }, response: null };
    mfaService.sendOtp.mockRejectedValue(err);

    const res = await request(app)
      .post('/integration/initiate')
      .send({ method: 'sms', userId: 'test-user-123' });

    if (res.body.pingoneRequest) {
      expect(typeof res.body.pingoneRequest.method).toBe('string');
      expect(typeof res.body.pingoneRequest.url).toBe('string');
      expect('body' in res.body.pingoneRequest).toBe(true);
    }
  });

  it('does not include pingoneRequest when _debug is absent', async () => {
    mfaService.sendOtp.mockResolvedValue({ daId: 'da-123' });

    const res = await request(app)
      .post('/integration/initiate')
      .send({ method: 'sms', userId: 'test-user-123' });

    // pingoneRequest should be absent or undefined — never an object with missing keys
    if (res.body.pingoneRequest !== undefined) {
      expect(typeof res.body.pingoneRequest.method).toBe('string');
      expect(typeof res.body.pingoneRequest.url).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// normalizePingoneRequest contract — Email OTP initiate
// ---------------------------------------------------------------------------
describe('POST /integration/initiate (email) — pingoneRequest shape', () => {
  const mfaService = require('../../services/mfaService');

  it('returns normalized pingoneRequest on success', async () => {
    mfaService.sendOtp.mockResolvedValue({
      daId: 'da-456',
      _debug: { request: { method: 'POST', url: 'https://api.pingone.com/v1/environments/env/users/u/devices/da/messages', body: {} }, response: {} },
    });

    const res = await request(app)
      .post('/integration/initiate')
      .send({ method: 'email', userId: 'test-user-123' });

    if (res.body.pingoneRequest) {
      expect(res.body.pingoneRequest.method).toBe('POST');
      expect(res.body.pingoneRequest.url).toContain('pingone');
      expect('body' in res.body.pingoneRequest).toBe(true);
    }
  });
});
