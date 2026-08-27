'use strict';

jest.mock('../services/controlPlaneOverview', () => ({ buildOverview: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  optionalAuthenticateToken: (req, _res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const controlPlaneOverview = require('../services/controlPlaneOverview');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/control-plane', require('../routes/controlPlane'));
  return a;
}

beforeEach(() => jest.clearAllMocks());

test('returns the overview', async () => {
  controlPlaneOverview.buildOverview.mockResolvedValue({
    generatedAt: '2026-08-27T12:00:00.000Z', sources: {}, zones: {},
    enforcement: [], findings: [], declared: [],
  });

  const res = await request(app()).get('/api/control-plane/overview');

  expect(res.status).toBe(200);
  expect(res.body.generatedAt).toBe('2026-08-27T12:00:00.000Z');
});

test('passes the request through, because the roster is session-scoped', async () => {
  controlPlaneOverview.buildOverview.mockResolvedValue({ zones: {}, findings: [], declared: [] });

  await request(app()).get('/api/control-plane/overview');

  expect(controlPlaneOverview.buildOverview).toHaveBeenCalledWith(expect.objectContaining({ user: { id: 'u1' } }));
});

test('500s with { error } — never { message } — if assembly itself throws', async () => {
  controlPlaneOverview.buildOverview.mockRejectedValue(new Error('boom'));

  const res = await request(app()).get('/api/control-plane/overview');

  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: 'overview_unavailable' });
});
