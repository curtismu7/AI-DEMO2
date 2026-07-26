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

const TRACE = {
  traceID: 'a1b2c3d4e5f60718',
  processes: { p1: { serviceName: 'demo-api-server' }, p2: { serviceName: 'mcp-gateway' } },
  spans: [
    { traceID: 'a1b2c3d4e5f60718', spanID: 's1', processID: 'p1', operationName: 'POST /run', startTime: 1, duration: 50000, references: [], tags: [] },
    { traceID: 'a1b2c3d4e5f60718', spanID: 's2', processID: 'p2', operationName: 'mcp:tool', startTime: 2, duration: 12000, references: [{ refType: 'CHILD_OF', spanID: 's1' }], tags: [] },
  ],
};

afterEach(() => jest.resetAllMocks());

beforeEach(() => configStore.getEffective.mockImplementation(() => ''));

describe('GET /api/health/tracing/graph', () => {
  it('fail-soft 200 when Jaeger is unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(makeApp()).get('/api/health/tracing/graph');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tracingEnabled: false, nodes: [], edges: [] });
    expect(typeof res.body.fetchedAt).toBe('string');
  });

  it('overview aggregates traces across services, deduped by traceID', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({ status: 200, data: { data: ['demo-api-server', 'mcp-gateway'] } })],
      ['/api/traces', () => Promise.resolve({ status: 200, data: { data: [TRACE] } })],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/graph?lookback=1h');
    expect(res.status).toBe(200);
    expect(res.body.tracingEnabled).toBe(true);
    expect(res.body.nodes.map((n) => n.id).sort()).toEqual(['chat-ui', 'demo-api-server', 'mcp-gateway']);
    expect(res.body.edges).toEqual([
      { source: 'chat-ui', target: 'demo-api-server', label: 'HTTPS' },
      { source: 'demo-api-server', target: 'mcp-gateway', label: 'mcp:tool' },
    ]);
  });

  it('detailed returns span graph for a traceId', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } })],
      [`/api/traces/${TRACE.traceID}`, () => Promise.resolve({ status: 200, data: { data: [TRACE] } })],
    ]);
    const res = await request(makeApp()).get(`/api/health/tracing/graph?traceId=${TRACE.traceID}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.edges).toEqual([{ source: 's1', target: 's2', label: 'mcp:tool' }]);
  });

  it('rejects malformed traceId with 400', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } })],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/graph?traceId=nope!');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_trace_id');
  });

  it('detailed returns 404 when Jaeger has no such trace', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } })],
      [`/api/traces/${TRACE.traceID}`, () => Promise.resolve({ status: 200, data: { data: [] } })],
    ]);
    const res = await request(makeApp()).get(`/api/health/tracing/graph?traceId=${TRACE.traceID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('trace_not_found');
  });

  it('detailed returns 404 when Jaeger itself 404s', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } })],
      [`/api/traces/${TRACE.traceID}`, () => {
        const err = new Error('Not Found');
        err.response = { status: 404 };
        return Promise.reject(err);
      }],
    ]);
    const res = await request(makeApp()).get(`/api/health/tracing/graph?traceId=${TRACE.traceID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('trace_not_found');
  });

  it('fail-soft 200 with tracingEnabled:false when ff_tracing flag is off', async () => {
    configStore.getEffective.mockImplementation((key) => (key === 'ff_tracing' ? 'false' : ''));
    mockJaeger([
      ['/api/services', () => Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } })],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/graph');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tracingEnabled: false, nodes: [], edges: [] });
  });
});
