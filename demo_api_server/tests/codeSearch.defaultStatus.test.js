const express = require('express');
const request = require('supertest');

jest.mock('../src/services/mcpCodeSearchClient');

test('GET /default-status returns the indexer status shape', async () => {
  const router = require('../routes/codeSearch');
  const app = express();
  app.use('/api/code-search', router);
  const res = await request(app).get('/api/code-search/default-status');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('state');
  expect(['idle', 'indexing', 'ready', 'error']).toContain(res.body.state);
});
