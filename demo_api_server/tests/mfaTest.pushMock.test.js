'use strict';
// Simulated push phone for /mfa-test step-up: session-scoped, never calls PingOne,
// grants nothing. start -> pending with a number to match; decision -> approved/denied.

const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({ authenticateToken: (req, _res, next) => next() }));
jest.mock('../services/mfaService', () => ({}));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/apiCallTrackerService', () => ({ trackApiCall: jest.fn() }));

const router = require('../routes/mfaTest');

function appWith(session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/api/mfa/test', router);
  return app;
}

test('start -> pending with a 2-digit number; approve -> the next poll reports approved once, then nothing is pending', async () => {
  const session = { user: { username: 'demouser' }, save: (cb) => cb && cb() };
  const app = appWith(session);
  const s = await request(app).post('/api/mfa/test/push-mock/start').expect(200);
  expect(s.body.state).toBe('pending');
  expect(s.body.numberToMatch).toMatch(/^\d{2}$/);
  expect(s.body.username).toBe('demouser');
  expect((await request(app).get('/api/mfa/test/push-mock/status').expect(200)).body.state).toBe('pending');
  expect((await request(app).post('/api/mfa/test/push-mock/decision').send({ decision: 'approve' }).expect(200)).body.state).toBe('approved');
  // The page learns the answer from its next poll (like a real push), once; then nothing is pending.
  expect((await request(app).get('/api/mfa/test/push-mock/status').expect(200)).body.state).toBe('approved');
  expect((await request(app).get('/api/mfa/test/push-mock/status').expect(409)).body.error).toBe('nothing_pending');
  expect(session.stepUpVerified).toBeUndefined();
});

test('deny -> denied', async () => {
  const app = appWith({ user: { username: 'demouser' }, save: (cb) => cb && cb() });
  await request(app).post('/api/mfa/test/push-mock/start').expect(200);
  expect((await request(app).post('/api/mfa/test/push-mock/decision').send({ decision: 'deny' }).expect(200)).body.state).toBe('denied');
});

test('an unanswered request expires', async () => {
  const session = { user: { username: 'demouser' }, save: (cb) => cb && cb() };
  const app = appWith(session);
  await request(app).post('/api/mfa/test/push-mock/start').expect(200);
  session.mockPushPhone.expiresAt = Date.now() - 1;
  expect((await request(app).get('/api/mfa/test/push-mock/status').expect(200)).body.state).toBe('expired');
});

test('bad decision -> 400; no session user -> 401', async () => {
  const app = appWith({ user: { username: 'demouser' }, save: (cb) => cb && cb() });
  await request(app).post('/api/mfa/test/push-mock/start').expect(200);
  await request(app).post('/api/mfa/test/push-mock/decision').send({ decision: 'maybe' }).expect(400);
  await request(appWith({ save: (cb) => cb && cb() })).post('/api/mfa/test/push-mock/start').expect(401);
});
