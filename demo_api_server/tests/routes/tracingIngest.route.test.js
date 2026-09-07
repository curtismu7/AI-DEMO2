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

const OTLP_BODY = { resourceSpans: [{ resource: {}, scopeSpans: [] }] };

afterEach(() => jest.resetAllMocks());
beforeEach(() => configStore.getEffective.mockImplementation(() => ''));

describe('POST /api/health/tracing/ingest', () => {
  test('204s and skips the forward entirely when ff_tracing is off', async () => {
    configStore.getEffective.mockImplementation((key) => (key === 'ff_tracing' ? 'false' : ''));
    const res = await request(makeApp()).post('/api/health/tracing/ingest').send(OTLP_BODY);
    expect(res.status).toBe(204);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('202s and forwards the raw OTLP body to jaeger:4318/v1/traces as JSON', async () => {
    axios.post.mockResolvedValue({ status: 200, data: {} });
    const res = await request(makeApp()).post('/api/health/tracing/ingest').send(OTLP_BODY);
    expect(res.status).toBe(202);
    expect(axios.post).toHaveBeenCalledWith(
      'http://jaeger:4318/v1/traces',
      OTLP_BODY,
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
  });

  test('still 202s when every candidate is unreachable — never a user-visible failure', async () => {
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(makeApp()).post('/api/health/tracing/ingest').send(OTLP_BODY);
    expect(res.status).toBe(202);
  });
});
