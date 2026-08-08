'use strict';
const request = require('supertest');
const express = require('express');

jest.mock('axios');
const axios = require('axios');
// Required once at module scope (not inside makeApp) — src/__tests__/setup.js
// runs a global jest.resetModules() in afterEach, which would otherwise hand a
// fresh, disconnected axios mock to a route required per-test. Matches the
// pattern in tests/tracingRoute.test.js.
const newRelicQueryRoute = require('../routes/newRelicQuery');

function makeApp() {
  const app = express();
  app.use('/api/newrelic', newRelicQueryRoute);
  return app;
}

const OLD_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...OLD_ENV };
  jest.clearAllMocks();
});

describe('GET /api/newrelic/pipeline', () => {
  it('503s when NR_USER_API_KEY is absent', async () => {
    delete process.env.NR_USER_API_KEY;
    process.env.NR_ACCOUNT_ID = '8369622';
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('newrelic_not_configured');
  });

  it('503s when NR_ACCOUNT_ID is absent', async () => {
    process.env.NR_USER_API_KEY = 'k';
    delete process.env.NR_ACCOUNT_ID;
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(503);
  });

  it('400s on a window outside the fixed map', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    const res = await request(makeApp())
      .get('/api/newrelic/pipeline?window=1+hour+ago+OR+1=1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_window');
  });

  it('maps a NerdGraph response into the flat payload', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    axios.post.mockResolvedValue({
      data: { data: { actor: { account: {
        funnel: { results: [{ category: 'oauth', count: 13 }] },
        timeseries: { results: [{ beginTimeSeconds: 100, count: 5 }] },
        stream: { results: [{
          timestamp: 1700, message: 'MCP tool call', category: 'mcp',
          severity: 'info', correlationId: 'abc',
        }] },
      } } } },
    });

    const res = await request(makeApp()).get('/api/newrelic/pipeline?window=24h');

    expect(res.status).toBe(200);
    expect(res.body.window).toBe('24h');
    expect(res.body.funnel).toEqual([{ category: 'oauth', count: 13 }]);
    expect(res.body.timeseries).toEqual([{ beginTimeSeconds: 100, count: 5 }]);
    expect(res.body.stream[0].correlationId).toBe('abc');
  });

  it('sends the API key as a header and never in the body', async () => {
    process.env.NR_USER_API_KEY = 'secret-key';
    process.env.NR_ACCOUNT_ID = '8369622';
    axios.post.mockResolvedValue({
      data: { data: { actor: { account: {
        funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] },
      } } } },
    });

    await request(makeApp()).get('/api/newrelic/pipeline');

    const [, body, config] = axios.post.mock.calls[0];
    expect(config.headers['Api-Key']).toBe('secret-key');
    expect(JSON.stringify(body)).not.toContain('secret-key');
  });

  it('502s when NerdGraph fails, without leaking the upstream error', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    axios.post.mockRejectedValue(new Error('ECONNREFUSED 1.2.3.4'));
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('newrelic_query_failed');
    expect(JSON.stringify(res.body)).not.toContain('1.2.3.4');
  });

  it('502s when NerdGraph returns GraphQL errors', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    axios.post.mockResolvedValue({
      data: { errors: [{ message: 'bad nrql' }] },
    });
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(502);
  });
});
