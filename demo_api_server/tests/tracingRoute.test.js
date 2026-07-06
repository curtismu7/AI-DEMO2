'use strict';

jest.mock('axios');
const axios = require('axios');
const request = require('supertest');
const express = require('express');

const healthRoutes = require('../routes/health');

function buildApp() {
  const app = express();
  app.use('/api/health', healthRoutes);
  return app;
}

describe('GET /api/health/tracing/status', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns ok when Jaeger responds', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { data: ['demo-api-server'] } });
    const res = await request(buildApp()).get('/api/health/tracing/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.jaegerQueryUrl).toBeTruthy();
    expect(res.body.defaultService).toBe('demo-api-server');
  });

  test('returns ok:false when Jaeger is down', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(buildApp()).get('/api/health/tracing/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
});

describe('GET /api/health/tracing/traces', () => {
  beforeEach(() => jest.clearAllMocks());

  test('summarises trace list from Jaeger', async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/api/services')) {
        return Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } });
      }
      return Promise.resolve({
        status: 200,
        data: {
          data: [{
            traceID: 'abc123',
            spans: [
              { traceID: 'abc123', operationName: 'GET /api/healthz', startTime: 1000000, duration: 5000, references: [] },
              { traceID: 'abc123', operationName: 'middleware', startTime: 1001000, duration: 2000, references: [{ refType: 'CHILD_OF' }] },
            ],
          }],
        },
      });
    });
    const res = await request(buildApp()).get('/api/health/tracing/traces?service=demo-api-server');
    expect(res.status).toBe(200);
    expect(res.body.traces).toHaveLength(1);
    expect(res.body.traces[0].traceId).toBe('abc123');
    expect(res.body.traces[0].operation).toBe('GET /api/healthz');
    expect(res.body.traces[0].spanCount).toBe(2);
  });
});
