'use strict';
/**
 * Regression: /api/mfa/test was reachable with zero credentials.
 *
 * The router's only gate was `NODE_ENV === 'production'`, which never fires
 * in this deployment (docker-compose.yml / k8s pin NODE_ENV=development), so
 * every route — including enrollment endpoints that accept a client-supplied
 * `userId` override and mint a worker token to act on it
 * (_resolveCredentialsForEnrollment) — was reachable by an anonymous caller.
 * Live-verified: an unauthenticated POST to enroll-sms-init made the BFF call
 * PingOne's real Management API `.../users/<attacker-supplied-id>/devices`
 * with a real worker bearer token.
 *
 * Fix: require authenticateToken at the router level, matching the
 * production twin routes/mfa.js.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({ getWorkerToken: jest.fn() }));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/apiCallTrackerService', () => ({ track: jest.fn() }));
jest.mock('../utils/mfaLogger', () => ({ mfaLogger: { logOperation: jest.fn() } }));
jest.mock('../middleware/auth', () => ({
  // Mirrors the real middleware's contract: no session → 401, never reaching
  // the route handler.
  authenticateToken: (req, res, next) => {
    if (req.session?.user) return next();
    return res.status(401).json({ error: 'unauthorized' });
  },
}));

const mfaService = require('../services/mfaService');
const router = require('../routes/mfaTest');

function buildApp({ signedIn }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (signedIn) req.session = { user: { oauthId: 'user-uuid' }, save: (cb) => cb && cb() };
    next();
  });
  app.use('/api/mfa/test', router);
  return app;
}

describe('mfaTest.js — auth gate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('an anonymous caller cannot reach enroll-sms-init with a victim userId override', async () => {
    const app = buildApp({ signedIn: false });

    const res = await request(app)
      .post('/api/mfa/test/integration/enroll-sms-init')
      .send({ userId: 'victim-uuid', phone: '+12025551234' });

    expect(res.status).toBe(401);
    expect(mfaService.getWorkerToken).not.toHaveBeenCalled();
  });

  test('an anonymous caller cannot reach any other integration route either', async () => {
    const app = buildApp({ signedIn: false });

    const res = await request(app).get('/api/mfa/test/integration/devices');

    expect(res.status).toBe(401);
  });

  test('a signed-in caller still reaches the route handler (no functional regression)', async () => {
    const app = buildApp({ signedIn: true });

    const res = await request(app).get('/api/mfa/test/config');

    expect(res.status).not.toBe(401);
  });
});
