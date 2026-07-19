'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios');
const axios = require('axios');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
}));

const tracingRouter = require('../../routes/tracing');

function makeApp() {
  const app = express();
  app.use('/api/health/tracing', tracingRouter);
  return app;
}

const TRACE = {
  traceID: 'a1b2c3d4e5f60718a1b2c3d4e5f60718',
  processes: { p1: { serviceName: 'agent-service' } },
  spans: [{
    traceID: 'a1b2c3d4e5f60718a1b2c3d4e5f60718', spanID: 's1', processID: 'p1',
    operationName: 'reasoning-step-1', startTime: 1_000_000, duration: 50_000,
    references: [], tags: [{ key: 'provider', value: 'llamacpp' }],
  }],
};
const JAEGER_OK = { status: 200, data: { data: [TRACE] } };
const SERVICES_OK = { status: 200, data: { data: ['agent-service'] } };

/** First axios.get call resolves service probe; later calls follow `responses` in order. */
function mockJaegerSequence(responses) {
  let i = 0;
  axios.get.mockImplementation((url) => {
    if (String(url).includes('/api/services')) return Promise.resolve(SERVICES_OK);
    const r = responses[Math.min(i++, responses.length - 1)];
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  });
}

afterEach(() => jest.resetAllMocks());

describe('GET /traces/:id/projected', () => {
  test('projects a found trace', async () => {
    mockJaegerSequence([JAEGER_OK]);
    const res = await request(makeApp()).get(`/api/health/tracing/traces/${TRACE.traceID}/projected`);
    expect(res.status).toBe(200);
    expect(res.body.traceId).toBe(TRACE.traceID);
    expect(res.body.spans.find((s) => s.id === 'agent_reasoning')).toBeDefined();
  });

  test('retries 404 then succeeds', async () => {
    const notFound = new Error('404'); notFound.response = { status: 404 };
    mockJaegerSequence([notFound, JAEGER_OK]);
    const res = await request(makeApp()).get(`/api/health/tracing/traces/${TRACE.traceID}/projected?retryDelaysMs=0`);
    expect(res.status).toBe(200);
    expect(res.body.spans.length).toBeGreaterThan(0);
  });

  test('404 after retries exhausted', async () => {
    const notFound = new Error('404'); notFound.response = { status: 404 };
    mockJaegerSequence([notFound, notFound, notFound, notFound]);
    const res = await request(makeApp()).get(`/api/health/tracing/traces/${TRACE.traceID}/projected?retryDelaysMs=0`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('trace_not_found');
  });

  test('rejects malformed id', async () => {
    const res = await request(makeApp()).get('/api/health/tracing/traces/nothex/projected');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_trace_id');
  });
});

describe('GET /traces/:id/raw', () => {
  test('passes the Jaeger payload through untouched', async () => {
    mockJaegerSequence([JAEGER_OK]);
    const res = await request(makeApp()).get(`/api/health/tracing/traces/${TRACE.traceID}/raw`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [TRACE] });
  });

  test('404 maps to trace_not_found without retry', async () => {
    const notFound = new Error('404'); notFound.response = { status: 404 };
    mockJaegerSequence([notFound, JAEGER_OK]);   // second response must never be reached
    const res = await request(makeApp()).get(`/api/health/tracing/traces/${TRACE.traceID}/raw`);
    expect(res.status).toBe(404);
  });
});
