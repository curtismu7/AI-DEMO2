'use strict';

jest.mock('../services/controlPlaneOverview', () => ({ buildOverview: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  optionalAuthenticateToken: (req, _res, next) => next(),
}));

const express = require('express');
const request = require('supertest');

function loadApp() {
  const a = express();
  a.use(express.json());
  // Both requires must happen in the SAME module-registry generation.
  // setup.js:98 calls jest.resetModules() in a global afterEach, so a handle
  // taken at module scope goes stale after test 1 and the assertions then read
  // a different mock instance from the one the router holds.
  a.use('/api/control-plane', require('../routes/controlPlane'));
  return { app: a, overview: require('../services/controlPlaneOverview') };
}

beforeEach(() => jest.clearAllMocks());

test('returns the overview', async () => {
  const { app, overview } = loadApp();
  overview.buildOverview.mockResolvedValue({
    generatedAt: '2026-08-27T12:00:00.000Z', sources: {}, zones: {},
    enforcement: [], findings: [], declared: [],
  });

  const res = await request(app).get('/api/control-plane/overview');

  expect(res.status).toBe(200);
  expect(res.body.generatedAt).toBe('2026-08-27T12:00:00.000Z');
});

test('passes the request through, because the roster is session-scoped', async () => {
  const { app, overview } = loadApp();
  overview.buildOverview.mockResolvedValue({ zones: {}, findings: [], declared: [] });

  await request(app).get('/api/control-plane/overview');

  expect(overview.buildOverview).toHaveBeenCalledWith(expect.objectContaining({ user: { id: 'u1' } }));
});

test('500s with { error } — never { message } — if assembly itself throws', async () => {
  const { app, overview } = loadApp();
  overview.buildOverview.mockRejectedValue(new Error('boom'));

  const res = await request(app).get('/api/control-plane/overview');

  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: 'overview_unavailable' });
});
