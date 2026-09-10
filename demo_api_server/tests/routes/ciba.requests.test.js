'use strict';

// GET /api/auth/ciba/requests — new read-only enumeration of a session's
// tracked CIBA requests (Agentic Access Console CIBA tab). Must not mutate
// req.session.cibaRequests or change any initiate/poll/status behavior —
// this suite only exercises the new route.

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { sub: 'u-1' }; next(); },
}));

const cibaRoutes = require('../../routes/ciba');

function buildApp(cibaRequests) {
  const app = express();
  app.use((req, _res, next) => {
    req.session = { cibaRequests };
    next();
  });
  app.use('/api/auth/ciba', cibaRoutes);
  return app;
}

describe('GET /api/auth/ciba/requests', () => {
  test('empty session → empty list', async () => {
    const res = await request(buildApp({})).get('/api/auth/ciba/requests');
    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([]);
  });

  test('maps pending / approved / expired / denied statuses without mutating the session', async () => {
    const now = Date.now();
    const cibaRequests = {
      'req-pending': { initiatedAt: now, expiresAt: now + 60000, amount: 100, binding_message: 'Approve $100?', simulated: true },
      'req-approved': { initiatedAt: now - 1000, expiresAt: now + 60000, pollOutcome: 'approved', amount: 200, simulated: false },
      'req-expired': { initiatedAt: now - 120000, expiresAt: now - 1000, amount: 300, simulated: true },
      'req-denied': { initiatedAt: now - 500, expiresAt: now + 60000, deniedByUser: true, amount: 50, simulated: true },
    };
    const snapshot = JSON.parse(JSON.stringify(cibaRequests));

    const res = await request(buildApp(cibaRequests)).get('/api/auth/ciba/requests');
    expect(res.status).toBe(200);

    const byId = Object.fromEntries(res.body.requests.map((r) => [r.authReqId, r]));
    expect(byId['req-pending'].status).toBe('pending');
    expect(byId['req-pending'].engine).toBe('simulated');
    expect(byId['req-approved'].status).toBe('approved');
    expect(byId['req-approved'].engine).toBe('pingone');
    expect(byId['req-expired'].status).toBe('expired');
    expect(byId['req-denied'].status).toBe('denied');

    // Read-only — the underlying structure must be untouched.
    expect(cibaRequests).toEqual(snapshot);
  });
});
