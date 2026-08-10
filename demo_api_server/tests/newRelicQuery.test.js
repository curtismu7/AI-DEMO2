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

  it('accepts the 14d window', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] },
    });
    const res = await request(makeApp()).get('/api/newrelic/view/pipeline?window=14d');
    expect(res.status).toBe(200);
    expect(res.body.window).toBe('14d');
    const sent = axios.post.mock.calls[0][1].query;
    expect(sent).toContain('14 days ago');
    expect(sent).toContain('TIMESERIES 12 hours');
  });

  it('maps the authorize view into decisions/posture/timeseries/stream', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      decisions: { results: [{ decision: 'PERMIT', count: 1 }, { decision: 'DENY', count: 2 }] },
      posture: { results: [{ tag: 'authorize/fail-open', count: 1 }] },
      rules: { results: [{ ruleName: 'Wire Fraud Block', count: 2 }] },
      timeseries: { results: [{ beginTimeSeconds: 10, count: 3 }] },
      stream: { results: [{ timestamp: 1, tag: 'authorize/deny', decision: 'DENY', amount: 60000, stepUpRequired: false, type: 'transfer', engine: 'pingone' }] },
    });
    const res = await request(makeApp()).get('/api/newrelic/view/authorize?window=24h');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('authorize');
    expect(res.body.decisions).toHaveLength(2);
    expect(res.body.posture[0].tag).toBe('authorize/fail-open');
    expect(res.body.rules).toEqual([{ ruleName: 'Wire Fraud Block', count: 2 }]);
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

describe('GET /api/newrelic/view/:view search (q)', () => {
  function nerdgraphOk(account) {
    axios.post.mockResolvedValue({ data: { data: { actor: { account } } } });
  }

  it('an absent q behaves exactly as before: no LIKE clause, q reported as empty', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({ funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] } });
    const res = await request(makeApp()).get('/api/newrelic/view/pipeline?window=1h');
    expect(res.status).toBe(200);
    expect(res.body.q).toBe('');
    const sent = axios.post.mock.calls[0][1].query;
    expect(sent).not.toContain('LIKE');
  });

  it('an empty q behaves exactly as an absent one', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({ funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] } });
    const res = await request(makeApp()).get('/api/newrelic/view/pipeline?window=1h&q=');
    expect(res.body.q).toBe('');
    const sent = axios.post.mock.calls[0][1].query;
    expect(sent).not.toContain('LIKE');
  });

  it('a search term reaches only the stream query, filtering on message', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({ funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] } });
    const res = await request(makeApp()).get('/api/newrelic/view/pipeline?window=1h&q=PingOne');
    expect(res.body.q).toBe('PingOne');
    const sent = axios.post.mock.calls[0][1].query;

    // Only the stream sub-query carries the filter.
    const streamMatch = sent.match(/stream: nrql\(query: "([\s\S]*?)"\)/);
    expect(streamMatch[1]).toContain("message LIKE '%PingOne%'");
    const funnelMatch = sent.match(/funnel: nrql\(query: "([\s\S]*?)"\)/);
    expect(funnelMatch[1]).not.toContain('LIKE');
    const timeseriesMatch = sent.match(/timeseries: nrql\(query: "([\s\S]*?)"\)/);
    expect(timeseriesMatch[1]).not.toContain('LIKE');
  });

  it('the authorize view applies q to stream only, leaving decisions/posture/rules/timeseries unfiltered', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({
      decisions: { results: [] }, posture: { results: [] }, rules: { results: [] },
      timeseries: { results: [] }, stream: { results: [] },
    });
    await request(makeApp()).get('/api/newrelic/view/authorize?window=24h&q=wire+fraud');
    const sent = axios.post.mock.calls[0][1].query;

    const streamMatch = sent.match(/stream: nrql\(query: "([\s\S]*?)"\)/);
    expect(streamMatch[1]).toContain("message LIKE '%wire fraud%'");
    for (const field of ['decisions', 'posture', 'rules', 'timeseries']) {
      const m = sent.match(new RegExp(`${field}: nrql\\(query: "([\\s\\S]*?)"\\)`));
      expect(m[1]).not.toContain('LIKE');
    }
  });

  it("an apostrophe in the term is escaped and cannot break out of the NRQL string literal", async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({ funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] } });
    await request(makeApp()).get(`/api/newrelic/view/pipeline?window=1h&q=${encodeURIComponent("it's")}`);
    const sent = axios.post.mock.calls[0][1].query;

    // The apostrophe must be backslash-escaped inside the NRQL literal. Once
    // the whole NRQL string is JSON.stringify'd to embed in the GraphQL
    // query text, that single escaping backslash is itself doubled — so the
    // literal, unescaped text sent over the wire contains two backslashes
    // ahead of the apostrophe.
    expect(sent).toContain("LIKE '%it\\\\'s%'");
    // And the broken/unescaped form (a bare apostrophe with no backslash
    // ahead of it) must not appear — that would mean the literal closed
    // early and "s%'" became trailing NRQL syntax.
    expect(sent).not.toContain("LIKE '%it's%'");
  });

  it('a double quote in the term does not need extra handling — the outer JSON.stringify wrap already escapes it', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({ funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] } });
    const res = await request(makeApp())
      .get(`/api/newrelic/view/pipeline?window=1h&q=${encodeURIComponent('"drop"')}`);
    expect(res.status).toBe(200);
    const sent = axios.post.mock.calls[0][1].query;
    expect(sent).toContain('LIKE \'%\\"drop\\"%\'');
  });

  it('a term over MAX_SEARCH_LEN is truncated, not rejected, and the reported q reflects what was applied', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';
    nerdgraphOk({ funnel: { results: [] }, timeseries: { results: [] }, stream: { results: [] } });
    const huge = 'x'.repeat(250);
    const res = await request(makeApp()).get(`/api/newrelic/view/pipeline?window=1h&q=${huge}`);
    expect(res.status).toBe(200);
    expect(res.body.q).toBe('x'.repeat(200));
    expect(res.body.q.length).toBe(200);
    const sent = axios.post.mock.calls[0][1].query;
    expect(sent).toContain(`LIKE '%${'x'.repeat(200)}%'`);
    expect(sent).not.toContain('x'.repeat(201));
  });

  it('the cache does not serve a searched payload to an unsearched request, or vice versa', async () => {
    process.env.NR_USER_API_KEY = 'k';
    process.env.NR_ACCOUNT_ID = '8369622';

    nerdgraphOk({
      funnel: { results: [] }, timeseries: { results: [] },
      stream: { results: [{ message: 'unfiltered event' }] },
    });
    const unsearched = await request(makeApp()).get('/api/newrelic/view/pipeline?window=1h');
    expect(unsearched.body.stream).toEqual([{ message: 'unfiltered event' }]);

    nerdgraphOk({
      funnel: { results: [] }, timeseries: { results: [] },
      stream: { results: [{ message: 'PingOne match only' }] },
    });
    const searched = await request(makeApp()).get('/api/newrelic/view/pipeline?window=1h&q=PingOne');
    expect(searched.body.stream).toEqual([{ message: 'PingOne match only' }]);

    // Re-requesting the unsearched form must still get the unsearched
    // payload from cache, not the searched one (and vice versa already
    // proven above by the distinct nerdgraphOk stubs both being consumed).
    const unsearchedAgain = await request(makeApp()).get('/api/newrelic/view/pipeline?window=1h');
    expect(unsearchedAgain.body.stream).toEqual([{ message: 'unfiltered event' }]);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
