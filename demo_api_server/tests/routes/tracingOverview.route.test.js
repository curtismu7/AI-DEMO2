'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios');
const axios = require('axios');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
}));
const configStore = require('../../services/configStore');

const tracingRouter = require('../../routes/tracing');

function makeApp() {
  const app = express();
  app.use('/api/health/tracing', tracingRouter);
  return app;
}

/** axios.get mock keyed by URL substring. */
function mockJaeger(handlers) {
  axios.get.mockImplementation((url) => {
    for (const [needle, responder] of handlers) {
      if (String(url).includes(needle)) return responder(url);
    }
    return Promise.reject(new Error(`unmocked url: ${url}`));
  });
}

const TRACE_A = { traceID: 'aaaaaaaaaaaaaaaa', processes: {}, spans: [] };
const TRACE_B = { traceID: 'bbbbbbbbbbbbbbbb', processes: {}, spans: [] };

afterEach(() => jest.resetAllMocks());
beforeEach(() => configStore.getEffective.mockImplementation(() => ''));

describe('GET /api/health/tracing/overview/raw', () => {
  test('fail-soft 200 {data:[]} when Jaeger is unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(makeApp()).get('/api/health/tracing/overview/raw');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  test('fail-soft 200 {data:[]} when ff_tracing flag is off', async () => {
    configStore.getEffective.mockImplementation((key) => (key === 'ff_tracing' ? 'false' : ''));
    const res = await request(makeApp()).get('/api/health/tracing/overview/raw');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
    expect(axios.get).not.toHaveBeenCalled();
  });

  // Note: axios.get is mocked at the function level — the mock only sees the
  // literal URL string (e.g. `${base}/api/traces`), never the serialized
  // `params` object a real request would carry. So handlers below can't
  // differentiate by `service=...`; every `/api/traces` call gets the same
  // response, matching the sibling `tracingGraph.route.test.js` overview
  // test's established pattern.
  test('gathers and dedupes traces across every returned service', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({
        status: 200, data: { data: ['demo-api-server', 'mcp-gateway'] },
      })],
      // Same response for both services' per-service call — 2 services x
      // 2 traces each = 4 raw entries, deduped by traceID down to 2.
      ['/api/traces', () => Promise.resolve({ status: 200, data: { data: [TRACE_A, TRACE_B] } })],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/overview/raw?lookback=1h');
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.traceID).sort()).toEqual(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
  });

  test('excludes jaeger-all-in-one from the per-service trace gather', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({
        status: 200, data: { data: ['demo-api-server', 'jaeger-all-in-one'] },
      })],
      ['/api/traces', () => Promise.resolve({ status: 200, data: { data: [TRACE_A] } })],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/overview/raw');
    expect(res.status).toBe(200);
    // One /api/traces call (demo-api-server) — jaeger-all-in-one filtered out
    // before the per-service Promise.all, so it's never queried.
    const tracesCalls = axios.get.mock.calls.filter(([url]) => String(url).includes('/api/traces')).length;
    expect(tracesCalls).toBe(1);
  });

  test('fail-soft 200 {data:[]} when the /api/services call itself throws', async () => {
    mockJaeger([
      ['/api/services', () => Promise.reject(new Error('boom'))],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/overview/raw');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });
});
