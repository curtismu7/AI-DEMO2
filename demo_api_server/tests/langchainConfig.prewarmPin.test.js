// demo_api_server/tests/langchainConfig.prewarmPin.test.js
'use strict';

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

describe('POST /api/langchain/llamacpp/prewarm pin guard', () => {
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

  afterEach(() => {
    delete global.fetch;
  });

  test('skips ensure when proxy is pinned to a different tier', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ pin: { name: 'llama-3.2-3b-instruct', port: 8091 } }),
    });

    const res = await request(app)
      .post('/api/langchain/llamacpp/prewarm')
      .send({ model: 'gpt-oss-20b' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      skipped: true,
      reason: 'pinned',
      model: 'gpt-oss-20b',
      port: 8096,
      pinned: { name: 'llama-3.2-3b-instruct', port: 8091 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/status');
  });

  test('calls ensure when requested model matches the pin', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pin: { name: 'llama-3.2-3b-instruct', port: 8091 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, port: 8091 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    const res = await request(app)
      .post('/api/langchain/llamacpp/prewarm')
      .send({ model: 'llama-3.2-3b-instruct' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, model: 'llama-3.2-3b-instruct', port: 8091 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/ensure?port=8091');
  });

  test('calls ensure when proxy has no pin', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pin: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, port: 8096 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    const res = await request(app)
      .post('/api/langchain/llamacpp/prewarm')
      .send({ model: 'gpt-oss-20b' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, model: 'gpt-oss-20b', port: 8096 });
    expect(String(fetchMock.mock.calls[1][0])).toContain('/ensure?port=8096');
  });
});
