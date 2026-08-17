// demo_api_server/tests/langchainConfig.prewarmNoTierManager.test.js
'use strict';

/**
 * POST /api/langchain/llamacpp/prewarm when no tier-manager is deployed.
 *
 * docker-compose.yml gates `tier-manager-k8` behind the `k8-build` profile and
 * it never starts in compose, so on every local stack this fetch fails. The
 * route used to answer 502, and the dashboard calls prewarm on load — so `/`
 * and `/dashboard` logged a hard 502 on every single page view. Found by
 * driving the live UI.
 *
 * Prewarm is a latency optimization; the tier still loads on first use. A
 * missing swap manager is "nothing to do", not an error. A permanent 502 trains
 * everyone to ignore console errors on the dashboard, which is how a real
 * failure gets missed.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../services/configStore', () => {
  const store = {};
  return {
    getEffective: jest.fn((k) => store[k]),
    setConfig: jest.fn(async (u) => Object.assign(store, u)),
    __store: store,
  };
});

describe('POST /api/langchain/llamacpp/prewarm without a tier-manager', () => {
  let app;
  let fetchMock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    app = express();
    app.use(express.json());
    app.use((req, _r, n) => { req.session = {}; n(); });
    app.use('/api/langchain', require('../routes/langchainConfig'));
  });

  afterEach(() => { delete global.fetch; });

  test('an unreachable tier-manager reports skipped, not 502', async () => {
    // 1st fetch = proxy pin probe (no pin), 2nd = tier-manager /ensure → down.
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const res = await request(app)
      .post('/api/langchain/llamacpp/prewarm')
      .send({ model: 'gpt-oss-20b' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.skipped).toBe(true);
    expect(res.body.reason).toBe('tier-manager-unavailable');
  });

  test('ECONNREFUSED is treated the same way', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8097'));

    const res = await request(app)
      .post('/api/langchain/llamacpp/prewarm')
      .send({ model: 'gpt-oss-20b' });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
  });

  test('a tier-manager that IS deployed but failing stays a loud 502', async () => {
    // Not a connectivity signature — a real error must not be silently swallowed.
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockRejectedValueOnce(new Error('tier swap crashed: out of memory'));

    const res = await request(app)
      .post('/api/langchain/llamacpp/prewarm')
      .send({ model: 'gpt-oss-20b' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('tier-manager unreachable');
  });

  test('an unknown tier model is still a 400', async () => {
    const res = await request(app)
      .post('/api/langchain/llamacpp/prewarm')
      .send({ model: 'not-a-tier' });

    expect(res.status).toBe(400);
  });
});
