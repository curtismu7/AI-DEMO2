'use strict';
/**
 * GET/POST /api/auth/mfa/ensure-fido2-rp are admin-only, gated on the SESSION
 * user's role (req.session.user), not req.user. Pins the exact non-admin
 * response so the gate can move between an inline check and a named guard
 * without changing what a caller sees.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({
  ensureFido2RelyingParty: jest.fn(),
  resolveRelyingPartyId: () => 'local.test',
}));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => next(),
}));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/posthog', () => ({ capture: jest.fn() }));
jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));

const mfaService = require('../services/mfaService');
const router = require('../routes/mfa');

function appWithSessionUser(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user, save: (cb) => cb && cb() };
    next();
  });
  app.use('/api/auth/mfa', router);
  return app;
}

const DENIED = { error: 'admin_required', message: 'Admin session required.' };

describe.each(['get', 'post'])('%s /api/auth/mfa/ensure-fido2-rp admin gate', (verb) => {
  beforeEach(() => jest.clearAllMocks());

  test('a non-admin session gets 403 and the service is never called', async () => {
    const res = await request(appWithSessionUser({ role: 'customer' }))[verb]('/api/auth/mfa/ensure-fido2-rp');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(DENIED);
    expect(mfaService.ensureFido2RelyingParty).not.toHaveBeenCalled();
  });

  test('a session with no user gets the same 403', async () => {
    const res = await request(appWithSessionUser(undefined))[verb]('/api/auth/mfa/ensure-fido2-rp');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(DENIED);
  });

  test('an admin session reaches the handler', async () => {
    mfaService.ensureFido2RelyingParty.mockResolvedValue({ ok: true });
    const res = await request(appWithSessionUser({ role: 'admin' }))[verb]('/api/auth/mfa/ensure-fido2-rp');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
