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
beforeEach(() => {
  // The response cache (Finding 2) is module-level state on the router
  // required at module scope above, so it survives across specs in this
  // file unless reset explicitly.
  newRelicQueryRoute._resetCache();
});
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

  it('503s when NR_ACCOUNT_ID is non-numeric', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = 'not-a-number';
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('newrelic_not_configured');
  });

  it('503s when NR_ACCOUNT_ID is an empty string (Number("") is 0, not NaN)', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '';
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('newrelic_not_configured');
  });

  it('503s when NR_ACCOUNT_ID is whitespace-only', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '   ';
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('newrelic_not_configured');
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

  it('serves a cached response within the TTL instead of issuing a second axios call', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    axios.post.mockResolvedValue({
      data: { data: { actor: { account: {
        funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] },
      } } } },
    });

    const app = makeApp();
    const first = await request(app).get('/api/newrelic/pipeline?window=1h');
    const second = await request(app).get('/api/newrelic/pipeline?window=1h');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/newrelic/view/:view', () => {
  function nerdgraphOk(account) {
    axios.post.mockResolvedValue({ data: { data: { actor: { account } } } });
  }

  it('400s on an unknown view', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    const res = await request(makeApp()).get('/api/newrelic/view/not-a-view');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_view');
  });

  it.each(['__proto__', 'constructor'])(
    '400s on the prototype-chain view name %s instead of falling through to a 502',
    async (viewName) => {
      process.env.NR_USER_API_KEY = 'k';
      process.env.NR_ACCOUNT_ID = '8369622';
      const res = await request(makeApp()).get(`/api/newrelic/view/${viewName}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_view');
    },
  );

  it('accepts the 7d window', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] },
    });
    const res = await request(makeApp()).get('/api/newrelic/view/pipeline?window=7d');
    expect(res.status).toBe(200);
    expect(res.body.window).toBe('7d');
    const sent = axios.post.mock.calls[0][1].query;
    expect(sent).toContain('7 days ago');
    expect(sent).toContain('TIMESERIES 6 hours');
  });

  it('maps the authorize view into decisions/posture/timeseries/stream', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      decisions: { results: [{ decision: 'PERMIT', count: 1 }, { decision: 'DENY', count: 2 }] },
      posture: { results: [{ tag: 'authorize/fail-open', count: 1 }] },
      timeseries: { results: [{ beginTimeSeconds: 10, count: 3 }] },
      stream: { results: [{ timestamp: 1, tag: 'authorize/deny', decision: 'DENY', amount: 60000, stepUpRequired: false, type: 'transfer', engine: 'pingone' }] },
    });
    const res = await request(makeApp()).get('/api/newrelic/view/authorize?window=24h');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('authorize');
    expect(res.body.decisions).toHaveLength(2);
    expect(res.body.posture[0].tag).toBe('authorize/fail-open');
    expect(res.body.stream[0].amount).toBe(60000);
  });

  it("the authorize view queries category='authorize', not logtype", async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      decisions: { results: [] }, posture: { results: [] },
      timeseries: { results: [] }, stream: { results: [] },
    });
    await request(makeApp()).get('/api/newrelic/view/authorize');
    const sent = axios.post.mock.calls[0][1].query;
    expect(sent).toContain("category='authorize'");
    expect(sent).toContain('FACET decision');
    expect(sent).toContain('FACET tag');
  });

  it('caches per view, so authorize does not serve the pipeline payload', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] },
    });
    await request(makeApp()).get('/api/newrelic/view/pipeline?window=1h');

    nerdgraphOk({
      decisions: { results: [{ decision: 'PERMIT', count: 9 }] }, posture: { results: [] },
      timeseries: { results: [] }, stream: { results: [] },
    });
    const res = await request(makeApp()).get('/api/newrelic/view/authorize?window=1h');
    expect(res.body.view).toBe('authorize');
    expect(res.body.decisions[0].count).toBe(9);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('keeps /pipeline working as an alias', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      funnel: { results: [{ category: 'oauth', count: 4 }] },
      timeseries: { results: [] }, stream: { results: [] },
    });
    const res = await request(makeApp()).get('/api/newrelic/pipeline');
    expect(res.status).toBe(200);
    expect(res.body.funnel[0].category).toBe('oauth');
  });
});
