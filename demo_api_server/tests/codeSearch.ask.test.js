const express = require('express');
const request = require('supertest');
jest.mock('../src/services/mcpCodeSearchClient');

beforeAll(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ answer: 'ok', sources: [], toolCalls: 0, mode: 'single-shot' }),
  }));
});

test('POST /ask proxies to the llamaindex agent', async () => {
  const app = express();
  app.use('/api/code-search', require('../routes/codeSearch'));
  const res = await request(app)
    .post('/api/code-search/ask')
    .send({ question: 'where is auth?', codebase_id: 'ai-demo2-default' });
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('answer', 'ok');
  expect(res.body).toHaveProperty('mode');
});
