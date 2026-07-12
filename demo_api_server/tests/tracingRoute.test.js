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

describe('GET /api/health/tracing/traces/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  const traceFixture = {
    data: [{
      traceID: 'aa58608e90e7be4872a3ae9085509cce',
      spans: [
        { spanID: 'root', operationName: 'GET /api/x', startTime: 1000000, duration: 5000, references: [], processID: 'p1' },
        { spanID: 'child', operationName: 'middleware', startTime: 1001000, duration: 2000, references: [{ refType: 'CHILD_OF', spanID: 'root' }], processID: 'p1' },
      ],
      processes: { p1: { serviceName: 'demo-api-server' } },
    }],
  };

  test('returns normalised span tree on success', async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/api/services')) return Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } });
      return Promise.resolve({ status: 200, data: traceFixture });
    });
    const res = await request(buildApp()).get('/api/health/tracing/traces/aa58608e90e7be4872a3ae9085509cce');
    expect(res.status).toBe(200);
    expect(res.body.traceId).toBe('aa58608e90e7be4872a3ae9085509cce');
    expect(res.body.spans).toHaveLength(2);
    expect(res.body.spans[0]).toMatchObject({ spanID: 'root', parentSpanID: null, depth: 0, serviceName: 'demo-api-server' });
    expect(res.body.spans[1]).toMatchObject({ spanID: 'child', parentSpanID: 'root', depth: 1, relativeStartMs: 1 });
    expect(res.body.durationMs).toBe(5);
    expect(res.body.serviceColors).toHaveProperty('demo-api-server');
  });

  test('rejects a non-hex trace id with 400', async () => {
    const res = await request(buildApp()).get('/api/health/tracing/traces/not-a-hex-id');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_trace_id');
  });

  test('maps Jaeger empty result to 404', async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/api/services')) return Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } });
      return Promise.resolve({ status: 200, data: { data: [] } });
    });
    const res = await request(buildApp()).get('/api/health/tracing/traces/aa58608e90e7be4872a3ae9085509cce');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('trace_not_found');
  });

  test('maps a query error to 502', async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/api/services')) return Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } });
      return Promise.reject(new Error('socket hang up'));
    });
    const res = await request(buildApp()).get('/api/health/tracing/traces/aa58608e90e7be4872a3ae9085509cce');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('jaeger_query_failed');
  });
});
