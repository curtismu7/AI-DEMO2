// demo_api_server/tests/lighthouseRoute.regression.test.js
'use strict';

jest.mock('../services/lighthouseService', () => ({
  runLighthouseAudit: jest.fn(),
  getHistory: jest.fn(),
  isRunning: false,
}));

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const lighthouseRoute = require('../routes/lighthouseRoute');
const lighthouseService = require('../services/lighthouseService');

function buildApp({ sessionUser } = {}) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (sessionUser) {
      req.session.user = sessionUser;
      req.user = sessionUser; // set by authenticateToken in production; required for requireAdmin
    }
    next();
  });
  app.use('/api/admin/lighthouse', lighthouseRoute);
  return app;
}

const ADMIN_USER = { id: 'u1', role: 'admin', sub: 'u1' };
const CUSTOMER_USER = { id: 'u2', role: 'customer', sub: 'u2' };

const MOCK_RESULT = {
  timestamp: '2026-05-27T00:00:00.000Z',
  scores: { performance: 91, accessibility: 96, bestPractices: 78, seo: 48 },
  metrics: { fcp: 0.9, lcp: 1.2, tbt: 20, cls: 0, si: 2.4 },
};

describe('POST /api/admin/lighthouse/run', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 when not logged in', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(401);
  });

  test('returns 403 when logged in as customer', async () => {
    const app = buildApp({ sessionUser: CUSTOMER_USER });
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(403);
  });

  test('returns 429 when audit already in progress', async () => {
    lighthouseService.isRunning = true;
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(429);
    lighthouseService.isRunning = false;
  });

  test('returns 200 with result on success', async () => {
    lighthouseService.runLighthouseAudit.mockResolvedValue(MOCK_RESULT);
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: MOCK_RESULT });
  });

  test('returns 503 when Chrome unavailable', async () => {
    const err = new Error('Chrome not found');
    err.code = 'CHROME_NOT_FOUND';
    lighthouseService.runLighthouseAudit.mockRejectedValue(err);
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(503);
  });

  test('returns 504 on timeout', async () => {
    const err = new Error('Audit timed out');
    err.code = 'LIGHTHOUSE_TIMEOUT';
    lighthouseService.runLighthouseAudit.mockRejectedValue(err);
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).post('/api/admin/lighthouse/run');
    expect(res.status).toBe(504);
  });
});

describe('GET /api/admin/lighthouse/history', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 401 when not logged in', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/admin/lighthouse/history');
    expect(res.status).toBe(401);
  });

  test('returns 403 when logged in as customer', async () => {
    const app = buildApp({ sessionUser: CUSTOMER_USER });
    const res = await request(app).get('/api/admin/lighthouse/history');
    expect(res.status).toBe(403);
  });

  test('returns 200 with history array', async () => {
    lighthouseService.getHistory.mockReturnValue([MOCK_RESULT]);
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).get('/api/admin/lighthouse/history');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ history: [MOCK_RESULT] });
  });

  test('returns empty array when no history', async () => {
    lighthouseService.getHistory.mockReturnValue([]);
    const app = buildApp({ sessionUser: ADMIN_USER });
    const res = await request(app).get('/api/admin/lighthouse/history');
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(0);
  });
});
