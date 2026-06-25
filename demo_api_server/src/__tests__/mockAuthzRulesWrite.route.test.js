'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios');
jest.mock('../../middleware/auth');

const axios = require('axios');
const { authenticateToken } = require('../../middleware/auth');
const authorizeRouter = require('../../routes/authorize');

function buildApp({ user = { id: 'u1', role: 'admin' } } = {}) {
  const app = express();
  app.use(express.json());
  authenticateToken.mockImplementation((req, res, next) => {
    if (user === null) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  });
  app.use('/api/authorize', authorizeRouter);
  return app;
}

afterEach(() => jest.clearAllMocks());

test('PUT /mock-authz-rules → any authenticated (non-admin) user can write', async () => {
  axios.put.mockResolvedValue({ data: { ok: true, editable: {} } });
  const app = buildApp({ user: { id: 'u2', role: 'customer' } });
  const r = await request(app).put('/api/authorize/mock-authz-rules').send({ global: { hitlThresholdUsd: 5 } });
  expect(r.status).toBe(200);
  expect(axios.put).toHaveBeenCalled();
});

test('PUT /mock-authz-rules → 401 when unauthenticated', async () => {
  const app = buildApp({ user: null });
  const r = await request(app).put('/api/authorize/mock-authz-rules').send({ global: { hitlThresholdUsd: 5 } });
  expect(r.status).toBe(401);
  expect(axios.put).not.toHaveBeenCalled();
});

test('PUT /mock-authz-rules → admin proxies to authz server and relays body', async () => {
  axios.put.mockResolvedValue({ data: { ok: true, editable: { global: { hitlThresholdUsd: { value: 5 } } } } });
  const app = buildApp();
  const r = await request(app).put('/api/authorize/mock-authz-rules').send({ global: { hitlThresholdUsd: 5 } });
  expect(r.status).toBe(200);
  expect(r.body.editable.global.hitlThresholdUsd.value).toBe(5);
  expect(axios.put).toHaveBeenCalledWith(
    expect.stringContaining('/rules'),
    { global: { hitlThresholdUsd: 5 } },
    expect.objectContaining({ timeout: expect.any(Number) }),
  );
});

test('POST /mock-authz-rules/reset → admin proxies reset', async () => {
  axios.post.mockResolvedValue({ data: { ok: true, editable: {} } });
  const app = buildApp();
  const r = await request(app).post('/api/authorize/mock-authz-rules/reset').send();
  expect(r.status).toBe(200);
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/rules/reset'), {}, expect.any(Object));
});

test('PUT relays 400 validation error from authz server', async () => {
  axios.put.mockRejectedValue({ response: { status: 400, data: { error: 'hitlThresholdUsd must be a finite number >= 0' } } });
  const app = buildApp();
  const r = await request(app).put('/api/authorize/mock-authz-rules').send({ global: { hitlThresholdUsd: -1 } });
  expect(r.status).toBe(400);
  expect(r.body.error).toMatch(/hitlThresholdUsd/);
});

test('PUT returns 503 when authz server is down', async () => {
  axios.put.mockRejectedValue({ code: 'ECONNREFUSED' });
  const app = buildApp();
  const r = await request(app).put('/api/authorize/mock-authz-rules').send({ global: { hitlThresholdUsd: 5 } });
  expect(r.status).toBe(503);
  expect(r.body.error).toBe('authz_server_unavailable');
});
